import { buildViews } from '@/lib/emby.catalog';
import { embyJson, withEmbyAuth } from '@/lib/emby.http';
import { EmbyQueryResult, EmbyUserView } from '@/lib/emby.types';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/**
 * GET /emby/Users/{userId}/Views
 *
 * 返回媒体库列表，客户端「我的媒体」页面直接消费。
 * 返回 CollectionType（movies / tvshows）以便客户端套用正确的
 * 海报墙布局与详情页模板。
 */
export const GET = withEmbyAuth(async () => {
  const views = buildViews();
  const result: EmbyQueryResult<EmbyUserView> = {
    Items: views,
    TotalRecordCount: views.length,
    StartIndex: 0,
  };
  return embyJson(result);
});
