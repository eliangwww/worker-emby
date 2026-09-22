/* eslint-disable no-console */

import { authenticateRequest } from '@/lib/emby.auth';
import { clearRequests, readRequests } from '@/lib/emby.debug';
import { embyJson, embyUnauthorized } from '@/lib/emby.http';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/**
 * GET /emby/Diagnostics/Requests
 *
 * 查看最近记录的客户端请求，用于排查「某客户端播不了」问题。
 * 需先设置环境变量 EMBY_DEBUG_REQUESTS=true 才会记录。
 *
 * 查询参数：
 *   ?limit=100    返回条数（上限 200）
 *   ?clear=true   先清空再返回
 */
export async function GET(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return embyUnauthorized();

  const { searchParams } = new URL(request.url);
  const limit = Number(searchParams.get('limit') || 100);
  const clear = searchParams.get('clear') === 'true';

  if (clear) {
    await clearRequests();
  }

  const enabled = process.env.EMBY_DEBUG_REQUESTS === 'true';
  const items = enabled ? await readRequests(limit) : [];

  return embyJson({
    enabled,
    hint: enabled
      ? undefined
      : '请求记录未启用。请在 Cloudflare 环境变量中设置 EMBY_DEBUG_REQUESTS=true 后重新部署。',
    count: items.length,
    requests: items.map((r) => ({
      time: new Date(r.CreatedAt).toISOString(),
      method: r.Method,
      path: r.Path,
      query: r.Query,
      status: r.Status,
      client: r.Client,
      device: r.DeviceId,
      ua: r.UserAgent,
      detail: r.Detail,
    })),
  });
}
