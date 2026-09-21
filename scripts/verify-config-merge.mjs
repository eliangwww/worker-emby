/* eslint-disable */
/**
 * 验证 config.json 与 D1 的合并语义：
 * 更换 config.json 后，旧源必须被移除，新源必须生效。
 *
 * 运行：node --experimental-sqlite scripts/verify-config-merge.mjs
 */

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = process.cwd();
const ts = require('typescript');

process.env.USERNAME = 'admin';
process.env.AUTH_PASSWORD = 'test';
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

// 模拟「当前 config.json」= 用户新换的 3 个采集站
const NEW_SITES = {
  hnzy: { api: 'https://iqiyizyapi.com/api.php/provide/vod', name: '爱奇艺' },
  lzzy: { api: 'https://360zyzz.com/api.php/provide/vod', name: '360资源' },
  ffzy: { api: 'https://ikunzyapi.com/api.php/provide/vod', name: 'iKun资源' },
};

// 模拟 D1 中残留的旧配置（旧源 + 一个后台手工添加的源）
const STALE_DB_CONFIG = {
  SiteConfig: { SiteName: 'KatelyaTV Emby', Announcement: '', SearchDownstreamMaxPage: 5, SiteInterfaceCacheTime: 7200, ImageProxy: '', DoubanProxy: '' },
  UserConfig: { AllowRegister: false, Users: [{ username: 'admin', role: 'owner' }] },
  SourceConfig: [
    { key: 'hnzy', name: '火鸟资源', api: 'https://hnzyapi.com/api.php/provide/vod', from: 'config', disabled: false },
    { key: 'lzzy', name: '量子资源', api: 'https://api.liangzizy.com/inc/apijson_vod.php', from: 'config', disabled: false },
    { key: 'ffzy', name: '非凡资源', api: 'https://ffzyapi.com/api.php/provide/vod', from: 'config', disabled: false },
    { key: 'ykzy', name: '永久资源', api: 'https://api.yongjiuzy.cc/provide/vod', from: 'config', disabled: false },
    { key: 'bdzy', name: '百度资源', api: 'https://api.1080zyku.com/inc/apijson_vod.php', from: 'config', disabled: false },
    { key: 'manual', name: '后台手工源', api: 'https://manual.example.com/api.php/provide/vod', from: 'custom', disabled: false },
  ],
};

sqlite.prepare('INSERT OR REPLACE INTO admin_configs (config_key, config_value, description) VALUES (?,?,?)')
  .run('main_config', JSON.stringify(STALE_DB_CONFIG), 'test');

// 在临时目录中复制一份 lib，替换 runtime.ts，避免改动真实源码
const tmpRoot = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'cfgmerge-'));
const tmpSrc = path.join(tmpRoot, 'src');
fs.cpSync(path.join(root, 'src'), tmpSrc, { recursive: true });

fs.writeFileSync(
  path.join(tmpSrc, 'lib', 'runtime.ts'),
  `// 临时（验证脚本生成）\n/* eslint-disable */\n\nexport const config = ${JSON.stringify({ cache_time: 7200, api_site: NEW_SITES }, null, 2)} as const;\nexport default config;\n`,
  'utf8'
);

// 模块加载（基于临时副本）
const cache = new Map();
function loadTsModule(absPath) {
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
    if (spec.startsWith('@/')) resolved = path.join(tmpSrc, spec.slice(2));
    else if (spec.startsWith('.')) resolved = path.resolve(dir, spec);
    else return require(spec);
    for (const c of [resolved + '.ts', resolved + '.tsx', path.join(resolved, 'index.ts')]) {
      if (fs.existsSync(c)) return loadTsModule(c);
    }
    throw new Error('cannot resolve ' + spec);
  };
  new Function('exports', 'require', 'module', '__filename', '__dirname', out.outputText)(mod.exports, rq, mod, absPath, dir);
  return mod.exports;
}

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}  ${detail}`); }
};

try {
  const configMod = loadTsModule(path.join(tmpSrc, 'lib', 'config.ts'));
  const cfg = await configMod.getConfig();
  const keys = cfg.SourceConfig.map((s) => s.key);

  console.log('\n=== config.json 合并语义验证 ===\n');
  console.log(`  生效源: ${keys.join(', ')}\n`);

  check('新源 hnzy 存在', keys.includes('hnzy'));
  check('新源 lzzy 存在', keys.includes('lzzy'));
  check('新源 ffzy 存在', keys.includes('ffzy'));

  check('旧源 ykzy 已移除', !keys.includes('ykzy'), '旧源残留会导致搜不到新内容');
  check('旧源 bdzy 已移除', !keys.includes('bdzy'));

  const hnzy = cfg.SourceConfig.find((s) => s.key === 'hnzy');
  check('hnzy 的 api 已更新为新地址', hnzy?.api === NEW_SITES.hnzy.api, String(hnzy?.api));
  check('hnzy 的名称已更新', hnzy?.name === '爱奇艺', String(hnzy?.name));

  check('后台手工源被保留', keys.includes('manual'));

  const active = cfg.SourceConfig.filter((s) => !s.disabled);
  check('启用源数 = 4', active.length === 4, `got ${active.length}`);

  console.log(`\n=== ${pass} 通过 / ${fail} 失败 ===\n`);
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}

process.exit(fail === 0 ? 0 : 1);
