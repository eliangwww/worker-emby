import { isAdminUser } from '@/lib/emby.auth';
import { buildUserDto } from '@/lib/emby.config';
import { embyJson, withEmbyAuth } from '@/lib/emby.http';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/**
 * GET /emby/Users/Me
 *
 * 客户端用当前 token 获取自己的用户信息，用于首页展示与权限判断。
 */
export const GET = withEmbyAuth(async (_request, ctx) => {
  const admin = await isAdminUser(ctx.userName);
  return embyJson(
    buildUserDto({
      id: ctx.userId,
      name: ctx.userName,
      isAdmin: admin,
      lastActivity: Date.now(),
    })
  );
});
