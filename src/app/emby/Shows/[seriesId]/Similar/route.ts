import {
  embyJson,
  firstParam,
  parsePaging,
  withEmbyAuth,
} from '@/lib/emby.http';
import {
  ensureSourcesRegistered,
  resolveRecommendations,
} from '@/lib/emby.items';
import { EmbyBaseItemDto, EmbyQueryResult } from '@/lib/emby.types';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/**
 * GET /emby/Shows/{seriesId}/Similar
 * GET /emby/Movies/{movieId}/Similar
 *
 * 「相似推荐」。Emby 客户端详情页底部会展示该列表。
 *
 * 实现：取当前条目的类型/分类关键词，在主源里按该分类拉一批
 * 同类型影片，排除自身后返回。
 */
export const GET = withEmbyAuth(async (request, ctx, params) => {
  const itemId = firstParam(params, 'seriesId', 'movieId', 'itemId', 'id');
  if (!itemId) {
    return embyJson({ Items: [], TotalRecordCount: 0, StartIndex: 0 });
  }

  await ensureSourcesRegistered();

  const { searchParams } = new URL(request.url);
  const { limit } = parsePaging(searchParams);

  const items = await resolveRecommendations(
    itemId,
    ctx.userName,
    Math.max(1, limit || 20)
  );

  return embyJson({
    Items: items,
    TotalRecordCount: items.length,
    StartIndex: 0,
  } satisfies EmbyQueryResult<EmbyBaseItemDto>);
});
