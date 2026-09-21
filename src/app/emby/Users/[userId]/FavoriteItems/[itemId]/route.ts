import { getStorage } from '@/lib/db';
import { embyNoContent, EmbyRouteParams,firstParam, withEmbyAuth } from '@/lib/emby.http';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/**
 * POST /emby/Users/{userId}/FavoriteItems/{itemId}
 * DELETE /emby/Users/{userId}/FavoriteItems/{itemId}
 *
 * 收藏 / 取消收藏。client 点击爱心时调用。
 */
async function handle(
  _request: Request,
  ctx: { userId: string },
  params: EmbyRouteParams,
  action: 'add' | 'remove'
) {
  const itemId = firstParam(params, 'itemId');
  if (!itemId) return embyNoContent();

  try {
    const storage = getStorage();
    if (action === 'add') {
      await (storage as any).setEmbyFavorite?.(ctx.userId, itemId);
    } else {
      await (storage as any).deleteEmbyFavorite?.(ctx.userId, itemId);
    }
  } catch {
    // 忽略
  }

  return embyNoContent();
}

export const POST = withEmbyAuth((req, ctx, params) =>
  handle(req, ctx, params, 'add')
);

export const DELETE = withEmbyAuth((req, ctx, params) =>
  handle(req, ctx, params, 'remove')
);
