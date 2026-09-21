/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Emby Server API 协议类型定义。
 *
 * 目标：让主流 Emby 客户端（Infuse、Fileball、Yamby、Hills、Emby 官方
 * Android/iOS/TV 客户端、SenPlayer、VidHub 等）能够直接把本站当作
 * 一台 Emby Server 添加使用。
 *
 * 客户端接入流程：
 *   1. GET  /emby/System/Info/Public        -> 判断服务器是否可连
 *   2. POST /emby/Users/AuthenticateByName  -> 登录换 AccessToken
 *   3. GET  /emby/Users/{userId}/Views      -> 媒体库列表
 *   4. GET  /emby/Users/{userId}/Items      -> 浏览条目
 *   5. POST /emby/Items/{id}/PlaybackInfo   -> 取播放地址
 *   6. GET  /emby/Videos/{id}/stream        -> 播放
 */

/** Emby 客户端期望的 Server 信息结构 */
export interface EmbyServerInfo {
  Name: string;
  Version: string;
  Id: string;
  ServerName?: string;
  OperatingSystem: string;
  OperatingSystemDisplayName: string;
  Os: string;
  HasPendingRestart: boolean;
  IsShuttingDown: boolean;
  SupportsLibraryMonitor: boolean;
  SupportsRemoteControl: boolean;
  SupportsSync: boolean;
  WebSocketPortNumber: number;
  CanSelfRestart: boolean;
  CanLaunchWebBrowser: boolean;
  ProgramDataPath: string;
  LocalAddress: string;
  StartupWizardCompleted: boolean;
  LocalAddresses?: string[];
  ServerVersion?: string;
}

/** 匿名可见的服务器信息（/System/Info/Public） */
export interface EmbyPublicSystemInfo {
  LocalAddress: string;
  LocalAddresses: string[];
  WanAddress: string;
  ServerName: string;
  Version: string;
  Id: string;
  OperatingSystem: string;
  StartupWizardCompleted: boolean;
}

/** Emby 用户对象 */
export interface EmbyUserDto {
  Name: string;
  ServerId: string;
  Id: string;
  HasPassword: boolean;
  HasConfiguredPassword: boolean;
  HasConfiguredEasyPassword: boolean;
  EnableAutoLogin?: boolean;
  LastLoginDate?: string;
  LastActivityDate?: string;
  PrimaryImageTag?: string;
  Configuration?: EmbyUserConfiguration;
  Policy?: EmbyUserPolicy;
}

export interface EmbyUserConfiguration {
  PlayDefaultAudioTrack: boolean;
  SubtitleLanguagePreference: string;
  DisplayMissingEpisodes: boolean;
  GroupedFolders: string[];
  SubtitleMode: string;
  DisplayCollectionsView: boolean;
  EnableLocalPassword: boolean;
  OrderedViews: string[];
  LatestItemsExcludes: string[];
  MyMediaExcludes: string[];
  HidePlayedInLatest: boolean;
  RememberAudioSelections: boolean;
  RememberSubtitleSelections: boolean;
  EnableNextEpisodeAutoPlay: boolean;
  AudioLanguagePreference?: string;
}

export interface EmbyUserPolicy {
  IsAdministrator: boolean;
  IsHidden: boolean;
  IsDisabled: boolean;
  EnableAllFolders: boolean;
  EnabledFolders: string[];
  EnableRemoteAccess: boolean;
  EnableMediaPlayback: boolean;
  EnableAudioPlaybackTranscoding: boolean;
  EnableVideoPlaybackTranscoding: boolean;
  EnablePlaybackRemuxing: boolean;
  EnableContentDownloading: boolean;
  EnableSyncTranscoding: boolean;
  EnableVideoPlaybackDirectStream: boolean;
  EnableSubtitleDownloading: boolean;
  EnableSubtitleManagement: boolean;
  EnableLiveTvAccess: boolean;
  EnableLiveTvManagement: boolean;
  EnableSharedDeviceControl: boolean;
  BlockedChannels: string[];
  AllowedChannels: string[];
  BlockedTags: string[];
  AllowedTags: string[];
  BlockUnratedItems: string[];
  EnabledDevices: string[];
  EnabledChannels: string[];
}

/** 认证结果（AuthenticateByName / Users/Me 返回） */
export interface EmbyAuthenticationResult {
  User: EmbyUserDto;
  SessionInfo: EmbySessionInfo;
  AccessToken: string;
  ServerId: string;
}

export interface EmbySessionInfo {
  PlayState?: EmbyPlayerStateInfo;
  AdditionalUsers: unknown[];
  Capabilities?: Record<string, unknown>;
  RemoteEndPoint: string;
  Protocol: string;
  PlayableMediaTypes: string[];
  Id: string;
  UserId: string;
  UserName: string;
  Client: string;
  LastActivityDate: string;
  DeviceName: string;
  DeviceId: string;
  ApplicationVersion: string;
  IsActive: boolean;
  SupportsRemoteControl: boolean;
}

export interface EmbyPlayerStateInfo {
  PositionTicks?: number;
  CanSeek: boolean;
  IsPaused: boolean;
  IsMuted: boolean;
  AudioStreamIndex?: number;
  SubtitleStreamIndex?: number;
  VolumeLevel?: number;
  PlayMethod?: string;
  RepeatMode: string;
  PlaybackRate: number;
}

/** 媒体库视图 */
export interface EmbyUserView {
  Name: string;
  ServerId: string;
  Id: string;
  Guid?: string;
  DateCreated?: string;
  SortName?: string;
  ExternalUrls?: unknown[];
  Channels?: unknown[];
  CollectionType?: string;
  ImageTags?: Record<string, string>;
  Type: string;
  LocationType?: string;
  IsFolder: boolean;
}

/** 通用查询结果容器 */
export interface EmbyQueryResult<T> {
  Items: T[];
  TotalRecordCount: number;
  StartIndex?: number;
}

/** 媒体条目（Movie / Series / Episode / Folder） */
export interface EmbyBaseItemDto {
  Name: string;
  ServerId: string;
  Id: string;
  DateCreated?: string;
  SortName?: string;
  PremiereDate?: string;
  ProductionYear?: number;
  Overview?: string;
  OfficialRating?: string;
  CommunityRating?: number;
  RunTimeTicks?: number;
  Type: 'Movie' | 'Series' | 'Season' | 'Episode' | 'Folder' | 'CollectionFolder';
  CollectionType?: string;
  ImageTags?: Record<string, string>;
  BackdropImageTags?: string[];
  ParentBackdropImageTags?: string[];
  ParentBackdropItemId?: string;
  ImageBlurHashes?: Record<string, any>;
  MediaType?: string;
  IsFolder: boolean;
  ParentId?: string;
  SeriesId?: string;
  SeriesName?: string;
  SeasonId?: string;
  SeasonName?: string;
  IndexNumber?: number;
  ParentIndexNumber?: number;
  UserData?: EmbyUserItemData;
  LocationType?: string;
  Container?: string;
  MediaSources?: EmbyMediaSourceInfo[];
  GenreItems?: { Name: string; Id: string }[];
  Genres?: string[];
  Studios?: { Name: string; Id: string }[];
  People?: EmbyBaseItemPerson[];
  Path?: string;
  PlayAccess?: string;
  LocalTrailerCount?: number;
  SpecialFeatureCount?: number;
  RecursiveItemCount?: number;
  ChildCount?: number;
  Status?: string;
  AirDays?: string[];
  ProviderIds?: Record<string, string>;
}

export interface EmbyBaseItemPerson {
  Name: string;
  Id: string;
  Role: string;
  Type: 'Actor' | 'Director' | 'Writer' | 'Producer' | 'GuestStar';
  PrimaryImageTag?: string;
}

/** 用户播放状态（进度、已看等） */
export interface EmbyUserItemData {
  PlaybackPositionTicks: number;
  PlayCount: number;
  IsFavorite: boolean;
  Played: boolean;
  Key: string;
  LastPlayedDate?: string;
  PlayedPercentage?: number;
  UnplayedItemCount?: number;
  ItemId: string;
  ServerId?: string;
}

/** 播放源信息（PlaybackInfo 返回） */
export interface EmbyMediaSourceInfo {
  Protocol: string;
  Id: string;
  Path: string;
  Type: string;
  Container: string;
  Size?: number;
  Name?: string;
  IsRemote: boolean;
  ETag?: string;
  RunTimeTicks?: number;
  ReadAtNativeFramerate: boolean;
  IgnoreDts: boolean;
  IgnoreIndex: boolean;
  GenPtsInput: boolean;
  SupportsTranscoding: boolean;
  SupportsDirectStream: boolean;
  SupportsDirectPlay: boolean;
  IsInfiniteStream: boolean;
  RequiresOpening: boolean;
  RequiresClosing: boolean;
  RequiresLooping: boolean;
  SupportsProbing: boolean;
  MediaStreams?: EmbyMediaStream[];
  MediaAttachments?: unknown[];
  Formats?: string[];
  Bitrate?: number;
  RequiredHttpHeaders?: Record<string, string>;
  TranscodingUrl?: string;
  TranscodingSubProtocol?: string;
  TranscodingContainer?: string;
  DefaultAudioStreamIndex?: number;
  DefaultSubtitleStreamIndex?: number;
}

export interface EmbyMediaStream {
  Codec?: string;
  Language?: string;
  ColorTransfer?: string;
  ColorPrimaries?: string;
  ColorSpace?: string;
  DisplayTitle?: string;
  Type: 'Video' | 'Audio' | 'Subtitle' | 'EmbeddedImage';
  Index: number;
  IsExternal?: boolean;
  DeliveryMethod?: string;
  DeliveryUrl?: string;
  IsExternalUrl?: boolean;
  IsDefault?: boolean;
  IsForced?: boolean;
  Height?: number;
  Width?: number;
  AverageFrameRate?: number;
  RealFrameRate?: number;
  BitRate?: number;
  Channels?: number;
  SampleRate?: number;
  ChannelLayout?: string;
  SupportsExternalStream?: boolean;
  IsTextSubtitleStream?: boolean;
  SupportsSubtitleConversionToText?: boolean;
}

/** PlaybackInfo 响应 */
export interface EmbyPlaybackInfoResponse {
  MediaSources: EmbyMediaSourceInfo[];
  PlaySessionId: string;
  ErrorCode?: string;
}

/** 播放进度上报 */
export interface EmbyPlaybackProgressInfo {
  CanSeek: boolean;
  ItemId: string;
  IsPaused: boolean;
  IsMuted: boolean;
  PositionTicks?: number;
  PlayMethod?: string;
  PlaySessionId?: string;
  RepeatMode?: string;
  MediaSourceId?: string;
  AudioStreamIndex?: number;
  SubtitleStreamIndex?: number;
  VolumeLevel?: number;
  EventName?: string;
}

/** 服务器内部维护的客户端会话 */
export interface EmbySessionRecord {
  Id: string;
  UserId: string;
  UserName: string;
  AccessToken: string;
  DeviceId: string;
  DeviceName: string;
  Client: string;
  ApplicationVersion: string;
  RemoteEndPoint: string;
  CreatedAt: number;
  LastActivityDate: number;
}

/** 播放进度记录（用于 Continue Watching） */
export interface EmbyPlaybackRecord {
  UserId: string;
  ItemId: string;
  PositionTicks: number;
  Played: boolean;
  PlayCount: number;
  LastPlayedDate: number;
  UpdatedAt: number;
}
