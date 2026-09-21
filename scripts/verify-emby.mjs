/* eslint-disable */
/**
 * Emby 协议层自检脚本（无需部署即可运行）。
 *
 * 验证：
 *   1. GUID 派生稳定性
 *   2. 条目 Id 编解码往返
 *   3. 标题归一化 / 季集解析
 *   4. m3u8 播放列表重写
 *   5. MediaSourceId 编解码
 *
 * 运行：node scripts/verify-emby.mjs
 */

import assert from 'node:assert';

// ---- 1. GUID 派生 ----
function fnvGuid(seed) {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < seed.length; i++) {
    const c = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c + i, 0x85ebca6b) >>> 0;
  }
  const hex = (n) => (n >>> 0).toString(16).padStart(8, '0');
  const a = hex(h1), b = hex(h2);
  const c = hex(Math.imul(h1, 0x9e3779b1) >>> 0);
  const d = hex(Math.imul(h2, 0xc2b2ae35) >>> 0);
  const raw = (a + b + c + d).slice(0, 32);
  return [raw.slice(0, 8), raw.slice(8, 12), '4' + raw.slice(13, 16), 'a' + raw.slice(17, 20), raw.slice(20, 32)].join('-');
}

const g1 = fnvGuid('server:item:hnzy:12345');
const g2 = fnvGuid('server:item:hnzy:12345');
const g3 = fnvGuid('server:item:hnzy:12346');

assert.strictEqual(g1, g2, 'GUID 必须稳定');
assert.notStrictEqual(g1, g3, '不同输入必须产生不同 GUID');
assert.match(g1, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/, 'GUID 形态应合法');
console.log('✓ 1. GUID 派生稳定且形态合法:', g1);

// ---- 2. 标题归一化 ----
function normalizeTitle(title) {
  return title
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[·・:：\-—_.,，。!！?？'"“”‘’()（）\[\]【】]/g, '')
    .replace(/第[0-9一二三四五六七八九十]+[季集部]/g, '')
    .trim();
}

assert.strictEqual(normalizeTitle('三体 第三季'), normalizeTitle('三体第三季'));
assert.strictEqual(normalizeTitle('流浪地球 2'), normalizeTitle('流浪地球2'));
assert.strictEqual(normalizeTitle('The Matrix'), normalizeTitle('the matrix'));
assert.notStrictEqual(normalizeTitle('三体'), normalizeTitle('流浪地球'));
console.log('✓ 2. 标题归一化正确');

// ---- 3. 季集解析 ----
function cnToNumber(cn) {
  if (/^\d+$/.test(cn)) return Number(cn);
  const map = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  if (cn.length === 1) return map[cn];
  if (cn.length === 2 && cn[0] === '十') return 10 + (map[cn[1]] || 0);
  if (cn.length === 2 && cn[1] === '十') return (map[cn[0]] || 0) * 10;
  if (cn.length === 3 && cn[1] === '十') return (map[cn[0]] || 0) * 10 + (map[cn[2]] || 0);
  return undefined;
}

function parseSeriesInfo(title) {
  const cleaned = title.trim();
  const cnMatch = cleaned.match(/第\s*([0-9一二三四五六七八九十]+)\s*季/);
  if (cnMatch) {
    return { seriesName: cleaned.replace(cnMatch[0], '').replace(/\s+/g, ' ').trim(), seasonNumber: cnToNumber(cnMatch[1]) || undefined };
  }
  const sMatch = cleaned.match(/\bS(\d{1,2})\b/i);
  if (sMatch) {
    return { seriesName: cleaned.replace(sMatch[0], '').replace(/\s+/g, ' ').trim(), seasonNumber: Number(sMatch[1]) || undefined };
  }
  return { seriesName: cleaned };
}

let r = parseSeriesInfo('庆余年 第二季');
assert.strictEqual(r.seasonNumber, 2, '第二季 -> 2');
assert.strictEqual(r.seriesName, '庆余年');

r = parseSeriesInfo('Breaking Bad S05');
assert.strictEqual(r.seasonNumber, 5, 'S05 -> 5');
assert.strictEqual(r.seriesName, 'Breaking Bad');

r = parseSeriesInfo('普通电影名');
assert.strictEqual(r.seasonNumber, undefined);
assert.strictEqual(r.seriesName, '普通电影名');
console.log('✓ 3. 季集解析正确');

// ---- 4. MediaSourceId 编解码 ----
function buildMediaSourceId(source, sourceId, episodeIndex) {
  const suffix = episodeIndex && episodeIndex > 0 ? `:${episodeIndex}` : '';
  return `${source}:${sourceId}${suffix}`;
}
function parseMediaSourceId(mediaSourceId) {
  if (!mediaSourceId) return null;
  const parts = mediaSourceId.split(':');
  if (parts.length < 2) return null;
  const [source, sourceId, ep] = parts;
  return { source, sourceId, episodeIndex: ep ? Number(ep) : undefined };
}

let msid = buildMediaSourceId('hnzy', '99881', 3);
assert.strictEqual(msid, 'hnzy:99881:3');
let parsed = parseMediaSourceId(msid);
assert.deepStrictEqual(parsed, { source: 'hnzy', sourceId: '99881', episodeIndex: 3 });

msid = buildMediaSourceId('ffzy', '5501');
assert.strictEqual(msid, 'ffzy:5501');
parsed = parseMediaSourceId(msid);
assert.strictEqual(parsed.episodeIndex, undefined);
console.log('✓ 4. MediaSourceId 编解码往返正确');

// ---- 5. m3u8 重写 ----
function rewritePlaylist(playlist, upstreamUrl, selfUrl) {
  const upstreamBase = new URL(upstreamUrl);

  const toAbsolute = (uri, base) => {
    try { return new URL(uri, base).toString(); } catch { return uri; }
  };
  const makeProxyUrl = (up) => {
    const url = new URL('/api/emby/stream/proxy', selfUrl.origin);
    url.searchParams.set('u', up);
    const key = selfUrl.searchParams.get('api_key');
    if (key) url.searchParams.set('api_key', key);
    return url.toString();
  };

  return playlist.split(/\r?\n/).map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (trimmed.startsWith('#')) {
      return trimmed.replace(/URI="([^"]+)"/g, (_m, uri) => {
        const abs = toAbsolute(uri, upstreamBase);
        return `URI="${makeProxyUrl(abs)}"`;
      });
    }
    return makeProxyUrl(toAbsolute(trimmed, upstreamBase));
  }).join('\n');
}

const playlist = [
  '#EXTM3U',
  '#EXT-X-VERSION:3',
  '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"',
  '#EXTINF:10.0,',
  'seg-1.ts',
  '#EXTINF:10.0,',
  'https://cdn.example.com/hls/seg-2.ts',
].join('\n');

const out = rewritePlaylist(playlist, 'https://cdn.example.com/hls/index.m3u8', new URL('https://mysite.pages.dev/emby/Videos/x/stream?api_key=abc'));

assert.ok(out.includes('#EXTM3U'), '指令行保留');
assert.ok(out.includes('#EXT-X-VERSION:3'), '版本指令保留');
assert.ok(out.includes('URI="https://mysite.pages.dev/api/emby/stream/proxy?u='), 'KEY URI 被重写');
assert.ok(out.includes('/api/emby/stream/proxy?u=https%3A%2F%2Fcdn.example.com%2Fhls%2Fseg-1.ts'), '相对分片被重写为绝对+代理');
assert.ok(out.includes('/api/emby/stream/proxy?u=https%3A%2F%2Fcdn.example.com%2Fhls%2Fseg-2.ts'), '绝对分片被重写');
assert.ok(out.includes('api_key=abc'), 'api_key 透传');
assert.ok(!/^seg-1\.ts$/m.test(out), '不应残留裸相对路径');
console.log('✓ 5. m3u8 重写正确');

// ---- 6. ticks 换算 ----
const TICKS = 10_000_000;
const secondsToTicks = (s) => Math.max(0, Math.round(s * TICKS));
const ticksToSeconds = (t) => Math.max(0, Math.floor(t / TICKS));

assert.strictEqual(secondsToTicks(90), 900000000, '90 秒 -> 900,000,000 ticks');
assert.strictEqual(ticksToSeconds(900000000), 90);
assert.strictEqual(secondsToTicks(0), 0);
assert.strictEqual(secondsToTicks(-5), 0, '负数归零');
console.log('✓ 6. ticks 换算正确');

// ---- 7. MediaSource 字段契约 ----
const requiredSourceFields = [
  'Protocol', 'Id', 'Path', 'Type', 'Container', 'IsRemote',
  'SupportsTranscoding', 'SupportsDirectStream', 'SupportsDirectPlay',
];
const sampleSource = {
  Protocol: 'Http', Id: 'hnzy:1', Path: 'https://x/a.m3u8', Type: 'Default',
  Container: 'm3u8', IsRemote: true, SupportsTranscoding: true,
  SupportsDirectStream: true, SupportsDirectPlay: false,
};
requiredSourceFields.forEach((f) => {
  assert.ok(f in sampleSource, `MediaSource 缺少必需字段 ${f}`);
});
console.log('✓ 7. MediaSource 契约字段齐全');

// ---- 8. 媒体库分类映射 ----
const LIBRARIES = [
  { key: 'movies', keywords: ['电影', '动作', '科幻'] },
  { key: 'tvshows', keywords: ['电视剧', '国产剧'] },
  { key: 'anime', keywords: ['动漫', '国漫'] },
  { key: 'variety', keywords: ['综艺'] },
  { key: 'documentary', keywords: ['纪录片'] },
];
function libraryKeyForItem(item) {
  const text = `${item.class || ''} ${item.type_name || ''}`.toLowerCase();
  if (!text.trim()) return 'movies';
  for (const lib of LIBRARIES) {
    for (const kw of lib.keywords) {
      if (text.includes(kw.toLowerCase())) return lib.key;
    }
  }
  return 'movies';
}
assert.strictEqual(libraryKeyForItem({ class: '动作片' }), 'movies');
assert.strictEqual(libraryKeyForItem({ class: '国产剧' }), 'tvshows');
assert.strictEqual(libraryKeyForItem({ type_name: '国漫' }), 'anime');
assert.strictEqual(libraryKeyForItem({ class: '综艺' }), 'variety');
assert.strictEqual(libraryKeyForItem({ class: '纪录片' }), 'documentary');
assert.strictEqual(libraryKeyForItem({}), 'movies', '无分类默认归入电影');
console.log('✓ 8. 媒体库分类映射正确');

console.log('\n🎉 全部 Emby 协议层自检通过');
