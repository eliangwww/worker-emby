/* eslint-disable no-console, @typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion */

import { EmbyServerInfo, EmbyUserDto, EmbyUserPolicy } from './emby.types';

/** Emby 协议版本：主流客户端按 4.8 特性集握手最稳定 */
export const EMBY_VERSION = '4.8.8.0';
/** Emby API 兼容版本号（客户端用于能力协商） */
export const EMBY_API_VERSION = '4.8.8.0';

/**
 * 稳定的服务器 Id。
 * Emby 客户端会把 (ServerId + UserId) 作为本地数据库主键，若该值每次
 * 部署都变化，客户端会重复添加服务器。因此优先取环境变量，其次由
 * 站点名称派生一个稳定的 GUID。
 */
export function getServerId(): string {
  const fromEnv = process.env.EMBY_SERVER_ID;
  if (fromEnv && fromEnv.trim()) {
    return fromEnv.trim();
  }
  return deriveGuid(process.env.SITE_NAME || 'KatelyaTV-Emby');
}

/** 由任意字符串派生一个稳定的 GUID 形态字符串 */
export function deriveGuid(seed: string): string {
  // FNV-1a 变体，产出 32 位十六进制，拼成 GUID 形态
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < seed.length; i++) {
    const c = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c + i, 0x85ebca6b) >>> 0;
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
  const a = hex(h1);
  const b = hex(h2);
  const c = hex(Math.imul(h1, 0x9e3779b1) >>> 0);
  const d = hex(Math.imul(h2, 0xc2b2ae35) >>> 0);
  const raw = (a + b + c + d).slice(0, 32);
  return [
    raw.slice(0, 8),
    raw.slice(8, 12),
    '4' + raw.slice(13, 16),
    'a' + raw.slice(17, 20),
    raw.slice(20, 32),
  ].join('-');
}

/** 站点对外展示名称（同时作为 Emby 服务器名） */
export function getSiteName(): string {
  return process.env.SITE_NAME || 'KatelyaTV';
}

/** 管理员用户名（Emby 登录账号） */
export function getAdminUsername(): string {
  return process.env.USERNAME || 'admin';
}

/** 管理员密码 */
export function getAdminPassword(): string {
  return process.env.AUTH_PASSWORD || '';
}

/**
 * 是否允许客户端仅凭 API Key 访问（部分客户端/脚本使用 X-Emby-Token
 * 直连，不经过 AuthenticateByName）。默认关闭以保证安全。
 */
export function isApiKeyAuthEnabled(): boolean {
  return process.env.EMBY_ENABLE_API_KEY === 'true';
}

/** 全局 API Key（EMBY_API_KEY 未设置时由密码派生） */
export function getApiKey(): string {
  return process.env.EMBY_API_KEY || '';
}

/** 构建用户的 Emby Policy */
export function buildUserPolicy(isAdmin: boolean): EmbyUserPolicy {
  return {
    IsAdministrator: isAdmin,
    IsHidden: false,
    IsDisabled: false,
    EnableAllFolders: true,
    EnabledFolders: [],
    EnableRemoteAccess: true,
    EnableMediaPlayback: true,
    EnableAudioPlaybackTranscoding: true,
    EnableVideoPlaybackTranscoding: true,
    EnablePlaybackRemuxing: true,
    EnableContentDownloading: true,
    EnableSyncTranscoding: true,
    EnableVideoPlaybackDirectStream: true,
    EnableSubtitleDownloading: true,
    EnableSubtitleManagement: true,
    EnableLiveTvAccess: false,
    EnableLiveTvManagement: false,
    EnableSharedDeviceControl: false,
    BlockedChannels: [],
    AllowedChannels: [],
    BlockedTags: [],
    AllowedTags: [],
    BlockUnratedItems: [],
    EnabledDevices: [],
    EnabledChannels: [],
  };
}

/** 构建 Emby 用户对象 */
export function buildUserDto(opts: {
  id: string;
  name: string;
  isAdmin: boolean;
  lastLogin?: number;
  lastActivity?: number;
}): EmbyUserDto {
  return {
    Name: opts.name,
    ServerId: getServerId(),
    Id: opts.id,
    HasPassword: true,
    HasConfiguredPassword: true,
    HasConfiguredEasyPassword: false,
    EnableAutoLogin: false,
    LastLoginDate: opts.lastLogin
      ? new Date(opts.lastLogin).toISOString()
      : undefined,
    LastActivityDate: opts.lastActivity
      ? new Date(opts.lastActivity).toISOString()
      : undefined,
    Configuration: {
      PlayDefaultAudioTrack: true,
      SubtitleLanguagePreference: 'chi',
      DisplayMissingEpisodes: false,
      GroupedFolders: [],
      SubtitleMode: 'Default',
      DisplayCollectionsView: false,
      EnableLocalPassword: false,
      OrderedViews: [],
      LatestItemsExcludes: [],
      MyMediaExcludes: [],
      HidePlayedInLatest: false,
      RememberAudioSelections: true,
      RememberSubtitleSelections: true,
      EnableNextEpisodeAutoPlay: true,
    },
    Policy: buildUserPolicy(opts.isAdmin),
  };
}

/** /System/Info/Public 响应 */
export function buildPublicSystemInfo(baseUrl: string): Record<string, any> {
  const name = getSiteName();
  return {
    LocalAddress: baseUrl,
    LocalAddresses: [baseUrl],
    WanAddress: baseUrl,
    ServerName: name,
    Version: EMBY_VERSION,
    Id: getServerId(),
    OperatingSystem: 'Linux',
    StartupWizardCompleted: true,
  };
}

/** /System/Info 响应（已认证） */
export function buildSystemInfo(baseUrl: string): EmbyServerInfo {
  const name = getSiteName();
  return {
    Name: name,
    ServerName: name,
    Version: EMBY_VERSION,
    ServerVersion: EMBY_VERSION,
    Id: getServerId(),
    OperatingSystem: 'Linux',
    OperatingSystemDisplayName: 'Cloudflare Workers',
    Os: 'Linux',
    HasPendingRestart: false,
    IsShuttingDown: false,
    SupportsLibraryMonitor: false,
    SupportsRemoteControl: false,
    SupportsSync: false,
    WebSocketPortNumber: 0,
    CanSelfRestart: false,
    CanLaunchWebBrowser: false,
    ProgramDataPath: '/data',
    LocalAddress: baseUrl,
    LocalAddresses: [baseUrl],
    StartupWizardCompleted: true,
  };
}

/**
 * 从请求推导对外 baseUrl。
 * Cloudflare 上 request.url 通常是内部地址，需要优先使用
 * X-Forwarded-Proto / Host 头，否则海报与播放地址会拼错。
 */
export function resolveBaseUrl(request: Request): string {
  const url = new URL(request.url);
  const proto =
    request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() ||
    url.protocol.replace(':', '');
  const host =
    request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() ||
    request.headers.get('host') ||
    url.host;
  return `${proto}://${host}`;
}

/** Emby 时间单位：1 tick = 100 纳秒，1 秒 = 10,000,000 ticks */
export const TICKS_PER_SECOND = 10_000_000;

export function secondsToTicks(seconds: number): number {
  return Math.max(0, Math.round(seconds * TICKS_PER_SECOND));
}

export function ticksToSeconds(ticks: number): number {
  return Math.max(0, Math.floor(ticks / TICKS_PER_SECOND));
}
