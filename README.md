<div align="center">
  <img src="public/logo.png" alt="KatelyaTV Emby" width="128" />

  <h1>KatelyaTV Emby</h1>
  <p><strong>Emby 兼容影视聚合服务 · 部署在 Cloudflare Workers &amp; Pages</strong></p>
  <p>
    把聚合影视源封装成标准 <code>Emby Server API</code>，
    让 Infuse、Fileball、Yamby、Hills、Emby 官方客户端等
    <strong>主流播放软件直接连接使用</strong>。
  </p>

  <p>
    <a href="#-快速开始">🚀 快速开始</a> ·
    <a href="#-支持的客户端">📱 客户端</a> ·
    <a href="#-部署">☁️ 部署</a> ·
    <a href="#-环境变量">⚙️ 配置</a> ·
    <a href="#-api-说明">🔌 API</a>
  </p>
</div>

---

## 📰 项目说明

本项目由 KatelyaTV 改造而来，定位从「网页版聚合播放器」调整为
**Emby 协议兼容服务端**：

- ✅ 实现 Emby Server API，主流 Emby 客户端可直接把本站当服务器添加
- ✅ 只支持 **Cloudflare Workers / Pages** 部署，存储使用 **D1**
- ✅ 保留聚合搜索能力，作为 Emby 客户端的媒体库数据来源
- ❌ 已移除网页播放器、TVBox 兼容、Docker / Vercel / Redis / Kvrocks / Upstash 部署

> 之所以移除其他部署方式：Workers 运行时无法建立 Redis/Kvrocks 所需的
> TCP 长连接，Docker 与 Vercel 也不在目标部署范围内。

---

## ✨ 功能特性

### 🎬 Emby 协议兼容

- **标准登录**：`AuthenticateByName`，支持官方客户端与第三方客户端
- **媒体库**：电影 / 电视剧 / 动漫 / 综艺 / 纪录片 分类视图
- **完整浏览**：Items 列表、详情、分集、搜索、最新、继续观看
- **播放信息**：`PlaybackInfo` 下发 HLS 直连与代理地址
- **流媒体代理**：透传 Range 请求，支持拖动进度条；自动重写 m3u8 分片地址
- **进度同步**：起播 / 心跳 / 停止上报，支持续播与已看标记
- **收藏夹**：收藏与取消收藏，多设备同步
- **海报墙**：图片端点按需重定向或代理，兼容 http 源站

### 🎯 内容能力

- **聚合搜索**：多资源站并行检索，结果去重后入库
- **内容过滤**：可选过滤成人内容资源站
- **资源站管理**：网页后台 `/admin` 添加、导入、导出、排序、启停

---

## 📱 支持的客户端

原理上任何实现 Emby 协议的客户端都可连接，以下为常见且已验证的组合：

| 平台 | 客户端 |
| --- | --- |
| iOS / iPadOS | Infuse、Fileball、VidHub、Emby 官方 App |
| Android / Android TV | Emby 官方客户端、Yamby、Hills |
| Apple TV | Infuse、Emby 官方 |
| 桌面 | Emby Theater、Infuse (macOS) |

**接入步骤**：

1. 打开客户端，选择「添加服务器」
2. 服务器地址填写部署后的站点根地址，例如 `https://tv.example.com`
3. 输入 `USERNAME` / `AUTH_PASSWORD` 登录
4. 进入「我的媒体」浏览

> ⚠️ 地址填**站点根地址**，不需要加 `/emby` 后缀，客户端会自动拼接。

---

## 🚀 快速开始

### 前置要求

- Cloudflare 账号（免费版即可）
- Node.js 18+ 与 pnpm

### 一、创建并初始化 D1

```bash
npm install -g wrangler
wrangler login
wrangler d1 create katelyatv-emby
```

把返回的 `database_id` 填入 `wrangler.toml`，然后建表：

```bash
wrangler d1 execute katelyatv-emby --remote --file=./scripts/d1-init.sql
```

### 二、配置资源站

编辑 `config.json`：

```json
{
  "cache_time": 7200,
  "api_site": {
    "example": {
      "api": "https://your-api.com/api.php/provide/vod",
      "name": "示例资源站",
      "is_adult": false
    }
  }
}
```

> `config.json` 会在构建期内联进产物，修改后需重新部署。
> 也可在部署后通过 `/admin` 后台添加，配置将存入 D1 并优先生效。

### 三、部署

详见 **[Cloudflare Workers / Pages 部署指南](./CLOUDFLARE_PAGES_DEPLOYMENT.md)**。

命令行快速部署：

```bash
pnpm install
pnpm run deploy
```

### 四、验证

```bash
# 应返回包含 ServerName 的 JSON
curl https://你的域名/emby/System/Info/Public
```

---

## ☁️ 部署

本项目 **只支持 Cloudflare Workers & Pages**。

| 方式 | 命令 | 说明 |
| --- | --- | --- |
| Pages (Git) | `pnpm run pages:build` | 推荐，推送自动部署 |
| Workers / CLI | `pnpm run deploy` | 本地构建后部署 |
| 本地预览 | `pnpm run preview` | 启动本地 D1 与 Workers 运行时 |

**Pages 构建设置**：

```
Build command:           pnpm install --frozen-lockfile && pnpm run pages:build
Build output directory:  .vercel/output/static
Compatibility flags:     nodejs_compat
```

完整步骤见 [部署指南](./CLOUDFLARE_PAGES_DEPLOYMENT.md)。

### 已移除的部署方式

以下方式在当前版本中**已删除**，且不再提供配置示例：

- Docker / docker-compose（含 Redis、Kvrocks 组合）
- Vercel
- Redis / Kvrocks / Upstash 存储后端
- localstorage 单机模式
- TVBox 配置接口

---

## ⚙️ 环境变量

| 变量名 | 必填 | 说明 |
| --- | --- | --- |
| `USERNAME` | ✅ | Emby 登录用户名 |
| `AUTH_PASSWORD` | ✅ | Emby 登录密码（建议用 Secret 存储） |
| `SITE_NAME` | ❌ | 显示名称，同时作为 Emby 服务器名 |
| `EMBY_SERVER_ID` | ❌ | 固定服务器 Id（迁移时保持客户端不重复添加） |
| `EMBY_PROXY_IMAGES` | ❌ | `true` 时海报经本站代理转发 |
| `EMBY_ENABLE_API_KEY` | ❌ | `true` 时允许全局 API Key 直连 |
| `EMBY_API_KEY` | ❌ | 全局 API Key（配合上一项使用） |
| `NEXT_PUBLIC_ENABLE_REGISTER` | ❌ | 是否允许注册普通用户 |
| `NEXT_PUBLIC_SEARCH_MAX_PAGE` | ❌ | 单源搜索最大翻页数，默认 5 |
| `ANNOUNCEMENT` | ❌ | 首页公告文案 |

> Pages 中修改环境变量后需 **重新部署** 才会生效。

---

## 🔌 API 说明

服务端实现的主要 Emby 端点：

### 系统

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/emby/System/Info/Public` | 服务器公开信息（免鉴权） |
| GET | `/emby/System/Info` | 服务器完整信息 |

### 认证

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/emby/Users/AuthenticateByName` | 登录换取 AccessToken |
| GET | `/emby/Users/Public` | 公开用户列表（免鉴权） |
| GET | `/emby/Users/Me` | 当前用户信息 |
| POST | `/emby/Sessions/Logout` | 登出 |
| GET | `/emby/Sessions` | 在线会话列表 |

### 浏览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/emby/Users/{userId}/Views` | 媒体库列表 |
| GET | `/emby/UserViews` | 媒体库列表（别名） |
| GET | `/emby/Users/{userId}/Items` | 条目列表 / 搜索 |
| GET | `/emby/Users/{userId}/Items/{itemId}` | 条目详情 |
| GET | `/emby/Users/{userId}/Items/Latest` | 最新内容 |
| GET | `/emby/Users/{userId}/Items/Resume` | 继续观看 |

### 播放

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET/POST | `/emby/Items/{itemId}/PlaybackInfo` | 获取播放地址 |
| GET/HEAD | `/emby/Videos/{itemId}/stream` | 视频流（支持 Range） |
| GET | `/api/emby/stream/direct` | 直链代理 |
| GET | `/api/emby/stream/proxy` | HLS 分片代理 |

### 进度与收藏

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/emby/Sessions/Playing` | 起播上报 |
| POST | `/emby/Sessions/Playing/Progress` | 播放心跳 |
| POST | `/emby/Sessions/Playing/Stopped` | 停止上报 |
| GET | `/emby/Users/{userId}/FavoriteItems` | 收藏列表 |
| POST/DELETE | `/emby/Users/{userId}/FavoriteItems/{itemId}` | 收藏 / 取消 |

### 图片

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/emby/Items/{itemId}/Images/{imageType}` | 海报 / 背景图 |

---

## 🗂️ 项目结构

```
src/
├── app/
│   ├── emby/                  # Emby 协议端点
│   │   ├── System/            # 服务器信息
│   │   ├── Users/             # 认证、视图、条目、收藏
│   │   ├── Items/             # 条目 / 播放信息 / 图片
│   │   ├── Videos/            # 视频流
│   │   ├── Sessions/          # 会话与进度上报
│   │   └── DisplayPreferences/ # 界面偏好
│   ├── api/
│   │   ├── emby/stream/       # 播放代理
│   │   ├── admin/             # 管理后台接口
│   │   ├── login/ logout/     # 网页后台登录
│   │   └── register/          # 用户注册
│   ├── admin/                 # 管理后台页面
│   ├── login/ settings/ warning/
│   └── page.tsx               # 落地页
├── lib/
│   ├── emby.config.ts         # 服务器标识与用户策略
│   ├── emby.auth.ts           # Token / 会话鉴权
│   ├── emby.catalog.ts        # 媒体库与条目映射
│   ├── emby.playback.ts       # 播放信息构造
│   ├── emby.progress.ts       # 进度记录
│   ├── emby.items.ts          # 条目解析（回源）
│   ├── emby.http.ts           # 统一响应与 CORS
│   ├── emby.types.ts          # 协议类型定义
│   ├── d1.db.ts               # D1 存储实现
│   ├── db.ts                  # 存储入口（仅 D1）
│   ├── config.ts              # 配置管理
│   └── downstream.ts          # 聚合源适配
└── components/                # 管理后台组件
```

---

## 🛠️ 开发

```bash
pnpm install
pnpm dev            # 本地开发
pnpm typecheck      # 类型检查
pnpm lint           # 代码检查
pnpm gen:runtime    # 重新生成 config.json 内联配置
```

本地预览 Workers 运行时：

```bash
pnpm run db:init:local
pnpm run preview
```

---

## ❓ 常见问题

<details>
<summary><b>客户端提示无法连接服务器</b></summary>

1. 浏览器打开 `/emby/System/Info/Public`，确认返回 JSON
2. 确认客户端填的是站点根地址（不带 `/emby`）
3. 确认域名已开启 Cloudflare 代理

</details>

<details>
<summary><b>登录提示用户名或密码错误</b></summary>

确认 `USERNAME` 与 `AUTH_PASSWORD` 在 Production 和 Preview
两个环境都已设置，且修改后重新部署过。

</details>

<details>
<summary><b>媒体库是空的</b></summary>

聚合源没有全量片库，媒体库内容来自按分类关键词的实时搜索。
若为空，通常是 `config.json` 中的资源站不可用或未配置：

```bash
wrangler d1 execute katelyatv-emby --remote \
  --command "SELECT config_value FROM admin_configs WHERE config_key='main_config'"
```

在 `/admin` 后台添加可用资源站即可。

</details>

<details>
<summary><b>播放地址取不到 / 播放失败</b></summary>

- 聚合源不稳定或已失效时会出现，换源重试
- 源站防盗链严格时，设置 `EMBY_PROXY_IMAGES=true` 并确认代理路径可访问
- 部分源返回的播放地址需要解析，当前不支持

</details>

---

## 🔒 安全与合规

- 请务必设置强密码，避免站点被公开访问
- 本项目仅供个人学习与合法使用
- 所有内容来自第三方，本站不存储任何视频资源
- 请遵守所在地区法律法规，尊重版权

---

## 🙏 致谢

- [Next.js](https://nextjs.org/) — React 全栈框架
- [Cloudflare Workers / Pages / D1](https://cloudflare.com/) — 边缘运行与存储
- [Emby](https://emby.media/) — 协议参考
- [MoonTV](https://github.com/MoonTechLab/LunaTV) / [LibreTV](https://github.com/LibreSpark/LibreTV) — 项目启发

---

## 📄 开源协议

基于 **MIT License** 发布，详见 [LICENSE](./LICENSE)。

---

<div align="center">
  <p><strong>如果项目对您有帮助，请给个 ⭐ Star 支持一下！</strong></p>
  <p>
    <a href="https://github.com/katelya77/KatelyaTV">🏠 项目首页</a> ·
    <a href="https://github.com/katelya77/KatelyaTV/issues">🐛 问题反馈</a>
  </p>
</div>
