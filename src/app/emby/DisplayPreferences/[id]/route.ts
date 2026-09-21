import { embyJson, firstParam, withEmbyAuth } from '@/lib/emby.http';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/**
 * GET /emby/DisplayPreferences/{id}
 *
 * 客户端读取界面偏好（首页布局、排序方式）。
 * 返回一份合理的默认值即可，客户端会自行覆盖。
 */
export const GET = withEmbyAuth(async (_request, ctx, params) => {
  const id = firstParam(params, 'id') || 'usersettings';
  const { searchParams } = new URL(_request.url);
  const userId = searchParams.get('userId') || ctx.userId;
  const client = searchParams.get('client') || 'emby';

  return embyJson({
    Id: id,
    SortBy: 'SortName',
    RememberIndexing: false,
    PrimaryImageHeight: 250,
    PrimaryImageWidth: 250,
    CustomPrefs: {},
    ScrollDirection: 'Horizontal',
    ShowBackdrop: true,
    RememberSorting: true,
    SortOrder: 'Ascending',
    ShowSidebar: false,
    Client: client,
    UserId: userId,
  });
});

/**
 * POST /emby/DisplayPreferences/{id}
 * 接受客户端保存的偏好，直接返回 204（无需持久化）。
 */
export const POST = withEmbyAuth(async () => {
  return new Response(null, {
    status: 204,
    headers: { 'Access-Control-Allow-Origin': '*' },
  });
});
