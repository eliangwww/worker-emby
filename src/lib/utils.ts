/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

/**
 * 通用工具函数。
 *
 * 网页播放器已移除，因此这里不再包含 hls.js 相关的清晰度探测逻辑。
 */

/** 获取图片代理 URL 设置（管理后台使用） */
export function getImageProxyUrl(): string | null {
  if (typeof window === 'undefined') return null;

  const enableImageProxy = localStorage.getItem('enableImageProxy');
  if (enableImageProxy !== null) {
    if (!(JSON.parse(enableImageProxy) as boolean)) {
      return null;
    }
  }

  const localImageProxy = localStorage.getItem('imageProxyUrl');
  if (localImageProxy != null) {
    return localImageProxy.trim() ? localImageProxy.trim() : null;
  }

  const serverImageProxy = (window as any).RUNTIME_CONFIG?.IMAGE_PROXY;
  return serverImageProxy && serverImageProxy.trim()
    ? serverImageProxy.trim()
    : null;
}

/** 处理图片 URL，如设置了图片代理则走代理 */
export function processImageUrl(originalUrl: string): string {
  if (!originalUrl) return originalUrl;

  const proxyUrl = getImageProxyUrl();
  if (!proxyUrl) return originalUrl;

  return `${proxyUrl}${encodeURIComponent(originalUrl)}`;
}

/**
 * 清除 HTML 标签，保留可读文本。
 * 聚合源的简介字段包含大量标签，进入 Emby Overview 前必须清洗。
 */
export function cleanHtmlTags(text: string): string {
  if (!text) return '';
  return text
    .replace(/<[^>]+>/g, '\n')
    .replace(/\n+/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/^\n+|\n+$/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim();
}
