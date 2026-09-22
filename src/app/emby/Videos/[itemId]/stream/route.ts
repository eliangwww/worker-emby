import { EmbyRouteParams } from '@/lib/emby.http';
import { handleStreamRequest } from '@/lib/emby.stream';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/**
 * GET|HEAD /emby/Videos/{itemId}/stream
 *
 * Emby 客户端的标准播放端点。带扩展名的写法
 * （stream.m3u8 / stream.mp4 / original.mkv）由同级的
 * [[...path]] 路由处理，两者共用 handleStreamRequest。
 */
export async function GET(
  request: Request,
  ctx: { params: EmbyRouteParams }
) {
  const itemId = (ctx.params?.itemId as string) || '';
  return handleStreamRequest(request, itemId);
}

export async function HEAD(
  request: Request,
  ctx: { params: EmbyRouteParams }
) {
  const itemId = (ctx.params?.itemId as string) || '';
  return handleStreamRequest(request, itemId);
}
