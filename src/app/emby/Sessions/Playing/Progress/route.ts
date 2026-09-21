import { embyNoContent, withEmbyAuth } from '@/lib/emby.http';
import { saveProgress } from '@/lib/emby.progress';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/**
 * POST /emby/Sessions/Playing/Progress
 *
 * 播放中心跳上报。频率高，必须快速返回 204。
 * 客户端根据是否收到 2xx 决定是否继续播放。
 */
export const POST = withEmbyAuth(async (request, ctx) => {
  try {
    const body = await request.json();
    await saveProgress(ctx.userId, body);
  } catch {
    // 忽略
  }
  return embyNoContent();
});
