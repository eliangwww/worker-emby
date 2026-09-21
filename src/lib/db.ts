/* eslint-disable no-console, @typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion */

import { AdminConfig } from './admin.types';
import { D1Storage } from './d1.db';
import { Favorite, IStorage, PlayRecord } from './types';

/**
 * 存储层。
 *
 * 本项目只支持 Cloudflare Workers / Pages 部署，因此存储固定为 D1。
 * 早期版本支持的 redis / kvrocks / upstash / localstorage 已移除，
 * 这些后端在 Workers 运行时不可用（无法建立 TCP/长连接）。
 */

// 单例存储实例
let storageInstance: IStorage | null = null;

/** D1 是否可用（Pages/Workers 通过全局绑定注入） */
export function isD1Available(): boolean {
  if (typeof globalThis !== 'undefined' && (globalThis as any).DB) {
    return true;
  }
  return !!process.env.DB;
}

/** 创建存储实例；D1 不可用时抛出明确错误而不是静默降级 */
function createStorage(): IStorage {
  if (!isD1Available()) {
    throw new Error(
      'D1 数据库未绑定。请在 wrangler.toml 中配置 [[d1_databases]] binding = "DB"，' +
        '或在 Cloudflare Pages 控制台为项目添加 D1 绑定。'
    );
  }
  return new D1Storage();
}

export function getStorage(): IStorage {
  if (!storageInstance) {
    storageInstance = createStorage();
  }
  return storageInstance;
}

// 工具函数：生成存储key
export function generateStorageKey(source: string, id: string): string {
  return `${source}+${id}`;
}

// 导出便捷方法
export class DbManager {
  private storage: IStorage;

  constructor() {
    this.storage = getStorage();
  }

  // 播放记录相关方法
  async getPlayRecord(
    userName: string,
    source: string,
    id: string
  ): Promise<PlayRecord | null> {
    const key = generateStorageKey(source, id);
    return this.storage.getPlayRecord(userName, key);
  }

  async savePlayRecord(
    userName: string,
    source: string,
    id: string,
    record: PlayRecord
  ): Promise<void> {
    const key = generateStorageKey(source, id);
    await this.storage.setPlayRecord(userName, key, record);
  }

  async getAllPlayRecords(userName: string): Promise<{
    [key: string]: PlayRecord;
  }> {
    return this.storage.getAllPlayRecords(userName);
  }

  async deletePlayRecord(
    userName: string,
    source: string,
    id: string
  ): Promise<void> {
    const key = generateStorageKey(source, id);
    await this.storage.deletePlayRecord(userName, key);
  }

  // 收藏相关方法
  async getFavorite(
    userName: string,
    source: string,
    id: string
  ): Promise<Favorite | null> {
    const key = generateStorageKey(source, id);
    return this.storage.getFavorite(userName, key);
  }

  async saveFavorite(
    userName: string,
    source: string,
    id: string,
    favorite: Favorite
  ): Promise<void> {
    const key = generateStorageKey(source, id);
    await this.storage.setFavorite(userName, key, favorite);
  }

  async getAllFavorites(
    userName: string
  ): Promise<{ [key: string]: Favorite }> {
    return this.storage.getAllFavorites(userName);
  }

  async deleteFavorite(
    userName: string,
    source: string,
    id: string
  ): Promise<void> {
    const key = generateStorageKey(source, id);
    await this.storage.deleteFavorite(userName, key);
  }

  async isFavorited(
    userName: string,
    source: string,
    id: string
  ): Promise<boolean> {
    const favorite = await this.getFavorite(userName, source, id);
    return favorite !== null;
  }

  // ---------- 用户相关 ----------
  async registerUser(userName: string, password: string): Promise<void> {
    await this.storage.registerUser(userName, password);
  }

  async verifyUser(userName: string, password: string): Promise<boolean> {
    return this.storage.verifyUser(userName, password);
  }

  async checkUserExist(userName: string): Promise<boolean> {
    return this.storage.checkUserExist(userName);
  }

  // ---------- 搜索历史 ----------
  async getSearchHistory(userName: string): Promise<string[]> {
    return this.storage.getSearchHistory(userName);
  }

  async addSearchHistory(userName: string, keyword: string): Promise<void> {
    await this.storage.addSearchHistory(userName, keyword);
  }

  async deleteSearchHistory(userName: string, keyword?: string): Promise<void> {
    await this.storage.deleteSearchHistory(userName, keyword);
  }

  // 获取全部用户
  async getAllUsers(): Promise<string[]> {
    if (typeof (this.storage as any).getAllUsers === 'function') {
      const users = await (this.storage as any).getAllUsers();
      // D1Storage.getAllUsers 返回对象数组，这里统一成用户名数组
      return Array.isArray(users)
        ? users.map((u: any) => (typeof u === 'string' ? u : u.username))
        : [];
    }
    return [];
  }

  // ---------- 管理员配置 ----------
  async getAdminConfig(): Promise<AdminConfig | null> {
    if (typeof (this.storage as any).getAdminConfig === 'function') {
      return (this.storage as any).getAdminConfig();
    }
    return null;
  }

  async saveAdminConfig(config: AdminConfig): Promise<void> {
    if (typeof (this.storage as any).setAdminConfig === 'function') {
      await (this.storage as any).setAdminConfig(config);
    }
  }

  // ---------- Emby 会话 / 进度 / 收藏 ----------
  async setEmbySession(session: any): Promise<void> {
    await (this.storage as any).setEmbySession(session);
  }

  async getEmbySessionByToken(token: string): Promise<any> {
    return (this.storage as any).getEmbySessionByToken?.(token) ?? null;
  }

  async getAllEmbySessions(): Promise<any[]> {
    return (await (this.storage as any).getAllEmbySessions?.()) ?? [];
  }

  async getAllEmbyPlayback(userId: string): Promise<any[]> {
    return (await (this.storage as any).getAllEmbyPlayback?.(userId)) ?? [];
  }

  async getEmbyPlayback(userId: string, itemId: string): Promise<any> {
    return (this.storage as any).getEmbyPlayback?.(userId, itemId) ?? null;
  }

  async setEmbyPlayback(record: any): Promise<void> {
    await (this.storage as any).setEmbyPlayback?.(record);
  }

  async getAllEmbyFavorites(userId: string): Promise<string[]> {
    return (await (this.storage as any).getAllEmbyFavorites?.(userId)) ?? [];
  }

  async setEmbyFavorite(userId: string, itemId: string): Promise<void> {
    await (this.storage as any).setEmbyFavorite?.(userId, itemId);
  }

  async deleteEmbyFavorite(userId: string, itemId: string): Promise<void> {
    await (this.storage as any).deleteEmbyFavorite?.(userId, itemId);
  }
}

// 导出便捷实例。
// 必须延迟构造：模块加载时 D1 绑定可能尚未注入（例如构建期收集页面数据），
// 若在此处直接 new 会抛出「D1 未绑定」并导致构建失败。
let dbInstance: DbManager | null = null;

export function getDb(): DbManager {
  if (!dbInstance) {
    dbInstance = new DbManager();
  }
  return dbInstance;
}

/** 延迟初始化的默认实例（首次属性访问时才创建存储） */
export const db: DbManager = new Proxy({} as DbManager, {
  get(_target, prop: string | symbol) {
    const instance = getDb() as any;
    const value = instance[prop];
    return typeof value === 'function' ? value.bind(instance) : value;
  },
});
