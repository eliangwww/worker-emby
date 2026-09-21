import { authenticateRequest, destroySession, extractToken } from '@/lib/emby.auth';
import { embyNoContent, embyUnauthorized } from '@/lib/emby.http';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/**
 * POST /emby/Sessions/Logout
 *
 * 登出。使当前 token 失效即可。
 * 客户端登出后应返回 204，否则会卡在登录界面。
 */
export async function POST(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return embyUnauthorized();

  const token = extractToken(request);
  if (token) {
    await destroySession(token);
  }

  return embyNoContent();
}
