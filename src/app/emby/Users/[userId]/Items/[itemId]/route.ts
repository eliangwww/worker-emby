import { getStorage } from '@/lib/db';
import {
  buildEpisodesFor,
  classifyId,
  toEmbyItem,
} from '@/lib/emby.catalog';
import { embyJson, embyNotFound, firstParam, withEmbyAuth } from '@/lib/emby.http';
import { resolveItem, resolveSeasonsForLocation } from '@/lib/emby.items';
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
