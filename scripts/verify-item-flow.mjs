/* eslint-disable */
/**
 * 端到端验证：搜索 -> 点开详情 -> 取播放信息。
 *
 * 关键：每个步骤都用**全新的模块实例**（模拟不同 isolate），
 * 复现并验证「Item not found」已被修复。
 *
 * 运行：node --experimental-sqlite scripts/verify-item-flow.mjs
 */

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = process.cwd();
const ts = require('typescript');

process.env.USERNAME = 'admin';
process.env.AUTH_PASSWORD = 'test-password';
process.env.SITE_NAME = 'KatelyaTV Emby';

const sqlite = new DatabaseSync(':memory:');
sqlite.exec(fs.readFileSync(path.join(root, 'scripts/d1-init.sql'), 'utf8'));
globalThis.DB = {
  prepare(sql) {
    let b = [];
    return {
      bind(...v) { b = v.map((x) => (typeof x === 'boolean' ? (x ? 1 : 0) : x === undefined ? null : x)); return this; },
      async first(c) { const r = sqlite.prepare(sql).get(...b); return r ? (c ? r[c] : r) : null; },
      async run() { const i = sqlite.prepare(sql).run(...b); return { results: [], success: true, meta: { changes: i.changes, last_row_id: Number(i.lastInsertRowid), changed_db: i.changes > 0, duration: 0 } }; },
      async all() { return { results: sqlite.prepare(sql).all(...b), success: true, meta: {} }; },
    };
  },
  async exec(sql) { sqlite.exec(sql); return { count: 0, duration: 0 }; },
  async batch(s) { return Promise.all(s.map((x) => x.run())); },
};

const SITE = { key: 'hnzy', name: '火鸟资源', api: 'https://cms.test/api.php/provide/vod' };
const makeItem = (id, name, cls) => ({
  vod_id: id, vod_name: name, vod_pic: `https://img.test/${id}.jpg`, vod_year: '2024',
  vod_class: cls, type_name: cls, vod_content: '<p>简介</p>',
  vod_play_url: `第01集$https://cdn.test/${id}/01.m3u8#第02集$https://cdn.test/${id}/02.m3u8`,
});

globalThis.fetch = async (input) => {
  const url = typeof input === 'string' ? input : input.url;
  const j = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (url.includes('ac=list')) return j({ class: [{ type_id: 6, type_name: '国产剧' }] });
  if (url.includes('ac=detail') && url.includes('&t=')) return j({ list: [makeItem(111, '分类剧集', '国产剧')] });
  if (url.includes('wd=')) {
    const wd = decodeURIComponent(new URL(url).searchParams.get('wd') || '');
    return j({ list: wd.includes('庆余年') ? [makeItem(999, '庆余年 第二季', '国产剧')] : [] });
  }
  if (url.includes('ids=')) return j({ list: [makeItem(999, '庆余年 第二季', '国产剧')] });
  return j({ list: [] });
};

/** 关键：每次调用都是全新的模块树 = 不同 isolate */
function freshIsolate() {
  const cache = new Map();
  function load(absPath) {
    if (cache.has(absPath)) return cache.get(absPath);
    const out = ts.transpileModule(fs.readFileSync(absPath, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
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
        if (fs.existsSync(c)) return load(c);
      }
      throw new Error('cannot resolve ' + spec);
    };
    new Function('exports', 'require', 'module', '__filename', '__dirname', out.outputText)(mod.exports, rq, mod, absPath, dir);
    return mod.exports;
  }
  return {
    get: (p) => load(path.join(root, 'src', p)),
  };
}

const adminConfig = {
  SiteConfig: { SiteName: 'KatelyaTV Emby', Announcement: '', SearchDownstreamMaxPage: 5, SiteInterfaceCacheTime: 7200, ImageProxy: '', DoubanProxy: '' },
  UserConfig: { AllowRegister: false, Users: [{ username: 'admin', role: 'owner' }] },
  SourceConfig: [{ key: SITE.key, name: SITE.name, api: SITE.api, from: 'config', disabled: false, is_adult: false }],
};
sqlite.prepare('INSERT OR REPLACE INTO admin_configs (config_key, config_value, description) VALUES (?,?,?)')
  .run('main_config', JSON.stringify(adminConfig), 'test');

const BASE = 'https://tv.test';
const jreq = (p, o = {}) => new Request(BASE + p, {
  method: o.method || 'GET',
  headers: { 'Content-Type': 'application/json', ...(o.headers || {}) },
  body: o.body ? JSON.stringify(o.body) : undefined,
});
const rj = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return { __raw: t }; } };

let pass = 0, fail = 0;
const check = (n, c, d = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}  ${d}`); } };

console.log('\n=== 端到端：搜索 → 详情 → 播放信息（跨 isolate） ===\n');

// ---- isolate 1：登录 ----
const iso1 = freshIsolate();
const auth = await rj(await iso1.get('app/emby/Users/AuthenticateByName/route.ts').POST(
  jreq('/emby/Users/AuthenticateByName', { method: 'POST', body: { Username: 'admin', Pw: 'test-password' } })
));
const H = { 'X-Emby-Token': auth.AccessToken };
const UID = auth.User?.Id;
check('isolate 1 登录成功', !!auth.AccessToken);

// ---- isolate 2：搜索（模拟客户端搜索请求落到另一个实例） ----
const iso2 = freshIsolate();
await iso2.get('lib/config.ts').getConfig(); // 触发源登记
const searchRes = await rj(await iso2.get('app/emby/Users/[userId]/Items/route.ts').GET(
  jreq(`/emby/Users/${UID}/Items?SearchTerm=%E5%BA%86%E4%BD%99%E5%B9%B4&IncludeItemTypes=Movie,Series`, { headers: H }),
  { params: { userId: UID } }
));
const found = searchRes.Items?.[0];
check('isolate 2 搜索到条目', !!found, JSON.stringify(searchRes).slice(0, 120));
console.log(`      条目: ${found?.Name}  Id=${found?.Id}`);
const ITEM_ID = found?.Id;

// ---- isolate 3：点开详情（客户端第二个请求，可能落在别的实例） ----
const iso3 = freshIsolate();
await iso3.get('lib/config.ts').getConfig();
const detailRes = await iso3.get('app/emby/Users/[userId]/Items/[itemId]/route.ts').GET(
  jreq(`/emby/Users/${UID}/Items/${ITEM_ID}`, { headers: H }),
  { params: { userId: UID, itemId: ITEM_ID } }
);
check('isolate 3 能打开详情（不再是 Item not found）', detailRes.status === 200, `status=${detailRes.status}`);
const detail = await rj(detailRes);
check('详情含 Name', !!detail.Name, JSON.stringify(detail).slice(0, 120));
check('详情 Type 为 Series', detail.Type === 'Series', String(detail.Type));
console.log(`      详情: ${detail.Name} (${detail.Type}) 集数=${detail.ChildCount}`);

// ---- isolate 4：分集列表（明确要求 Episode，符合真实客户端） ----
const iso4 = freshIsolate();
await iso4.get('lib/config.ts').getConfig();
const epRes = await rj(await iso4.get('app/emby/Users/[userId]/Items/route.ts').GET(
  jreq(`/emby/Users/${UID}/Items?ParentId=${ITEM_ID}&IncludeItemTypes=Episode`, { headers: H }),
  { params: { userId: UID } }
));
check('isolate 4 列出分集', (epRes.Items?.length || 0) > 0, `items=${epRes.Items?.length}`);
console.log(`      分集数: ${epRes.Items?.length}`);
const EP_ID = epRes.Items?.[0]?.Id;

// ---- isolate 5：分集详情 + 播放信息 ----
const iso5 = freshIsolate();
await iso5.get('lib/config.ts').getConfig();
const epDetail = await iso5.get('app/emby/Users/[userId]/Items/[itemId]/route.ts').GET(
  jreq(`/emby/Users/${UID}/Items/${EP_ID}`, { headers: H }),
  { params: { userId: UID, itemId: EP_ID } }
);
check('isolate 5 能打开分集详情', epDetail.status === 200, `status=${epDetail.status}`);

const iso6 = freshIsolate();
await iso6.get('lib/config.ts').getConfig();
const pbiRes = await iso6.get('app/emby/Items/[itemId]/PlaybackInfo/route.ts').POST(
  jreq(`/emby/Items/${EP_ID}/PlaybackInfo`, { method: 'POST', body: {}, headers: H }),
  { params: { itemId: EP_ID } }
);
const pbi = await rj(pbiRes);
check('isolate 6 取到播放信息', pbiRes.status === 200, `status=${pbiRes.status}`);
check('返回 MediaSources', Array.isArray(pbi.MediaSources) && pbi.MediaSources.length > 0,
  JSON.stringify(pbi).slice(0, 160));
if (pbi.MediaSources?.length) {
  const ms = pbi.MediaSources[0];
  console.log(`      播放源: ${ms.Container} ${ms.Path}`);
  check('播放地址有效', /^https?:\/\//.test(ms.Path || ''), String(ms.Path));
  check('声明支持直连/直通', ms.SupportsDirectStream === true);
}

// ---- isolate 7：视频流端点解析 ----
const iso7 = freshIsolate();
await iso7.get('lib/config.ts').getConfig();
let streamOk = false;
let streamStatus = 0;
try {
  const sr = await iso7.get('app/emby/Videos/[itemId]/stream/route.ts').GET(
    jreq(`/emby/Videos/${EP_ID}/stream?Static=true`, { headers: H }),
    { params: { itemId: EP_ID } }
  );
  streamStatus = sr.status;
  streamOk = sr.status === 200 || sr.status === 206;
} catch (e) {
  streamStatus = -1;
}
check('stream 端点可解析（200/206）', streamOk, `status=${streamStatus}`);

console.log(`\n=== ${pass} 通过 / ${fail} 失败 ===\n`);
process.exit(fail === 0 ? 0 : 1);
