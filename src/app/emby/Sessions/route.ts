import { listSessions } from '@/lib/emby.auth';
import { embyJson, withEmbyAuth } from '@/lib/emby.http';
import { EmbySessionInfo } from '@/lib/emby.types';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/**
 * GET /emby/Sessions
 *
 * 返回当前在线的客户端会话。
 * 部分客户端（以及 Emby 的「控制其他设备」功能）会调用。
 */
export const GET = withEmbyAuth(async () => {
  const sessions = await listSessions();

  const items: EmbySessionInfo[] = sessions.map((s) => ({
    AdditionalUsers: [],
    Capabilities: {},
    RemoteEndPoint: s.RemoteEndPoint,
    Protocol: 'Http',
    PlayableMediaTypes: ['Video'],
    Id: s.Id,
    UserId: s.UserId,
    UserName: s.UserName,
    Client: s.Client,
    LastActivityDate: new Date(s.LastActivityDate).toISOString(),
    DeviceName: s.DeviceName,
    DeviceId: s.DeviceId,
    ApplicationVersion: s.ApplicationVersion,
    // 只有近期有活动的会话才算在线
    IsActive: Date.now() - s.LastActivityDate < 5 * 60 * 1000,
    SupportsRemoteControl: false,
  }));

  return embyJson(items);
});
