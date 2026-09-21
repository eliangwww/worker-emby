import { getStorage } from '@/lib/db';
import {
  EmbyAuthContext,
  embyJson,
  EmbyRouteParams,
  firstParam,
  resolveBaseUrl,
  withEmbyAuth,
} from '@/lib/emby.http';
import { resolveMediaSource } from '@/lib/emby.items';
import { buildPlaybackInfo } from '@/lib/emby.playback';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/**
 * POST /emby/Items/{itemId}/PlaybackInfo
 *
 * 客户端决定「怎么播」的接口。必须尽量返回可直连的 MediaSources，
 * 否则客户端会要求服务器转码而失败。
 *
 * 支持 query 参数 UserId / StartTimeTicks / MediaSourceId，
 * 也支持 JSON body（不同客户端传法不同）。
 */
async function handler(
  request: Request,
  ctx: EmbyAuthContext,
  params: EmbyRouteParams
) {
  const itemId = firstParam(params, 'itemId');
  const { searchParams } = new URL(request.url);
  const baseUrl = resolveBaseUrl(request);

  // body 解析（有些客户端只发 body）
  let body: Record<string, unknown> = {};
  if (request.method === 'POST') {
    try {
      const text = await request.text();
      if (text) body = JSON.parse(text);
    } catch {
      body = {};
    }
  }

  const mediaSourceId = String(
    body.MediaSourceId ?? searchParams.get('MediaSourceId') ?? ''
  ) || undefined;

  const startTimeTicks = Number(
    body.StartTimeTicks ?? searchParams.get('StartTimeTicks') ?? 0
  );

  // Episode 的 Id 里已编码分集序号，这里无需额外推断
  const resolved = await resolveMediaSource({
    itemId: itemId || '',
    userName: ctx.userName,
    baseUrl,
    mediaSourceId,
  });

  if (!resolved) {
    // 找不到播放地址时返回空 MediaSources，客户端会提示无法播放
    // 而不是崩溃
    return embyJson(
      buildPlaybackInfo({ itemId: itemId || '', mediaSources: [] })
    );
  }

  const playbackInfo = buildPlaybackInfo({
    itemId: itemId || '',
    mediaSources: [resolved.mediaSource],
  });

  // 记录起播进度（Continue Watching 用）
  try {
    const storage = getStorage();
    const existing = await (storage as any).getEmbyPlayback?.(
      ctx.userId,
      resolved.mediaSource.Id
    );
    await (storage as any).setEmbyPlayback?.({
      UserId: ctx.userId,
      ItemId: resolved.mediaSource.Id,
      PositionTicks: startTimeTicks > 0 ? startTimeTicks : existing?.PositionTicks || 0,
      Played: existing?.Played || false,
      PlayCount: existing?.PlayCount || 0,
      LastPlayedDate: Date.now(),
      UpdatedAt: Date.now(),
    });
  } catch {
    // 进度记录失败不影响播放
  }

  return embyJson(playbackInfo);
}

export const POST = withEmbyAuth(handler as any);
export const GET = withEmbyAuth(handler as any);
