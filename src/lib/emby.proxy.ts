/* eslint-disable no-console, @typescript-eslint/no-explicit-any */

/**
 * 媒体代理。
 *
 * 从路由文件抽离到这里，因为 Next.js 的 route.ts 只允许导出
 * HTTP 方法（GET/POST/...）与少量配置，导出其他函数会导致构建失败。
 */

/** 拉流时使用的伪装请求头，规避源站防盗链 */
function upstreamHeaders(upstreamUrl: string, range?: string | null) {
  const headers: Record<string, string> = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    Accept: '*/*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  };
  if (range) headers['Range'] = range;

  try {
    const u = new URL(upstreamUrl);
    headers['Referer'] = `${u.protocol}//${u.host}/`;
    headers['Origin'] = `${u.protocol}//${u.host}`;
  } catch {
    // 非法 URL 交给 fetch 报错
  }
  return headers;
}

/**
 * 代理上游媒体。
 * 透传 Range 与 206 响应，客户端才能拖动进度条；
 * HLS 播放列表会被重写，使分片请求继续经过本站。
 */
export async function proxyMedia(
  request: Request,
  upstreamUrl: string,
  isHlsStream: boolean
): Promise<Response> {
  const range = request.headers.get('range');

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      headers: upstreamHeaders(upstreamUrl, range),
      redirect: 'follow',
    });
  } catch (err) {
    console.error('代理拉流失败:', err);
    return new Response('Upstream fetch failed', {
      status: 502,
      headers: { 'Access-Control-Allow-Origin': '*' },
    });
  }

  if (!upstream.ok && upstream.status !== 206) {
    return new Response(`Upstream returned ${upstream.status}`, {
      status: upstream.status,
      headers: { 'Access-Control-Allow-Origin': '*' },
    });
  }

  const contentType =
    upstream.headers.get('content-type') ||
    (isHlsStream ? 'application/vnd.apple.mpegurl' : 'video/mp2t');

  const isPlaylist =
    isHlsStream &&
    (contentType.includes('mpegurl') ||
      contentType.includes('x-mpegURL') ||
      upstreamUrl.includes('.m3u8'));

  // HLS 播放列表：重写分片地址，否则客户端会相对本站域名取分片而 404
  if (isPlaylist) {
    const text = await upstream.text();
    const rewritten = rewritePlaylist(text, upstreamUrl, new URL(request.url));

    return new Response(rewritten, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache',
      },
    });
  }

  // 二进制流：原样透传状态码与关键头
  const responseHeaders = new Headers();
  for (const h of [
    'content-type',
    'content-length',
    'content-range',
    'accept-ranges',
    'etag',
    'last-modified',
  ]) {
    const v = upstream.headers.get(h);
    if (v) responseHeaders.set(h, v);
  }
  if (!responseHeaders.has('content-type')) {
    responseHeaders.set('content-type', contentType);
  }
  if (!responseHeaders.has('accept-ranges')) {
    responseHeaders.set('accept-ranges', 'bytes');
  }
  responseHeaders.set('Access-Control-Allow-Origin', '*');
  responseHeaders.set(
    'Access-Control-Expose-Headers',
    'Content-Range, Content-Length, Accept-Ranges'
  );
  responseHeaders.set('Cache-Control', 'public, max-age=3600');

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

/**
 * 重写 m3u8：把分片与子播放列表指向本站代理。
 * 保持 #EXT-X-* 指令不变，只改 URI。
 */
export function rewritePlaylist(
  playlist: string,
  upstreamUrl: string,
  selfUrl: URL
): string {
  const upstreamBase = new URL(upstreamUrl);

  const toAbsolute = (uri: string, base: URL): string => {
    try {
      return new URL(uri, base).toString();
    } catch {
      return uri;
    }
  };

  const makeProxyUrl = (up: string): string => {
    const url = new URL('/api/emby/stream/proxy', selfUrl.origin);
    url.searchParams.set('u', up);
    // 透传 api_key，分片请求仍能通过鉴权
    const key =
      selfUrl.searchParams.get('api_key') ||
      selfUrl.searchParams.get('X-Emby-Token');
    if (key) url.searchParams.set('api_key', key);
    return url.toString();
  };

  return playlist
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;

      // 指令行：重写其中的 URI="..."（如 EXT-X-KEY / EXT-X-MAP）
      if (trimmed.startsWith('#')) {
        return trimmed.replace(/URI="([^"]+)"/g, (_m, uri: string) => {
          const abs = toAbsolute(uri, upstreamBase);
          return `URI="${makeProxyUrl(abs)}"`;
        });
      }

      return makeProxyUrl(toAbsolute(trimmed, upstreamBase));
    })
    .join('\n');
}
