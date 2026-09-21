/* eslint-disable no-console, @typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion */

import { deriveGuid, getServerId, secondsToTicks } from './emby.config';
import { EmbyBaseItemDto, EmbyUserItemData, EmbyUserView } from './emby.types';
import { SearchResult } from './types';

/**
 * 媒体库（Emby Views）定义。
 *
 * 各聚合源的 vod_class / type_name 分类命名并不统一，这里把关键词
 * 归并到 Emby 标准 CollectionType 对应的库中。
 *
 * ⚠️ 匹配顺序很重要：LIBRARIES 按**从具体到宽泛**排列，
 * 且 keywords 中不能出现「片」「剧」这类单字泛化词——
 * 否则「纪录片」「动画片」会被 movies 抢走，
 * 「国产剧」也会被 tvshows 之外的库误吞。
 */
export interface LibraryDefinition {
  /** 库 ID 后缀，与 serverId 一起构成稳定的 viewId */
  key: string;
  name: string;
  collectionType: 'movies' | 'tvshows';
  /** 命中的分类关键词（小写匹配，越具体越靠前） */
  keywords: string[];
  /**
   * 上游分类名匹配（用于 ac=list 得到的 type_name），
   * 与 keywords 分开维护，便于精确控制。
   */
  upstreamNames?: string[];
}

export const LIBRARIES: LibraryDefinition[] = [
  // ---- 先匹配具体类型，避免被泛化词吞掉 ----
  {
    key: 'documentary',
    name: '纪录片',
    collectionType: 'movies',
    keywords: ['纪录片', '记录片', 'documentary', '记录'],
  },
  {
    key: 'anime',
    name: '动漫',
    collectionType: 'tvshows',
    keywords: ['动漫', '国漫', '日漫', '动画', 'anime', '番剧'],
  },
  {
    key: 'variety',
    name: '综艺',
    collectionType: 'tvshows',
    keywords: ['综艺', '真人秀', '脱口秀', 'variety', 'show'],
  },
  {
    key: 'tvshows',
    name: '电视剧',
    collectionType: 'tvshows',
    keywords: [
      '电视剧', '连续剧', '国产剧', '港台剧', '日韩剧', '欧美剧',
      '海外剧', '台湾剧', '韩国剧', '泰国剧', '短剧', 'series', 'tv',
    ],
  },
  {
    key: 'movies',
    name: '电影',
    collectionType: 'movies',
    keywords: [
      '电影', '动作片', '喜剧片', '爱情片', '科幻片', '恐怖片',
      '战争片', '剧情片', '犯罪片', '悬疑片', '冒险片', '奇幻片',
      '动画片', '伦理片', '武侠片', '枪战片', '灾难片', 'movie', 'film',
    ],
  },
];

/** 全部媒体库视图 Id */
export function buildViews(): EmbyUserView[] {
  const serverId = getServerId();
  return LIBRARIES.map((lib) => ({
    Name: lib.name,
    ServerId: serverId,
    Id: viewIdFor(lib.key),
    Guid: viewIdFor(lib.key),
    DateCreated: new Date(0).toISOString(),
    SortName: lib.name,
    ExternalUrls: [],
    Channels: [],
    CollectionType: lib.collectionType,
    ImageTags: {},
    Type: 'CollectionFolder',
    LocationType: 'FileSystem',
    IsFolder: true,
  }));
}

/** 稳定的媒体库 Id */
export function viewIdFor(key: string): string {
  return deriveGuid(`${getServerId()}:view:${key}`);
}

/** 判断某个 Id 是否为媒体库 */
export function findLibraryById(id: string): LibraryDefinition | undefined {
  return LIBRARIES.find((lib) => viewIdFor(lib.key) === id);
}

/**
 * 把源站的分类文本映射到媒体库。
 * 无匹配时归入电影库，保证条目总能被看到。
 */
export function libraryKeyForItem(item: {
  class?: string;
  type_name?: string;
}): string {
  const text = `${item.class || ''} ${item.type_name || ''}`.toLowerCase();
  if (!text.trim()) return 'movies';

  for (const lib of LIBRARIES) {
    for (const kw of lib.keywords) {
      if (text.includes(kw.toLowerCase())) {
        return lib.key;
      }
    }
  }
  return 'movies';
}

/** 条目 Id 编码：把 source + 源站 id 打包成稳定 GUID 形态 */
export function encodeItemId(source: string, sourceId: string): string {
  return deriveGuid(`${getServerId()}:item:${source}:${sourceId}`);
}

/** 解码条目 Id 回 source + 源站 id */
export function decodeItemId(
  itemId: string
): { source: string; sourceId: string } | null {
  return idIndex.get(itemId) || null;
}

/**
 * 进程内 Id 反查表。
 * 由于 GUID 派生不可逆，运行时把见过的条目登记下来；
 * 冷启动未登记的 Id 通过 Items 端点的递归搜索回填。
 */
const idIndex = new Map<string, { source: string; sourceId: string }>();

export function registerItemId(
  itemId: string,
  source: string,
  sourceId: string
): void {
  idIndex.set(itemId, { source, sourceId });
}

/** 剧集/分集 Id 编码 */
export function encodeEpisodeId(
  source: string,
  sourceId: string,
  index: number
): string {
  return deriveGuid(`${getServerId()}:ep:${source}:${sourceId}:${index}`);
}

const episodeIndex = new Map<
  string,
  { source: string; sourceId: string; index: number }
>();

export function registerEpisodeId(
  episodeId: string,
  source: string,
  sourceId: string,
  index: number
): void {
  episodeIndex.set(episodeId, { source, sourceId, index });
}

export function decodeEpisodeId(
  episodeId: string
): { source: string; sourceId: string; index: number } | null {
  return episodeIndex.get(episodeId) || null;
}

/** 判断一个 Id 是哪种形态 */
export function classifyId(
  id: string
):
  | { kind: 'view'; library: LibraryDefinition }
  | { kind: 'item'; source: string; sourceId: string }
  | { kind: 'episode'; source: string; sourceId: string; index: number }
  | { kind: 'unknown' } {
  const lib = findLibraryById(id);
  if (lib) return { kind: 'view', library: lib };

  const ep = decodeEpisodeId(id);
  if (ep) return { kind: 'episode', ...ep };

  const item = decodeItemId(id);
  if (item) return { kind: 'item', ...item };

  return { kind: 'unknown' };
}

/** 从标题粗略拆分「剧名 + 季集」，兼容 "某某 第2季" / "某某 S02" */
export function parseSeriesInfo(title: string): {
  seriesName: string;
  seasonNumber?: number;
} {
  const cleaned = title.trim();

  const cnMatch = cleaned.match(/第\s*([0-9一二三四五六七八九十]+)\s*季/);
  if (cnMatch) {
    const seasonNumber = cnToNumber(cnMatch[1]);
    return {
      seriesName: cleaned.replace(cnMatch[0], '').replace(/\s+/g, ' ').trim(),
      seasonNumber: seasonNumber || undefined,
    };
  }

  const sMatch = cleaned.match(/\bS(\d{1,2})\b/i);
  if (sMatch) {
    return {
      seriesName: cleaned.replace(sMatch[0], '').replace(/\s+/g, ' ').trim(),
      seasonNumber: Number(sMatch[1]) || undefined,
    };
  }

  return { seriesName: cleaned };
}

function cnToNumber(cn: string): number | undefined {
  if (/^\d+$/.test(cn)) return Number(cn);
  const map: Record<string, number> = {
    一: 1, 二: 2, 三: 3, 四: 4, 五: 5,
    六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
  };
  if (cn.length === 1) return map[cn];
  if (cn.length === 2 && cn[0] === '十') return 10 + (map[cn[1]] || 0);
  if (cn.length === 2 && cn[1] === '十') return (map[cn[0]] || 0) * 10;
  if (cn.length === 3 && cn[1] === '十') {
    return (map[cn[0]] || 0) * 10 + (map[cn[2]] || 0);
  }
  return undefined;
}

/** 年份解析 */
export function parseYear(year?: string): number | undefined {
  if (!year) return undefined;
  const m = year.match(/(19|20)\d{2}/);
  return m ? Number(m[0]) : undefined;
}

/**
 * 把聚合源搜索结果转成 Emby 条目。
 *
 * 有多个播放地址 -> Series（剧集），客户端会展开分集；
 * 单集 -> Movie，直接播放。
 */
export function toEmbyItem(
  result: SearchResult,
  opts: { userData?: EmbyUserItemData; baseUrl?: string } = {}
): EmbyBaseItemDto {
  const itemId = encodeItemId(result.source, result.id);
  registerItemId(itemId, result.source, result.id);

  const episodeCount = result.episodes?.length || 0;
  const year = parseYear(result.year);
  const isSeries = episodeCount > 1;

  const { seriesName, seasonNumber } = parseSeriesInfo(result.title);
  const hasImage = !!result.poster;

  const item: EmbyBaseItemDto = {
    Name: result.title,
    ServerId: getServerId(),
    Id: itemId,
    DateCreated: new Date(0).toISOString(),
    SortName: result.title,
    PremiereDate: year ? `${year}-01-01T00:00:00.000Z` : undefined,
    ProductionYear: year,
    Overview: result.desc || result.title,
    Type: isSeries ? 'Series' : 'Movie',
    MediaType: 'Video',
    IsFolder: isSeries,
    CollectionType: undefined,
    ImageTags: hasImage ? { Primary: imageTagFor(itemId) } : {},
    BackdropImageTags: hasImage ? [imageTagFor(itemId)] : [],
    UserData: opts.userData || buildEmptyUserData(itemId),
    LocationType: 'FileSystem',
    Genres: result.class ? result.class.split(/[/,，、]/).filter(Boolean) : [],
    ProviderIds: result.douban_id ? { Douban: String(result.douban_id) } : {},
    ChildCount: isSeries ? episodeCount : undefined,
    RecursiveItemCount: isSeries ? episodeCount : undefined,
  };

  // 剧集条目需要 SeriesName / Season 信息，客户端才能正确分组
  if (isSeries) {
    item.SeriesName = seriesName || result.title;
    item.SeriesId = itemId;
    const season = seasonNumber || 1;
    item.ParentIndexNumber = season;
    item.SeasonId = encodeSeasonId(result.source, result.id, season);
    item.SeasonName = `第 ${season} 季`;
  }

  // 演员：源站通常没有结构化演员表，从 desc 里粗略抽取「主演：」
  const actors = extractActors(result.desc);
  if (actors.length) {
    item.People = actors.map((name) => ({
      Name: name,
      Id: deriveGuid(`${getServerId()}:person:${name}`),
      Role: name,
      Type: 'Actor' as const,
    }));
  }

  return item;
}

/** 稳定的图片 tag（内容不变则海报 URL 不变，客户端可长缓存） */
export function imageTagFor(seed: string): string {
  return deriveGuid(`${seed}:img`).replace(/-/g, '').slice(0, 16);
}

/** 季 Id 编码 */
export function encodeSeasonId(
  source: string,
  sourceId: string,
  season: number
): string {
  return deriveGuid(`${getServerId()}:season:${source}:${sourceId}:${season}`);
}

/** 空播放状态 */
export function buildEmptyUserData(itemId: string): EmbyUserItemData {
  return {
    PlaybackPositionTicks: 0,
    PlayCount: 0,
    IsFavorite: false,
    Played: false,
    Key: itemId,
    ItemId: itemId,
  };
}

/** 抽取「主演：张三 李四」形式的演员 */
function extractActors(desc?: string): string[] {
  if (!desc) return [];
  const m = desc.match(/(?:主演|演员|导演)\s*[:：]\s*([^\n。；;]{1,80})/);
  if (!m) return [];
  return m[1]
    .split(/[\s,，、/]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2 && s.length <= 12)
    .slice(0, 10);
}

/**
 * 把搜索结果的集数展开为 Emby Episode 列表。
 * 客户端在 Series 详情页拉取分集时使用。
 */
export function buildEpisodesFor(
  result: SearchResult,
  userDataFor?: (itemId: string) => EmbyUserItemData | undefined
): EmbyBaseItemDto[] {
  const seriesItemId = encodeItemId(result.source, result.id);
  registerItemId(seriesItemId, result.source, result.id);

  const { seriesName, seasonNumber } = parseSeriesInfo(result.title);
  const year = parseYear(result.year);
  const season = seasonNumber || 1;
  const seasonId = encodeSeasonId(result.source, result.id, season);

  return (result.episodes || []).map((_url, idx) => {
    const episodeId = encodeEpisodeId(result.source, result.id, idx);
    registerEpisodeId(episodeId, result.source, result.id, idx);

    const epNumber = idx + 1;
    const name = `第 ${epNumber} 集`;

    return {
      Name: name,
      ServerId: getServerId(),
      Id: episodeId,
      DateCreated: new Date(0).toISOString(),
      SortName: name,
      PremiereDate: year ? `${year}-01-01T00:00:00.000Z` : undefined,
      ProductionYear: year,
      Overview: result.desc || '',
      Type: 'Episode' as const,
      MediaType: 'Video',
      IsFolder: false,
      SeriesId: seriesItemId,
      SeriesName: seriesName || result.title,
      SeasonId: seasonId,
      SeasonName: `第 ${season} 季`,
      ParentId: seasonId,
      IndexNumber: epNumber,
      ParentIndexNumber: season,
      ImageTags: result.poster
        ? ({ Primary: imageTagFor(seriesItemId) } as Record<string, string>)
        : ({} as Record<string, string>),
      BackdropImageTags: result.poster ? [imageTagFor(seriesItemId)] : [],
      UserData: userDataFor?.(episodeId) || buildEmptyUserData(episodeId),
      LocationType: 'FileSystem',
      Container: 'mp4',
      MediaSources: [],
      RunTimeTicks: secondsToTicks(45 * 60),
    };
  });
}

/** 构造季条目 */
export function buildSeasonItem(
  seriesId: string,
  seasonNumber: number,
  seasonName: string,
  episodeCount: number
): EmbyBaseItemDto {
  return {
    Name: seasonName,
    ServerId: getServerId(),
    Id: deriveGuid(`${seriesId}:season:${seasonNumber}`),
    DateCreated: new Date(0).toISOString(),
    SortName: seasonName,
    Type: 'Season',
    IsFolder: true,
    SeriesId: seriesId,
    SeriesName: seasonName,
    IndexNumber: seasonNumber,
    ParentIndexNumber: 0,
    ChildCount: episodeCount,
    RecursiveItemCount: episodeCount,
    LocationType: 'FileSystem',
  };
}

/** Emby 标准排序字段 -> 排序函数 */
export function sortItems(
  items: EmbyBaseItemDto[],
  sortBy?: string,
  sortOrder?: string
): EmbyBaseItemDto[] {
  const desc = (sortOrder || 'Ascending').toLowerCase().startsWith('desc');
  const fields = (sortBy || 'SortName').split(',').map((s) => s.trim());

  const sorted = [...items];
  sorted.sort((a, b) => {
    for (const field of fields) {
      const cmp = compareByField(a, b, field);
      if (cmp !== 0) return desc ? -cmp : cmp;
    }
    return 0;
  });
  return sorted;
}

function compareByField(
  a: EmbyBaseItemDto,
  b: EmbyBaseItemDto,
  field: string
): number {
  switch (field) {
    case 'DateCreated':
    case 'PremiereDate':
      return (a.PremiereDate || '').localeCompare(b.PremiereDate || '');
    case 'ProductionYear':
      return (a.ProductionYear || 0) - (b.ProductionYear || 0);
    case 'CommunityRating':
      return (a.CommunityRating || 0) - (b.CommunityRating || 0);
    case 'Random':
      return Math.random() - 0.5;
    case 'SortName':
    default:
      return (a.SortName || a.Name).localeCompare(
        b.SortName || b.Name,
        'zh-CN'
      );
  }
}
