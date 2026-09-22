import { authenticateRequest } from '@/lib/emby.auth';
import { classifyId } from '@/lib/emby.catalog';
import {
  embyError,
  embyJson,
  embyUnauthorized,
  resolveBaseUrl,
} from '@/lib/emby.http';
import {
  ensureSourcesRegistered,
  resolveItem,
  resolveStreamWithSupplement,
} from '@/lib/emby.items';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/**
 * GET /api/debug/playback?itemId=<id>[&ep=<n>][&MediaSourceId=<ms>]
 *
 * 播放链路诊断。
 *
 * 用户反馈「选集能看到，但点播放没反应」。播放要经过多步，
 * 任何一步失败客户端都只是「无响应」，很难定位。本端点把每一步
 * 的结果都返回出来，一眼就能看出断在哪：
 *
 *   1. Id 解码        —— itemId 能否解析出 source/sourceId/分集序号
 *   2. 详情回源        —— 该源能否取到影片详情、是否带可播放分集
 *   3. 分集地址        —— 目标分集的原始地址是什么（含前 3 个样例）
 *   4. 播放解析        —— resolveStreamWithSupplement 能否得到真实流地址
 *   5. 代理地址        —— 生成的 /api/emby/stream/direct 地址
 *   6. 上游可达性      —— 服务器 fetch 一次上游，确认非 403/404
 *
 * 返回中不含任何密钥；仅诊断用，可安全暴露（需 Emby 鉴权）。
 */
export async function GET(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return embyUnauthorized();

  const { searchParams } = new URL(request.url);
  const itemId = searchParams.get('itemId') || '';
  const MediaSourceId = searchParams.get('MediaSourceId') || undefined;
  const epParam = Number(searchParams.get('ep') || 0);
  const baseUrl = resolveBaseUrl(request);

  if (!itemId && !MediaSourceId) {
    return embyError(400, 'Missing itemId or MediaSourceId');
  }

  const report: Record<string, unknown> = {
    input: { itemId, MediaSourceId, ep: epParam || undefined, baseUrl },
  };

  await ensureSourcesRegistered();

  // 1) Id 解码
  const classified = classifyId(itemId);
  report.decode = classified;

  // 2) 详情回源
  const resolved = itemId ? await resolveItem(itemId, undefined, auth.userName) : null;
  if (!resolved) {
    report.detail = { ok: false, reason: 'resolveItem 返回 null（源表未登记 / 源不可用 / 详情无内容）' };
    return embyJson(report);
  }
  const eps = resolved.result.episodes || [];
  report.detail = {
    ok: true,
    source: resolved.result.source,
    sourceId: resolved.result.id,
    title: resolved.result.title,
    episodeCount: eps.length,
    episodeSamples: eps.slice(0, 3),
  };

  // 3) 计算目标分集序号
  let episodeIndex =
    classified.kind === 'episode' ? classified.index + 1 : undefined;
  if (!episodeIndex && epParam > 0) episodeIndex = epParam;
  if (!episodeIndex && MediaSourceId) {
    const m = MediaSourceId.match(/:(\d+)$/);
    if (m) episodeIndex = Number(m[1]);
  }
  report.episodeIndex = episodeIndex;

  // 4) 播放解析（含跨源补充）
  const stream = await resolveStreamWithSupplement({
    source: resolved.result.source,
    sourceId: resolved.result.id,
    title: resolved.result.title,
    episodeIndex,
    userName: auth.userName,
  });
  if (!stream) {
    report.playback = {
      ok: false,
      reason: 'resolveStreamWithSupplement 返回 null（该分集地址为空 / 非 http(s) / 跨源补充也没找到）',
    };
    return embyJson(report);
  }
  report.playback = {
    ok: true,
    url: stream.stream.url,
    container: stream.stream.container,
    isHls: stream.stream.isHls,
    fromSource: stream.result.source,
  };

  // 5) 代理地址
  const params = new URLSearchParams({
    source: resolved.result.source,
    id: resolved.result.id,
  });
  if (episodeIndex && episodeIndex > 0) params.set('ep', String(episodeIndex));
  report.proxyUrl = `${baseUrl}/api/emby/stream/direct?${params.toString()}`;

  // 6) 上游可达性（HEAD 一次，避免拉整个文件）
  try {
    const head = await fetch(stream.stream.url, {
      method: 'GET',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Range: 'bytes=0-1023',
        Accept: '*/*',
        Referer: new URL(stream.stream.url).origin + '/',
      },
    });
    report.upstream = {
      status: head.status,
      contentType: head.headers.get('content-type'),
      contentRange: head.headers.get('content-range'),
      ok: head.ok || head.status === 206,
    };
    // 不读取 body，避免浪费
  } catch (err) {
    report.upstream = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  return embyJson(report);
}
