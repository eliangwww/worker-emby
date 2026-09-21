import { authenticateRequest } from '@/lib/emby.auth';
import { embyError, embyUnauthorized } from '@/lib/emby.http';
import { resolveStreamByLocation } from '@/lib/emby.items';
import { proxyMedia } from '@/lib/emby.proxy';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/**
 * GET /api/emby/stream/direct?source=xx&id=yy&ep=1
 *
 * 播放代理。
 *
 * 为什么需要代理：
 *  - 聚合源普遍有防盗链（校验 Referer / User-Agent），客户端直连会 403
 *  - 部分源返回的 m3u8 内含相对路径分片，需重写为绝对地址
 *
 * 同时必须原样透传 Range 并回传 206/Content-Range，
 * 否则客户端无法拖动进度条。
 */
export async function GET(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return embyUnauthorized();

  const { searchParams } = new URL(request.url);
  const source = searchParams.get('source') || '';
  const sourceId = searchParams.get('id') || '';
  const ep = Number(searchParams.get('ep') || 0);

  if (!source || !sourceId) {
    return embyError(400, 'Missing source or id');
  }

  const resolved = await resolveStreamByLocation({
    source,
    sourceId,
    episodeIndex: ep > 0 ? ep : undefined,
  });

  if (!resolved) {
    return embyError(404, 'No playable stream found');
  }

  return proxyMedia(request, resolved.stream.url, resolved.stream.isHls);
}
