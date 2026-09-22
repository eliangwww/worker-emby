/* eslint-disable no-console, @typescript-eslint/no-explicit-any */

import { isD1Available } from './db';

/**
 * 请求记录器。
 *
 * 用途：排查「某个客户端播不了」这类问题时，最大的障碍是
 * **看不到客户端到底请求了什么**。Workers 默认没有可读的日志，
 * 因此这里把最近若干条请求写入 D1，通过 /emby/Diagnostics/Requests 查看。
 *
 * 只在 EMBY_DEBUG_REQUESTS=true 时启用，避免生产环境额外开销。
 */

/** 单条记录 */
export interface RecordedRequest {
  Id: number;
  Method: string;
  Path: string;
  Query: string;
  Status: number;
  UserAgent: string;
  Client: string;
  DeviceId: string;
  Token: string;
  Detail: string;
  CreatedAt: number;
}

const MAX_RECORDS = 200;

/** 是否启用请求记录 */
export function isRequestLoggingEnabled(): boolean {
  return process.env.EMBY_DEBUG_REQUESTS === 'true';
}

/** 建表（幂等，首次写入时自动创建） */
let tableReady = false;
async function ensureTable(): Promise<void> {
  if (tableReady) return;
  if (!isD1Available()) return;

  try {
    const binding = (globalThis as any).DB;
    if (binding?.exec) {
      await binding.exec(
        `CREATE TABLE IF NOT EXISTS emby_debug_requests (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          method TEXT,
          path TEXT,
          query TEXT,
          status INTEGER,
          user_agent TEXT,
          client TEXT,
          device_id TEXT,
          token TEXT,
          detail TEXT,
          created_at INTEGER
        )`
      );
      await binding.exec(
        'CREATE INDEX IF NOT EXISTS idx_emby_debug_created ON emby_debug_requests(created_at DESC)'
      );
    }
    tableReady = true;
  } catch (err) {
    console.error('创建请求记录表失败:', err);
  }
}

/** 记录一条请求（失败静默，绝不影响主流程） */
export async function recordRequest(
  request: Request,
  status: number,
  detail = ''
): Promise<void> {
  if (!isRequestLoggingEnabled()) return;

  try {
    await ensureTable();
    const binding = (globalThis as any).DB;
    if (!binding?.prepare) return;

    const url = new URL(request.url);
    const authHeader =
      request.headers.get('x-emby-authorization') ||
      request.headers.get('authorization') ||
      '';

    // 从 MediaBrowser 头里抽取 Client / DeviceId
    const parsed: Record<string, string> = {};
    authHeader.split(',').forEach((part) => {
      const i = part.indexOf('=');
      if (i > 0) {
        let v = part.slice(i + 1).trim();
        if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
        parsed[part.slice(0, i).trim()] = v;
      }
    });

    const token =
      url.searchParams.get('api_key') ||
      request.headers.get('x-emby-token') ||
      parsed['Token'] ||
      '';

    await binding
      .prepare(
        `INSERT INTO emby_debug_requests
         (method, path, query, status, user_agent, client, device_id, token, detail, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        request.method,
        url.pathname,
        url.search.replace(/^\?/, ''),
        status,
        (request.headers.get('user-agent') || '').slice(0, 200),
        parsed['Client'] || '',
        parsed['DeviceId'] || '',
        token ? token.slice(0, 8) + '…' : '',
        detail.slice(0, 300),
        Date.now()
      )
      .run();

    // 只保留最近 MAX_RECORDS 条
    await binding
      .prepare(
        `DELETE FROM emby_debug_requests
         WHERE id NOT IN (
           SELECT id FROM emby_debug_requests ORDER BY id DESC LIMIT ?
         )`
      )
      .bind(MAX_RECORDS)
      .run();
  } catch {
    // 记录失败不影响请求本身
  }
}

/** 读取最近记录 */
export async function readRequests(limit = 100): Promise<RecordedRequest[]> {
  if (!isD1Available()) return [];
  try {
    await ensureTable();
    const binding = (globalThis as any).DB;
    if (!binding?.prepare) return [];

    const res = await binding
      .prepare(
        'SELECT * FROM emby_debug_requests ORDER BY id DESC LIMIT ?'
      )
      .bind(Math.min(limit, MAX_RECORDS))
      .all();

    return (res.results || []).map((r: any) => ({
      Id: r.id,
      Method: r.method,
      Path: r.path,
      Query: r.query,
      Status: r.status,
      UserAgent: r.user_agent,
      Client: r.client,
      DeviceId: r.device_id,
      Token: r.token,
      Detail: r.detail,
      CreatedAt: r.created_at,
    }));
  } catch {
    return [];
  }
}

/** 清空记录 */
export async function clearRequests(): Promise<void> {
  if (!isD1Available()) return;
  try {
    const binding = (globalThis as any).DB;
    if (!binding?.exec) return;
    await binding.exec('DELETE FROM emby_debug_requests');
  } catch {
    // 忽略
  }
}
