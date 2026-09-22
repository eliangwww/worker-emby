/* eslint-disable */
/**
 * 播放链路验证：跟随客户端真实会走的 URL。
 *
 * 关键回归：PlaybackInfo 返回的 Path / TranscodingUrl 必须
 * **真的能播**，而不是指向不存在的路由（Hills 报「找不到 item」的根因）。
 *
 * 本测试会：
 *   1. 调 PlaybackInfo 拿到 MediaSource
 *   2. 把返回的 Path / TranscodingUrl 真正地 GET 一遍
 *   3. 断言拿到 200/206 且内容是视频流（而非 404 HTML）
 *
 * 运行：node --experimental-sqlite scripts/verify-playback-urls.mjs
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

// ---------- 模拟 HLS 源站 ----------
// 源 key 必须唯一，避免与 config.json 中的真实源冲突
// （mergeSources 以 config.json 为准，会覆盖同 key 的源）
const SITE = { key: 'zztest', name: '测试资源', api: 'https://cms.test/api.php/provide/vod' };
const CDN = 'https://cdn.test';

const PLAYLIST = [
  '#EXTM3U',
  '#EXT-X-VERSION:3',
  '#EXT-X-TARGETDURATION:10',
  '#EXTINF:10.0,',
  'seg-1.ts',
  '#EXTINF:10.0,',
  'seg-2.ts',
  '#EXT-X-ENDLIST',
].join('\n');

const SEGMENT = Buffer.from('G' + '@'.repeat(187) + 'x'.repeat(188), 'binary'); // 伪 TS 包

const fetchLog = [];

const makeItem = (id, name, cls, epCount = 3) => ({
  vod_id: id, vod_name: name, vod_pic: `https://img.test/${id}.jpg`, vod_year: '2024',
  vod_class: cls, type_name: cls, vod_content: '<p>简介</p>',
  vod_play_url: Array.from({ length: epCount }, (_, i) =>
    `第${String(i + 1).padStart(2, '0')}集$${CDN}/${id}/${String(i + 1).padStart(2, '0')}/index.m3u8`
  ).join('#'),
});

globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  fetchLog.push(url);
  const j = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });

  // ---- 上游 CMS ----
  if (url.startsWith(SITE.api)) {
    if (url.includes('ac=list')) return j({ class: [{ type_id: 6, type_name: '国产剧' }] });
    if (url.includes('ac=detail') && url.includes('&t=')) return j({ list: [makeItem(111, '分类剧集', '国产剧')] });
    if (url.includes('wd=')) {
      const wd = decodeURIComponent(new URL(url).searchParams.get('wd') || '');
      return j({ list: wd.includes('庆余年') ? [makeItem(999, '庆余年', '国产剧', 3)] : [] });
    }
    if (url.includes('ids=')) return j({ list: [makeItem(999, '庆余年', '国产剧', 3)] });
    return j({ list: [] });
  }

  // ---- CDN：m3u8 与分片 ----
  if (url.startsWith(CDN)) {
    // 只服务 mock 数据里真实存在的路径（第 01-03 集）
    const m = url.match(new RegExp(`^${CDN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/(\\d+)/(\\d{2})/`));
    if (!m || m[1] !== '999' || Number(m[2]) < 1 || Number(m[2]) > 3) {
      return new Response('not found', { status: 404 });
    }
    if (url.includes('.m3u8')) {
      // 校验防盗链头是否带上
      const hdrs = init?.headers || {};
      const referer = hdrs['Referer'] || hdrs['referer'];
      if (!referer) {
        return new Response('forbidden: missing referer', { status: 403 });
      }
      return new Response(PLAYLIST, {
        status: 200,
        headers: { 'Content-Type': 'application/vnd.apple.mpegurl' },
      });
    }
    if (url.endsWith('.ts')) {
      const range = (init?.headers || {})['Range'] || (init?.headers || {})['range'];
      if (range) {
        return new Response(SEGMENT, {
          status: 206,
          headers: {
            'Content-Type': 'video/mp2t',
            'Content-Range': `bytes 0-${SEGMENT.length - 1}/${SEGMENT.length}`,
            'Content-Length': String(SEGMENT.length),
            'Accept-Ranges': 'bytes',
          },
        });
      }
      return new Response(SEGMENT, {
        status: 200,
        headers: { 'Content-Type': 'video/mp2t', 'Content-Length': String(SEGMENT.length) },
      });
    }
  }
  return new Response('not found', { status: 404 });
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
  // from 必须是 'custom'：mergeSources 会清理 config.json 中已不存在的
  // 'config' 来源条目，只有后台手工添加的 'custom' 源会被保留。
  SourceConfig: [{ key: SITE.key, name: SITE.name, api: SITE.api, from: 'custom', disabled: false, is_adult: false }],
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

console.log('\n=== 播放 URL 可播性验证 ===\n');

// 登录 + 搜索 + 取分集
const iso1 = freshIsolate();
const auth = await rj(await iso1.get('app/emby/Users/AuthenticateByName/route.ts').POST(
  jreq('/emby/Users/AuthenticateByName', { method: 'POST', body: { Username: 'admin', Pw: 'test-password' } })
));
const H = { 'X-Emby-Token': auth.AccessToken };
const UID = auth.User?.Id;

const iso2 = freshIsolate();
await iso2.get('lib/config.ts').getConfig();
const searchRes = await iso2.get('app/emby/Users/[userId]/Items/route.ts').GET(
  jreq(`/emby/Users/${UID}/Items?SearchTerm=%E5%BA%86%E4%BD%99%E5%B9%B4`, { headers: H }),
  { params: { userId: UID } }
);
const search = await rj(searchRes);
if (!search.Items?.length) {
  console.log('  [调试] CMS 请求记录:');
  fetchLog.filter((u) => u.includes('cms.test')).forEach((u) => console.log('    ' + u));
}
const SERIES_ID = search.Items?.[0]?.Id;
check('搜索到剧集', !!SERIES_ID, JSON.stringify(search).slice(0, 200));

const iso3 = freshIsolate();
await iso3.get('lib/config.ts').getConfig();
const eps = await rj(await iso3.get('app/emby/Users/[userId]/Items/route.ts').GET(
  jreq(`/emby/Users/${UID}/Items?ParentId=${SERIES_ID}&IncludeItemTypes=Episode`, { headers: H }),
  { params: { userId: UID } }
));
const EP_ID = eps.Items?.[0]?.Id;
check('取到分集', !!EP_ID);

// ---- PlaybackInfo ----
const iso4 = freshIsolate();
await iso4.get('lib/config.ts').getConfig();
const pbiRes = await iso4.get('app/emby/Items/[itemId]/PlaybackInfo/route.ts').POST(
  jreq(`/emby/Items/${EP_ID}/PlaybackInfo`, { method: 'POST', body: {}, headers: H }),
  { params: { itemId: EP_ID } }
);
const pbi = await rj(pbiRes);
check('PlaybackInfo 200', pbiRes.status === 200, `status=${pbiRes.status}`);

const ms = pbi.MediaSources?.[0];
check('返回 MediaSource', !!ms, JSON.stringify(pbi).slice(0, 160));
check('声明 SupportsDirectPlay', ms?.SupportsDirectPlay === true, String(ms?.SupportsDirectPlay));
check('声明 SupportsDirectStream', ms?.SupportsDirectStream === true);
check('Container 为 m3u8', ms?.Container === 'm3u8', String(ms?.Container));
check('Path 非空', !!ms?.Path, String(ms?.Path));
check('TranscodingUrl 非空', !!ms?.TranscodingUrl);

console.log(`      Path          = ${ms?.Path}`);
console.log(`      TranscodingUrl= ${ms?.TranscodingUrl}`);

// ---- 关键：客户端的播放决策字段（Hills / ExoPlayer 类客户端） ----
console.log('\n[播放决策字段]');
const streams = ms?.MediaStreams || [];
const videoStream = streams.find((s) => s.Type === 'Video');
const audioStream = streams.find((s) => s.Type === 'Audio');

check('声明了 Video 流', !!videoStream);
check('声明了 Audio 流', !!audioStream);
check(
  'Video.DeliveryMethod 为 DirectStream（非 Encode）',
  videoStream?.DeliveryMethod === 'DirectStream',
  String(videoStream?.DeliveryMethod)
);
check(
  'Audio.DeliveryMethod 为 DirectStream（非 Encode）',
  audioStream?.DeliveryMethod === 'DirectStream',
  String(audioStream?.DeliveryMethod)
);
check('Video.Index 为 0', videoStream?.Index === 0, String(videoStream?.Index));
check('Audio.Index 为 1', audioStream?.Index === 1, String(audioStream?.Index));
check(
  'DefaultAudioStreamIndex 与 Audio.Index 一致',
  ms?.DefaultAudioStreamIndex === audioStream?.Index,
  `default=${ms?.DefaultAudioStreamIndex} audio=${audioStream?.Index}`
);
check('DefaultSubtitleStreamIndex 为 -1（不强制字幕）',
  ms?.DefaultSubtitleStreamIndex === -1, String(ms?.DefaultSubtitleStreamIndex));
check('TranscodingContainer 为 ts（HLS 输出容器）',
  ms?.TranscodingContainer === 'ts', String(ms?.TranscodingContainer));
check('IsInfiniteStream 为 false', ms?.IsInfiniteStream === false);
check('Protocol 为 Http', ms?.Protocol === 'Http', String(ms?.Protocol));
check('Formats 含 hls', Array.isArray(ms?.Formats) && ms.Formats.includes('hls'),
  JSON.stringify(ms?.Formats));
check('RunTimeTicks 为正数', (ms?.RunTimeTicks || 0) > 0, String(ms?.RunTimeTicks));

// ============ 关键：真的去 GET 这些 URL ============
console.log('\n[关键] 跟随客户端真实会请求的 URL');

/** 用 handle 函数直接跑路由（模拟 Workers 处理该路径） */
async function hit(url, headers = {}) {
  const u = new URL(url);
  const req = new Request(url, { headers });
  const routePieces = u.pathname;

  // TranscodingUrl -> /api/emby/stream/direct
  if (routePieces.startsWith('/api/emby/stream/direct')) {
    const iso = freshIsolate();
    await iso.get('lib/config.ts').getConfig();
    return iso.get('app/api/emby/stream/direct/route.ts').GET(req);
  }
  // 标准 Emby 路径 -> /emby/Videos/{id}/stream
  if (routePieces.startsWith('/emby/Videos/')) {
    const parts = routePieces.split('/').filter(Boolean); // ['emby','Videos','{id}','stream']
    const iso = freshIsolate();
    await iso.get('lib/config.ts').getConfig();
    return iso.get('app/emby/Videos/[itemId]/stream/route.ts').GET(req, {
      params: { itemId: decodeURIComponent(parts[2]) },
    });
  }
  // 不存在的路由
  return new Response('not found', { status: 404 });
}

// 4a) TranscodingUrl 必须真的能播
const tRes = await hit(ms.TranscodingUrl, { ...H });
check('TranscodingUrl 可播放（不再 404）', tRes.status === 200 || tRes.status === 206,
  `status=${tRes.status}`);
console.log(`      TranscodingUrl -> status=${tRes.status} type=${tRes.headers.get('content-type')}`);

// 4b) Path 也必须能播
const pRes = await hit(ms.Path, { ...H });
check('Path 可播放', pRes.status === 200 || pRes.status === 206, `status=${pRes.status}`);
console.log(`      Path -> status=${pRes.status} type=${pRes.headers.get('content-type')}`);

// 4c) m3u8 内容应为播放列表且分片地址已重写
const body = await pRes.text();
check('返回 HLS 播放列表', body.includes('#EXTM3U'), body.slice(0, 80));
check('分片地址已重写为本站代理', body.includes('/api/emby/stream/proxy?u='),
  body.split('\n').filter((l) => l && !l.startsWith('#')).slice(0, 3).join(' | '));

// 4d) 标准 Emby 播放路径（客户端另一种走法）
const vUrl = `${BASE}/emby/Videos/${EP_ID}/stream?Static=true&api_key=${auth.AccessToken}`;
const vRes = await hit(vUrl, {});
check('标准 /emby/Videos/{id}/stream 可播', vRes.status === 200 || vRes.status === 206,
  `status=${vRes.status}`);
if (vRes.status !== 200 && vRes.status !== 206) {
  console.log(`      [调试] 响应体: ${(await vRes.text()).slice(0, 200)}`);
}

// 4e) 分片代理可用 + Range 支持（拖动进度条）
const segLine = body.split('\n').find((l) => l.includes('/api/emby/stream/proxy?u='));
if (segLine) {
  const iso5 = freshIsolate();
  await iso5.get('lib/config.ts').getConfig();
  const segRes = await iso5.get('app/api/emby/stream/proxy/route.ts').GET(
    new Request(segLine, { headers: { ...H, Range: 'bytes=0-187' } })
  );
  check('分片代理可取（200/206）', segRes.status === 200 || segRes.status === 206,
    `status=${segRes.status}`);
  console.log(`      分片 -> status=${segRes.status} range=${segRes.headers.get('content-range')}`);
  check('拖进度条所需 Content-Range 已返回', !!segRes.headers.get('content-range') || segRes.status === 200);
} else {
  check('找到分片代理地址', false, 'm3u8 中无代理地址');
}

// 4f) 防盗链：确认代理带上了 Referer（否则源站 403）
console.log('\n[防盗链] 代理是否携带 Referer');
const noRefRes = await (async () => {
  // 直接打 CDN（不带 Referer）应被拒
  return fetch(`${CDN}/999/01/index.m3u8`);
})();
check('源站确实校验 Referer（测试前提成立）', noRefRes.status === 403, `status=${noRefRes.status}`);

const withRefRes = await (async () => {
  // 经本站代理应成功
  const iso = freshIsolate();
  await iso.get('lib/config.ts').getConfig();
  return iso.get('app/api/emby/stream/direct/route.ts').GET(
    new Request(`${BASE}/api/emby/stream/direct?source=zztest&id=999&ep=1`, { headers: H })
  );
})();
check('经本站代理可绕过防盗链', withRefRes.status === 200 || withRefRes.status === 206,
  `status=${withRefRes.status}`);

console.log(`\n=== ${pass} 通过 / ${fail} 失败 ===\n`);
process.exit(fail === 0 ? 0 : 1);
