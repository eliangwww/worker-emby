/* eslint-disable */
/**
 * 端到端模拟：hills/Emby 客户端从「库列表 -> 详情 -> 季 -> 集」的完整调用链，
 * 检查每一步返回是否为空（定位「没有选集选季」）。
 *
 * 运行：node scripts/debug-episode-flow.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = process.cwd();
const ts = require('typescript');

process.env.USERNAME = 'admin';
process.env.AUTH_PASSWORD = 'test';
process.env.SITE_NAME = 'KatelyaTV Emby';
process.env.NEXT_PUBLIC_SEARCH_MAX_PAGE = '2';

// 临时把 runtime.ts 换成单源配置，加速并聚焦测试
const runtimePath = path.join(root, 'src/lib/runtime.ts');
const runtimeBackup = fs.readFileSync(runtimePath, 'utf8');
const testConfig = {
  cache_time: 7200,
  api_site: {
    lzzy: { api: 'https://360zyzz.com/api.php/provide/vod', name: '360资源', is_adult: false },
  },
};
fs.writeFileSync(runtimePath, `export const config = ${JSON.stringify(testConfig, null, 2)} as const;\nexport type RuntimeConfig = typeof config;\nexport default config;\n`);
process.on('exit', () => { try { fs.writeFileSync(runtimePath, runtimeBackup); } catch {} });

function loadTs(absPath, cache = new Map()) {
  if (cache.has(absPath)) return cache.get(absPath);
  const out = ts.transpileModule(fs.readFileSync(absPath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      resolveJsonModule: true,
    },
    fileName: absPath,
  });
  const mod = { exports: {} };
  cache.set(absPath, mod.exports);
  const dir = path.dirname(absPath);
  const rq = (spec) => {
    let resolved;
    if (spec.startsWith('@/')) resolved = path.join(root, 'src', spec.slice(2));
    else if (spec.startsWith('.')) resolved = path.resolve(dir, spec);
    else return require(spec);
    for (const c of [resolved + '.ts', resolved + '.tsx', path.join(resolved, 'index.ts')]) {
      if (fs.existsSync(c)) return loadTs(c, cache);
    }
    throw new Error('cannot resolve ' + spec);
  };
  new Function('exports', 'require', 'module', '__filename', '__dirname', out.outputText)(
    mod.exports, rq, mod, absPath, dir
  );
  return mod.exports;
}

const catalog = loadTs(path.join(root, 'src/lib/emby.catalog.ts'));
const items = loadTs(path.join(root, 'src/lib/emby.items.ts'));

console.log('\n=== 模拟 Emby 客户端剧集链路 ===\n');

// 1) 搜索一部剧
console.log('[1] 搜索「庆余年」');
const { searchFromApi } = loadTs(path.join(root, 'src/lib/downstream.ts'));
const site = { key: 'lzzy', name: '360资源', api: 'https://360zyzz.com/api.php/provide/vod' };
const results = await searchFromApi(site, '庆余年');
console.log(`  返回 ${results.length} 条`);
if (!results.length) { console.log('  ❌ 搜索为空，终止'); process.exit(1); }

const series = results.find((r) => r.episodes.length > 1) || results[0];
console.log(`  选中: "${series.title}" id=${series.id}`);
console.log(`  episodes 数量: ${series.episodes.length}`);
console.log(`  poster: ${series.poster ? '有' : '无'}`);
console.log(`  isSeries(>1): ${series.episodes.length > 1}`);

// 2) 模拟 toEmbyItem（详情页返回）
console.log('\n[2] toEmbyItem（详情页）');
const item = catalog.toEmbyItem(series);
console.log(`  Type=${item.Type} IsFolder=${item.IsFolder} ChildCount=${item.ChildCount}`);
console.log(`  Id=${item.Id}`);

// 3) 模拟客户端请求 Season 列表：Items?ParentId=<seriesId>
console.log('\n[3] resolveSeasons（客户端要季列表）');
const seasons = await items.resolveSeasons(item.Id, 'admin');
console.log(`  返回 ${seasons.length} 个季`);
seasons.forEach((s) => console.log(`    Id=${s.Id} Name=${s.Name} ChildCount=${s.ChildCount}`));

// 4) 模拟客户端请求 Episode 列表：Items?ParentId=<seriesId>&IncludeItemTypes=Episode
console.log('\n[4] resolveEpisodes（客户端直接要分集）');
const eps = await items.resolveEpisodes(item.Id, undefined, 'admin');
console.log(`  返回 ${eps.length} 个分集`);
eps.slice(0, 3).forEach((e) => console.log(`    Id=${e.Id} Name=${e.Name} Index=${e.IndexNumber}`));
if (eps.length > 3) console.log(`    ... 共 ${eps.length} 集`);

// 5) 模拟客户端请求季下的分集：ParentId=<seasonId>
console.log('\n[5] resolveEpisodesForSeason（季 -> 分集）');
if (seasons.length) {
  const c = catalog.classifyId(seasons[0].Id);
  console.log(`  seasonId 解码: ${JSON.stringify(c)}`);
  const eps2 = await items.resolveEpisodesForSeason(c.source, c.sourceId, 'admin');
  console.log(`  返回 ${eps2.length} 个分集`);
} else {
  console.log('  ⚠️ 没有季，无法测试');
}

console.log('\n=== 结束 ===\n');