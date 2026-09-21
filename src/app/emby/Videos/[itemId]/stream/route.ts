import { authenticateRequest } from '@/lib/emby.auth';
import { resolveBaseUrl } from '@/lib/emby.config';
import {
  embyError,
  EmbyRouteParams,
  embyUnauthorized,
  firstParam,
} from '@/lib/emby.http';
import { resolveMediaSource, resolveStreamByLocation } from '@/lib/emby.items';
import { proxyMedia } from '@/lib/emby.proxy';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/**
 * GET|HEAD /emby/Videos/{itemId}/stream
 *
 * Emby 客户端的标准播放端点，播放器直接请求这里。
 *
 * 客户端会用以下任一方式标识要播的内容：
 *   - Static=true + MediaSourceId
 *   - api_key / X-Emby-Token 鉴权
 *   - query: source, id, ep（本站 TranscodingUrl 注入的参数）
 *
 * 解析出真实上游地址后交给 proxyMedia 透传，
 * 保证 Range 请求与 206 响应正确，客户端才能拖进度条。
 */
async function handle(
  request: Request,
  params: EmbyRouteParams
): Promise<Response> {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return embyUnauthorized();

  const itemId = firstParam(params, 'itemId') || '';
  const { searchParams } = new URL(request.url);
  const baseUrl = resolveBaseUrl(request);

  // 1) 本站 TranscodingUrl 直接带了 source/id，省一次回源搜索
  const source = searchParams.get('source');
  const rawId = searchParams.get('id');
  const ep = Number(searchParams.get('ep') || 0);

  if (source && rawId) {
    const resolved = await resolveStreamByLocation({
      source,
      sourceId: rawId,
      episodeIndex: ep > 0 ? ep : undefined,
    });
    if (!resolved) return embyError(404, 'No playable stream found');
    return proxyMedia(request, resolved.stream.url, resolved.stream.isHls);
  }

  // 2) 标准 Emby 形式：只给 itemId（可能是 Episode 或 Movie）
  if (!itemId) {
    return embyError(400, 'Missing item id');
  }

  const mediaSourceId = searchParams.get('MediaSourceId') || undefined;

  const resolved = await resolveMediaSource({
    itemId,
    userName: auth.userName,
    baseUrl,
    mediaSourceId,
  });

  if (!resolved) {
    return embyError(404, 'No playable stream found');
  }

  const upstream = resolved.mediaSource.Path;
  if (!upstream) {
    return embyError(404, 'Media source has no path');
  }

  const isHls = resolved.mediaSource.Container === 'm3u8';
  return proxyMedia(request, upstream, isHls);
}

export async function GET(
  request: Request,
  ctx: { params: EmbyRouteParams }
) {
  return handle(request, ctx.params || {});
}

export async function HEAD(
  request: Request,
  ctx: { params: EmbyRouteParams }
) {
  return handle(request, ctx.params || {});
}
