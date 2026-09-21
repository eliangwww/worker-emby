/* eslint-disable no-console */

import { authenticateRequest } from '@/lib/emby.auth';
import { classifyId } from '@/lib/emby.catalog';
import { embyNotFound, embyUnauthorized } from '@/lib/emby.http';
import { resolveItem } from '@/lib/emby.items';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/**
 * GET /emby/Items/{itemId}/Images/{imageType}
 *
 * 海报/背景图。
 *
 * 聚合源的图片普遍有防盗链且是 http，直接返回上游地址会让客户端
 * 在 https 页面下加载失败（混合内容）。因此这里做法是：
 *   1. 优先 302 重定向到上游图片（客户端自行缓存，省流量）
 *   2. 上游不可用时回退到占位图
 *
 * 走服务端代理会把 Workers 免费额度很快耗尽，所以默认重定向。
 * 需要完全代理时可设 EMBY_PROXY_IMAGES=true。
 */
export async function GET(
  request: Request,
  ctx: { params: { itemId?: string; imageType?: string } }
) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return embyUnauthorized();

  const itemId = ctx.params?.itemId || '';
  const imageType = (ctx.params?.imageType || 'Primary').toLowerCase();
  const { searchParams } = new URL(request.url);
  const requestedUrl = searchParams.get('url');

  let imageUrl: string | undefined = requestedUrl || undefined;

  if (!imageUrl) {
    if (!itemId) return embyNotFound('Missing item id');

    const classified = classifyId(itemId);
    if (classified.kind === 'unknown') {
      return placeholderResponse(request);
    }

    const resolved = await resolveItem(itemId, undefined, auth.userName);
    if (!resolved || !resolved.result.poster) {
      return placeholderResponse(request);
    }
    imageUrl = resolved.result.poster;
  }

  // 源站图片多为 http，直接重定向会让 https 客户端拦截
  const shouldProxy =
    process.env.EMBY_PROXY_IMAGES === 'true' ||
    (imageUrl.startsWith('http://') && new URL(request.url).protocol === 'https:');

  if (shouldProxy) {
    return proxyImage(imageUrl, imageType);
  }

  return new Response(null, {
    status: 302,
    headers: {
      Location: imageUrl,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}

/** 代理图片，附加防盗链头 */
async function proxyImage(
  imageUrl: string,
  _imageType: string
): Promise<Response> {
  const headers: Record<string, string> = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
  };
  try {
    const u = new URL(imageUrl);
    headers['Referer'] = `${u.protocol}//${u.host}/`;
  } catch {
    // 交给 fetch 报错
  }

  try {
    const upstream = await fetch(imageUrl, { headers, redirect: 'follow' });
    if (!upstream.ok || !upstream.body) {
      return new Response(null, { status: 404 });
    }

    const contentType =
      upstream.headers.get('content-type') || 'image/jpeg';

    // 只回传图片，避免代理被滥用为通用转发
    if (!contentType.startsWith('image/')) {
      return new Response(null, { status: 415 });
    }

    return new Response(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (err) {
    console.error('图片代理失败:', err);
    return new Response(null, { status: 502 });
  }
}

/** 无海报时返回内联 SVG 占位，避免客户端显示破图 */
function placeholderResponse(request: Request): Response {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450" viewBox="0 0 300 450">
  <rect width="300" height="450" fill="#1f2937"/>
  <text x="150" y="225" font-family="sans-serif" font-size="20" fill="#6b7280" text-anchor="middle">No Image</text>
</svg>`;
  void request;
  return new Response(svg, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
