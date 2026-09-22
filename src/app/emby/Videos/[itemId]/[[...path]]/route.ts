import { EmbyRouteParams } from '@/lib/emby.http';
import { handleStreamRequest } from '@/lib/emby.stream';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/**
 * GET|HEAD /emby/Videos/{itemId}/<任意后缀>
 *
 * 兼容不同客户端对播放地址的写法。除了无后缀的
 * /stream（由同级的 stream/route.ts 处理），客户端还会请求：
 *   - /emby/Videos/{id}/stream.m3u8
 *   - /emby/Videos/{id}/stream.mp4?Static=true
 *   - /emby/Videos/{id}/stream.ts
 *   - /emby/Videos/{id}/original.mkv
 *   - /emby/Videos/{id}/master.m3u8
 *
 * 若只注册 stream 路由，这些带后缀的请求会命中 404，
 * 客户端表现为「能选集、能看详情，但点播放没反应」。
 * 这里统一复用 handleStreamRequest 的解析逻辑。
 */
async function handle(
  request: Request,
  params: EmbyRouteParams
): Promise<Response> {
  const itemId = (params?.itemId as string) || '';
  return handleStreamRequest(request, itemId);
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
