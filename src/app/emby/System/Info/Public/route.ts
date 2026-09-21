import { buildPublicSystemInfo } from '@/lib/emby.config';
import { embyJson, embyOptions, resolveBaseUrl } from '@/lib/emby.http';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/**
 * GET /emby/System/Info/Public
 *
 * Emby 客户端添加服务器时第一个调用的接口（无需鉴权）。
 * 返回 ServerName / Version / Id 供客户端展示与持久化。
 */
export async function GET(request: Request) {
  const baseUrl = resolveBaseUrl(request);
  return embyJson(buildPublicSystemInfo(baseUrl));
}

export async function OPTIONS() {
  return embyOptions();
}
