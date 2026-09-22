/* eslint-disable */
/**
 * 回归验证：分集「能点开」与「能播放」。
 *
 * 背景：
 *   用户反馈「选集有了，但没法打开具体哪一集，然后也没有办法播放」。
 *   根因有两个：
 *     1. 点开某一集时，客户端请求 /emby/Users/{uid}/Items/{episodeId}，
 *        旧实现返回的是**宿主剧集**（DTO.Id 是 Series Id），与请求 Id
 *        不符 -> 客户端判定条目不存在/类型错误。
 *     2. 播放分集时没有把「分集序号」带到取流环节
 *        （Videos/{id}/stream 未传 episodeIndex），
 *        导致无论点哪一集都只播第 1 集，或直接播不出。
 *
 * 本脚本用静态检查锁死这些修复，防止回归。
 *
 * 运行：node scripts/verify-episode-playback.mjs
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

console.log('\n=== 分集打开 + 播放 回归验证 ===\n');

// ---------- 1) catalog 导出单个分集构造器 ----------
console.log('[1] emby.catalog.ts 分集构造');
const catalog = read('src/lib/emby.catalog.ts');
check('导出 buildEpisodeItem', /export function buildEpisodeItem\(/.test(catalog));
check(
  'buildEpisodesFor 复用 buildEpisodeItem（Id 完全一致）',
  /return \(result\.episodes \|\| \[\]\)\.map\(\(_url, idx\) =>\s*\n?\s*buildEpisodeItem\(/.test(catalog)
);
check(
  'buildEpisodeItem 用 encodeEpisodeId(source, id, index)',
  /encodeEpisodeId\(result\.source, result\.id, index\)/.test(catalog)
);
check('buildEpisodeItem 设置 Type=Episode', /Type: 'Episode' as const/.test(catalog));
check('buildEpisodeItem 设置 SeriesId', /SeriesId: seriesItemId/.test(catalog));

// ---------- 2) 分集详情路由返回 Episode 本身 ----------
console.log('\n[2] 分集详情路由 (Users/{uid}/Items/{itemId})');
const detailPath = 'src/app/emby/Users/[userId]/Items/[itemId]/route.ts';
check('分集详情路由存在', exists(detailPath));
const detail = read(detailPath);
check("识别 classified.kind === 'episode'", /classified\.kind === 'episode'/.test(detail));
check('分集分支调用 buildEpisodeItem', /buildEpisodeItem\(\{/.test(detail));
check('分集分支传入 classified.index', /index: classified\.index/.test(detail));
check(
  '分集分支附带 MediaSources（可直接起播）',
  /buildMediaSourceFromResult\(/.test(detail) && /episode\.MediaSources = \[mediaSource\]/.test(detail)
);
check(
  '分集分支位于通用 resolveItem 之前（先命中 Episode）',
  detail.indexOf("classified.kind === 'episode'") <
    detail.indexOf('const resolved = await resolveItem(itemId, undefined, ctx.userName);\n  if (!resolved) return embyNotFound();')
);

// ---------- 3) stream 路由带上分集序号 ----------
console.log('\n[3] 播放流路由 (Videos/{itemId}/stream 及带后缀变体)');
const streamPath = 'src/app/emby/Videos/[itemId]/stream/route.ts';
check('播放流路由存在', exists(streamPath));
const stream = read(streamPath);
// 播放解析已抽到共享模块 emby.stream.ts
const streamLib = read('src/lib/emby.stream.ts');
check('stream 路由复用 handleStreamRequest', /handleStreamRequest/.test(stream));
check('导出 handleStreamRequest', /export async function handleStreamRequest\(/.test(streamLib));
check('引入 classifyId', /import \{ classifyId \}/.test(streamLib));
check('引入 parseMediaSourceId', /parseMediaSourceId/.test(streamLib));
check('由 itemId 推断分集序号', /classified\.kind === 'episode' \? classified\.index \+ 1/.test(streamLib));
check(
  '由 MediaSourceId 推断分集序号',
  /parseMediaSourceId\(mediaSourceId\)/.test(streamLib)
);
check(
  'resolveStreamWithSupplement 传入 episodeIndex',
  /resolveStreamWithSupplement\(\{[\s\S]*?episodeIndex,/.test(streamLib)
);
// 带后缀的播放路径（stream.m3u8 / stream.mp4 / original.mkv / master.m3u8）
const catchAllPath = 'src/app/emby/Videos/[itemId]/[[...path]]/route.ts';
check('带后缀播放路径 catch-all 路由存在', exists(catchAllPath));
if (exists(catchAllPath)) {
  const catchAll = read(catchAllPath);
  check('catch-all 复用 handleStreamRequest', /handleStreamRequest/.test(catchAll));
  check('catch-all 导出 GET', /export async function GET\(/.test(catchAll));
  check('catch-all 导出 HEAD', /export async function HEAD\(/.test(catchAll));
}

// ---------- 4) resolveMediaSource 从 MediaSourceId 还原序号 ----------
console.log('\n[4] emby.items.ts 播放解析');
const items = read('src/lib/emby.items.ts');
check('引入 parseMediaSourceId', /parseMediaSourceId/.test(items));
check(
  'MediaSourceId 可还原分集序号',
  /epIndex === undefined && mediaSourceId[\s\S]{0,200}parseMediaSourceId\(mediaSourceId\)/.test(items)
);
check(
  'episode 形态 Id 时 epIndex = index + 1',
  /epIndex = classified\.index \+ 1/.test(items)
);
check('导出 attachMediaSources', /export function attachMediaSources\(/.test(items));

// ---------- 5) 分集列表带 MediaSources ----------
console.log('\n[5] 分集列表附 MediaSources');
const showsEpisodes = read('src/app/emby/Shows/[seriesId]/Episodes/route.ts');
check('Episodes 路由传入 baseUrl', /resolveBaseUrl\(request\)/.test(showsEpisodes));
check(
  'resolveEpisodesForSeries 支持 baseUrl 参数',
  /resolveEpisodesForSeries\([\s\S]{0,200}baseUrl\?: string/.test(items)
);
check(
  'resolveEpisodesForSeries 调用 attachMediaSources',
  /attachMediaSources\(/.test(items)
);

const listRoute = read('src/app/emby/Users/[userId]/Items/route.ts');
check('Items 路由有 episodesForParent 辅助', /async function episodesForParent\(/.test(listRoute));
check('episodesForParent 附 MediaSources', /attachMediaSources\(/.test(listRoute));

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail === 0 ? 0 : 1);
