/* eslint-disable no-console, @typescript-eslint/no-explicit-any */

import { getAvailableApiSites, getConfig, getFilteredApiSites } from './config';
import {
  fetchByCategory,
  fetchCategories,
  getDetailFromApi,
  searchFromApi,
} from './downstream';
import {
  buildEpisodesFor,
  buildSeasonItem,
  classifyId,
  encodeItemId,
  LIBRARIES,
  libraryKeyForItem,
  parseSeriesInfo,
  registerItemId,
  toEmbyItem,
} from './emby.catalog';
import {
  buildMediaSourceFromResult,
  ResolvedStream,
  resolveStreamUrl,
} from './emby.playback';
import {
  EmbyBaseItemDto,
  EmbyMediaSourceInfo,
  EmbyUserItemData,
} from './emby.types';
import { SearchResult } from './types';

/**
 * 条目解析层。
 *
 * Emby 客户端会用只有它自己知道的 Id 回调（如 PlaybackInfo、图片、
 * 分集列表），而我们的 Id 是由 source+源站id 派生的不可逆 GUID。
 * 因此这里统一负责：
 *   1. 内存索引命中（同进程内已注册过的条目）
 *   2. 回源搜索（冷启动 / 换实例后按标题找回）
 */

/** 解析出的条目上下文 */
export interface ResolvedItem {
  itemId: string;
  source: string;
  sourceId: string;
  result: SearchResult;
}

/** 源表登记状态缓存（并发共享同一个 Promise） */
let sourcesReady: Promise<void> | null = null;

/**
 * 确保源 key 已登记到 Id 编解码表。
 *
 * getConfig() 内部会调用 registerSourcesForIdDecoding()，
 * 因此在做任何 classifyId() 之前调一次即可。
 * 用 Promise 缓存避免并发请求重复读取配置。
 *
 * ⚠️ 所有直接调用 classifyId() 的路由都应先 await 本函数，
 * 否则冷启动 isolate 会把合法 Id 误判为 unknown。
 */
export function ensureSourcesRegistered(): Promise<void> {
  if (!sourcesReady) {
    sourcesReady = getConfig()
      .then(() => undefined)
      .catch((err) => {
        // 失败时允许下次重试，避免一次抖动导致整段生命周期不可用
        sourcesReady = null;
        console.error('登记源 key 失败:', err);
      });
  }
  return sourcesReady;
}

/**
 * 根据 Emby 条目 Id 解析回源内容。
 *
 * 流程：
 *   1. 内存索引命中 -> 用已知 source+id 拉详情
 *   2. 未命中 -> 调用 search() 按标题模糊搜索并匹配
 *
 * @param itemId       Emby 条目 Id（Movie/Series 层级）
 * @param fallbackName 客户端可能回传的标题，用于回源搜索
 * @param userName     用于应用成人内容过滤设置
 */
export async function resolveItem(
  itemId: string,
  fallbackName?: string,
  userName?: string
): Promise<ResolvedItem | null> {
  // ⚠️ 必须先登记源 key 再做 Id 解码。
  //
  // 条目 Id 是「源哈希 + 数字 id」的可逆编码，反解时需要用哈希
  // 查回源 key；而源表只在 getConfig() 中被填充。Cloudflare 是多
  // isolate 的，冷启动 isolate 里若无任何请求先触发 getConfig()，
  // classifyId() 就会因查不到源而返回 unknown —— 表现为
  // 「封面显示 No Image 占位图 + 点开条目 404 Item not found」。
  await ensureSourcesRegistered();

  const classified = classifyId(itemId);

  // 1) 命中内存索引：直接按 source + id 取详情
  if (classified.kind === 'item') {
    const detail = await fetchDetail(classified.source, classified.sourceId);
    if (detail) {
      return {
        itemId,
        source: classified.source,
        sourceId: classified.sourceId,
        result: detail,
      };
    }
  }

  if (classified.kind === 'episode') {
    const detail = await fetchDetail(classified.source, classified.sourceId);
    if (detail) {
      return {
        itemId,
        source: classified.source,
        sourceId: classified.sourceId,
        result: detail,
      };
    }
  }

  // 2) 未命中：按标题回源搜索
  if (fallbackName && fallbackName.trim()) {
    const found = await findByTitle(fallbackName, userName);
    if (found) {
      return {
        itemId: encodeItemId(found.source, found.id),
        source: found.source,
        sourceId: found.id,
        result: found,
      };
    }
  }

  return null;
}

/** 用 source + sourceId 取详情 */
async function fetchDetail(
  source: string,
  sourceId: string
): Promise<SearchResult | null> {
  try {
    const sites = await getAvailableApiSites();
    const site = sites.find((s) => s.key === source);
    if (!site) return null;

    const detail = await getDetailFromApi(site, sourceId);
    if (detail && detail.episodes?.length) {
      registerItemId(encodeItemId(source, sourceId), source, sourceId);
      return detail;
    }
    return detail || null;
  } catch (err) {
    console.error(`获取详情失败 ${source}/${sourceId}:`, err);
    return null;
  }
}

/** 按标题在所有可用源中搜索，取最佳匹配 */
export async function findByTitle(
  title: string,
  userName?: string
): Promise<SearchResult | null> {
  try {
    const sites = userName
      ? await getFilteredApiSites(userName)
      : await getAvailableApiSites(true);

    if (!sites.length) return null;

    const results = (
      await Promise.all(sites.map((site) => searchFromApi(site, title)))
    ).flat();

    if (!results.length) return null;

    // 优先精确匹配标题，其次取第一个结果
    const normalized = normalizeTitle(title);
    const exact = results.find((r) => normalizeTitle(r.title) === normalized);
    return exact || results[0];
  } catch (err) {
    console.error('按标题回源搜索失败:', err);
    return null;
  }
}

/** 标题归一化，忽略空格/标点/季集后缀差异 */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[·・:：\-—_.,，。!！?？'"“”‘’()（）[\]【】]/g, '')
    .replace(/第[0-9一二三四五六七八九十]+[季集部]/g, '')
    .trim();
}

/**
 * 媒体库内容列表。
 *
 * ⚠️ 之前的实现用「分类名当搜索词」（fetchByCategory 不存在时走
 * searchFromApi('电影')），但 `wd=` 是**片名关键词**搜索，
 * 搜「电影」「综艺」几乎必然返回空 —— 这正是媒体库为空的原因。
 *
 * 现在的策略（按可靠性排序）：
 *   1. 读取资源站真实分类表（ac=list），挑出属于该库的分类 ID，
 *      用 ac=detail&t=<id> 分页拉取真正的列表内容。
 *   2. 分类接口不可用时，回退到用若干**具体片名/热词**搜索，
 *      并放宽归类限制，保证库里有内容而不是空白。
 */
export async function listLibraryItems(opts: {
  libraryKey: string;
  userName?: string;
  userDataFor?: (itemId: string) => EmbyUserItemData | undefined;
  maxItems?: number;
}): Promise<EmbyBaseItemDto[]> {
  const { libraryKey, userName, userDataFor } = opts;
  const maxItems = opts.maxItems ?? 60;

  const sites = userName
    ? await getFilteredApiSites(userName)
    : await getAvailableApiSites(true);

  if (!sites.length) return [];

  const collected = new Map<string, SearchResult>();

  const addAll = (items: SearchResult[], strict: boolean) => {
    for (const item of items) {
      const key = `${item.source}:${item.id}`;
      if (collected.has(key)) continue;
      // strict 模式下按分类精确归属，避免各库互相污染；
      // 回退模式下放宽，保证有内容可展示
      if (strict && libraryKeyForItem(item) !== libraryKey) continue;
      collected.set(key, item);
    }
  };

  // ---------- 策略 1：按上游真实分类浏览 ----------
  let usedCategories = false;

  const categoryResults = await Promise.all(
    sites.map(async (site) => {
      const categories = await fetchCategories(site);
      if (!categories.length) return [] as SearchResult[];

      // 找出属于本库的分类 ID
      const wanted = categories.filter(
        (c) => libraryKeyForCategoryName(c.type_name) === libraryKey
      );
      if (!wanted.length) return [] as SearchResult[];

      const pages = await Promise.all(
        wanted.slice(0, 6).map((c) => fetchByCategory(site, c.type_id, 1))
      );
      return pages.flat();
    })
  );

  for (const batch of categoryResults) {
    if (batch.length) {
      usedCategories = true;
      addAll(batch, false); // 来自真实分类，无需再过滤
    }
  }

  // ---------- 策略 2：回退到热词搜索 ----------
  if (!usedCategories || collected.size < 12) {
    for (const q of queriesForLibrary(libraryKey)) {
      const batches = await Promise.all(
        sites.map((site) =>
          searchFromApi(site, q).catch(() => [] as SearchResult[])
        )
      );
      // 先严格归类，避免热词结果污染其他库
      addAll(batches.flat(), true);
      if (collected.size >= maxItems) break;
    }
  }

  return Array.from(collected.values())
    .slice(0, maxItems)
    .map((r) =>
      toEmbyItem(r, { userData: userDataFor?.(encodeItemId(r.source, r.id)) })
    );
}

/** 依据上游分类名判定归属的库（用于 ac=list 的 type_name） */
export function libraryKeyForCategoryName(typeName: string): string {
  const text = String(typeName || '').toLowerCase().trim();
  if (!text) return '';

  for (const lib of LIBRARIES) {
    for (const kw of lib.keywords) {
      if (text.includes(kw.toLowerCase())) return lib.key;
    }
  }
  return '';
}

/**
 * 每个媒体库的回退检索词。
 *
 * 注意：这里用的是**真实影片类型热词**而非「电影」这种分类名，
 * 因为 wd= 是片名搜索。仍然可能命中不多，仅作为策略 1 的兜底。
 */
function queriesForLibrary(libraryKey: string): string[] {
  switch (libraryKey) {
    case 'movies':
      return ['动作', '喜剧', '科幻', '爱情', '战争'];
    case 'tvshows':
      return ['国产剧', '韩剧', '美剧', '港剧'];
    case 'anime':
      return ['动漫', '国漫', '日漫'];
    case 'variety':
      return ['综艺', '真人秀'];
    case 'documentary':
      return ['纪录片', '探索'];
    default:
      return ['动作'];
  }
}

/**
 * 获取 Series 的分集。
 * 客户端进入剧集详情页时调用，返回 Episode 列表。
 */
export async function resolveEpisodes(
  itemId: string,
  fallbackName?: string,
  userName?: string,
  userDataFor?: (itemId: string) => EmbyUserItemData | undefined
): Promise<EmbyBaseItemDto[]> {
  const resolved = await resolveItem(itemId, fallbackName, userName);
  if (!resolved) return [];
  return buildEpisodesFor(resolved.result, userDataFor);
}

/**
 * 获取 Series 下的季列表。
 *
 * Emby 官方客户端与 Yamby 等的导航路径是
 * Series -> Season -> Episode。早期实现从不返回 Season 条目，
 * 导致这些客户端在「季」这一层拿到空列表 —— 表现为**没有剧集列表**。
 *
 * 由于聚合源把一个剧的所有分集放在同一个列表里，这里统一
 * 只暴露一个季（第 1 季，或标题中解析出的季号）。
 */
export async function resolveSeasons(
  itemId: string,
  userName?: string,
  userDataFor?: (itemId: string) => EmbyUserItemData | undefined
): Promise<EmbyBaseItemDto[]> {
  const resolved = await resolveItem(itemId, undefined, userName);
  if (!resolved) return [];
  return seasonsFor(resolved.result, userDataFor);
}

/**
 * 由 source / sourceId 直接构造季列表（无需回源搜索）。
 * 供详情端点解析 Season Id 时使用。
 */
export async function resolveSeasonsForLocation(
  source: string,
  sourceId: string,
  userDataFor?: (itemId: string) => EmbyUserItemData | undefined
): Promise<EmbyBaseItemDto[]> {
  const detail = await fetchDetail(source, sourceId);
  if (!detail) return [];
  return seasonsFor(detail, userDataFor);
}

/** 由搜索结果构造季列表 */
function seasonsFor(
  result: SearchResult,
  userDataFor?: (itemId: string) => EmbyUserItemData | undefined
): EmbyBaseItemDto[] {
  const episodeCount = result.episodes?.length || 0;
  if (episodeCount === 0) return [];

  const { seasonNumber } = parseSeriesInfo(result.title);
  const season = seasonNumber || 1;

  return [
    buildSeasonItem(
      result.source,
      result.id,
      season,
      `第 ${season} 季`,
      episodeCount,
      result.poster,
      undefined,
      userDataFor
    ),
  ];
}

/**
 * 直接按 source / sourceId 取某季的分集。
 * 供 ParentId 为季 Id 时调用（第二跳），无需再回源搜索。
 */
export async function resolveEpisodesForSeason(
  source: string,
  sourceId: string,
  userName?: string,
  userDataFor?: (itemId: string) => EmbyUserItemData | undefined
): Promise<EmbyBaseItemDto[]> {
  void userName;
  const detail = await fetchDetail(source, sourceId);
  if (!detail) return [];
  return buildEpisodesFor(detail, userDataFor);
}

/**
 * 解析条目并构造 MediaSource。
 * PlaybackInfo 与 stream 路由共用。
 */
export async function resolveMediaSource(opts: {
  itemId: string;
  fallbackName?: string;
  userName?: string;
  episodeIndex?: number;
  mediaSourceId?: string;
  baseUrl: string;
  durationSec?: number;
}): Promise<{ mediaSource: EmbyMediaSourceInfo; result: SearchResult } | null> {
  const {
    itemId,
    fallbackName,
    userName,
    episodeIndex,
    mediaSourceId,
    baseUrl,
    durationSec,
  } = opts;

  // Episode 形态的 Id：直接能得到 source/sourceId/index
  const classified = classifyId(itemId);

  let resolved: ResolvedItem | null = null;
  let epIndex = episodeIndex;

  if (classified.kind === 'episode') {
    resolved = await resolveItem(itemId, fallbackName, userName);
    epIndex = classified.index + 1; // 内部 0 基 -> Emby 1 基
  } else {
    resolved = await resolveItem(itemId, fallbackName, userName);
  }

  if (!resolved) return null;

  const mediaSource = buildMediaSourceFromResult({
    result: resolved.result,
    itemId: resolved.itemId,
    episodeIndex: epIndex,
    baseUrl,
    durationSec,
  });

  if (!mediaSource) return null;

  // 客户端指定的 MediaSourceId 优先（多版本场景）
  if (mediaSourceId) {
    mediaSource.Id = mediaSourceId;
  }

  return { mediaSource, result: resolved.result };
}

/**
 * 直接由 (source, sourceId, episodeIndex) 解析播放地址。
 * stream 代理路由使用，避免两次回源搜索。
 */
export async function resolveStreamByLocation(opts: {
  source: string;
  sourceId: string;
  episodeIndex?: number;
}): Promise<{ stream: ResolvedStream; result: SearchResult } | null> {
  const detail = await fetchDetail(opts.source, opts.sourceId);
  if (!detail || !detail.episodes?.length) return null;

  const episodes = detail.episodes;
  const idx =
    opts.episodeIndex && opts.episodeIndex > 0 ? opts.episodeIndex - 1 : 0;
  const raw = episodes[idx] ?? episodes[0];
  const stream = resolveStreamUrl(raw);
  if (!stream) return null;

  return { stream, result: detail };
}

export { parseSeriesInfo };
