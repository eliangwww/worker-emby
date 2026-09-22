/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

/**
 * 中间件。
 *
 * 重要：Emby 协议端点（/emby/**、/api/emby/**）使用 Emby 自己的
 * X-Emby-Token 鉴权，绝不能走这里的 Cookie 校验，否则所有客户端
 * 都会收到 401 或 302。因此这些前缀在 matcher 中被排除。
 *
 * 本站不再提供网页播放界面，中间件只保护管理后台。
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (shouldSkipAuth(pathname)) {
    return NextResponse.next();
  }

  // 未配置管理员密码时提示先完成配置
  if (!process.env.AUTH_PASSWORD) {
    return NextResponse.redirect(new URL('/warning', request.url));
  }

  return NextResponse.next();
}

/** 无需登录即可访问的路径 */
function shouldSkipAuth(pathname: string): boolean {
  const skipPaths = [
    '/_next',
    '/favicon.ico',
    '/robots.txt',
    '/manifest.json',
    '/icons/',
    '/logo.png',
    '/screenshot.png',
    '/warning',
    '/login',
    '/api/login',
    '/api/logout',
    '/api/emby',
    '/api/debug',
    '/emby',
  ];

  return skipPaths.some((path) => pathname.startsWith(path));
}

/**
 * 明确排除 Emby 协议路径与管理登录相关接口，
 * 避免中间件对客户端请求做重定向。
 */
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|emby|api/emby|api/debug|login|warning|api/login|api/logout|api/server-config|api/image-proxy).*)',
  ],
};
