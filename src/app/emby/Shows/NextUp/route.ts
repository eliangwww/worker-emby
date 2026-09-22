import { getStorage } from '@/lib/db';
import { embyJson, parsePaging, withEmbyAuth } from '@/lib/emby.http';
import { ensureSourcesRegistered, resolveEpisodesForSeries } from '@/lib/emby.items';
import { EmbyBaseItemDto, EmbyQueryResult } from '@/lib/emby.types';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/**
 * GET /emby/Shows/NextUp
 *
 * 「接下来看什么」。Emby 客户端首页与剧集详情页都会调用，
 * 用于在看完一集后推荐下一集。
 *
 * 参数：
 *   - SeriesId 限定某部剧（详情页「下一集」按钮）
 *   - UserId   用户
 *   - Limit    返回条数
 *
 * 实现：读取该用户的播放进度，对每部有进度的剧算出「下一集」。
 * 没有进度但有 SeriesId 时，返回该剧第一集。
 */
export const GET = withEmbyAuth(async (request, ctx) => {
  const { searchParams } = new URL(request.url);
  const { limit } = parsePaging(searchParams);
  const seriesId = searchParams.get('SeriesId') || '';

  await ensureSourcesRegistered();

  // 指定了剧：直接返回该剧未看的第一集
  if (seriesId) {
    const episodes = await resolveEpisodesForSeries(seriesId, ctx.userName);
    const items = episodes.slice(0, Math.max(1, limit));
    return embyJson({
      Items: items,
      TotalRecordCount: items.length,
      StartIndex: 0,
    } satisfies EmbyQueryResult<EmbyBaseItemDto>);
  }

  // 未指定：从播放进度里挑「有进度且未看完」的剧，给下一集
  const storage = getStorage() as any;
  let records: any[] = [];
  try {
    const all = await storage.getAllEmbyPlayback?.(ctx.userId);
    if (Array.isArray(all)) records = all;
  } catch {
    // 无进度数据时返回空列表
  }

  const items: EmbyBaseItemDto[] = [];
  for (const rec of records) {
    if (items.length >= Math.max(1, limit)) break;
    // 只处理剧集（分集）进度，且未标记已看完
    if (!rec?.ItemId || rec?.Played) continue;
    if (!(rec?.PositionTicks > 0)) continue;

    const { decodeEpisodeId, classifyId, encodeItemId } = await import(
      '@/lib/emby.catalog'
    );
    const ep = decodeEpisodeId(rec.ItemId);
    const seriesRef = ep
      ? { source: ep.source, sourceId: ep.sourceId }
      : classifyId(rec.ItemId);

    if (!seriesRef || !('source' in seriesRef) || !seriesRef.source) continue;

    const seriesItemId = encodeItemId(
      (seriesRef as any).source,
      (seriesRef as any).sourceId
    );
    const episodes = await resolveEpisodesForSeries(
      seriesItemId,
      ctx.userName
    );
    const currentIndex = ep ? ep.index : -1;
    const next = episodes.find(
      (e) => (e.IndexNumber ?? 0) === currentIndex + 2
    );
    if (next) items.push(next);
  }

  return embyJson({
    Items: items,
    TotalRecordCount: items.length,
    StartIndex: 0,
  } satisfies EmbyQueryResult<EmbyBaseItemDto>);
});
