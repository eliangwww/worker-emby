/* eslint-disable */
/**
 * Emby 端点冒烟测试。
 *
 * 直接用 esbuild 把 src 下的 TypeScript 路由编译成 CJS 并执行，
 * 配合 node:sqlite 提供的 D1 兼容绑定，验证完整的 Emby 客户端链路。
 *
 * 运行：node scripts/smoke-emby.mjs
 */

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = process.cwd();

process.env.SITE_NAME = process.env.SITE_NAME || 'KatelyaTV Emby';
process.env.USERNAME = process.env.USERNAME || 'admin';
process.env.AUTH_PASSWORD = process.env.AUTH_PASSWORD || 'test-password';
process.env.NODE_ENV = 'production';

// ---------- D1 兼容层（node:sqlite） ----------
const sqlite = new DatabaseSync(':memory:');
sqlite.exec(fs.readFileSync(path.join(root, 'scripts', 'd1-init.sql'), 'utf8'));

function makeStatement(sql) {
  let bound = [];
  return {
    bind(...values) {
      bound = values.map((v) => {
        if (typeof v === 'boolean') return v ? 1 : 0;
        if (v === undefined) return null;
        return v;
      });
      return this;
    },
    async first(colName) {
      const row = sqlite.prepare(sql).get(...bound);
      if (!row) return null;
      return colName ? row[colName] : row;
    },
    async run() {
      const info = sqlite.prepare(sql).run(...bound);
      return {
        results: [],
        success: true,
        meta: {
          changed_db: info.changes > 0,
          changes: info.changes,
          last_row_id: Number(info.lastInsertRowid),
          duration: 0,
        },
      };
    },
    async all() {
      return { results: sqlite.prepare(sql).all(...bound), success: true, meta: {} };
    },
  };
}

globalThis.DB = {
  prepare: makeStatement,
  async exec(sql) {
    sqlite.exec(sql);
    return { count: 0, duration: 0 };
  },
  async batch(stmts) {
    return Promise.all(stmts.map((s) => s.run()));
  },
};

// ---------- 用 TypeScript 编译器把源码路由转成 CJS ----------
const ts = require('typescript');

/** 把 TS 源码(含 @/ 别名)编译为可 require 的 CJS 模块树 */
const moduleCache = new Map();

function loadTsModule(absPath) {
  if (moduleCache.has(absPath)) return moduleCache.get(absPath);

  const source = fs.readFileSync(absPath, 'utf8');
  const out = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
      inlineSourceMap: false,
    },
    fileName: absPath,
  });

  const mod = { exports: {} };
  moduleCache.set(absPath, mod.exports);

  const dir = path.dirname(absPath);
  const localRequire = (spec) => {
    // 解析 @/ 别名
    let resolved;
    if (spec.startsWith('@/')) {
      resolved = path.join(root, 'src', spec.slice(2));
    } else if (spec.startsWith('.')) {
      resolved = path.resolve(dir, spec);
    } else {
      return require(spec);
    }

    for (const cand of [
      resolved + '.ts',
      resolved + '.tsx',
      path.join(resolved, 'index.ts'),
    ]) {
      if (fs.existsSync(cand)) return loadTsModule(cand);
    }
    throw new Error(`无法解析模块: ${spec} (${resolved})`);
  };

  const fn = new Function('exports', 'require', 'module', '__filename', '__dirname', out.outputText);
  fn(mod.exports, localRequire, mod, absPath, dir);
  return mod.exports;
}

const srcRoute = (p) => path.join(root, 'src', p);

const R = {
  publicInfo: loadTsModule(srcRoute('app/emby/System/Info/Public/route.ts')).GET,
  auth: loadTsModule(srcRoute('app/emby/Users/AuthenticateByName/route.ts')).POST,
  authOptions: loadTsModule(srcRoute('app/emby/Users/AuthenticateByName/route.ts')).OPTIONS,
  usersPublic: loadTsModule(srcRoute('app/emby/Users/Public/route.ts')).GET,
  usersMe: loadTsModule(srcRoute('app/emby/Users/Me/route.ts')).GET,
  views: loadTsModule(srcRoute('app/emby/Users/[userId]/Views/route.ts')).GET,
  userViews: loadTsModule(srcRoute('app/emby/UserViews/route.ts')).GET,
  items: loadTsModule(srcRoute('app/emby/Users/[userId]/Items/route.ts')).GET,
  resume: loadTsModule(srcRoute('app/emby/Users/[userId]/Items/Resume/route.ts')).GET,
  latest: loadTsModule(srcRoute('app/emby/Users/[userId]/Items/Latest/route.ts')).GET,
  favAdd: loadTsModule(srcRoute('app/emby/Users/[userId]/FavoriteItems/[itemId]/route.ts')).POST,
  favRemove: loadTsModule(srcRoute('app/emby/Users/[userId]/FavoriteItems/[itemId]/route.ts')).DELETE,
  playbackInfoPost: loadTsModule(srcRoute('app/emby/Items/[itemId]/PlaybackInfo/route.ts')).POST,
  playing: loadTsModule(srcRoute('app/emby/Sessions/Playing/route.ts')).POST,
  progress: loadTsModule(srcRoute('app/emby/Sessions/Playing/Progress/route.ts')).POST,
  stopped: loadTsModule(srcRoute('app/emby/Sessions/Playing/Stopped/route.ts')).POST,
  logout: loadTsModule(srcRoute('app/emby/Sessions/Logout/route.ts')).POST,
  sessions: loadTsModule(srcRoute('app/emby/Sessions/route.ts')).GET,
  images: loadTsModule(srcRoute('app/emby/Items/[itemId]/Images/[imageType]/route.ts')).GET,
  imageStream: loadTsModule(srcRoute('app/api/emby/stream/direct/route.ts')).GET,
  imageProxy: loadTsModule(srcRoute('app/api/emby/stream/proxy/route.ts')).GET,
  displayPrefs: loadTsModule(srcRoute('app/emby/DisplayPreferences/[id]/route.ts')).GET,
  systemInfo: loadTsModule(srcRoute('app/emby/System/Info/route.ts')).GET,
};

// ---------- 测试工具 ----------
const BASE = 'https://tv.example.com';
let pass = 0;
let fail = 0;

function check(name, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`  \u2713 ${name}`);
  } else {
    fail++;
    console.log(`  \u2717 ${name}  ${detail}`);
  }
}

function req(pathname, { method = 'GET', body, headers = {} } = {}) {
  const h = { ...headers };
  if (body) h['Content-Type'] = 'application/json';
  return new Request(`${BASE}${pathname}`, {
    method,
    headers: h,
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function json(res) {
  const t = await res.text();
  try {
    return JSON.parse(t);
  } catch {
    return { __raw: t };
  }
}

const ctx = (p) => ({ params: p });

// ---------- 开始 ----------
console.log('\n=== Emby 端点冒烟测试 ===\n');

let serverId, userId, accessToken;

console.log('[1] GET /emby/System/Info/Public');
{
  const res = await R.publicInfo(req('/emby/System/Info/Public'));
  const j = await json(res);
  check('status 200', res.status === 200, `got ${res.status}`);
  check('ServerName 正确', j.ServerName === 'KatelyaTV Emby', String(j.ServerName));
  check('Version 为 Emby 版本号', j.Version === '4.8.8.0', String(j.Version));
  check('Id 是 GUID', /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/.test(j.Id || ''), String(j.Id));
  check('StartupWizardCompleted=true', j.StartupWizardCompleted === true);
  serverId = j.Id;
}

console.log('\n[2] POST /emby/Users/AuthenticateByName');
{
  const res = await R.auth(
    req('/emby/Users/AuthenticateByName', {
      method: 'POST',
      body: { Username: 'admin', Pw: 'test-password' },
      headers: {
        'X-Emby-Authorization':
          'MediaBrowser Client="Smoke", Device="PC", DeviceId="dev-1", Version="1.0"',
      },
    })
  );
  const j = await json(res);
  check('正确密码 200', res.status === 200, `got ${res.status} ${JSON.stringify(j).slice(0, 160)}`);
  check('返回 AccessToken', typeof j.AccessToken === 'string' && j.AccessToken.length > 0);
  check('User.Name=admin', j.User?.Name === 'admin', String(j.User?.Name));
  check('User.ServerId 与服务器一致', j.User?.ServerId === serverId);
  check('管理员 Policy', j.User?.Policy?.IsAdministrator === true);
  check('SessionInfo.DeviceName 透传', j.SessionInfo?.DeviceName === 'PC', String(j.SessionInfo?.DeviceName));
  check('响应头含 X-Emby-Token', res.headers.get('X-Emby-Token') === j.AccessToken);
  accessToken = j.AccessToken;
  userId = j.User?.Id;

  const bad = await R.auth(
    req('/emby/Users/AuthenticateByName', { method: 'POST', body: { Username: 'admin', Pw: 'nope' } })
  );
  check('错误密码 401', bad.status === 401, `got ${bad.status}`);

  const alt = await R.auth(
    req('/emby/Users/AuthenticateByName', { method: 'POST', body: { Username: 'admin', Password: 'test-password' } })
  );
  check('兼容 Password 字段名', alt.status === 200, `got ${alt.status}`);

  const qs = await R.auth(
    req('/emby/Users/AuthenticateByName?Username=admin&Pw=test-password', { method: 'POST' })
  );
  check('兼容 query string 凭据', qs.status === 200, `got ${qs.status}`);

  const noUser = await R.auth(req('/emby/Users/AuthenticateByName', { method: 'POST', body: { Pw: 'x' } }));
  check('缺用户名 400', noUser.status === 400, `got ${noUser.status}`);
}

const AUTH = { 'X-Emby-Token': accessToken };

console.log('\n[3] 鉴权边界');
{
  const none = await R.usersMe(req('/emby/Users/Me'));
  check('无 token -> 401', none.status === 401, `got ${none.status}`);

  const bogus = await R.usersMe(req('/emby/Users/Me', { headers: { 'X-Emby-Token': 'bogus' } }));
  check('伪造 token -> 401', bogus.status === 401, `got ${bogus.status}`);

  const ok = await json(await R.usersMe(req('/emby/Users/Me', { headers: AUTH })));
  check('有效 token -> 200 & Name=admin', ok.Name === 'admin', JSON.stringify(ok).slice(0, 120));

  const viaQuery = await R.usersMe(req(`/emby/Users/Me?api_key=${accessToken}`));
  check('api_key query 鉴权可用', viaQuery.status === 200, `got ${viaQuery.status}`);
}

console.log('\n[4] GET /emby/Users/{userId}/Views');
let movieViewId;
{
  const res = await R.views(req(`/emby/Users/${userId}/Views`, { headers: AUTH }), ctx({ userId }));
  const j = await json(res);
  check('status 200', res.status === 200, `got ${res.status}`);
  check('返回 5 个媒体库', j.TotalRecordCount === 5, String(j.TotalRecordCount));
  const names = (j.Items || []).map((i) => i.Name);
  check('中文库名齐全', ['电影','电视剧','动漫','综艺','纪录片'].every((n) => names.includes(n)), names.join('|'));
  check('CollectionType 仅 movies/tvshows', (j.Items || []).every((i) => ['movies','tvshows'].includes(i.CollectionType)));
  check('Type=CollectionFolder', (j.Items || []).every((i) => i.Type === 'CollectionFolder'));
  check('IsFolder=true', (j.Items || []).every((i) => i.IsFolder === true));
  check('Id 均为 GUID', (j.Items || []).every((i) => /^[0-9a-f-]{36}$/.test(i.Id)));
  movieViewId = j.Items.find((i) => i.Name === '电影')?.Id;
}

console.log('\n[4b] 分类归属（回归：曾被泛化词「片/剧」吞掉）');
{
  const { libraryKeyForItem, LIBRARIES } = loadTsModule(
    srcRoute('lib/emby.catalog.ts')
  );

  const cases = [
    ['纪录片', 'documentary'],
    ['记录片', 'documentary'],
    ['动画片', 'anime'],
    ['国产动漫', 'anime'],
    ['国产剧', 'tvshows'],
    ['日韩剧', 'tvshows'],
    ['综艺', 'variety'],
    ['大陆综艺', 'variety'],
    ['动作片', 'movies'],
    ['科幻片', 'movies'],
    ['电视剧', 'tvshows'],
    ['电影', 'movies'],
  ];

  for (const [cls, expected] of cases) {
    const got = libraryKeyForItem({ class: cls });
    check(`「${cls}」-> ${expected}`, got === expected, `got ${got}`);
  }

  check('5 个媒体库齐全', LIBRARIES.length === 5, String(LIBRARIES.length));
  check(
    '无单字泛化关键词',
    LIBRARIES.every((l) => l.keywords.every((k) => k.length >= 2)),
    LIBRARIES.flatMap((l) => l.keywords.filter((k) => k.length < 2)).join(',')
  );
}

console.log('\n[5] GET /emby/UserViews（客户端别名）');
{
  const j = await json(await R.userViews(req('/emby/UserViews', { headers: AUTH })));
  check('同样返回 5 个媒体库', j.TotalRecordCount === 5, String(j.TotalRecordCount));
}

console.log('\n[6] GET /emby/Users/{userId}/Items');
{
  const res = await R.items(
    req(`/emby/Users/${userId}/Items?ParentId=${movieViewId}&Limit=20`, { headers: AUTH }),
    ctx({ userId })
  );
  const j = await json(res);
  check('status 200', res.status === 200, `got ${res.status}`);
  check('返回 QueryResult', Array.isArray(j.Items) && typeof j.TotalRecordCount === 'number');
  check('条目不含 null', (j.Items || []).every((i) => i && typeof i.Id === 'string'));

  const noAuth = await R.items(req(`/emby/Users/${userId}/Items`), ctx({ userId }));
  check('无 token -> 401', noAuth.status === 401, `got ${noAuth.status}`);
}

console.log('\n[7] GET /emby/Users/Public & /emby/Users/Me 用户对象');
{
  const pub = await json(await R.usersPublic(req('/emby/Users/Public')));
  check('Public 返回数组', Array.isArray(pub), JSON.stringify(pub).slice(0, 120));
  check('含 admin 用户', pub.some((u) => u.Name === 'admin'));
  check('不泄露密码字段', pub.every((u) => !('Password' in u) && !('Pw' in u)));
}

console.log('\n[8] 播放进度：Playing -> Progress -> Stopped');
{
  const itemId = 'hnzy:12345:1';
  let r = await R.playing(
    req('/emby/Sessions/Playing', { method: 'POST', body: { ItemId: itemId, MediaSourceId: itemId, PositionTicks: 1000000 }, headers: AUTH })
  );
  check('Playing -> 204', r.status === 204, `got ${r.status}`);

  r = await R.progress(
    req('/emby/Sessions/Playing/Progress', { method: 'POST', body: { ItemId: itemId, PositionTicks: 50000000 }, headers: AUTH })
  );
  check('Progress -> 204', r.status === 204, `got ${r.status}`);

  const row = sqlite.prepare('SELECT * FROM emby_playback WHERE user_id=? AND item_id=?').get(userId, itemId);
  check('进度写入 D1', !!row);
  check('进度值 = 50,000,000 ticks', Number(row?.position_ticks) === 50000000, String(row?.position_ticks));
  check('未看完 played=0', Number(row?.played) === 0, String(row?.played));

  // 未看完 -> 应出现在 Resume
  const resume = await json(
    await R.resume(req(`/emby/Users/${userId}/Items/Resume`, { headers: AUTH }), ctx({ userId }))
  );
  check('Resume 含未看完条目', resume.TotalRecordCount >= 1, String(resume.TotalRecordCount));

  // 看完（position == runtime）-> played=1 且进度归零
  r = await R.stopped(
    req('/emby/Sessions/Playing/Stopped', {
      method: 'POST',
      body: { ItemId: itemId, PositionTicks: 100000000, RuntimeTicks: 100000000 },
      headers: AUTH,
    })
  );
  check('Stopped -> 204', r.status === 204, `got ${r.status}`);

  const row2 = sqlite.prepare('SELECT * FROM emby_playback WHERE user_id=? AND item_id=?').get(userId, itemId);
  check('看完后 played=1', Number(row2?.played) === 1, String(row2?.played));
  check('看完后进度归零', Number(row2?.position_ticks) === 0, String(row2?.position_ticks));
  check('播放次数 +1', Number(row2?.play_count) === 1, String(row2?.play_count));

  const resume2 = await json(
    await R.resume(req(`/emby/Users/${userId}/Items/Resume`, { headers: AUTH }), ctx({ userId }))
  );
  check('看完后从 Resume 移除', resume2.TotalRecordCount === 0, String(resume2.TotalRecordCount));
}

console.log('\n[9] 收藏链路');
{
  const itemId = 'hnzy:99887';
  let r = await R.favAdd(
    req(`/emby/Users/${userId}/FavoriteItems/${itemId}`, { method: 'POST', headers: AUTH }),
    ctx({ userId, itemId })
  );
  check('收藏 -> 204', r.status === 204, `got ${r.status}`);
  check('写入 D1', !!sqlite.prepare('SELECT * FROM emby_favorites WHERE user_id=? AND item_id=?').get(userId, itemId));

  r = await R.favRemove(
    req(`/emby/Users/${userId}/FavoriteItems/${itemId}`, { method: 'DELETE', headers: AUTH }),
    ctx({ userId, itemId })
  );
  check('取消收藏 -> 204', r.status === 204, `got ${r.status}`);
  check('已从 D1 删除', !sqlite.prepare('SELECT * FROM emby_favorites WHERE user_id=? AND item_id=?').get(userId, itemId));
}

console.log('\n[10] 会话管理');
{
  const list = await json(await R.sessions(req('/emby/Sessions', { headers: AUTH })));
  check('返回数组', Array.isArray(list), JSON.stringify(list).slice(0, 120));
  check('含本次会话且 IsActive', list.some((s) => s.UserName === 'admin' && s.IsActive === true));

  const r = await R.logout(req('/emby/Sessions/Logout', { method: 'POST', headers: AUTH }));
  check('登出 -> 204', r.status === 204, `got ${r.status}`);

  const after = await R.usersMe(req('/emby/Users/Me', { headers: AUTH }));
  check('登出后 token 失效 -> 401', after.status === 401, `got ${after.status}`);
}

console.log('\n[11] PlaybackInfo 与流代理（无有效源时优雅失败）');
{
  // 重新登录（上一步已登出）
  const a = await json(
    await R.auth(req('/emby/Users/AuthenticateByName', { method: 'POST', body: { Username: 'admin', Pw: 'test-password' } }))
  );
  const H = { 'X-Emby-Token': a.AccessToken };

  const pbi = await R.playbackInfoPost(
    req('/emby/Items/unknown-item/PlaybackInfo', { method: 'POST', body: {}, headers: H }),
    ctx({ itemId: 'unknown-item' })
  );
  const j = await json(pbi);
  check('PlaybackInfo 不崩溃（200/4xx）', pbi.status === 200 || pbi.status >= 400, `got ${pbi.status}`);
  if (pbi.status === 200) {
    check('返回 MediaSources 数组', Array.isArray(j.MediaSources), JSON.stringify(j).slice(0, 120));
    check('返回 PlaySessionId', typeof j.PlaySessionId === 'string');
  }

  const direct = await R.imageStream(req('/api/emby/stream/direct?source=x&id=y', { headers: H }));
  check('无源时 direct 返回 404', direct.status === 404, `got ${direct.status}`);

  const noParam = await R.imageStream(req('/api/emby/stream/direct', { headers: H }));
  check('缺参数 -> 400', noParam.status === 400, `got ${noParam.status}`);

  const noAuth = await R.imageStream(req('/api/emby/stream/direct?source=x&id=y'));
  check('无 token -> 401', noAuth.status === 401, `got ${noAuth.status}`);

  const badProto = await R.imageProxy(req('/api/emby/stream/proxy?u=file:///etc/passwd', { headers: H }));
  check('非 http(s) 协议 -> 400', badProto.status === 400, `got ${badProto.status}`);

  const badUrl = await R.imageProxy(req('/api/emby/stream/proxy?u=not-a-url', { headers: H }));
  check('非法 URL -> 400', badUrl.status === 400, `got ${badUrl.status}`);
}

console.log('\n[12] 图片端点');
{
  const a = await json(
    await R.auth(req('/emby/Users/AuthenticateByName', { method: 'POST', body: { Username: 'admin', Pw: 'test-password' } }))
  );
  const H = { 'X-Emby-Token': a.AccessToken };

  const res = await R.images(
    req('/emby/Items/unknown/Images/Primary', { headers: H }),
    ctx({ itemId: 'unknown', imageType: 'Primary' })
  );
  check('未知条目返回占位图（200）', res.status === 200, `got ${res.status}`);
  check('占位图 Content-Type 为 svg', (res.headers.get('content-type') || '').includes('svg'), String(res.headers.get('content-type')));

  const noAuth = await R.images(req('/emby/Items/x/Images/Primary'), ctx({ itemId: 'x', imageType: 'Primary' }));
  check('图片端点需要鉴权 -> 401', noAuth.status === 401, `got ${noAuth.status}`);
}

console.log('\n[13] 其他客户端兼容端点');
{
  const a = await json(
    await R.auth(req('/emby/Users/AuthenticateByName', { method: 'POST', body: { Username: 'admin', Pw: 'test-password' } }))
  );
  const H = { 'X-Emby-Token': a.AccessToken };

  const prefs = await json(
    await R.displayPrefs(req('/emby/DisplayPreferences/usersettings?userId=x&client=emby', { headers: H }), ctx({ id: 'usersettings' }))
  );
  check('DisplayPreferences 返回 Id', prefs.Id === 'usersettings', JSON.stringify(prefs).slice(0, 120));

  const sys = await json(await R.systemInfo(req('/emby/System/Info', { headers: H }), ctx({})));
  check('System/Info 返回 Name/Id', !!sys.Name && sys.Id === serverId, JSON.stringify(sys).slice(0, 120));
  check('System/Info 声明 Cloudflare Workers', sys.OperatingSystemDisplayName === 'Cloudflare Workers');

  const latest = await json(
    await R.latest(req(`/emby/Users/${a.User.Id}/Items/Latest?Limit=5`, { headers: H }), ctx({ userId: a.User.Id }))
  );
  check('Latest 返回数组', Array.isArray(latest.Items), JSON.stringify(latest).slice(0, 120));
}

console.log('\n[14] CORS 与预检');
{
  const res = await R.authOptions();
  check('OPTIONS -> 204', res.status === 204, `got ${res.status}`);
  check('允许跨域', res.headers.get('Access-Control-Allow-Origin') === '*');
  check('暴露 Content-Range（拖进度条必需）', (res.headers.get('Access-Control-Expose-Headers') || '').includes('Content-Range'));
  check('允许 X-Emby-Token 头', (res.headers.get('Access-Control-Allow-Headers') || '').includes('X-Emby-Token'));
}

console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===\n`);
process.exit(fail === 0 ? 0 : 1);
