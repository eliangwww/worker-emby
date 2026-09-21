# Cloudflare Workers / Pages 部署指南

本项目是一个 **Emby 兼容服务端**，只支持 Cloudflare Workers & Pages 部署，
数据存储使用 **D1**。

> 其他部署方式（Docker / Vercel / Redis / Kvrocks / Upstash）已在
> 本版本中移除，因为 Workers 运行时无法建立这些后端所需的 TCP 长连接。

---

## 一、前置准备

1. 一个 Cloudflare 账号（免费版即可）
2. 已 Fork 或克隆本仓库
3. 本地安装 Node.js 18+ 与 pnpm

---

## 二、方式一：Cloudflare Pages（推荐）

### 1. 创建 D1 数据库

```bash
npm install -g wrangler
wrangler login
wrangler d1 create katelyatv-emby
```

命令会输出 `database_id`，把它填入 `wrangler.toml`：

```toml
[[d1_databases]]
binding = "DB"
database_name = "katelyatv-emby"
database_id = "这里粘贴你的真实 ID"
```

### 2. 初始化表结构

```bash
wrangler d1 execute katelyatv-emby --remote --file=./scripts/d1-init.sql
```

### 3. 连接 Git 仓库

Cloudflare Dashboard → **Workers & Pages** → **Create** → **Pages** →
**Connect to Git**，选择本仓库，然后填写：

| 配置项 | 值 |
| --- | --- |
| Framework preset | `Next.js` |
| Build command | `pnpm install --frozen-lockfile && pnpm run pages:build` |
| Build output directory | `.vercel/output/static` |

### 4. 设置兼容性标志

项目 Settings → **Functions** → **Compatibility flags**，
添加 `nodejs_compat`（`wrangler.toml` 中已声明）。

### 5. 绑定 D1

项目 Settings → **Functions** → **D1 database bindings**：

- Variable name: `DB`
- D1 database: `katelyatv-emby`

### 6. 配置环境变量

项目 Settings → **Environment variables**（Production 与 Preview 都要设置）：

| 变量名 | 必填 | 说明 |
| --- | --- | --- |
| `USERNAME` | ✅ | Emby 登录用户名，如 `admin` |
| `AUTH_PASSWORD` | ✅ | Emby 登录密码 |
| `SITE_NAME` | ❌ | 显示名称，同时作为 Emby 服务器名 |
| `EMBY_PROXY_IMAGES` | ❌ | `true` 时海报经本站代理（源站防盗链严格时开启） |
| `EMBY_ENABLE_API_KEY` | ❌ | `true` 时允许用全局 API Key 直连 |

> ⚠️ **`AUTH_PASSWORD` 必须设置**，否则登录无法通过。
> 建议使用 **Secret** 类型而非明文存储。

### 7. 重新部署

设置完成后触发一次 Redeploy 即可。

---

## 三、方式二：Wrangler 命令行部署

```bash
# 安装依赖
pnpm install

# 本地预览（会启动本地 D1）
pnpm run db:init:local
pnpm run preview

# 部署到生产
pnpm run deploy
```

使用命令行部署时，环境变量通过 secret 注入：

```bash
wrangler secret put AUTH_PASSWORD
wrangler secret put USERNAME
```

---

## 四、验证部署

浏览器打开以下地址（无需登录）：

- `https://你的域名/emby/System/Info/Public`
  应返回包含 `ServerName`、`Version`、`Id` 的 JSON。

然后在 Emby 客户端中添加服务器：

1. 服务器地址填 `https://你的域名`
2. 用户名/密码填上面配置的 `USERNAME` / `AUTH_PASSWORD`
3. 登录后进入「我的媒体」即可浏览

> 💡 部分客户端要求地址包含协议头，建议填写完整的 `https://...`。

---

## 五、常见问题

### 部署后访问 500

**原因**：`AUTH_PASSWORD` 未设置，或 D1 未绑定。

**排查**：

```bash
# 确认 D1 绑定
wrangler d1 list

# 确认表已初始化
wrangler d1 execute katelyatv-emby --remote --command "SELECT name FROM sqlite_master WHERE type='table'"
```

### 客户端提示「无法连接服务器」

1. 确认 `/emby/System/Info/Public` 能正常打开
2. 确认地址填写的是**站点根地址**（不要带 `/emby` 后缀）
3. 若使用自定义域名，确认已开启 Cloudflare 代理（橙色云朵）

### 登录提示「用户名或密码错误」

- 确认 `USERNAME` / `AUTH_PASSWORD` 在 **Production 和 Preview 两个环境**都已设置
- 若使用 Pages，修改环境变量后必须**重新部署**才生效

### 播放卡顿或无法播放

- 源站可能有防盗链，尝试设置 `EMBY_PROXY_IMAGES=true` 或检查源站可用性
- 聚合源画质与稳定性取决于上游，与本站无关

### 媒体库为空

聚合源没有「全量片库」概念，媒体库内容来自按分类关键词的实时搜索。
若为空，说明当前配置的资源站不可用或未配置：

```bash
# 确认已有源
cat config.json
```

可在管理后台 `/admin` 添加或导入资源站。

---

## 六、更新部署

```bash
# 同步上游代码后
git pull

# 重新安装依赖并部署
pnpm install
pnpm run deploy
```

数据库结构如有变更，重新执行初始化脚本（使用 `IF NOT EXISTS`，可安全重复执行）：

```bash
pnpm run db:init
```
