import { getStorage } from '@/lib/db';
import { toEmbyItem } from '@/lib/emby.catalog';
import { embyJson, parsePaging,withEmbyAuth } from '@/lib/emby.http';
import { resolveItem } from '@/lib/emby.items';
import { EmbyBaseItemDto, EmbyQueryResult } from '@/lib/emby.types';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/**
 * GET /emby/Users/{userId}/Items/Resume
 *
 * 「继续观看」。客户端首页最重要的一个接口。
 * 依据 emby_playback 表里未看完的记录回源重建条目。
 */
export const GET = withEmbyAuth(async (request, ctx) => {
  const { searchParams } = new URL(request.url);
  const { startIndex, limit } = parsePaging(searchParams);
  const mediaTypes = searchParams.get('MediaTypes') || '';

  const storage = getStorage();
  let records: any[] = [];
  try {
    records = (await (storage as any).getAllEmbyPlayback?.(ctx.userId)) || [];
  } catch {
    records = [];
  }

  // 未看完且有进度的记录
  const resumable = records.filter(
    (r) => !r.Played && (r.PositionTicks || 0) > 0
  );

  let favorites: string[] = [];
  try {
    favorites = (await (storage as any).getAllEmbyFavorites?.(ctx.userId)) || [];
  } catch {
    favorites = [];
  }
  const favSet = new Set(favorites);

  const items: EmbyBaseItemDto[] = [];

  // 并发回源重建，限制并发避免打爆上游
  const batch = resumable.slice(startIndex, startIndex + limit);
  const resolved = await Promise.all(
    batch.map(async (rec) => {
      // ItemId 可能是 itemId 或 mediaSourceId(source:id:ep)
      const resolvedItem = await resolveItemForResume(rec.ItemId, ctx.userName);
      if (!resolvedItem) return null;

      const item = toEmbyItem(resolvedItem.result, {
        userData: {
          PlaybackPositionTicks: rec.PositionTicks || 0,
          PlayCount: rec.PlayCount || 0,
          IsFavorite: favSet.has(rec.ItemId),
          Played: false,
          Key: rec.ItemId,
          ItemId: rec.ItemId,
          LastPlayedDate: rec.LastPlayedDate
            ? new Date(rec.LastPlayedDate).toISOString()
            : undefined,
        },
      });
      return item;
    })
  );

  resolved.forEach((r) => {
    if (r) items.push(r);
  });

  void mediaTypes;

  const result: EmbyQueryResult<EmbyBaseItemDto> = {
    Items: items,
    TotalRecordCount: resumable.length,
    StartIndex: startIndex,
  };
  return embyJson(result);
});

/**
 * 兼容两种 Id：
 *   - source:id:ep（MediaSourceId 形态，播放进度按集记录）
 *   - GUID（条目 Id 形态）
 */
async function resolveItemForResume(itemId: string, userName: string) {
  const parts = itemId.split(':');
  if (parts.length >= 2 && !itemId.includes('-')) {
    const { resolveStreamByLocation } = await import('@/lib/emby.items');
    const found = await resolveStreamByLocation({
      source: parts[0],
      sourceId: parts[1],
    });
    if (found) {
      const { encodeItemId } = await import('@/lib/emby.catalog');
      return {
        itemId: encodeItemId(parts[0], parts[1]),
        source: parts[0],
        sourceId: parts[1],
        result: found.result,
      };
    }
  }
  return resolveItem(itemId, undefined, userName);
}
