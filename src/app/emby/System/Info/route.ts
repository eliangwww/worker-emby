import { buildSystemInfo } from '@/lib/emby.config';
import { embyJson, resolveBaseUrl, withEmbyAuth } from '@/lib/emby.http';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/**
 * GET /emby/System/Info
 *
 * 已认证的服务器信息。部分客户端在登录后调用以获取完整能力列表。
 */
export const GET = withEmbyAuth(async (request) => {
  const baseUrl = resolveBaseUrl(request);
  return embyJson(buildSystemInfo(baseUrl));
});
