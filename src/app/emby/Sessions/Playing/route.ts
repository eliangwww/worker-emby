import { embyNoContent, withEmbyAuth } from '@/lib/emby.http';
import { saveProgress } from '@/lib/emby.progress';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/**
 * POST /emby/Sessions/Playing
 *
 * 起播上报。客户端在开始播放时调用。
 * 必须返回 204 且尽量快，否则客户端会认为播放失败。
 */
export const POST = withEmbyAuth(async (request, ctx) => {
  try {
    const body = await request.json();
    await saveProgress(ctx.userId, body, { markPlaying: true });
  } catch {
    // 上报失败不应影响播放
  }
  return embyNoContent();
});
