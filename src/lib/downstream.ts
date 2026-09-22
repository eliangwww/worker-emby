import { API_CONFIG, ApiSite, getConfig } from '@/lib/config';
import { SearchResult } from '@/lib/types';
import { cleanHtmlTags } from '@/lib/utils';

interface ApiSearchItem {
  vod_id: string;
  vod_name: string;
  vod_pic: string;
  vod_remarks?: string;
  vod_play_url?: string;
  vod_class?: string;
  vod_year?: string;
  vod_content?: string;
  vod_douban_id?: number;
  type_name?: string;
}

export async function searchFromApi(
  apiSite: ApiSite,
  query: string
): Promise<SearchResult[]> {
  try {
    const apiBaseUrl = apiSite.api;
    const apiUrl =
      apiBaseUrl + API_CONFIG.search.path + encodeURIComponent(query);
    const apiName = apiSite.name;

    // 添加超时处理
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(apiUrl, {
      headers: API_CONFIG.search.headers,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    if (
      !data ||
      !data.list ||
      !Array.isArray(data.list) ||
      data.list.length === 0
    ) {
      return [];
    }
    // 处理第一页结果
    const results = data.list.map((item: ApiSearchItem) => {
      let episodes: string[] = [];

      // 使用正则表达式从 vod_play_url 提取 m3u8 链接
      if (item.vod_play_url) {
        const m3u8Regex = /\$(https?:\/\/[^"'\s]+?\.m3u8)/g;
        // 先用 $$$ 分割
        const vod_play_url_array = item.vod_play_url.split('$$$');
        // 对每个分片做匹配，取匹配到最多的作为结果
        vod_play_url_array.forEach((url: string) => {
          const matches = url.match(m3u8Regex) || [];
          if (matches.length > episodes.length) {
            episodes = matches;
          }
        });
      }

      episodes = Array.from(new Set(episodes)).map((link: string) => {
        link = link.substring(1); // 去掉开头的 $
        const parenIndex = link.indexOf('(');
        return parenIndex > 0 ? link.substring(0, parenIndex) : link;
      });

      return {
        id: item.vod_id.toString(),
        title: item.vod_name.trim().replace(/\s+/g, ' '),
        poster: item.vod_pic,
        episodes,
        source: apiSite.key,
        source_name: apiName,
        class: item.vod_class,
        year: item.vod_year
          ? item.vod_year.match(/\d{4}/)?.[0] || ''
          : 'unknown',
        desc: cleanHtmlTags(item.vod_content || ''),
        type_name: item.type_name,
        douban_id: item.vod_douban_id,
      };
    });

    const config = await getConfig();
    const MAX_SEARCH_PAGES: number = config.SiteConfig.SearchDownstreamMaxPage;

    // 获取总页数
    const pageCount = data.pagecount || 1;
    // 确定需要获取的额外页数
    const pagesToFetch = Math.min(pageCount - 1, MAX_SEARCH_PAGES - 1);

    // 如果有额外页数，获取更多页的结果
    if (pagesToFetch > 0) {
      const additionalPagePromises = [];

      for (let page = 2; page <= pagesToFetch + 1; page++) {
        const pageUrl =
          apiBaseUrl +
          API_CONFIG.search.pagePath
            .replace('{query}', encodeURIComponent(query))
            .replace('{page}', page.toString());

        const pagePromise = (async () => {
          try {
            const pageController = new AbortController();
            const pageTimeoutId = setTimeout(
              () => pageController.abort(),
              8000
            );

            const pageResponse = await fetch(pageUrl, {
              headers: API_CONFIG.search.headers,
              signal: pageController.signal,
            });

            clearTimeout(pageTimeoutId);

            if (!pageResponse.ok) return [];

            const pageData = await pageResponse.json();

            if (!pageData || !pageData.list || !Array.isArray(pageData.list))
              return [];

            return pageData.list.map((item: ApiSearchItem) => {
              let episodes: string[] = [];

              // 使用正则表达式从 vod_play_url 提取 m3u8 链接
              if (item.vod_play_url) {
                const m3u8Regex = /\$(https?:\/\/[^"'\s]+?\.m3u8)/g;
                episodes = item.vod_play_url.match(m3u8Regex) || [];
              }

              episodes = Array.from(new Set(episodes)).map((link: string) => {
                link = link.substring(1); // 去掉开头的 $
                const parenIndex = link.indexOf('(');
                return parenIndex > 0 ? link.substring(0, parenIndex) : link;
              });

              return {
                id: item.vod_id.toString(),
                title: item.vod_name.trim().replace(/\s+/g, ' '),
                poster: item.vod_pic,
                episodes,
                source: apiSite.key,
                source_name: apiName,
                class: item.vod_class,
                year: item.vod_year
                  ? item.vod_year.match(/\d{4}/)?.[0] || ''
                  : 'unknown',
                desc: cleanHtmlTags(item.vod_content || ''),
                type_name: item.type_name,
                douban_id: item.vod_douban_id,
              };
            });
          } catch (error) {
            return [];
          }
        })();

        additionalPagePromises.push(pagePromise);
      }

      // 等待所有额外页的结果
      const additionalResults = await Promise.all(additionalPagePromises);

      // 合并所有页的结果
      additionalResults.forEach((pageResults) => {
        if (pageResults.length > 0) {
          results.push(...pageResults);
        }
      });
    }

    return results;
  } catch (error) {
    return [];
  }
}

// 匹配 m3u8 链接的正则
const M3U8_PATTERN = /(https?:\/\/[^"'\s]+?\.m3u8)/g;

/**
 * Apple CMS 的「分类浏览」接口。
 *
 * 关键认知：`wd=` 是**片名关键词**搜索，不是分类浏览。
 * 搜索 `电影`/`综艺` 这类分类名几乎必然返回空结果，
 * 这是媒体库与推荐页为空的根本原因。
 *
 * 正确做法是使用分类列表接口：
 *   ?ac=detail&t=<分类ID>&pg=<页码>
 * 或（部分源不支持 t 时）用 `ac=list` 拉取分类映射：
 *   ?ac=list  ->  class: [{type_id, type_name}]
 */
export interface CmsCategory {
  type_id: number;
  type_name: string;
}

/** 拉取资源站的一级分类列表 */
export async function fetchCategories(
  apiSite: ApiSite
): Promise<CmsCategory[]> {
  try {
    const url = `${apiSite.api}?ac=list`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(url, {
      headers: API_CONFIG.search.headers,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) return [];

    const data = await res.json();
    const list = data?.class;
    if (!Array.isArray(list)) return [];

    return list
      .filter((c: any) => c && (c.type_id !== undefined || c.type_id === 0))
      .map((c: any) => ({
        type_id: Number(c.type_id),
        type_name: String(c.type_name || '').trim(),
      }))
      .filter((c) => c.type_name && Number.isFinite(c.type_id));
  } catch {
    return [];
  }
}

/**
 * 按分类 ID 拉取内容列表（真正的「浏览」）。
 *
 * @param apiSite 资源站
 * @param typeId  分类 ID
 * @param page    页码（从 1 开始）
 */
export async function fetchByCategory(
  apiSite: ApiSite,
  typeId: number,
  page = 1
): Promise<SearchResult[]> {
  try {
    const url = `${apiSite.api}?ac=detail&t=${typeId}&pg=${page}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(url, {
      headers: API_CONFIG.search.headers,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) return [];

    const data = await res.json();
    if (!Array.isArray(data?.list)) return [];

    return data.list.map((item: ApiSearchItem) =>
      mapApiItemToResult(item, apiSite)
    );
  } catch {
    return [];
  }
}

/**
 * 按年份/地区等更多条件浏览（部分源支持）。
 * 失败时由调用方回退到 fetchByCategory。
 */
export async function fetchLatestByCategory(
  apiSite: ApiSite,
  typeId: number,
  page = 1
): Promise<SearchResult[]> {
  return fetchByCategory(apiSite, typeId, page);
}

/** 把 CMS 条目映射为内部 SearchResult（搜索结果与分类浏览共用） */
export function mapApiItemToResult(
  item: ApiSearchItem,
  apiSite: ApiSite
): SearchResult {
  let episodes: string[] = [];

  if (item.vod_play_url) {
    const m3u8Regex = /\$(https?:\/\/[^"'\s]+?\.m3u8)/g;
    const vod_play_url_array = item.vod_play_url.split('$$$');
    vod_play_url_array.forEach((url: string) => {
      const matches = url.match(m3u8Regex) || [];
      if (matches.length > episodes.length) {
        episodes = matches;
      }
    });

    // 非 m3u8 的直链源（mp4 等）也一并支持
    if (episodes.length === 0) {
      const parts = item.vod_play_url.split('$$$')[0].split('#');
      episodes = parts
        .map((ep: string) => {
          const seg = ep.split('$');
          return seg.length > 1 ? seg[1] : '';
        })
        .filter(
          (u: string) => u.startsWith('http://') || u.startsWith('https://')
        );
    }
  }

  episodes = Array.from(new Set(episodes)).map((link: string) => {
    link = link.substring(1);
    const parenIndex = link.indexOf('(');
    return parenIndex > 0 ? link.substring(0, parenIndex) : link;
  });

  return {
    id: String(item.vod_id),
    title: String(item.vod_name || '').trim().replace(/\s+/g, ' '),
    poster: item.vod_pic || '',
    episodes,
    source: apiSite.key,
    source_name: apiSite.name,
    class: item.vod_class,
    year: item.vod_year
      ? item.vod_year.match(/\d{4}/)?.[0] || ''
      : 'unknown',
    desc: cleanHtmlTags(item.vod_content || ''),
    type_name: item.type_name,
    douban_id: item.vod_douban_id,
  };
}

export async function getDetailFromApi(
  apiSite: ApiSite,
  id: string
): Promise<SearchResult> {
  if (apiSite.detail) {
    return handleSpecialSourceDetail(id, apiSite);
  }

  const detailUrl = `${apiSite.api}${API_CONFIG.detail.path}${id}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  const response = await fetch(detailUrl, {
    headers: API_CONFIG.detail.headers,
    signal: controller.signal,
  });

  clearTimeout(timeoutId);

  if (!response.ok) {
    throw new Error(`详情请求失败: ${response.status}`);
  }

  const data = await response.json();

  if (
    !data ||
    !data.list ||
    !Array.isArray(data.list) ||
    data.list.length === 0
  ) {
    throw new Error('获取到的详情内容无效');
  }

  const videoDetail = data.list[0];
  let episodes: string[] = [];

  // 处理播放源拆分
  if (videoDetail.vod_play_url) {
    const playSources = videoDetail.vod_play_url.split('$$$');

    // ⚠️ 不再盲取 playSources[0]。
    //
    // 部分采集站（如 U酷影视 ykzy）的第 0 组是 \"分享页\" 之类的
    // 非标准地址（如 https://xxx/share/xxx），并非可直接播放的
    // m3u8/mp4；真正的播放地址在第 1 组。旧实现只取第 0 组，
    // 会导致这些源「能搜到、点进去却播不了」。
    //
    // 改为：解析每一组的可播放地址，选「数量最多」且含 m3u8 的
    // 那一组；都没有 m3u8 时退回「可播放地址最多」的组。
    const parsedGroups: string[][] = playSources.map((group: string) =>
      group
        .split('#')
        .map((ep: string) => {
          const parts = ep.split('$');
          return parts.length > 1 ? parts[1].trim() : '';
        })
        .filter(
          (url: string) =>
            url && (url.startsWith('http://') || url.startsWith('https://'))
        )
    );

    const m3u8Groups = parsedGroups
      .map((urls, idx) => ({ idx, urls }))
      .filter((g) => g.urls.some((u) => /\.m3u8(\?|$)/i.test(u)));

    if (m3u8Groups.length) {
      const best = m3u8Groups.sort(
        (a, b) => b.urls.length - a.urls.length
      )[0];
      episodes = best.urls;
    } else {
      const nonEmpty = parsedGroups
        .map((urls, idx) => ({ idx, urls }))
        .filter((g) => g.urls.length > 0);
      if (nonEmpty.length) {
        const best = nonEmpty.sort(
          (a, b) => b.urls.length - a.urls.length
        )[0];
        episodes = best.urls;
      }
    }
  }

  // 如果播放源为空，则尝试从内容中解析 m3u8
  if (episodes.length === 0 && videoDetail.vod_content) {
    const matches = videoDetail.vod_content.match(M3U8_PATTERN) || [];
    episodes = matches.map((link: string) => link.replace(/^\$/, ''));
  }

  return {
    id: id.toString(),
    title: videoDetail.vod_name,
    poster: videoDetail.vod_pic,
    episodes,
    source: apiSite.key,
    source_name: apiSite.name,
    class: videoDetail.vod_class,
    year: videoDetail.vod_year
      ? videoDetail.vod_year.match(/\d{4}/)?.[0] || ''
      : 'unknown',
    desc: cleanHtmlTags(videoDetail.vod_content),
    type_name: videoDetail.type_name,
    douban_id: videoDetail.vod_douban_id,
  };
}

async function handleSpecialSourceDetail(
  id: string,
  apiSite: ApiSite
): Promise<SearchResult> {
  const detailUrl = `${apiSite.detail}/index.php/vod/detail/id/${id}.html`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  const response = await fetch(detailUrl, {
    headers: API_CONFIG.detail.headers,
    signal: controller.signal,
  });

  clearTimeout(timeoutId);

  if (!response.ok) {
    throw new Error(`详情页请求失败: ${response.status}`);
  }

  const html = await response.text();
  let matches: string[] = [];

  if (apiSite.key === 'ffzy') {
    const ffzyPattern =
      /\$(https?:\/\/[^"'\s]+?\/\d{8}\/\d+_[a-f0-9]+\/index\.m3u8)/g;
    matches = html.match(ffzyPattern) || [];
  }

  if (matches.length === 0) {
    const generalPattern = /\$(https?:\/\/[^"'\s]+?\.m3u8)/g;
    matches = html.match(generalPattern) || [];
  }

  // 去重并清理链接前缀
  matches = Array.from(new Set(matches)).map((link: string) => {
    link = link.substring(1); // 去掉开头的 $
    const parenIndex = link.indexOf('(');
    return parenIndex > 0 ? link.substring(0, parenIndex) : link;
  });

  // 提取标题
  const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
  const titleText = titleMatch ? titleMatch[1].trim() : '';

  // 提取描述
  const descMatch = html.match(
    /<div[^>]*class=["']sketch["'][^>]*>([\s\S]*?)<\/div>/
  );
  const descText = descMatch ? cleanHtmlTags(descMatch[1]) : '';

  // 提取封面
  const coverMatch = html.match(/(https?:\/\/[^"'\s]+?\.jpg)/g);
  const coverUrl = coverMatch ? coverMatch[0].trim() : '';

  // 提取年份
  const yearMatch = html.match(/>(\d{4})</);
  const yearText = yearMatch ? yearMatch[1] : 'unknown';

  return {
    id,
    title: titleText,
    poster: coverUrl,
    episodes: matches,
    source: apiSite.key,
    source_name: apiSite.name,
    class: '',
    year: yearText,
    desc: descText,
    type_name: '',
    douban_id: 0,
  };
}
