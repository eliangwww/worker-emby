/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextResponse } from 'next/server';

import { authenticateRequest } from './emby.auth';
import { resolveBaseUrl } from './emby.config';

/**
 * Emby 客户端对响应头比较敏感：
 *  - 必须允许跨域（许多桌面/移动客户端以 WebView 形式运行）
 *  - 必须暴露 Content-Range，否则拖动进度条会失败
 */
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, HEAD',
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization, X-Emby-Authorization, X-Emby-Token, X-MediaBrowser-Token, Range, Accept, Origin, User-Agent, X-Requested-With',
  'Access-Control-Expose-Headers':
    'Content-Range, Content-Length, Accept-Ranges, Content-Type, X-Emby-Token',
  'Access-Control-Max-Age': '86400',
  'Access-Control-Allow-Credentials': 'false',
};

/** 统一的 OPTIONS 预检响应 */
export function embyOptions(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/** 带 CORS 的 JSON 响应 */
export function embyJson(
  data: unknown,
  init: { status?: number; headers?: Record<string, string> } = {}
): NextResponse {
  return NextResponse.json(data as any, {
    status: init.status ?? 200,
    headers: { ...CORS_HEADERS, ...(init.headers || {}) },
  });
}

/** Emby 风格错误响应：主流客户端识别 status code + 文本体 */
export function embyError(status: number, message: string): NextResponse {
  return new NextResponse(message, {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

/** 401：未授权 */
export function embyUnauthorized(
  message = 'Invalid token or no authentication information'
): NextResponse {
  return embyError(401, message);
}

/** 404 */
export function embyNotFound(message = 'Item not found'): NextResponse {
  return embyError(404, message);
}

/** 204 空响应（客户端大量使用，如进度上报） */
export function embyNoContent(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/** 认证上下文 */
export interface EmbyAuthContext {
  userId: string;
  userName: string;
  isAdmin: boolean;
  token?: string;
}

/** 路由动态段参数 */
export interface EmbyRouteParams {
  [key: string]: string | string[] | undefined;
}

/**
 * 从 Next.js 的 params 中取第一个动态段。
 * 兼容具名参数 { itemId: 'abc' } 与数组参数 { path: ['abc'] }。
 */
export function firstParam(
  params: EmbyRouteParams | undefined,
  ...names: string[]
): string | undefined {
  if (!params) return undefined;

  for (const name of names) {
    const v = params[name];
    if (typeof v === 'string' && v) return v;
    if (Array.isArray(v) && v.length) return v[0];
  }

  for (const v of Object.values(params)) {
    if (typeof v === 'string' && v) return v;
    if (Array.isArray(v) && v.length) return v[0];
  }
  return undefined;
}

/**
 * 包装一个需要鉴权的路由处理器。
 *
 * 签名与 Next.js App Router 一致：handler(request, { params })。
 * 鉴权失败自动返回 401。
 */
export function withEmbyAuth(
  handler: (
    request: Request,
    ctx: EmbyAuthContext,
    params: EmbyRouteParams
  ) => Promise<Response> | Response
) {
  return async (
    request: Request,
    routeCtx?: { params?: EmbyRouteParams }
  ): Promise<Response> => {
    const auth = await authenticateRequest(request);
    if (!auth.ok) {
      return embyUnauthorized();
    }
    try {
      return await handler(
        request,
        {
          userId: auth.userId!,
          userName: auth.userName!,
          isAdmin: !!auth.isAdmin,
          token: auth.token,
        },
        routeCtx?.params || {}
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Emby 路由处理失败:', err);
      const message = err instanceof Error ? err.message : 'Internal error';
      return embyError(500, message);
    }
  };
}

/** 兼容多种 Emby 分页参数命名 */
export function parsePaging(searchParams: URLSearchParams): {
  startIndex: number;
  limit: number;
} {
  const startIndex = Number(
    searchParams.get('StartIndex') ?? searchParams.get('startIndex') ?? 0
  );
  const limit = Number(
    searchParams.get('Limit') ??
      searchParams.get('limit') ??
      searchParams.get('PageSize') ??
      50
  );
  return {
    startIndex: Number.isFinite(startIndex) && startIndex > 0 ? startIndex : 0,
    limit:
      Number.isFinite(limit) && limit > 0 ? Math.min(limit, 500) : 50,
  };
}

/** 生成带 ETag 的图片/静态响应缓存头 */
export function cacheHeaders(seconds = 86400): Record<string, string> {
  return {
    'Cache-Control': `public, max-age=${seconds}, s-maxage=${seconds}`,
  };
}

/** 对外 baseUrl（供路由内部拼接播放地址使用） */
export { resolveBaseUrl };
