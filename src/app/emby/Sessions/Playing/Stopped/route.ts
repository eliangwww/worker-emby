import { embyNoContent, withEmbyAuth } from '@/lib/emby.http';
import { finishProgress } from '@/lib/emby.progress';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/**
 * POST /emby/Sessions/Playing/Stopped
 *
 * 停止播放上报。客户端在此结算进度：
 *   - 接近结尾 -> 标记已看，从「继续观看」移除
 *   - 中途退出 -> 保留进度，出现在「继续观看」
 */
export const POST = withEmbyAuth(async (request, ctx) => {
  try {
    const body = await request.json();
    await finishProgress(ctx.userId, body);
  } catch {
    // 忽略
  }
  return embyNoContent();
});
