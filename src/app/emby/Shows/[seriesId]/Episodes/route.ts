import {
  embyJson,
  firstParam,
  withEmbyAuth,
} from '@/lib/emby.http';
import {
  ensureSourcesRegistered,
  resolveEpisodesForSeries,
} from '@/lib/emby.items';
import { EmbyBaseItemDto, EmbyQueryResult } from '@/lib/emby.types';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/**
 * GET /emby/Shows/{seriesId}/Episodes
 *
 * 剧集分集列表标准端点（Hills / Infuse / Emby 官方客户端使用）。
 *
 * 支持参数：
 *   - SeasonId   只取某一季（可选）
 *   - Season     季号（可选）
 *   - StartIndex / Limit 分页
 */
export const GET = withEmbyAuth(async (request, ctx, params) => {
  const seriesId = firstParam(params, 'seriesId', 'itemId', 'id');
  if (!seriesId) {
    return embyJson({ Items: [], TotalRecordCount: 0, StartIndex: 0 });
  }

  await ensureSourcesRegistered();

  const { searchParams } = new URL(request.url);
  const startIndex = Number(searchParams.get('StartIndex') ?? 0) || 0;
  const limit = Number(searchParams.get('Limit') ?? 0) || 0;

  // 季过滤：客户端可能传季 Id 或季号
  const seasonId = searchParams.get('SeasonId') || '';
  const seasonNumber = searchParams.get('Season') || '';

  let episodes = await resolveEpisodesForSeries(seriesId, ctx.userName);

  if (seasonId) {
    episodes = episodes.filter((ep) => ep.SeasonId === seasonId);
  } else if (seasonNumber && /^\d+$/.test(seasonNumber)) {
    const wanted = Number(seasonNumber);
    const filtered = episodes.filter(
      (ep) => (ep.ParentIndexNumber ?? 1) === wanted
    );
    if (filtered.length) episodes = filtered;
  }

  const total = episodes.length;
  const paged = limit > 0 ? episodes.slice(startIndex, startIndex + limit) : episodes;

  return embyJson({
    Items: paged,
    TotalRecordCount: total,
    StartIndex: startIndex,
  } satisfies EmbyQueryResult<EmbyBaseItemDto>);
});
