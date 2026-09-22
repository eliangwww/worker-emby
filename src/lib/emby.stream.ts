import { authenticateRequest } from './emby.auth';
import { classifyId } from './emby.catalog';
import { resolveBaseUrl } from './emby.config';
import { embyError, embyUnauthorized } from './emby.http';
import { resolveMediaSource, resolveStreamWithSupplement } from './emby.items';
import { parseMediaSourceId } from './emby.playback';
import { proxyMedia } from './emby.proxy';

/**
 * Emby 播放端点共享实现。
 *
 * 为什么需要抽出来：
 * 不同客户端请求播放地址的路径写法差异很大，常见有：
 *   - GET /emby/Videos/{itemId}/stream
 *   - GET /emby/Videos/{itemId}/stream.m3u8
 *   - GET /emby/Videos/{itemId}/stream.mp4?Static=true
 *   - GET /emby/Videos/{itemId}/original.mkv
 *   - GET /emby/videos/{itemId}/master.m3u8
 * 若只为 stream 建路由，带扩展名的请求会 404，表现为
 * 「能选集、能进详情，但一点播放就没反应」。
 *
 * 解析出真实上游地址后交给 proxyMedia 透传，保证 Range 请求
 * 与 206 响应正确，客户端才能拖进度条。
 */
export async function handleStreamRequest(
  request: Request,
  itemId: string
): Promise<Response> {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return embyUnauthorized();

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
        return proxyMedia(
          request,
          byLocation.stream.url,
          byLocation.stream.isHls
        );
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

  // ⚠️ 必须带上分集序号，否则无论点哪一集都只会播第 1 集。
  // 序号来源二选一：itemId 本身是 Episode 形态，或 MediaSourceId 带 :ep。
  const classified = classifyId(itemId);
  let episodeIndex =
    classified.kind === 'episode' ? classified.index + 1 : undefined;
  if (!episodeIndex && mediaSourceId) {
    const parsed = parseMediaSourceId(mediaSourceId);
    if (parsed?.episodeIndex && parsed.episodeIndex > 0) {
      episodeIndex = parsed.episodeIndex;
    }
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
    episodeIndex,
    userName: auth.userName,
  });

  if (!byLocation) {
    return embyError(404, 'No playable stream found');
  }

  return proxyMedia(request, byLocation.stream.url, byLocation.stream.isHls);
}
