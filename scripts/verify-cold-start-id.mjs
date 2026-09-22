/* eslint-disable */
/**
 * 回归验证：冷启动 isolate 中「未注册源表就 classifyId」会导致
 * Item not found / 封面 No Image。
 *
 * 修复要点：所有直接调用 classifyId() 的路由入口都必须先
 * await ensureSourcesRegistered()；图片路由不再用 classifyId 预判。
 *
 * 运行：node scripts/verify-cold-start-id.mjs
 */

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}  ${detail}`); }
};

console.log('\n=== 冷启动 Id 解码回归验证 ===\n');

// ---------- 1) resolveItem 必须先登记源再解码 ----------
console.log('[1] emby.items.ts 的 resolveItem 顺序');
const items = read('src/lib/emby.items.ts');
const resolveStart = items.indexOf('export async function resolveItem(');
const resolveBody = items.slice(resolveStart, resolveStart + 2000);
const ensurePos = resolveBody.indexOf('await ensureSourcesRegistered()');
const classifyPos = resolveBody.indexOf('const classified = classifyId(itemId)');
check('resolveItem 内先 ensureSourcesRegistered 再 classifyId',
  ensurePos > -1 && classifyPos > -1 && ensurePos < classifyPos,
  `ensurePos=${ensurePos} classifyPos=${classifyPos}`);

// ---------- 2) 图片路由不得再用 classifyId 预判 ----------
console.log('\n[2] 图片路由不再预先 classifyId');
const imgRoute = read('src/app/emby/Items/[itemId]/Images/[imageType]/route.ts');
check('图片路由不再 import classifyId',
  !/import\s*\{[^}]*classifyId[^}]*\}/.test(imgRoute));
check('图片路由不再调用 classifyId(',
  !/\bclassifyId\s*\(/.test(imgRoute));
check('图片路由直接调用 resolveItem', imgRoute.includes('await resolveItem(itemId'));

// ---------- 3) 详情路由入口先登记源 ----------
console.log('\n[3] 详情路由入口顺序');
const detailRoute = read('src/app/emby/Users/[userId]/Items/[itemId]/route.ts');
const dEnsure = detailRoute.indexOf('await ensureSourcesRegistered()');
const dClassify = detailRoute.indexOf('classifyId(itemId)');
check('详情路由先 ensureSourcesRegistered 再 classifyId',
  dEnsure > -1 && dClassify > -1 && dEnsure < dClassify,
  `ensure=${dEnsure} classify=${dClassify}`);

// ---------- 4) 列表路由 ParentId 分支先登记源 ----------
console.log('\n[4] 列表路由 ParentId 分支顺序');
const listRoute = read('src/app/emby/Users/[userId]/Items/route.ts');
const lEnsure = listRoute.indexOf('await ensureSourcesRegistered()');
const lClassify = listRoute.indexOf('classifyId(parentId)');
check('列表路由先 ensureSourcesRegistered 再 classifyId(parentId)',
  lEnsure > -1 && lClassify > -1 && lEnsure < lClassify,
  `ensure=${lEnsure} classify=${lClassify}`);

// ---------- 5) ensureSourcesRegistered 导出且幂等 ----------
console.log('\n[5] ensureSourcesRegistered 实现');
check('已导出', /export function ensureSourcesRegistered/.test(items));
check('有 Promise 缓存（幂等）', /let sourcesReady: Promise<void> \| null = null/.test(items));
check('失败时允许重试', /sourcesReady = null;/.test(items));

console.log(`\n=== ${pass} 通过 / ${fail} 失败 ===\n`);
process.exit(fail === 0 ? 0 : 1);
