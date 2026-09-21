/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

import { AdminConfig } from './admin.types';
import { getStorage, isD1Available } from './db';
import runtimeConfig from './runtime';

/**
 * 配置层。
 *
 * 数据来源优先级：
 *   1. D1 中的 admin_configs（管理后台修改，最高优先级）
 *   2. config.json（构建期内联，作为初始值）
 *   3. 环境变量（站点名等）
 *
 * 本项目仅支持 Cloudflare Workers / Pages，因此不再有
 * Docker 动态读文件、Redis/Kvrocks/Upstash 等分支。
 */

export interface ApiSite {
  key: string;
  api: string;
  name: string;
  detail?: string;
}

interface ConfigFileStruct {
  cache_time?: number;
  api_site: {
    [key: string]: ApiSite & { is_adult?: boolean };
  };
}

export const API_CONFIG = {
  search: {
    path: '?ac=videolist&wd=',
    pagePath: '?ac=videolist&wd={query}&pg={page}',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'application/json',
    },
  },
  detail: {
    path: '?ac=videolist&ids=',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'application/json',
    },
  },
};

let cachedConfig: AdminConfig | null = null;

function fileConfig(): ConfigFileStruct {
  return (runtimeConfig as unknown as ConfigFileStruct) || { api_site: {} };
}

function defaultSiteName(): string {
  return process.env.SITE_NAME || 'KatelyaTV Emby';
}

function defaultAnnouncement(): string {
  return (
    process.env.ANNOUNCEMENT ||
    '本站为 Emby 兼容服务，所有内容均来自第三方网站。本站不存储任何视频资源，不对内容的准确性、合法性、完整性负责。'
  );
}

/** 由 config.json 构建初始管理配置 */
function buildDefaultConfig(): AdminConfig {
  const cfg = fileConfig();
  const apiSiteEntries = Object.entries(cfg.api_site || {});
  const ownerUser = process.env.USERNAME;

  const users: AdminConfig['UserConfig']['Users'] = ownerUser
    ? [{ username: ownerUser, role: 'owner' }]
    : [];

  return {
    SiteConfig: {
      SiteName: defaultSiteName(),
      Announcement: defaultAnnouncement(),
      SearchDownstreamMaxPage:
        Number(process.env.NEXT_PUBLIC_SEARCH_MAX_PAGE) || 5,
      SiteInterfaceCacheTime: cfg.cache_time || 7200,
      ImageProxy: process.env.NEXT_PUBLIC_IMAGE_PROXY || '',
      DoubanProxy: process.env.NEXT_PUBLIC_DOUBAN_PROXY || '',
    },
    UserConfig: {
      AllowRegister: process.env.NEXT_PUBLIC_ENABLE_REGISTER === 'true',
      Users: users,
    },
    SourceConfig: apiSiteEntries.map(([key, site]) => ({
      key,
      name: site.name,
      api: site.api,
      detail: site.detail,
      from: 'config' as const,
      disabled: false,
      is_adult: site.is_adult === true,
    })),
  };
}

/** 合并 config.json 中的源与数据库中的源 */
function mergeSources(adminConfig: AdminConfig): AdminConfig {
  const cfg = fileConfig();
  const apiSiteEntries = Object.entries(cfg.api_site || {});
  const existing = new Set((adminConfig.SourceConfig || []).map((s) => s.key));

  apiSiteEntries.forEach(([key, site]) => {
    if (!existing.has(key)) {
      adminConfig.SourceConfig.push({
        key,
        name: site.name,
        api: site.api,
        detail: site.detail,
        from: 'config',
        disabled: false,
        is_adult: site.is_adult === true,
      });
    }
  });

  // 不在 config.json 中的源标记为 custom，并同步 is_adult
  const apiSiteKeys = new Set(apiSiteEntries.map(([k]) => k));
  adminConfig.SourceConfig.forEach((source) => {
    if (!apiSiteKeys.has(source.key)) {
      source.from = 'custom';
    } else {
      const siteConfig = cfg.api_site[source.key];
      if (siteConfig) {
        source.is_adult = siteConfig.is_adult === true;
      }
    }
  });

  return adminConfig;
}

/** 确保 owner 用户存在且角色正确 */
function ensureOwner(adminConfig: AdminConfig, extraUsers: string[]): void {
  if (!adminConfig.UserConfig) {
    adminConfig.UserConfig = { AllowRegister: false, Users: [] };
  }
  if (!Array.isArray(adminConfig.UserConfig.Users)) {
    adminConfig.UserConfig.Users = [];
  }

  const ownerUser = process.env.USERNAME;
  const users = adminConfig.UserConfig.Users;

  // 非 owner 的 owner 角色降级
  users.forEach((u) => {
    if (u.username !== ownerUser && u.role === 'owner') {
      u.role = 'user';
    }
  });

  // 补全数据库中已存在但配置里没有的用户
  const known = new Set(users.map((u) => u.username));
  extraUsers.forEach((name) => {
    if (name && !known.has(name)) {
      users.push({ username: name, role: 'user' });
      known.add(name);
    }
  });

  if (ownerUser) {
    const idx = users.findIndex((u) => u.username === ownerUser);
    if (idx >= 0) {
      users[idx].role = 'owner';
    } else {
      users.unshift({ username: ownerUser, role: 'owner' });
    }
  }
}

/** 应用环境变量覆盖（环境变量优先级高于 DB 中的同名项） */
function applyEnvOverrides(adminConfig: AdminConfig): AdminConfig {
  adminConfig.SiteConfig.SiteName = defaultSiteName();
  adminConfig.SiteConfig.Announcement = defaultAnnouncement();
  adminConfig.UserConfig.AllowRegister =
    process.env.NEXT_PUBLIC_ENABLE_REGISTER === 'true';
  return adminConfig;
}

/** 读取全部用户（用于补全配置），失败返回空数组 */
async function safeGetAllUsers(): Promise<string[]> {
  try {
    const storage = getStorage();
    const users = await storage.getAllUsers();
    if (!Array.isArray(users)) return [];
    return users.map((u: any) =>
      typeof u === 'string' ? u : u.username
    ).filter(Boolean);
  } catch (e) {
    console.error('获取用户列表失败:', e);
    return [];
  }
}

/**
 * 获取管理配置。
 * D1 中没有配置时，用 config.json + 环境变量初始化并写回。
 */
export async function getConfig(): Promise<AdminConfig> {
  if (cachedConfig) {
    return cachedConfig;
  }

  // D1 未绑定（例如本地未配置）时直接用默认配置，避免整站不可用
  if (!isD1Available()) {
    const fallback = buildDefaultConfig();
    ensureOwner(fallback, []);
    cachedConfig = applyEnvOverrides(fallback);
    return cachedConfig;
  }

  try {
    const storage = getStorage();
    const userNames = await safeGetAllUsers();
    let adminConfig = await storage.getAdminConfig();

    if (adminConfig) {
      adminConfig = mergeSources(adminConfig);
      ensureOwner(adminConfig, userNames);
      cachedConfig = applyEnvOverrides(adminConfig);
    } else {
      const fresh = buildDefaultConfig();
      ensureOwner(fresh, userNames);
      cachedConfig = applyEnvOverrides(fresh);
      try {
        await storage.setAdminConfig(cachedConfig);
      } catch (err) {
        console.error('写入初始管理配置失败:', err);
      }
    }

    return cachedConfig;
  } catch (error) {
    console.error('读取管理配置失败，使用默认配置:', error);
    const fallback = buildDefaultConfig();
    ensureOwner(fallback, []);
    cachedConfig = applyEnvOverrides(fallback);
    return cachedConfig;
  }
}

/** 重置配置为 config.json + 环境变量的初始状态 */
export async function resetConfig(): Promise<void> {
  const fresh = buildDefaultConfig();
  const userNames = await safeGetAllUsers();
  ensureOwner(fresh, userNames);
  applyEnvOverrides(fresh);

  if (isD1Available()) {
    try {
      const storage = getStorage();
      await storage.setAdminConfig(fresh);
    } catch (err) {
      console.error('重置配置失败:', err);
    }
  }

  cachedConfig = fresh;
}

/** 清除内存缓存（管理后台保存后调用） */
export function invalidateConfigCache(): void {
  cachedConfig = null;
}

export async function getCacheTime(): Promise<number> {
  const config = await getConfig();
  return config.SiteConfig.SiteInterfaceCacheTime || 7200;
}

/** 获取可用源（可选过滤成人内容） */
export async function getAvailableApiSites(
  filterAdult = false
): Promise<ApiSite[]> {
  const config = await getConfig();

  if (!config.SourceConfig || !Array.isArray(config.SourceConfig)) {
    console.warn('SourceConfig 缺失，返回空列表');
    return [];
  }

  let sites = config.SourceConfig.filter((s) => !s.disabled).map((s) => ({
    ...s,
    is_adult: s.is_adult === true,
  }));

  if (filterAdult) {
    sites = sites.filter((s) => !s.is_adult);
  }

  return sites.map((s) => ({
    key: s.key,
    name: s.name,
    api: s.api,
    detail: s.detail,
  }));
}

/** 依据用户设置动态获取可用源 */
export async function getFilteredApiSites(userName?: string): Promise<ApiSite[]> {
  const config = await getConfig();

  if (!config.SourceConfig || !Array.isArray(config.SourceConfig)) {
    return [];
  }

  let shouldFilterAdult = true;
  if (userName) {
    try {
      const storage = getStorage();
      const userSettings = await storage.getUserSettings(userName);
      shouldFilterAdult = userSettings?.filter_adult_content !== false;
    } catch (error) {
      console.warn('读取用户设置失败，使用默认过滤:', error);
    }
  }

  let sites = config.SourceConfig.filter((s) => !s.disabled).map((s) => ({
    ...s,
    is_adult: s.is_adult === true,
  }));

  if (shouldFilterAdult) {
    sites = sites.filter((s) => !s.is_adult);
  }

  return sites.map((s) => ({
    key: s.key,
    name: s.name,
    api: s.api,
    detail: s.detail,
  }));
}

/** 获取成人内容资源站 */
export async function getAdultApiSites(): Promise<ApiSite[]> {
  const config = await getConfig();

  if (!config.SourceConfig || !Array.isArray(config.SourceConfig)) {
    return [];
  }

  return config.SourceConfig.filter(
    (s) => !s.disabled && s.is_adult === true
  ).map((s) => ({
    key: s.key,
    name: s.name,
    api: s.api,
    detail: s.detail,
  }));
}
