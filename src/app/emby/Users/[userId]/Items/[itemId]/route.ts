import { getStorage } from '@/lib/db';
import {
  buildEpisodeItem,
  buildEpisodesFor,
  classifyId,
  toEmbyItem,
} from '@/lib/emby.catalog';
import { embyJson, embyNotFound, firstParam, resolveBaseUrl, withEmbyAuth } from '@/lib/emby.http';
import { resolveItem, resolveSeasonsForLocation, ensureSourcesRegistered } from '@/lib/emby.items';
import { buildMediaSourceFromResult } from '@/lib/emby.playback';
import { EmbyBaseItemDto, EmbyUserItemData } from '@/lib/emby.types';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/**
 * GET /emby/Users/{userId}/Items/{itemId}
 *
 * 条目详情。客户端进入详情页时调用，需要返回完整字段
 * （Overview / People / MediaSources / UserData），否则详情页会空白。
 */
export const GET = withEmbyAuth(async (request, ctx, params) => {
  const itemId = firstParam(params, 'itemId');
  if (!itemId) return embyNotFound('Missing item id');

  // ⚠️ 先登记源 key 再解码：冷启动 isolate 里源表为空时，
  // 合法的 itemId 会被 classifyId 误判为 unknown，客户端显示 Item not found。
  await ensureSourcesRegistered();

  // 媒体库视图
  const classified = classifyId(itemId);
  if (classified.kind === 'view') {
    const { buildViews } = await import('@/lib/emby.catalog');
    const view = buildViews().find((v) => v.Id === itemId);
    if (!view) return embyNotFound();
    return embyJson(view);
  }

  // 季条目：客户端可能直接打开 Season 页面
  if (classified.kind === 'season') {
    const seasons = await resolveSeasonsForLocation(
      classified.source,
      classified.sourceId
    );
    const season = seasons.find((s) => s.Id === itemId);
    if (!season) return embyNotFound();
    return embyJson(season);
  }

  // ⚠️ 分集条目：必须返回 **Episode** 本身，而不是宿主剧集。
  //
  // 客户端点开某一集时会请求 /emby/Users/{uid}/Items/{episodeId}。
  // 旧实现走到下面的 resolveItem，拿到的是宿主剧集详情再 toEmbyItem，
  // 返回的 DTO.Id 是 Series Id —— 与请求的 Id 不符，客户端会判定
  // 条目不存在/类型错误，表现为「选集看得到，但点开和播放都失败」。
  if (classified.kind === 'episode') {
    const resolved = await resolveItem(itemId, undefined, ctx.userName);
    if (!resolved) return embyNotFound();

    const storage = getStorage();
    let epUserData: EmbyUserItemData = {
      PlaybackPositionTicks: 0,
      PlayCount: 0,
      IsFavorite: false,
      Played: false,
      Key: itemId,
      ItemId: itemId,
    };
    try {
      const rec = await (storage as any).getEmbyPlayback?.(
        ctx.userId,
        itemId
      );
      const favs = await (storage as any).getAllEmbyFavorites?.(ctx.userId);
      epUserData = {
        PlaybackPositionTicks: rec?.PositionTicks || 0,
        PlayCount: rec?.PlayCount || 0,
        IsFavorite: Array.isArray(favs) && favs.includes(itemId),
        Played: !!rec?.Played,
        Key: itemId,
        ItemId: itemId,
        LastPlayedDate: rec?.LastPlayedDate
          ? new Date(rec.LastPlayedDate).toISOString()
          : undefined,
      };
    } catch {
      // 忽略
    }

    const episode = buildEpisodeItem({
      result: resolved.result,
      index: classified.index,
      userData: epUserData,
    });

    // 附带该集的 MediaSource：部分客户端（如 Infuse / Fileball）
    // 会直接读详情里的 MediaSources 起播，不额外调 PlaybackInfo。
    const mediaSource = buildMediaSourceFromResult({
      result: resolved.result,
      itemId: episode.Id || itemId,
      episodeIndex: classified.index + 1,
      baseUrl: resolveBaseUrl(request),
    });
    if (mediaSource) episode.MediaSources = [mediaSource];

    return embyJson(episode);
  }

  const resolved = await resolveItem(itemId, undefined, ctx.userName);
  if (!resolved) return embyNotFound();

  // 组装用户播放状态
  const storage = getStorage();
  let userData: EmbyUserItemData = {
    PlaybackPositionTicks: 0,
    PlayCount: 0,
    IsFavorite: false,
    Played: false,
    Key: resolved.itemId,
    ItemId: resolved.itemId,
  };
  try {
    const rec = await (storage as any).getEmbyPlayback?.(
      ctx.userId,
      resolved.itemId
    );
    const favs = await (storage as any).getAllEmbyFavorites?.(ctx.userId);
    userData = {
      PlaybackPositionTicks: rec?.PositionTicks || 0,
      PlayCount: rec?.PlayCount || 0,
      IsFavorite: Array.isArray(favs) && favs.includes(resolved.itemId),
      Played: !!rec?.Played,
      Key: resolved.itemId,
      ItemId: resolved.itemId,
      LastPlayedDate: rec?.LastPlayedDate
        ? new Date(rec.LastPlayedDate).toISOString()
        : undefined,
    };
  } catch {
    // 忽略
  }

  const item: EmbyBaseItemDto = toEmbyItem(resolved.result, { userData });

  // 剧集补充分集信息
  if (item.Type === 'Series') {
    const eps = buildEpisodesFor(resolved.result);
    item.ChildCount = eps.length;
    item.RecursiveItemCount = eps.length;
  }

  return embyJson(item);
});
