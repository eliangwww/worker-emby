/* eslint-disable no-console, @typescript-eslint/no-explicit-any */

import { authenticateRequest } from '@/lib/emby.auth';
import { getConfig } from '@/lib/config';
import { searchFromApi, fetchCategories } from '@/lib/downstream';
import { embyJson, embyUnauthorized } from '@/lib/emby.http';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/**
 * GET /emby/Diagnostics
 *
 * 自检端点：用于排查「搜索不到内容」这类问题。
 * 会真实访问每个资源站并汇报结果，因此需要鉴权。
 *
 * 返回内容：
 *   - 当前生效的资源站列表（含来源：config.json / 后台添加）
 *   - 每个源的可达性、分类表读取情况
 *   - 用指定关键词真实搜索的结果条数
 *
 * 用法：
 *   /emby/Diagnostics?q=庆余年
 *   /emby/Diagnostics?probe=false        （只看配置，不访问上游）
 */
export async function GET(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return embyUnauthorized();

  const { searchParams } = new URL(request.url);
  const probe = searchParams.get('probe') !== 'false';
  const query = searchParams.get('q') || '';

  let config;
  try {
    config = await getConfig();
  } catch (err) {
    return embyJson(
      {
        ok: false,
        stage: 'getConfig',
        error: err instanceof Error ? err.message : String(err),
        hint: 'D1 未绑定或初始化失败，请检查 wrangler.toml 中的 [[d1_databases]]',
      },
      { status: 500 }
    );
  }

  const sources = (config.SourceConfig || []).map((s) => ({
    key: s.key,
    name: s.name,
    api: s.api,
    from: s.from,
    disabled: !!s.disabled,
    is_adult: !!s.is_adult,
  }));

  const active = sources.filter((s) => !s.disabled);

  const result: any = {
    ok: true,
    serverIdConfigured: !!process.env.EMBY_SERVER_ID,
    siteName: config.SiteConfig?.SiteName,
    sourceCount: sources.length,
    activeCount: active.length,
    sources,
  };

  if (!active.length) {
    result.hint =
      '没有任何启用的资源站。请检查 config.json（构建期内联）或在 /admin 后台添加。';
    return embyJson(result);
  }

  if (!probe) {
    return embyJson(result);
  }

  // ---- 真实探测每个源 ----
  const probes = await Promise.all(
    active.map(async (s) => {
      const apiSite = {
        key: s.key,
        name: s.name,
        api: s.api,
        detail: (s as any).detail,
      };

      const entry: any = { key: s.key, name: s.name, api: s.api };

      // 1) 分类表（判断源是否可达 + 是否支持浏览）
      try {
        const cats = await fetchCategories(apiSite);
        entry.categoriesOk = cats.length > 0;
        entry.categoryCount = cats.length;
        entry.categorySample = cats.slice(0, 8).map((c) => `${c.type_id}:${c.type_name}`);
        if (!cats.length) {
          entry.categoryNote =
            '未取到分类表（部分源不支持 ac=list，不影响搜索）';
        }
      } catch (err) {
        entry.categoriesOk = false;
        entry.categoriesError = err instanceof Error ? err.message : String(err);
      }

      // 2) 关键词搜索
      if (query) {
        try {
          const items = await searchFromApi(apiSite, query);
          entry.searchOk = true;
          entry.searchCount = items.length;
          if (items.length) {
            entry.searchSample = items.slice(0, 3).map((i) => ({
              id: i.id,
              title: i.title,
              episodes: i.episodes.length,
              class: i.class,
            }));
          }
        } catch (err) {
          entry.searchOk = false;
          entry.searchError = err instanceof Error ? err.message : String(err);
        }
      }

      return entry;
    })
  );

  result.probes = probes;
  result.summary = {
    reachable: probes.filter((p) => p.categoriesOk || p.searchOk).length,
    total: probes.length,
    searchQuery: query || null,
    searchHits: probes.reduce((n, p) => n + (p.searchCount || 0), 0),
  };

  if (query && result.summary.searchHits === 0) {
    result.hint =
      '所有源对该关键词均无结果。可能原因：关键词不含片名（wd= 是片名搜索）、' +
      '源站不可达、或源站需要不同的参数格式。请用具体片名（如「庆余年」）重试。';
  }

  return embyJson(result);
}
