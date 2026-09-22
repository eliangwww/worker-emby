import { getStorage } from '@/lib/db';
import {
  buildEpisodesFor,
  classifyId,
  encodeItemId,
  sortItems,
  toEmbyItem,
} from '@/lib/emby.catalog';
import {
  embyJson,
  parsePaging,
  resolveBaseUrl,
  withEmbyAuth,
} from '@/lib/emby.http';
import {
  attachMediaSources,
  listLibraryItems,
  normalizeTitle,
  resolveEpisodes,
  resolveEpisodesForSeason,
  ensureSourcesRegistered,
  resolveItem,
  resolveSeasons,
} from '@/lib/emby.items';
import { EmbyBaseItemDto, EmbyQueryResult, EmbyUserItemData } from '@/lib/emby.types';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/**
 * GET /emby/Users/{userId}/Items
 *
 * Emby 浏览核心接口，客户端用它做：
 *   - 进入媒体库列内容（ParentId = 库 Id）
 *   - 全局搜索（SearchTerm / IncludeItemTypes）
 *   - 继续观看（Filters=IsResumable）
 *   - 最新添加（SortBy=DateCreated）
 *
 * 支持参数：ParentId, SearchTerm, IncludeItemTypes, Recursive,
 *          StartIndex, Limit, SortBy, SortOrder, Filters, Ids
 */
export const GET = withEmbyAuth(async (request, ctx) => {
  const { searchParams } = new URL(request.url);
  const { startIndex, limit } = parsePaging(searchParams);

  const parentId = searchParams.get('ParentId') || searchParams.get('parentId') || '';
  const searchTerm = searchParams.get('SearchTerm') || searchParams.get('searchTerm') || '';
  const includeItemTypes = searchParams.get('IncludeItemTypes') || '';
  const sortBy = searchParams.get('SortBy') || undefined;
  const sortOrder = searchParams.get('SortOrder') || undefined;
  const filters = searchParams.get('Filters') || '';
  const idsParam = searchParams.get('Ids') || '';
  const recursive = searchParams.get('Recursive') !== 'false';

  // 用户播放状态查询器（进度 / 已看 / 收藏）
  const storage = getStorage();
  let playbackMap = new Map<string, any>();
  let favoriteSet = new Set<string>();
  try {
    const records = await (storage as any).getAllEmbyPlayback?.(ctx.userId);
    if (Array.isArray(records)) {
      playbackMap = new Map(records.map((r: any) => [r.ItemId, r]));
    }
    const favs = await (storage as any).getAllEmbyFavorites?.(ctx.userId);
    if (Array.isArray(favs)) {
      favoriteSet = new Set(favs);
    }
  } catch {
    // 无进度数据不影响浏览
  }

  const userDataFor = (itemId: string): EmbyUserItemData => {
    const rec = playbackMap.get(itemId);
    return {
      PlaybackPositionTicks: rec?.PositionTicks || 0,
      PlayCount: rec?.PlayCount || 0,
      IsFavorite: favoriteSet.has(itemId),
      Played: !!rec?.Played,
      Key: itemId,
      ItemId: itemId,
      LastPlayedDate: rec?.LastPlayedDate
        ? new Date(rec.LastPlayedDate).toISOString()
        : undefined,
    };
  };

  let items: EmbyBaseItemDto[] = [];

  // ---------- 1) 指定 Ids 批量取 ----------
  if (idsParam) {
    const wanted = idsParam.split(',').map((s) => s.trim()).filter(Boolean);
    for (const id of wanted) {
      const one = await resolveItemById(id, ctx.userName, userDataFor);
      if (one) items.push(one);
    }
  }
  // ---------- 2) 按 ParentId 展开 ----------
  else if (parentId) {
    // ⚠️ 先登记源 key 再解码（冷启动 isolate 否则解不出 ParentId）
    await ensureSourcesRegistered();
    const classified = classifyId(parentId);

    if (classified.kind === 'view') {
      // 媒体库 -> 内容列表
      items = await listLibraryItems({
        libraryKey: classified.library.key,
        userName: ctx.userName,
        userDataFor,
      });
    } else if (classified.kind === 'season') {
      // 季 -> 分集列表（客户端 Series -> Season -> Episode 的第二跳）
      items = await episodesForParent({
        source: classified.source,
        sourceId: classified.sourceId,
        userName: ctx.userName,
        userDataFor,
        request,
      });
    } else if (classified.kind === 'item') {
      // Series 的子项。客户端有两种流派：
      //   A. 先要 Season，再由 Season 要 Episode（Emby 官方、Yamby）
      //   B. 直接要 Episode（Infuse、Fileball）
      // 依据 IncludeItemTypes 判断，两种都支持。
      const wantsEpisodes = /episode/i.test(includeItemTypes);

      if (wantsEpisodes) {
        items = await episodesForParent({
          source: classified.source,
          sourceId: classified.sourceId,
          userName: ctx.userName,
          userDataFor,
          request,
        });
      } else {
        items = await resolveSeasons(parentId, ctx.userName, userDataFor);
        // 客户端没明确要 Episode 但季为空时，直接给分集更实用
        if (!items.length) {
          items = await episodesForParent({
            source: classified.source,
            sourceId: classified.sourceId,
            userName: ctx.userName,
            userDataFor,
            request,
          });
        }
      }

      // 兜底：仍拿不到子项时返回条目本身，避免客户端白屏
      if (!items.length) {
        const one = await resolveItemById(parentId, ctx.userName, userDataFor);
        if (one) items = [one];
      }
    } else if (classified.kind === 'episode') {
      // 分集被当作父级（少见）：返回其所属剧集的分集
      items = await episodesForParent({
        source: classified.source,
        sourceId: classified.sourceId,
        userName: ctx.userName,
        userDataFor,
        request,
      });
    }
  }
  // ---------- 3) 顶层浏览（无 ParentId） ----------
  else {
    // 未指定父级时返回媒体库视图，兼容直接调用 Items 的客户端
    const { buildViews } = await import('@/lib/emby.catalog');
    items = buildViews() as unknown as EmbyBaseItemDto[];
  }

  // ---------- 搜索 ----------
  // Emby 客户端的搜索行为差异很大：有的只发 SearchTerm，有的会带上
  // 当前所在媒体库的 ParentId。因此只要拿到 SearchTerm，就**直接回源
  // 搜索**，而不是只过滤当前页已有的条目——后者会让搜索结果几乎恒为空。
  if (searchTerm.trim()) {
    items = await searchAllSources(searchTerm, ctx.userName, userDataFor);
  }

  // ---------- 类型过滤 ----------
  if (includeItemTypes) {
    const wanted = new Set(
      includeItemTypes.split(',').map((s) => s.trim().toLowerCase())
    );
    items = items.filter((it) => wanted.has(String(it.Type).toLowerCase()));
  }

  // ---------- 播放状态过滤 ----------
  if (filters) {
    const flags = filters.toLowerCase();
    if (flags.includes('isresumable')) {
      items = items.filter(
        (it) =>
          (it.UserData?.PlaybackPositionTicks || 0) > 0 &&
          !it.UserData?.Played
      );
    }
    if (flags.includes('isunplayed')) {
      items = items.filter((it) => !it.UserData?.Played);
    }
    if (flags.includes('isplayed')) {
      items = items.filter((it) => it.UserData?.Played);
    }
    if (flags.includes('isfavorite')) {
      items = items.filter((it) => it.UserData?.IsFavorite);
    }
  }

  // ---------- 排序 ----------
  const effectiveSort =
    sortBy ||
    (filters.toLowerCase().includes('isresumable')
      ? 'DatePlayed'
      : searchTerm
        ? 'SortName'
        : 'SortName');
  if (effectiveSort.includes('Random')) {
    items = sortItems(items, 'Random', sortOrder);
  } else {
    items = sortItems(items, effectiveSort, sortOrder);
  }

  const total = items.length;
  const paged = items.slice(startIndex, startIndex + limit);

  const result: EmbyQueryResult<EmbyBaseItemDto> = {
    Items: paged,
    TotalRecordCount: total,
    StartIndex: startIndex,
  };

  return embyJson(result);
});

/**
 * 取某部剧的分集（供季/剧集两级 ParentId 使用），并补上 MediaSources。
 *
 * MediaSources 让客户端（Infuse / Fileball / Hills）无需再调
 * PlaybackInfo 即可直接起播，少一次往返、也更不易失败。
 */
async function episodesForParent(opts: {
  source: string;
  sourceId: string;
  userName: string;
  userDataFor: (itemId: string) => EmbyUserItemData;
  request: Request;
}): Promise<EmbyBaseItemDto[]> {
  const { source, sourceId, userName, userDataFor, request } = opts;

  // 直接用 location 编出 itemId 再解析，无需按标题回源搜索
  const itemId = encodeItemId(source, sourceId);
  const resolved = await resolveItem(itemId, undefined, userName);

  const episodes = resolved
    ? buildEpisodesFor(resolved.result, userDataFor)
    : await resolveEpisodesForSeason(source, sourceId, userName, userDataFor);

  if (!resolved || !episodes.length) return episodes;

  return attachMediaSources(
    episodes,
    resolved.result,
    resolveBaseUrl(request)
  );
}

/** 取单个条目（含分集展开） */
async function resolveItemById(
  id: string,
  userName: string,
  userDataFor: (itemId: string) => EmbyUserItemData
): Promise<EmbyBaseItemDto | null> {
  const classified = classifyId(id);

  if (classified.kind === 'view') {
    const { buildViews } = await import('@/lib/emby.catalog');
    const view = buildViews().find((v) => v.Id === id);
    return (view as unknown as EmbyBaseItemDto) || null;
  }

  const resolved = await resolveItem(id, undefined, userName);
  if (!resolved) return null;

  const item = toEmbyItem(resolved.result, {
    userData: userDataFor(resolved.itemId),
  });

  // 剧集返回分集以便客户端直接播放
  if (item.Type === 'Series') {
    item.MediaSources = [];
    const eps = buildEpisodesFor(resolved.result, userDataFor);
    if (eps.length) {
      item.ChildCount = eps.length;
      item.RecursiveItemCount = eps.length;
    }
  }

  return item;
}

/**
 * 跨源搜索。
 *
 * 并发查询所有可用资源站并按「标题+年份」去重。
 * 同一部片子常被多个源收录，去重后展示更干净。
 */
async function searchAllSources(
  term: string,
  userName: string,
  userDataFor: (itemId: string) => EmbyUserItemData
): Promise<EmbyBaseItemDto[]> {
  const { getFilteredApiSites } = await import('@/lib/config');
  const { searchFromApi } = await import('@/lib/downstream');
  const { encodeItemId } = await import('@/lib/emby.catalog');
  const { normalizeTitle } = await import('@/lib/emby.items');

  const sites = await getFilteredApiSites(userName);
  if (!sites.length) return [];

  const results = (
    await Promise.all(
      sites.map((s) => searchFromApi(s, term).catch(() => []))
    )
  ).flat();

  const seen = new Set<string>();
  const items: EmbyBaseItemDto[] = [];
  for (const r of results) {
    const dedupeKey = `${normalizeTitle(r.title)}:${r.year}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const id = encodeItemId(r.source, r.id);
    items.push(toEmbyItem(r, { userData: userDataFor(id) }));
  }
  return items;
}
