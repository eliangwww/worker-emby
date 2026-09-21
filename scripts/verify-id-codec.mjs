/* eslint-disable */
/**
 * 验证「条目 Id 跨 isolate 可解」。
 *
 * 这是 Item not found 的核心回归测试：
 * 编码发生在 isolate A（搜索），解码发生在 isolate B（点开详情），
 * 两次加载完全独立的模块实例、互不共享内存。
 *
 * 运行：node scripts/verify-id-codec.mjs
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

/** 每次调用都创建全新的模块实例，模拟不同 isolate */
function freshCatalog() {
  const cache = new Map();
  function load(absPath) {
    if (cache.has(absPath)) return cache.get(absPath);
    const out = ts.transpileModule(fs.readFileSync(absPath, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
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
        if (fs.existsSync(c)) return load(c);
      }
      throw new Error('cannot resolve ' + spec);
    };
    new Function('exports', 'require', 'module', '__filename', '__dirname', out.outputText)(
      mod.exports, rq, mod, absPath, dir
    );
    return mod.exports;
  }
  return load(path.join(root, 'src', 'lib', 'emby.catalog.ts'));
}

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}  ${detail}`); }
};

console.log('\n=== 条目 Id 跨 isolate 编解码验证 ===\n');

// ---------- isolate A：搜索产生 Id ----------
const isoA = freshCatalog();
isoA.registerSourceKey('hnzy');

const cases = [
  ['hnzy', '12345', undefined],
  ['hnzy', '1', undefined],
  ['hnzy', '999999999', undefined],
  ['lzzy', '5501', undefined],
  ['ffzy', '887766', undefined],
];

const encodedItems = cases.map(([src, sid]) => ({
  src,
  sid,
  id: isoA.encodeItemId(src, sid),
}));

console.log('[1] isolate A 编码结果');
encodedItems.forEach((e) => console.log(`    ${e.src}:${e.sid} -> ${e.id}`));

// ---------- isolate B：完全独立的模块实例解码 ----------
const isoB = freshCatalog();
// 只登记源 key（模拟真实场景：每个 isolate 启动时从 config 登记）
isoB.registerSourceKeys(['hnzy', 'lzzy', 'ffzy']);

console.log('\n[2] isolate B 解码（无共享内存）');
for (const e of encodedItems) {
  const decoded = isoB.decodeItemId(e.id);
  check(
    `${e.src}:${e.sid} 可解`,
    decoded?.source === e.src && decoded?.sourceId === e.sid,
    `got ${JSON.stringify(decoded)}`
  );
}

// ---------- 分集 Id ----------
console.log('\n[3] 分集 Id 跨 isolate');
const epA = isoA.encodeEpisodeId('hnzy', '12345', 0);
const epB = isoA.encodeEpisodeId('hnzy', '12345', 7);
const epC = isoA.encodeEpisodeId('hnzy', '12345', 100);

for (const [id, expectedIdx] of [[epA, 0], [epB, 7], [epC, 100]]) {
  const d = isoB.decodeEpisodeId(id);
  check(
    `第 ${expectedIdx + 1} 集可解`,
    d?.source === 'hnzy' && d?.sourceId === '12345' && d?.index === expectedIdx,
    `got ${JSON.stringify(d)}`
  );
}

// ---------- classifyId 端到端 ----------
console.log('\n[4] classifyId（路由实际调用的入口）');
for (const e of encodedItems) {
  const c = isoB.classifyId(e.id);
  check(
    `classifyId -> item`,
    c.kind === 'item' && c.source === e.src && c.sourceId === e.sid,
    `got ${JSON.stringify(c)}`
  );
}
const cEp = isoB.classifyId(epB);
check(
  'classifyId -> episode',
  cEp.kind === 'episode' && cEp.index === 7,
  `got ${JSON.stringify(cEp)}`
);

// ---------- GUID 形态（客户端硬性要求） ----------
console.log('\n[5] GUID 形态');
const guidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
check('条目 Id 是 GUID 形态', encodedItems.every((e) => guidRe.test(e.id)),
  encodedItems.filter((e) => !guidRe.test(e.id)).map((e) => e.id).join(','));
check('分集 Id 是 GUID 形态', [epA, epB, epC].every((i) => guidRe.test(i)));

// ---------- 确定性（同输入同输出，客户端可缓存） ----------
console.log('\n[6] 确定性与唯一性');
const isoC = freshCatalog();
check('跨 isolate 编码结果一致',
  isoC.encodeItemId('hnzy', '12345') === isoA.encodeItemId('hnzy', '12345'));
check('不同源产生不同 Id',
  isoA.encodeItemId('hnzy', '100') !== isoA.encodeItemId('lzzy', '100'));
check('不同条目产生不同 Id',
  isoA.encodeItemId('hnzy', '100') !== isoA.encodeItemId('hnzy', '101'));
check('条目与分集 Id 不冲突',
  isoA.encodeItemId('hnzy', '100') !== isoA.encodeEpisodeId('hnzy', '100', 0));

// ---------- 未登记源应解不出（避免误解码到错误源） ----------
console.log('\n[7] 未登记源的边界行为');
const isoD = freshCatalog();
const unknown = isoD.decodeItemId(encodedItems[0].id);
check('未登记源时解不出（返回 null 而非错误源）', unknown === null, `got ${JSON.stringify(unknown)}`);

// ---------- 旧 Id / 垃圾输入不应崩溃 ----------
console.log('\n[8] 健壮性');
check('随机 GUID 返回 null', isoB.decodeItemId('11111111-2222-3333-4444-555555555555') === null);
check('非 GUID 字符串返回 null', isoB.decodeItemId('not-a-guid') === null);
check('空字符串返回 null', isoB.decodeItemId('') === null);
check('classifyId 对垃圾输入返回 unknown', isoB.classifyId('garbage').kind === 'unknown');

// ---------- 大 id 边界 ----------
console.log('\n[9] 大数值边界');
const bigCases = ['0', '1', '2147483647', '9007199254740993', '999999999999999999'];
for (const sid of bigCases) {
  const id = isoA.encodeItemId('hnzy', sid);
  const d = isoB.decodeItemId(id);
  check(`id=${sid} 往返一致`, d?.sourceId === sid, `got ${d?.sourceId}`);
}

console.log(`\n=== ${pass} 通过 / ${fail} 失败 ===\n`);
process.exit(fail === 0 ? 0 : 1);
