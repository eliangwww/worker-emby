import {
  embyJson,
  firstParam,
  withEmbyAuth,
} from '@/lib/emby.http';
import {
  ensureSourcesRegistered,
  resolveSeasonsForSeries,
} from '@/lib/emby.items';
import { EmbyBaseItemDto, EmbyQueryResult } from '@/lib/emby.types';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/**
 * GET /emby/Shows/{seriesId}/Seasons
 *
 * ⚠️ 这是 Emby 官方客户端、Infuse、Hills、Yamby 等**进入剧集详情后
 * 拉取季列表的标准端点**。
 *
 * 早期实现只提供 /emby/Users/{userId}/Items?ParentId=...，
 * 部分客户端（尤其 Hills）不使用该方式，而是直接请求
 * /emby/Shows/{id}/Seasons 与 /Episodes。缺少这两个端点时，
 * 客户端会拿到 404，表现为**剧集详情页没有季/集可选**。
 */
export const GET = withEmbyAuth(async (request, ctx, params) => {
  const seriesId = firstParam(params, 'seriesId', 'itemId', 'id');
  if (!seriesId) return embyJson(emptyResult());

  // 冷启动 isolate 需先登记源 key，否则 seriesId 解不出 source
  await ensureSourcesRegistered();

  const seasons = await resolveSeasonsForSeries(seriesId, ctx.userName, () => undefined);

  return embyJson({
    Items: seasons,
    TotalRecordCount: seasons.length,
    StartIndex: 0,
  } satisfies EmbyQueryResult<EmbyBaseItemDto>);
});

function emptyResult(): EmbyQueryResult<EmbyBaseItemDto> {
  return { Items: [], TotalRecordCount: 0, StartIndex: 0 };
}
