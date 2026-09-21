/* eslint-disable no-console, @typescript-eslint/no-explicit-any */

import { imageTagFor, registerItemId } from './emby.catalog';
import { getServerId, secondsToTicks } from './emby.config';
import {
  EmbyMediaSourceInfo,
  EmbyMediaStream,
  EmbyPlaybackInfoResponse,
} from './emby.types';
import { SearchResult } from './types';

/**
 * 播放层。
 *
 * 聚合源的播放地址多为 m3u8（HLS）。主流 Emby 客户端对
 * SupportsDirectStream / SupportsTranscoding 的处理差异很大：
 *
 *  - Infuse / Fileball / VidHub 等：直接请求 PlaybackInfo 里给出的
 *    TranscodingUrl 或直链，自身解码能力很强。
 *  - Emby 官方客户端：会依据 MediaSources 的 Container、
 *    SupportsDirectPlay 判断是否需要转码。
 *
 * 策略：统一声明为 HLS (Container=m3u8, Protocol=Http)，同时提供
 * 直链与一个本站代理地址，由客户端自行选择。这样无需真实转码
 * 就能让绝大多数客户端正常起播。
 */

/** 判断 URL 是否 HLS */
export function isHls(url: string): boolean {
  return /\.m3u8(\?|$)/i.test(url) || /\/hls\//i.test(url);
}

/** 从 URL 猜测容器 */
export function guessContainer(url: string): string {
  if (isHls(url)) return 'm3u8';
  const m = url.match(/\.(mp4|mkv|ts|flv|avi|mov|webm|m4v)(\?|$)/i);
  return m ? m[1].toLowerCase() : 'mp4';
}

/** 播放地址解析结果 */
export interface ResolvedStream {
  url: string;
  container: string;
  isHls: boolean;
}

/**
 * 解析一个分集的真实播放地址。
 * 支持直接 http(s) 链接；对需要解析的（如网盘/解析接口）暂不处理，
 * 由上层过滤。
 */
export function resolveStreamUrl(rawUrl: string): ResolvedStream | null {
  if (!rawUrl) return null;
  const url = rawUrl.trim();
  if (!/^https?:\/\//i.test(url)) return null;
  return { url, container: guessContainer(url), isHls: isHls(url) };
}

/**
 * 构造 MediaSource。
 *
 * @param opts.itemId       条目 Id（用于代理路径）
 * @param opts.source       源站 key
 * @param opts.sourceId     源站条目 id
 * @param opts.episodeIndex 分集序号（从 1 开始）
 * @param opts.stream       已解析的播放地址
 * @param opts.title        展示名
 * @param opts.baseUrl      本站 baseUrl（生成代理地址）
 * @param opts.durationSec  时长（秒），未知则用默认值
 */
export function buildMediaSource(opts: {
  itemId: string;
  source: string;
  sourceId: string;
  episodeIndex?: number;
  stream: ResolvedStream;
  title: string;
  baseUrl: string;
  durationSec?: number;
}): EmbyMediaSourceInfo {
  const {
    itemId,
    source,
    sourceId,
    episodeIndex,
    stream,
    title,
    baseUrl,
    durationSec,
  } = opts;

  registerItemId(itemId, source, sourceId);

  const mediaSourceId = buildMediaSourceId(source, sourceId, episodeIndex);
  const duration = durationSec && durationSec > 0 ? durationSec : 45 * 60;

  // 本站代理地址：解决部分客户端无法直连源站（防盗链/UA/CORS）的问题
  const proxyUrl = buildProxyUrl(baseUrl, source, sourceId, episodeIndex);
  // 转码/直连统一走代理，客户端把 api_key 交给本站即可
  const transcodeUrl = buildTranscodeUrl(
    baseUrl,
    mediaSourceId,
    source,
    sourceId,
    episodeIndex,
    stream.container
  );

  return {
    Protocol: 'Http',
    Id: mediaSourceId,
    Path: stream.url,
    Type: 'Default',
    Container: stream.container,
    Name: title,
    IsRemote: true,
    RunTimeTicks: secondsToTicks(duration),
    ReadAtNativeFramerate: false,
    IgnoreDts: true,
    IgnoreIndex: true,
    GenPtsInput: false,
    // HLS 源声明支持直连/直通，客户端不会强制要求转码
    SupportsTranscoding: true,
    SupportsDirectStream: true,
    SupportsDirectPlay: !stream.isHls,
    IsInfiniteStream: false,
    RequiresOpening: false,
    RequiresClosing: false,
    RequiresLooping: false,
    SupportsProbing: true,
    MediaStreams: buildMediaStreams(stream),
    MediaAttachments: [],
    Formats: [],
    RequiredHttpHeaders: {},
    TranscodingUrl: transcodeUrl,
    TranscodingSubProtocol: 'http',
    TranscodingContainer: stream.container === 'm3u8' ? 'ts' : 'mp4',
    DefaultAudioStreamIndex: 1,
    DefaultSubtitleStreamIndex: -1,
  };
}

/** 稳定的 MediaSourceId，客户端用它回传播放进度 */
export function buildMediaSourceId(
  source: string,
  sourceId: string,
  episodeIndex?: number
): string {
  const suffix = episodeIndex && episodeIndex > 0 ? `:${episodeIndex}` : '';
  return `${source}:${sourceId}${suffix}`;
}

/** 解析 MediaSourceId */
export function parseMediaSourceId(
  mediaSourceId: string
): { source: string; sourceId: string; episodeIndex?: number } | null {
  if (!mediaSourceId) return null;
  const parts = mediaSourceId.split(':');
  if (parts.length < 2) return null;
  const [source, sourceId, ep] = parts;
  return {
    source,
    sourceId,
    episodeIndex: ep ? Number(ep) : undefined,
  };
}

/**
 * 媒体流声明。
 * 不声明视频流具体编码，避免客户端因为编码不匹配而拒绝播放；
 * 仅给出容器与基础信息，并提供一个外部字幕占位。
 */
function buildMediaStreams(stream: ResolvedStream): EmbyMediaStream[] {
  const streams: EmbyMediaStream[] = [
    {
      Type: 'Video',
      Index: 0,
      Codec: stream.isHls ? 'h264' : guessVideoCodec(stream.container),
      DisplayTitle: stream.isHls ? 'HLS' : stream.container.toUpperCase(),
      IsDefault: true,
      IsExternal: false,
      SupportsExternalStream: false,
      DeliveryMethod: 'Encode',
      IsExternalUrl: false,
      Width: 1920,
      Height: 1080,
    },
    {
      Type: 'Audio',
      Index: 1,
      Codec: 'aac',
      Language: 'chi',
      DisplayTitle: '中文 - AAC',
      IsDefault: true,
      IsExternal: false,
      SupportsExternalStream: false,
      Channels: 2,
      ChannelLayout: 'stereo',
      SampleRate: 44100,
      DeliveryMethod: 'Encode',
      IsExternalUrl: false,
    },
  ];
  return streams;
}

function guessVideoCodec(container: string): string {
  switch (container) {
    case 'mkv':
    case 'webm':
      return 'hevc';
    default:
      return 'h264';
  }
}

/** 本站代理播放地址（客户端可用作直链） */
export function buildProxyUrl(
  baseUrl: string,
  source: string,
  sourceId: string,
  episodeIndex?: number
): string {
  const params = new URLSearchParams({ source, id: sourceId });
  if (episodeIndex && episodeIndex > 0) {
    params.set('ep', String(episodeIndex));
  }
  return `${baseUrl}/api/emby/stream/direct?${params.toString()}`;
}

/**
 * 构造客户端可用的 TranscodingUrl。
 * Emby 客户端会把 api_key 追加到该地址后请求，
 * 因此这里指向本站的统一播放端点。
 */
export function buildTranscodeUrl(
  baseUrl: string,
  mediaSourceId: string,
  source: string,
  sourceId: string,
  episodeIndex: number | undefined,
  container: string
): string {
  const params = new URLSearchParams({
    MediaSourceId: mediaSourceId,
    source,
    id: sourceId,
    Static: 'true',
    Container: container,
  });
  if (episodeIndex && episodeIndex > 0) {
    params.set('ep', String(episodeIndex));
  }
  return `${baseUrl}/api/emby/videos/stream?${params.toString()}`;
}

/** 构造 PlaybackInfo 响应 */
export function buildPlaybackInfo(opts: {
  itemId: string;
  mediaSources: EmbyMediaSourceInfo[];
}): EmbyPlaybackInfoResponse {
  return {
    MediaSources: opts.mediaSources,
    PlaySessionId: `${opts.itemId}-${Date.now().toString(36)}`,
  };
}

/**
 * 把搜索结果 + 指定分集转换为 MediaSource。
 * 找不到该分集时返回 null。
 */
export function buildMediaSourceFromResult(opts: {
  result: SearchResult;
  itemId: string;
  episodeIndex?: number;
  baseUrl: string;
  durationSec?: number;
}): EmbyMediaSourceInfo | null {
  const { result, itemId, episodeIndex, baseUrl, durationSec } = opts;

  const episodes = result.episodes || [];
  if (!episodes.length) return null;

  // episodeIndex 从 1 开始（Emby 约定）；缺省取第 1 集
  const idx = episodeIndex && episodeIndex > 0 ? episodeIndex - 1 : 0;
  const raw = episodes[idx] ?? episodes[0];
  const stream = resolveStreamUrl(raw);
  if (!stream) return null;

  const title =
    episodes.length > 1
      ? `${result.title} 第 ${idx + 1} 集`
      : result.title;

  return buildMediaSource({
    itemId,
    source: result.source,
    sourceId: result.id,
    episodeIndex: episodes.length > 1 ? idx + 1 : undefined,
    stream,
    title,
    baseUrl,
    durationSec,
  });
}

/** 图片 tag（供海报 URL 使用） */
export { imageTagFor };

/** ServerId 透传，便于外部构造条目 */
export { getServerId };
