import { userIdFor } from '@/lib/emby.auth';
import { buildUserDto } from '@/lib/emby.config';
import { embyJson, embyOptions } from '@/lib/emby.http';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/**
 * GET /emby/Users/Public
 *
 * 登录页用于列出可选用户（无需鉴权）。
 * 出于安全考虑，这里只暴露管理员账号；客户端仍可手动输入用户名。
 */
export async function GET() {
  const { getAdminUsername } = await import('@/lib/emby.config');
  const name = getAdminUsername();

  return embyJson([
    buildUserDto({
      id: userIdFor(name),
      name,
      isAdmin: true,
    }),
  ]);
}

export async function OPTIONS() {
  return embyOptions();
}
