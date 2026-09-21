-- KatelyaTV Emby 服务 · D1 数据库初始化脚本
-- 适用于 Cloudflare Workers / Pages (D1)
--
-- 执行方式：
--   wrangler d1 execute katelyatv-emby --file=./scripts/d1-init.sql
--   wrangler d1 execute katelyatv-emby --remote --file=./scripts/d1-init.sql

-- 用户表（Emby 登录使用，owner 账号由环境变量提供，无需写入本表）
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Emby 客户端会话表（AccessToken -> 用户/设备）
CREATE TABLE IF NOT EXISTS emby_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  access_token TEXT UNIQUE NOT NULL,
  device_id TEXT,
  device_name TEXT,
  client TEXT,
  application_version TEXT,
  remote_end_point TEXT,
  created_at INTEGER NOT NULL,
  last_activity_date INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_emby_sessions_token ON emby_sessions(access_token);
CREATE INDEX IF NOT EXISTS idx_emby_sessions_user ON emby_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_emby_sessions_device ON emby_sessions(user_id, device_id);

-- Emby 播放进度表（用于 Continue Watching / 已看标记）
CREATE TABLE IF NOT EXISTS emby_playback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  position_ticks INTEGER DEFAULT 0,
  played INTEGER DEFAULT 0,
  play_count INTEGER DEFAULT 0,
  last_played_date INTEGER,
  updated_at INTEGER NOT NULL,
  UNIQUE (user_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_emby_playback_user ON emby_playback(user_id);
CREATE INDEX IF NOT EXISTS idx_emby_playback_updated ON emby_playback(user_id, updated_at DESC);

-- 收藏表（Emby 收藏夹 /api/emby/Users/{id}/FavoriteItems）
CREATE TABLE IF NOT EXISTS emby_favorites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_emby_favorites_user ON emby_favorites(user_id);

-- 播放记录表（兼容网页端历史，保留）
CREATE TABLE IF NOT EXISTS play_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  key TEXT NOT NULL,
  title TEXT,
  source_name TEXT,
  cover TEXT,
  year TEXT,
  index_episode INTEGER DEFAULT 0,
  total_episodes INTEGER DEFAULT 0,
  play_time REAL DEFAULT 0,
  total_time REAL DEFAULT 0,
  save_time INTEGER DEFAULT 0,
  search_title TEXT,
  UNIQUE (username, key)
);
CREATE INDEX IF NOT EXISTS idx_play_records_user ON play_records(username);

-- 收藏表（网页端格式，保留兼容）
CREATE TABLE IF NOT EXISTS favorites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  key TEXT NOT NULL,
  title TEXT,
  source_name TEXT,
  cover TEXT,
  year TEXT,
  total_episodes INTEGER DEFAULT 0,
  save_time INTEGER DEFAULT 0,
  search_title TEXT,
  UNIQUE (username, key)
);
CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(username);

-- 用户设置表（内容过滤等）
CREATE TABLE IF NOT EXISTS user_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  settings TEXT,
  updated_time INTEGER
);

-- 管理员配置表
CREATE TABLE IF NOT EXISTS admin_configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  config_key TEXT UNIQUE NOT NULL,
  config_value TEXT,
  description TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO admin_configs (config_key, config_value, description) VALUES
('site_name', 'KatelyaTV', '站点名称'),
('cache_ttl', '3600', '缓存时间（秒）');
