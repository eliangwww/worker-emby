/* eslint-disable no-console, @typescript-eslint/no-explicit-any */

import { getStorage } from './db';
import {
  deriveGuid,
  getAdminPassword,
  getAdminUsername,
  getApiKey,
  getServerId,
  isApiKeyAuthEnabled,
} from './emby.config';
import { EmbySessionRecord } from './emby.types';

/** Emby 客户端可能使用的 token 请求头（不同客户端不一致） */
const TOKEN_HEADERS = [
  'x-emby-token',
  'x-emby-authorization',
  'x-mediabrowser-token',
];

/** 从请求中提取 MediaBrowser 授权头里的字段 */
function parseMediaBrowserAuth(header: string | null): Record<string, string> {
  const result: Record<string, string> = {};
  if (!header) return result;
  header.split(',').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx > 0) {
      const key = part.slice(0, idx).trim();
      let value = part.slice(idx + 1).trim();
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }
      result[key] = value;
    }
  });
  return result;
}

/** 客户端信息（会话与设备标识） */
export interface ClientContext {
  deviceId: string;
  deviceName: string;
  client: string;
  version: string;
  token?: string;
}

/** 从请求头解析客户端上下文 */
export function parseClientContext(request: Request): ClientContext {
  const authHeader =
    request.headers.get('x-emby-authorization') ||
    request.headers.get('authorization');
  const parsed = parseMediaBrowserAuth(authHeader);

  const explicitToken =
    request.headers.get('x-emby-token') ||
    request.headers.get('x-mediabrowser-token') ||
    undefined;

  return {
    deviceId:
      parsed['DeviceId'] ||
      request.headers.get('x-emby-deviceid') ||
      'unknown-device',
    deviceName: parsed['Device'] || 'Unknown Device',
    client: parsed['Client'] || 'Emby Client',
    version: parsed['Version'] || '1.0.0',
    token: explicitToken || parsed['Token'] || undefined,
  };
}

/** 从请求提取 token（含 query 参数，播放地址常用 ?api_key=） */
export function extractToken(request: Request): string | undefined {
  const url = new URL(request.url);
  const queryToken =
    url.searchParams.get('api_key') ||
    url.searchParams.get('X-Emby-Token') ||
    url.searchParams.get('apiKey') ||
    url.searchParams.get('token');
  if (queryToken) return queryToken;

  for (const h of TOKEN_HEADERS) {
    const v = request.headers.get(h);
    if (v) return v;
  }

  const authHeader =
    request.headers.get('x-emby-authorization') ||
    request.headers.get('authorization');
  const parsed = parseMediaBrowserAuth(authHeader);
  return parsed['Token'] || undefined;
}

/** 用户 Id 由用户名稳定派生，保证客户端缓存不失效 */
export function userIdFor(username: string): string {
  return deriveGuid(`${getServerId()}:${username}`);
}

/**
 * 校验账号密码。
 * - owner（USERNAME/AUTH_PASSWORD）由环境变量校验
 * - 其他用户走 D1 users 表
 */
export async function verifyCredentials(
  username: string,
  password: string
): Promise<boolean> {
  const adminUser = getAdminUsername();
  const adminPass = getAdminPassword();

  if (username === adminUser) {
    return !!adminPass && password === adminPass;
  }

  try {
    const storage = getStorage();
    return await storage.verifyUser(username, password);
  } catch (err) {
    console.error('Emby 用户校验失败:', err);
    return false;
  }
}

/** 判断用户是否为管理员 */
export async function isAdminUser(username: string): Promise<boolean> {
  if (username === getAdminUsername()) return true;
  try {
    const storage = getStorage();
    const all = await storage.getAllUsers();
    const found = all.find((u) => u.username === username);
    return found?.role === 'admin' || found?.role === 'owner';
  } catch {
    return false;
  }
}

/** 用户是否存在 */
export async function userExists(username: string): Promise<boolean> {
  if (username === getAdminUsername()) return true;
  try {
    const storage = getStorage();
    return await storage.checkUserExist(username);
  } catch {
    return false;
  }
}

/** 生成随机的 Emby AccessToken */
export function generateAccessToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * 创建并持久化一个会话。
 * 同一 DeviceId 重复登录时复用旧 token，避免客户端出现重复设备。
 */
export async function createSession(
  username: string,
  ctx: ClientContext,
  remoteEndPoint: string
): Promise<EmbySessionRecord> {
  const storage = getStorage();
  const userId = userIdFor(username);

  // 复用同设备同用户的历史会话
  let existing: EmbySessionRecord | null = null;
  try {
    existing = await (storage as any).getEmbySessionByDevice?.(
      userId,
      ctx.deviceId
    );
  } catch {
    existing = null;
  }

  const token = existing?.AccessToken || generateAccessToken();
  const now = Date.now();

  const session: EmbySessionRecord = {
    Id: existing?.Id || generateAccessToken(),
    UserId: userId,
    UserName: username,
    AccessToken: token,
    DeviceId: ctx.deviceId,
    DeviceName: ctx.deviceName,
    Client: ctx.client,
    ApplicationVersion: ctx.version,
    RemoteEndPoint: remoteEndPoint,
    CreatedAt: existing?.CreatedAt || now,
    LastActivityDate: now,
  };

  try {
    await (storage as any).setEmbySession?.(session);
  } catch (err) {
    console.error('保存 Emby 会话失败:', err);
  }

  return session;
}

/**
 * 依据 token 解析会话。
 * token 无效时返回 null，由调用方决定返回 401。
 */
export async function resolveSession(
  token: string | undefined
): Promise<EmbySessionRecord | null> {
  if (!token) return null;
  try {
    const storage = getStorage();
    const session = await (storage as any).getEmbySessionByToken?.(token);
    if (!session) return null;
    // 刷新活跃时间（失败不影响鉴权结果）
    try {
      await (storage as any).touchEmbySession?.(token);
    } catch {
      // 忽略：活跃时间仅用于 /Sessions 的在线判断
    }
    return session as EmbySessionRecord;
  } catch (err) {
    console.error('解析 Emby 会话失败:', err);
    return null;
  }
}

/** 删除会话（登出） */
export async function destroySession(token: string): Promise<void> {
  try {
    const storage = getStorage();
    await (storage as any).deleteEmbySession?.(token);
  } catch (err) {
    console.error('删除 Emby 会话失败:', err);
  }
}

/**
 * 统一的鉴权入口。
 * 支持三种方式：
 *   1. X-Emby-Token / api_key 对应的会话 token
 *   2. 全局 API Key（EMBY_ENABLE_API_KEY=true 时）
 *   3. 无需鉴权的公共端点由调用方自行跳过
 */
export async function authenticateRequest(request: Request): Promise<{
  ok: boolean;
  userId?: string;
  userName?: string;
  isAdmin?: boolean;
  token?: string;
}> {
  const token = extractToken(request);

  const session = await resolveSession(token);
  if (session) {
    return {
      ok: true,
      userId: session.UserId,
      userName: session.UserName,
      isAdmin: await isAdminUser(session.UserName),
      token: session.AccessToken,
    };
  }

  if (token && isApiKeyAuthEnabled()) {
    const apiKey = getApiKey();
    if (apiKey && token === apiKey) {
      const adminUser = getAdminUsername();
      return {
        ok: true,
        userId: userIdFor(adminUser),
        userName: adminUser,
        isAdmin: true,
        token,
      };
    }
  }

  return { ok: false };
}

/** 所有已存在的会话（Sessions 端点使用） */
export async function listSessions(): Promise<EmbySessionRecord[]> {
  try {
    const storage = getStorage();
    return (await (storage as any).getAllEmbySessions?.()) || [];
  } catch {
    return [];
  }
}
