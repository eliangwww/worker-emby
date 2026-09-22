import { authenticateRequest } from '@/lib/emby.auth';
import { resolveBaseUrl } from '@/lib/emby.config';
import {
  embyError,
  EmbyRouteParams,
  embyUnauthorized,
  firstParam,
} from '@/lib/emby.http';
import { resolveMediaSource, resolveStreamWithSupplement } from '@/lib/emby.items';
import { parseMediaSourceId } from '@/lib/emby.playback';
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
    const resolved = await resolveStreamWithSupplement({
      source,
      sourceId: rawId,
      episodeIndex: ep > 0 ? ep : undefined,
      userName: auth.userName,
    });
    if (!resolved) return embyError(404, 'No playable stream found');
    return proxyMedia(request, resolved.stream.url, resolved.stream.isHls);
  }

  // 2) 标准 Emby 形式：只给 itemId（可能是 Episode 或 Movie）
  if (!itemId) {
    return embyError(400, 'Missing item id');
  }

  const mediaSourceId = searchParams.get('MediaSourceId') || undefined;

  // 优先用 MediaSourceId（形如 source:sourceId:ep）直接定位，
  // 可省一次详情回源。这是客户端播放时最常带的参数。
  if (mediaSourceId) {
    const parsed = parseMediaSourceId(mediaSourceId);
    if (parsed) {
      const byLocation = await resolveStreamWithSupplement({
        source: parsed.source,
        sourceId: parsed.sourceId,
        episodeIndex: parsed.episodeIndex,
        userName: auth.userName,
      });
      if (byLocation) {
        return proxyMedia(request, byLocation.stream.url, byLocation.stream.isHls);
      }
    }
  }

  // 回退：由 itemId 解析出应该播哪一集
  const resolved = await resolveMediaSource({
    itemId,
    userName: auth.userName,
    baseUrl,
    mediaSourceId,
  });

  if (!resolved) {
    return embyError(404, 'No playable stream found');
  }

  // ⚠️ 必须代理**真实上游地址**，而不是 mediaSource.Path。
  // Path 指向本站自己的代理端点，转发它会造成自我回环，
  // 并且丢失源站所需的 Referer/User-Agent。
  //
  // 若主源没有可播放地址，resolveStreamWithSupplement 会用标题
  // 到其他源找可播放的那一份作为「播放源补充」。
  const byLocation = await resolveStreamWithSupplement({
    source: resolved.result.source,
    sourceId: resolved.result.id,
    title: resolved.result.title,
    userName: auth.userName,
  });

  if (!byLocation) {
    return embyError(404, 'No playable stream found');
  }

  return proxyMedia(request, byLocation.stream.url, byLocation.stream.isHls);
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
