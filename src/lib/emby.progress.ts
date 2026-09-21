/* eslint-disable no-console, @typescript-eslint/no-explicit-any */

import { getStorage } from './db';
import { secondsToTicks } from './emby.config';
import { EmbyPlaybackRecord } from './emby.types';

/**
 * 播放进度。
 *
 * 客户端会高频上报进度（Playing / Progress / Stopped），
 * 这些接口必须始终返回 2xx，否则客户端会弹错误或退出播放。
 * 因此所有写入都做了容错，失败只记录日志。
 */

/** 客户端进度请求体（字段命名在不同客户端间不一致） */
export interface ProgressPayload {
  ItemId?: string;
  MediaSourceId?: string;
  PositionTicks?: number;
  IsPaused?: boolean;
  IsMuted?: boolean;
  PlayMethod?: string;
  PlaySessionId?: string;
  EventName?: string;
  PlaybackStartTimeTicks?: number;
  /** 部分客户端上报秒数 */
  PositionMs?: number;
  RuntimeTicks?: number;
}

/** 规范化出条目 Id 与位置 */
export function normalizeProgress(payload: ProgressPayload): {
  itemId: string;
  positionTicks: number;
} | null {
  // MediaSourceId 在本书实现里就是「progress key」（source:id:ep）
  const itemId = String(
    payload.ItemId || payload.MediaSourceId || ''
  ).trim();
  if (!itemId) return null;

  let ticks = Number(payload.PositionTicks || 0);

  // 兼容以毫秒上报的客户端
  if (!ticks && payload.PositionMs) {
    ticks = Number(payload.PositionMs) * 10_000;
  }
  if (!Number.isFinite(ticks) || ticks < 0) ticks = 0;

  return { itemId, positionTicks: Math.round(ticks) };
}

/** 保存进度（起播/播放中） */
export async function saveProgress(
  userId: string,
  payload: ProgressPayload,
  opts: { markPlaying?: boolean } = {}
): Promise<void> {
  const normalized = normalizeProgress(payload);
  if (!normalized) return;

  try {
    const storage = getStorage();
    const existing: EmbyPlaybackRecord | null =
      (await (storage as any).getEmbyPlayback?.(userId, normalized.itemId)) ||
      null;

    // 起播事件若没有位置信息，保留已有进度（续播场景）
    const position =
      opts.markPlaying && normalized.positionTicks === 0
        ? existing?.PositionTicks || 0
        : normalized.positionTicks;

    await (storage as any).setEmbyPlayback?.({
      UserId: userId,
      ItemId: normalized.itemId,
      PositionTicks: position,
      Played: existing?.Played || false,
      PlayCount: existing?.PlayCount || 0,
      LastPlayedDate: Date.now(),
      UpdatedAt: Date.now(),
    });
  } catch (err) {
    console.error('保存播放进度失败:', err);
  }
}

/**
 * 停止播放上报。
 * 客户端在此标记「已看完」，是 Continue Watching 与已看状态的关键。
 */
export async function finishProgress(
  userId: string,
  payload: ProgressPayload
): Promise<void> {
  const normalized = normalizeProgress(payload);
  if (!normalized) return;

  try {
    const storage = getStorage();
    const existing: EmbyPlaybackRecord | null =
      (await (storage as any).getEmbyPlayback?.(userId, normalized.itemId)) ||
      null;

    const runtimeTicks = Number(payload.RuntimeTicks || 0);
    const position = normalized.positionTicks;

    // 播放到 90% 以上（或客户端明确上报已看完）视为看完
    const watchedEnough =
      runtimeTicks > 0
        ? position / runtimeTicks >= 0.9
        : position >= secondsToTicks(60 * 60 * 22); // 无时长信息时的兜底

    const finished =
      watchedEnough ||
      String(payload.EventName || '').toLowerCase().includes('stop') === false;

    await (storage as any).setEmbyPlayback?.({
      UserId: userId,
      ItemId: normalized.itemId,
      PositionTicks: watchedEnough ? 0 : position,
      Played: watchedEnough ? true : existing?.Played || false,
      PlayCount: watchedEnough
        ? (existing?.PlayCount || 0) + 1
        : existing?.PlayCount || 0,
      LastPlayedDate: Date.now(),
      UpdatedAt: Date.now(),
    });

    void finished;
  } catch (err) {
    console.error('保存停止进度失败:', err);
  }
}
