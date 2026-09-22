/* eslint-disable */
/**
 * 验证用户报告的两个问题：
 *   1. 封面加载不出来（图片端点强制鉴权导致 401）
 *   2. 没有播放/剧集列表（缺 Season 层，客户端 Series->Season->Episode 断链）
 *
 * 全程跨 isolate，模拟真实 Emby 客户端行为。
 *
 * 运行：node --experimental-sqlite scripts/verify-artwork-episodes.mjs
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

// ---------- D1 ----------
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

// ---------- 上游 mock ----------
const SITE = { key: 'hnzy', name: '火鸟资源', api: 'https://cms.test/api.php/provide/vod' };
const POSTER = 'https://img.test/poster-999.jpg';
const makeItem = (id, name, cls, epCount = 24) => ({
  vod_id: id, vod_name: name, vod_pic: POSTER, vod_year: '2024',
  vod_class: cls, type_name: cls, vod_content: '<p>简介</p>',
  vod_play_url: Array.from({ length: epCount }, (_, i) =>
    `第${String(i + 1).padStart(2, '0')}集$https://cdn.test/${id}/${String(i + 1).padStart(2, '0')}.m3u8`
  ).join('#'),
});

const fetchLog = [];
globalThis.fetch = async (input) => {
  const url = typeof input === 'string' ? input : input.url;
  fetchLog.push(url);
  const j = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });

  // 图片：返回真实 PNG 字节
  if (url.startsWith('https://img.test/')) {
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000050001' + '0d0a2db4' + '0000000049454e44ae426082', 'hex');
    return new Response(png, { status: 200, headers: { 'Content-Type': 'image/png' } });
  }
  if (url.includes('ac=list')) return j({ class: [{ type_id: 6, type_name: '国产剧' }] });
  if (url.includes('ac=detail') && url.includes('&t=')) return j({ list: [makeItem(111, '分类剧集', '国产剧')] });
  if (url.includes('wd=')) {
    const wd = decodeURIComponent(new URL(url).searchParams.get('wd') || '');
    return j({ list: wd.includes('庆余年') ? [makeItem(999, '庆余年', '国产剧', 24)] : [] });
  }
  if (url.includes('ids=')) return j({ list: [makeItem(999, '庆余年', '国产剧', 24)] });
  return j({ list: [] });
};

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
  return { get: (p) => load(path.join(root, 'src', p)) };
}

const adminConfig = {
  SiteConfig: { SiteName: 'KatelyaTV Emby', Announcement: '', SearchDownstreamMaxPage: 5, SiteInterfaceCacheTime: 7200, ImageProxy: '', DoubanProxy: '' },
  UserConfig: { AllowRegister: false, Users: [{ username: 'admin', role: 'owner' }] },
  SourceConfig: [{ key: SITE.key, name: SITE.name, api: SITE.api, from: 'config', disabled: false, is_adult: false }],
};
sqlite.prepare('INSERT OR REPLACE INTO admin_configs (config_key, config_value, description) VALUES (?,?,?)')
  .run('main_config', JSON.stringify(adminConfig), 'test');

const BASE = 'https://tv.example.com';
const jreq = (p, o = {}) => new Request(BASE + p, {
  method: o.method || 'GET',
  headers: { 'Content-Type': 'application/json', ...(o.headers || {}) },
  body: o.body ? JSON.stringify(o.body) : undefined,
});
const rj = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return { __raw: t }; } };

let pass = 0, fail = 0;
const check = (n, c, d = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}  ${d}`); } };

console.log('\n=== 封面 + 剧集列表验证 ===\n');

// ---- 登录 + 搜索 ----
const iso1 = freshIsolate();
const auth = await rj(await iso1.get('app/emby/Users/AuthenticateByName/route.ts').POST(
  jreq('/emby/Users/AuthenticateByName', { method: 'POST', body: { Username: 'admin', Pw: 'test-password' } })
));
const H = { 'X-Emby-Token': auth.AccessToken };
const UID = auth.User?.Id;

const iso2 = freshIsolate();
await iso2.get('lib/config.ts').getConfig();
const search = await rj(await iso2.get('app/emby/Users/[userId]/Items/route.ts').GET(
  jreq(`/emby/Users/${UID}/Items?SearchTerm=%E5%BA%86%E4%BD%99%E5%B9%B4`, { headers: H }),
  { params: { userId: UID } }
));
const series = search.Items?.[0];
const SERIES_ID = series?.Id;
check('搜索到剧集', !!SERIES_ID);

// ============ 问题 1：封面 ============
console.log('\n[1] 封面图（ImageTags / 图片端点）');
check('条目声明了 Primary ImageTag', !!series?.ImageTags?.Primary,
  JSON.stringify(series?.ImageTags));

const iso3 = freshIsolate();
await iso3.get('lib/config.ts').getConfig();
const imgRoute = iso3.get('app/emby/Items/[itemId]/Images/[imageType]/route.ts');

// 1a) 不带 token（客户端海报墙的典型请求）
const imgNoAuth = await imgRoute.GET(
  jreq(`/emby/Items/${SERIES_ID}/Images/Primary`),
  { params: { itemId: SERIES_ID, imageType: 'Primary' } }
);
check('不带 token 也能取图（不再 401）', imgNoAuth.status !== 401,
  `status=${imgNoAuth.status}`);
console.log(`      status=${imgNoAuth.status} Location=${imgNoAuth.headers.get('location') || '(proxy/placeholder)'}`);

// 1b) 带 token
const imgAuth = await imgRoute.GET(
  jreq(`/emby/Items/${SERIES_ID}/Images/Primary`, { headers: H }),
  { params: { itemId: SERIES_ID, imageType: 'Primary' } }
);
check('带 token 同样可取图', imgAuth.status === 200 || imgAuth.status === 302,
  `status=${imgAuth.status}`);

// 1c) 图片内容真的能拿到（上游可访问时）
if (imgAuth.status === 302) {
  const loc = imgAuth.headers.get('location');
  check('重定向指向真实海报地址', loc === POSTER, String(loc));
  const follow = await fetch(loc);
  check('海报地址可下载', follow.ok, `status=${follow.status}`);
}

// 1d) 未知条目返回占位图而非报错
const imgUnknown = await imgRoute.GET(
  jreq('/emby/Items/00000000-0000-0000-0000-000000000000/Images/Primary'),
  { params: { itemId: '00000000-0000-0000-0000-000000000000', imageType: 'Primary' } }
);
check('未知条目返回占位图（200）', imgUnknown.status === 200, `status=${imgUnknown.status}`);

// ============ 问题 2：剧集列表 ============
console.log('\n[2] 剧集列表（Series -> Season -> Episode）');

// 2a) 直接要 Episode（Infuse / Fileball 流派）
const iso4 = freshIsolate();
await iso4.get('lib/config.ts').getConfig();
const directEps = await rj(await iso4.get('app/emby/Users/[userId]/Items/route.ts').GET(
  jreq(`/emby/Users/${UID}/Items?ParentId=${SERIES_ID}&IncludeItemTypes=Episode`, { headers: H }),
  { params: { userId: UID } }
));
check('直接请求 Episode 拿到分集', (directEps.Items?.length || 0) === 24,
  `items=${directEps.Items?.length}`);
check('分集 Type 均为 Episode',
  (directEps.Items || []).every((i) => i.Type === 'Episode'));

// 2b) 先要 Season（Emby 官方 / Yamby 流派）
const iso5 = freshIsolate();
await iso5.get('lib/config.ts').getConfig();
const seasons = await rj(await iso5.get('app/emby/Users/[userId]/Items/route.ts').GET(
  jreq(`/emby/Users/${UID}/Items?ParentId=${SERIES_ID}&IncludeItemTypes=Season`, { headers: H }),
  { params: { userId: UID } }
));
check('请求 Season 拿到季度条目', (seasons.Items?.length || 0) >= 1,
  `items=${seasons.Items?.length} ${JSON.stringify(seasons).slice(0, 140)}`);
const season = seasons.Items?.[0];
check('Type 为 Season', season?.Type === 'Season', String(season?.Type));
check('Season 声明 ChildCount', (season?.ChildCount || 0) === 24, String(season?.ChildCount));
console.log(`      Season: ${season?.Name} Id=${season?.Id} ChildCount=${season?.ChildCount}`);

// 2c) 无 IncludeItemTypes 时也要给出可导航内容（关键回归）
const iso6 = freshIsolate();
await iso6.get('lib/config.ts').getConfig();
const noType = await rj(await iso6.get('app/emby/Users/[userId]/Items/route.ts').GET(
  jreq(`/emby/Users/${UID}/Items?ParentId=${SERIES_ID}`, { headers: H }),
  { params: { userId: UID } }
));
check('不带 IncludeItemTypes 也有内容（不再空白）', (noType.Items?.length || 0) > 0,
  `items=${noType.Items?.length}`);

// 2d) 由 Season 取分集（第二跳，跨 isolate）
const SEASON_ID = season?.Id;
const iso7 = freshIsolate();
await iso7.get('lib/config.ts').getConfig();
const epsBySeason = await rj(await iso7.get('app/emby/Users/[userId]/Items/route.ts').GET(
  jreq(`/emby/Users/${UID}/Items?ParentId=${SEASON_ID}&IncludeItemTypes=Episode`, { headers: H }),
  { params: { userId: UID } }
));
check('由 Season 取到分集（第二跳跨 isolate）', (epsBySeason.Items?.length || 0) === 24,
  `items=${epsBySeason.Items?.length} parent=${SEASON_ID}`);

// 2e) 分集的 ParentId 必须等于 Season 的 Id（否则客户端断链）
const ep0 = epsBySeason.Items?.[0];
check('Episode.ParentId 指向 Season.Id', ep0?.ParentId === SEASON_ID,
  `ep.ParentId=${ep0?.ParentId} season.Id=${SEASON_ID}`);
check('Episode.SeriesId 指向 Series.Id', ep0?.SeriesId === SERIES_ID,
  `ep.SeriesId=${ep0?.SeriesId} series.Id=${SERIES_ID}`);
check('分集带海报', !!ep0?.ImageTags?.Primary, JSON.stringify(ep0?.ImageTags));

// ---- 播放信息 ----
console.log('\n[3] 播放');
const EP_ID = ep0?.Id;
const iso8 = freshIsolate();
await iso8.get('lib/config.ts').getConfig();
const pbi = await rj(await iso8.get('app/emby/Items/[itemId]/PlaybackInfo/route.ts').POST(
  jreq(`/emby/Items/${EP_ID}/PlaybackInfo`, { method: 'POST', body: {}, headers: H }),
  { params: { itemId: EP_ID } }
));
check('分集可获取播放信息', (pbi.MediaSources?.length || 0) > 0,
  JSON.stringify(pbi).slice(0, 160));
if (pbi.MediaSources?.length) {
  console.log(`      播放地址: ${pbi.MediaSources[0].Path}`);
}

console.log(`\n=== ${pass} 通过 / ${fail} 失败 ===\n`);
process.exit(fail === 0 ? 0 : 1);
