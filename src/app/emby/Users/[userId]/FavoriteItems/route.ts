import { getStorage } from '@/lib/db';
import { toEmbyItem } from '@/lib/emby.catalog';
import { embyJson, parsePaging,withEmbyAuth } from '@/lib/emby.http';
import { resolveItem } from '@/lib/emby.items';
import { EmbyBaseItemDto, EmbyQueryResult } from '@/lib/emby.types';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/**
 * GET /emby/Users/{userId}/FavoriteItems
 *
 * 收藏列表。客户端「我的收藏」页面使用。
 */
export const GET = withEmbyAuth(async (request, ctx) => {
  const { searchParams } = new URL(request.url);
  const { startIndex, limit } = parsePaging(searchParams);

  const storage = getStorage();
  let favorites: string[] = [];
  try {
    favorites = (await (storage as any).getAllEmbyFavorites?.(ctx.userId)) || [];
  } catch {
    favorites = [];
  }

  const items: EmbyBaseItemDto[] = [];
  const page = favorites.slice(startIndex, startIndex + limit);

  const resolved = await Promise.all(
    page.map(async (favId) => {
      const r = await resolveItem(favId, undefined, ctx.userName);
      if (!r) return null;
      return toEmbyItem(r.result, {
        userData: {
          PlaybackPositionTicks: 0,
          PlayCount: 0,
          IsFavorite: true,
          Played: false,
          Key: favId,
          ItemId: favId,
        },
      });
    })
  );

  resolved.forEach((r) => {
    if (r) items.push(r);
  });

  const result: EmbyQueryResult<EmbyBaseItemDto> = {
    Items: items,
    TotalRecordCount: favorites.length,
    StartIndex: startIndex,
  };
  return embyJson(result);
});
