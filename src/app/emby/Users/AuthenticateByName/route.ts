/* eslint-disable no-console */

import {
  createSession,
  isAdminUser,
  parseClientContext,
  verifyCredentials,
} from '@/lib/emby.auth';
import { buildUserDto, getServerId } from '@/lib/emby.config';
import { embyError, embyJson, embyOptions } from '@/lib/emby.http';
import { EmbyAuthenticationResult, EmbySessionInfo } from '@/lib/emby.types';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/**
 * POST /emby/Users/AuthenticateByName
 *
 * Emby 客户端登录入口。请求体：
 *   { "Username": "admin", "Pw": "password" }
 *
 * 注意：Emby 官方客户端把密码字段命名为 `Pw`，而部分第三方客户端
 * （Infuse / Fileball 等）发送 `Password`。两者都要兼容，否则会出现
 * 「密码错误」。同时客户端可能把凭据放在 query string 中。
 */
export async function POST(request: Request) {
  try {
    let body: Record<string, unknown> = {};
    try {
      const text = await request.text();
      if (text) {
        body = JSON.parse(text);
      }
    } catch {
      // 有些客户端发送表单编码，回退到 URLSearchParams
      body = {};
    }

    const url = new URL(request.url);

    const username = String(
      body.Username ??
        body.username ??
        url.searchParams.get('Username') ??
        url.searchParams.get('username') ??
        ''
    ).trim();

    const password = String(
      body.Pw ??
        body.PW ??
        body.password ??
        body.Password ??
        url.searchParams.get('Pw') ??
        url.searchParams.get('password') ??
        ''
    );

    if (!username) {
      return embyError(400, 'Username is required');
    }

    const valid = await verifyCredentials(username, password);
    if (!valid) {
      // Emby 客户端靠 401 判断账号密码错误并提示用户
      return embyError(401, 'Invalid username or password');
    }

    const ctx = parseClientContext(request);
    const remoteEndPoint =
      request.headers.get('cf-connecting-ip') ||
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      '0.0.0.0';

    const session = await createSession(username, ctx, remoteEndPoint);
    const admin = await isAdminUser(username);
    const now = Date.now();

    const sessionInfo: EmbySessionInfo = {
      AdditionalUsers: [],
      Capabilities: {},
      RemoteEndPoint: session.RemoteEndPoint,
      Protocol: 'Http',
      PlayableMediaTypes: ['Video'],
      Id: session.Id,
      UserId: session.UserId,
      UserName: session.UserName,
      Client: session.Client,
      LastActivityDate: new Date(session.LastActivityDate).toISOString(),
      DeviceName: session.DeviceName,
      DeviceId: session.DeviceId,
      ApplicationVersion: session.ApplicationVersion,
      IsActive: true,
      SupportsRemoteControl: false,
      PlayState: {
        CanSeek: true,
        IsPaused: false,
        IsMuted: false,
        RepeatMode: 'RepeatNone',
        PlaybackRate: 1,
      },
    };

    const result: EmbyAuthenticationResult = {
      User: buildUserDto({
        id: session.UserId,
        name: username,
        isAdmin: admin,
        lastLogin: now,
        lastActivity: now,
      }),
      SessionInfo: sessionInfo,
      AccessToken: session.AccessToken,
      ServerId: getServerId(),
    };

    return embyJson(result, {
      headers: { 'X-Emby-Token': session.AccessToken },
    });
  } catch (err) {
    console.error('AuthenticateByName 失败:', err);
    return embyError(500, 'Authentication failed');
  }
}

export async function OPTIONS() {
  return embyOptions();
}
