/* eslint-disable */
/**
 * 回归验证：剧集「季 / 选集」与「推荐列表」所需的标准 Emby Shows 路由，
 * 以及「主源优先 + 其他源作播放补充」的架构。
 *
 * 背景：
 *   Hills / Infuse / Yamby 等客户端进入剧集详情页后，会直接请求
 *   /emby/Shows/{id}/Seasons 与 /emby/Shows/{id}/Episodes，
 *   以及详情页底部的 /emby/Shows/{id}/Similar。
 *   缺少这些标准端点时，客户端拿到 404 -> 表现为「没有选集选季」。
 *
 * 运行：node scripts/verify-shows-routes.mjs
 */

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(root, p));

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}  ${detail}`); }
};

console.log('\n=== Shows 路由 + 主源架构 回归验证 ===\n');

// ---------- 1) 标准 Shows 路由文件存在 ----------
console.log('[1] 标准 Emby Shows 路由文件');
const routes = [
  'src/app/emby/Shows/[seriesId]/Seasons/route.ts',
  'src/app/emby/Shows/[seriesId]/Episodes/route.ts',
  'src/app/emby/Shows/NextUp/route.ts',
  'src/app/emby/Shows/[seriesId]/Similar/route.ts',
];
for (const r of routes) {
  check(`存在 ${r}`, exists(r));
}

// ---------- 2) 路由约定（edge / force-dynamic / withEmbyAuth / 先登记源） ----------
console.log('\n[2] Shows 路由约定');
for (const r of routes) {
  if (!exists(r)) continue;
  const src = read(r);
  check(`${r} 使用 edge runtime`, /export const runtime = 'edge'/.test(src));
  check(`${r} force-dynamic`, /export const dynamic = 'force-dynamic'/.test(src));
  check(`${r} 使用 withEmbyAuth`, /withEmbyAuth\(/.test(src));
  check(`${r} 先 ensureSourcesRegistered`, /ensureSourcesRegistered\(\)/.test(src));
}

// ---------- 3) Seasons / Episodes 调用正确的解析函数 ----------
console.log('\n[3] Seasons / Episodes 解析函数');
const seasons = read('src/app/emby/Shows/[seriesId]/Seasons/route.ts');
const episodes = read('src/app/emby/Shows/[seriesId]/Episodes/route.ts');
check('Seasons 调用 resolveSeasonsForSeries', seasons.includes('resolveSeasonsForSeries'));
check('Episodes 调用 resolveEpisodesForSeries', episodes.includes('resolveEpisodesForSeries'));
check('Episodes 支持 SeasonId 过滤', episodes.includes("searchParams.get('SeasonId')"));
check('返回 EmbyQueryResult 结构', seasons.includes('TotalRecordCount') && seasons.includes('StartIndex'));

// ---------- 4) emby.items.ts 导出了对应函数 ----------
console.log('\n[4] emby.items.ts 导出');
const items = read('src/lib/emby.items.ts');
const exports = [
  'resolveSeasonsForSeries',
  'resolveEpisodesForSeries',
  'resolveRecommendations',
  'findPlaybackSupplement',
  'resolveStreamWithSupplement',
];
for (const fn of exports) {
  check(`导出 ${fn}`, new RegExp(`export async function ${fn}\\(`).test(items));
}

// ---------- 5) 主源配置 ----------
console.log('\n[5] 主源配置支持');
const types = read('src/lib/admin.types.ts');
const config = read('src/lib/config.ts');
check('SourceConfig 增加 is_primary 字段', /is_primary\?:\s*boolean/.test(types));
check('config 导出 getPrimaryApiSite', /export async function getPrimaryApiSite/.test(config));
check('可用源列表主源排最前', /sortPrimaryFirst/.test(config));

const sourceApi = read('src/app/api/admin/source/route.ts');
check('源管理 API 支持 setprimary', sourceApi.includes("'setprimary'"));
check('setprimary 保证唯一主源', /s\.is_primary = false/.test(sourceApi));

// ---------- 6) 播放源补充 ----------
console.log('\n[6] 播放源补充');
check('downstream 不再盲取 playSources[0]',
  !/const mainSource = playSources\[0\]/.test(read('src/lib/downstream.ts')));
check('downstream 优先选含 m3u8 的播放组',
  /m3u8Groups/.test(read('src/lib/downstream.ts')));
const streamRoute = read('src/app/emby/Videos/[itemId]/stream/route.ts');
check('stream 路由使用 resolveStreamWithSupplement',
  /resolveStreamWithSupplement/.test(streamRoute));
check('stream 路由传入标题用于跨源补充',
  /title:\s*resolved\.result\.title/.test(streamRoute));

// ---------- 7) 后台 UI ----------
console.log('\n[7] 后台 UI');
const admin = read('src/app/admin/page.tsx');
check('DataSource 增加 is_primary', /is_primary\?:\s*boolean/.test(admin));
check('有 handleSetPrimary', /const handleSetPrimary/.test(admin));
check('表格有「主源」列', admin.includes('主源'));

console.log(`\n=== ${pass} 通过 / ${fail} 失败 ===\n`);
process.exit(fail === 0 ? 0 : 1);
