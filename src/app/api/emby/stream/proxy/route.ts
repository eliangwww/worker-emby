import { authenticateRequest } from '@/lib/emby.auth';
import { embyError, embyUnauthorized } from '@/lib/emby.http';
import { proxyMedia } from '@/lib/emby.proxy';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/**
 * GET /api/emby/stream/proxy?u=<upstream>&api_key=...
 *
 * HLS 分片 / 子播放列表代理。
 * direct 路由会把 m3u8 内的地址重写到这里，保证分片请求同样
 * 带上正确的 Referer/UA，绕过源站防盗链。
 */
export async function GET(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return embyUnauthorized();

  const { searchParams } = new URL(request.url);
  const upstream = searchParams.get('u');

  if (!upstream) {
    return embyError(400, 'Missing upstream url');
  }

  // 只代理 http(s)，避免 SSRF 到其他协议
  let parsed: URL;
  try {
    parsed = new URL(upstream);
  } catch {
    return embyError(400, 'Invalid upstream url');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return embyError(400, 'Unsupported protocol');
  }

  const isHls =
    parsed.pathname.endsWith('.m3u8') || parsed.pathname.endsWith('.m3u');

  return proxyMedia(request, upstream, isHls);
}
