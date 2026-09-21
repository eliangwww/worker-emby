import { embyJson, withEmbyAuth } from '@/lib/emby.http';
import { EmbyQueryResult, EmbyUserView } from '@/lib/emby.types';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/**
 * GET /emby/UserViews
 * GET /emby/Users/{userId}/Views 的别名。
 *
 * 不同客户端调用的路径不一致（Infuse 用 UserViews，
 * 官方客户端用 Users/{id}/Views），两者都要提供。
 */
export const GET = withEmbyAuth(async () => {
  const { buildViews } = await import('@/lib/emby.catalog');
  const views = buildViews();
  const result: EmbyQueryResult<EmbyUserView> = {
    Items: views,
    TotalRecordCount: views.length,
    StartIndex: 0,
  };
  return embyJson(result);
});
