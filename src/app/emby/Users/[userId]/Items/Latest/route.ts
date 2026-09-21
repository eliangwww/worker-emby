import { LIBRARIES, sortItems } from '@/lib/emby.catalog';
import { embyJson, parsePaging,withEmbyAuth } from '@/lib/emby.http';
import { listLibraryItems, normalizeTitle } from '@/lib/emby.items';
import { EmbyBaseItemDto, EmbyQueryResult } from '@/lib/emby.types';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/**
 * GET /emby/Users/{userId}/Items/Latest
 *
 * 「最新添加」。客户端首页横向滚动区使用。
 * 聚合源没有时间线，这里跨媒体库聚合一批内容作为推荐位。
 */
export const GET = withEmbyAuth(async (request, ctx) => {
  const { searchParams } = new URL(request.url);
  const { limit } = parsePaging(searchParams);
  const parentId = searchParams.get('ParentId') || '';

  const libraries = parentId
    ? LIBRARIES.filter((l) => parentId.includes(l.key))
    : LIBRARIES;

  const targets = libraries.length ? libraries : LIBRARIES;

  const batches = await Promise.all(
    targets.map((lib) =>
      listLibraryItems({
        libraryKey: lib.key,
        userName: ctx.userName,
      }).catch(() => [] as EmbyBaseItemDto[])
    )
  );

  const seen = new Set<string>();
  const merged: EmbyBaseItemDto[] = [];
  for (const item of batches.flat()) {
    const key = normalizeTitle(item.Name);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }

  const items = sortItems(merged, 'SortName', 'Descending').slice(
    0,
    Math.max(1, limit)
  );

  const result: EmbyQueryResult<EmbyBaseItemDto> = {
    Items: items,
    TotalRecordCount: merged.length,
    StartIndex: 0,
  };
  return embyJson(result);
});
