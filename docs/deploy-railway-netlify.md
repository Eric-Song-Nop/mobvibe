# Mobvibe 部署指南 (Railway + Netlify)

本文档描述如何将 Mobvibe 部署到云端：
- **Gateway 服务 + PostgreSQL**: 部署到 Railway
- **WebUI 前端**: 部署到 Netlify

## 架构概览

```
┌─────────────────────────┐     HTTPS      ┌──────────────────────────────┐
│        Netlify          │◄──────────────►│         Railway              │
│  (WebUI 静态站点)        │                │  ┌────────────────────────┐  │
│  https://your-app.      │                │  │     Gateway Server     │  │
│     netlify.app         │                │  │     (Express +         │  │
└─────────────────────────┘                │  │      Socket.io)        │  │
                                           │  └───────────┬────────────┘  │
                                           │              │               │
                                           │  ┌───────────▼────────────┐  │
                                           │  │     PostgreSQL         │  │
                                           │  │     (数据库)            │  │
                                           │  └────────────────────────┘  │
                                           └──────────────────────────────┘
```

## 前置准备

1. [Railway](https://railway.app/) 账号
2. [Netlify](https://netlify.com/) 账号
3. GitHub 仓库（代码已推送）
4. 本地已安装 pnpm

---

## 第一部分：Railway 部署 (Gateway + PostgreSQL)

### 1.1 创建 Railway 项目

1. 登录 [Railway Dashboard](https://railway.app/dashboard)
2. 点击 **"New Project"**
3. 选择 **"Deploy from GitHub repo"**
4. 连接你的 GitHub 账号并选择 `mobvibe` 仓库

### 1.2 添加 PostgreSQL 数据库

1. 在项目中点击 **"+ New"**
2. 选择 **"Database"** → **"Add PostgreSQL"**
3. Railway 会自动创建数据库并生成 `DATABASE_URL`

### 1.3 配置 Gateway 服务

项目已包含 Railway 配置文件：
- `railway.json` - 根目录，配置 Dockerfile 构建
- `apps/gateway/Dockerfile` - 多阶段构建镜像

Railway 会自动检测这些文件并正确构建。

**如需手动配置**，在 Railway 项目中：
1. 点击 Gateway 服务
2. 进入 **Settings** → **Build**
3. 确认:
   - **Root Directory**: `/` (项目根目录)
   - **Dockerfile Path**: `apps/gateway/Dockerfile`

### 1.4 配置环境变量

在 Railway Gateway 服务的 **Variables** 标签页中添加：

| 变量名 | 值 | 说明 |
|--------|-----|------|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | 引用 PostgreSQL 服务 |
| `PORT` | `3005` | Gateway 端口 |
| `GATEWAY_CORS_ORIGINS` | `https://your-app.netlify.app` | 允许的 CORS 来源 |
| `SITE_URL` | `https://your-gateway.railway.app` | Gateway 的公开 URL |
| `BETTER_AUTH_SECRET` | `<随机生成的密钥>` | 用于会话签名 |

可选的 OAuth 变量（如需社交登录）：
| 变量名 | 值 | 说明 |
|--------|-----|------|
| `GITHUB_CLIENT_ID` | `<GitHub OAuth App ID>` | GitHub 登录 |
| `GITHUB_CLIENT_SECRET` | `<GitHub OAuth Secret>` | GitHub 登录 |
| `GOOGLE_CLIENT_ID` | `<Google OAuth ID>` | Google 登录 |
| `GOOGLE_CLIENT_SECRET` | `<Google OAuth Secret>` | Google 登录 |

#### 生成 BETTER_AUTH_SECRET

```bash
openssl rand -base64 32
```

### 1.5 数据库迁移

**自动迁移（默认）**

Dockerfile 已配置为启动时自动运行迁移：
- 当 `DATABASE_URL` 存在时，自动执行 `drizzle-kit push`
- 迁移完成后启动服务器

无需手动操作，部署时会自动同步数据库 schema。

**手动迁移（可选）**

如需在本地手动运行迁移：

```bash
# 安装 Railway CLI
npm install -g @railway/cli

# 登录并链接项目
railway login
railway link

# 在 Railway 环境中运行迁移
railway run --service gateway pnpm db:push
```

### 1.6 配置自定义域名（可选）

1. 在 Railway Gateway 服务中进入 **Settings** → **Networking**
2. 点击 **"Generate Domain"** 获取 `*.railway.app` 域名
3. 或点击 **"Add Custom Domain"** 添加自己的域名

记下 Gateway 的公开 URL（如 `https://mobvibe-gateway.railway.app`）。

### 1.7 验证 Gateway 部署

```bash
# 健康检查
curl https://your-gateway.railway.app/health

# 预期响应
{"status":"ok","cliCount":0}
```

---

## 第二部分：Netlify 部署 (WebUI)

### 2.1 创建 Netlify 站点

1. 登录 [Netlify Dashboard](https://app.netlify.com/)
2. 点击 **"Add new site"** → **"Import an existing project"**
3. 选择 GitHub 并连接 `mobvibe` 仓库

### 2.2 配置构建设置

项目已包含 Netlify 配置文件 `apps/webui/netlify.toml`，包含：
- 构建命令和发布目录配置
- Node.js 版本设置 (v22)
- SPA 路由重定向规则

**只需在 Netlify 设置中配置**：

| 设置项 | 值 |
|--------|-----|
| **Base directory** | `apps/webui` |

其他设置会从 `netlify.toml` 自动读取。

### 2.3 配置环境变量

在 **Site configuration** → **Environment variables** 中添加：

| 变量名 | 值 | 说明 |
|--------|-----|------|
| `VITE_GATEWAY_URL` | `https://your-gateway.railway.app` | Gateway 的公开 URL |

### 2.6 触发部署

1. 推送代码到 GitHub
2. Netlify 会自动触发构建
3. 或在 Netlify Dashboard 手动点击 **"Trigger deploy"**

### 2.7 验证 WebUI 部署

访问你的 Netlify URL（如 `https://your-app.netlify.app`），应该能看到 Mobvibe 界面。

---

## 第三部分：配置 CORS 和安全性

### 3.1 更新 Railway Gateway CORS

部署完 Netlify 后，需要更新 Gateway 的 CORS 配置：

1. 在 Railway 的 Gateway 服务中更新环境变量
2. 设置 `GATEWAY_CORS_ORIGINS` 为 Netlify 的完整 URL

```
GATEWAY_CORS_ORIGINS=https://your-app.netlify.app
```

如有多个域名，用逗号分隔：

```
GATEWAY_CORS_ORIGINS=https://your-app.netlify.app,https://custom-domain.com
```

### 3.2 更新 Better Auth 配置

确保 Gateway 的 `SITE_URL` 正确设置，这会影响 OAuth 回调：

```
SITE_URL=https://your-gateway.railway.app
```

---

## 第四部分：CLI 连接配置

本地运行的 `mobvibe-cli` 需要连接到云端 Gateway：

```bash
# 启动 CLI daemon，指向 Railway Gateway
cd apps/mobvibe-cli
./bin/mobvibe.mjs start --gateway https://your-gateway.railway.app

# 登录（如果启用了认证）
./bin/mobvibe.mjs login --webui https://your-app.netlify.app

# 检查状态
./bin/mobvibe.mjs status
```

---

## 第五部分：故障排除

### Gateway 部署失败

1. 检查 Railway 构建日志
2. 确保 `Dockerfile` 路径正确
3. 验证 `pnpm-lock.yaml` 已提交

### 数据库连接失败

1. 验证 `DATABASE_URL` 格式正确
2. 检查 PostgreSQL 服务是否运行
3. 查看 Gateway 日志中的数据库错误

```bash
# Railway CLI 查看日志
railway logs --service gateway
```

### CORS 错误

1. 确认 `GATEWAY_CORS_ORIGINS` 包含 Netlify URL
2. URL 不要有末尾斜杠
3. 确保使用 HTTPS

### WebUI 无法连接 Gateway

1. 检查浏览器控制台的网络请求
2. 验证 `VITE_GATEWAY_URL` 环境变量
3. 确认 Gateway 健康检查通过

### Socket.io 连接问题

1. 确保 Railway 没有限制 WebSocket
2. 检查是否有代理/防火墙拦截
3. 查看浏览器控制台的 WebSocket 错误

---

## 第六部分：环境变量完整参考

### Railway Gateway 环境变量

| 变量名 | 必需 | 说明 |
|--------|------|------|
| `DATABASE_URL` | 是 | PostgreSQL 连接字符串 |
| `PORT` | 否 | 服务端口（默认 3005） |
| `GATEWAY_CORS_ORIGINS` | 是 | 允许的 CORS 来源 |
| `SITE_URL` | 是 | Gateway 公开 URL |
| `BETTER_AUTH_SECRET` | 是 | 会话签名密钥 |
| `GITHUB_CLIENT_ID` | 否 | GitHub OAuth |
| `GITHUB_CLIENT_SECRET` | 否 | GitHub OAuth |
| `GOOGLE_CLIENT_ID` | 否 | Google OAuth |
| `GOOGLE_CLIENT_SECRET` | 否 | Google OAuth |

### Netlify WebUI 环境变量

| 变量名 | 必需 | 说明 |
|--------|------|------|
| `VITE_GATEWAY_URL` | 是 | Gateway 的公开 URL |

> 注：`NODE_VERSION=22` 已在 `apps/webui/netlify.toml` 中配置

---

## 第七部分：更新和维护

### 自动部署

- **Railway**: 推送到 main 分支自动部署 Gateway
- **Netlify**: 推送到 main 分支自动部署 WebUI

### 手动部署

```bash
# Railway
railway up --service gateway

# Netlify
netlify deploy --prod
```

### 数据库更新

当 `apps/gateway/src/db/schema.ts` 变更时：

1. 提交代码并推送到 GitHub
2. Railway 重新部署时会自动运行 `drizzle-kit push`
3. 数据库 schema 自动同步

> 注：`drizzle-kit push` 适用于开发和小型生产环境。
> 对于需要精细控制迁移的场景，可使用 `pnpm db:generate` 生成迁移文件。

---

## 附录：Railway 项目结构示例

```
Railway Project
├── Gateway (Service)
│   ├── Source: GitHub repo
│   ├── Dockerfile: apps/gateway/Dockerfile
│   └── Environment Variables
│       ├── DATABASE_URL → ${{Postgres.DATABASE_URL}}
│       ├── GATEWAY_CORS_ORIGINS
│       ├── SITE_URL
│       └── BETTER_AUTH_SECRET
│
└── PostgreSQL (Database)
    └── Auto-generated DATABASE_URL
```

## 附录：项目中的部署配置文件

```
mobvibe/
├── railway.json                    # Railway 构建配置
├── apps/
│   ├── gateway/
│   │   ├── Dockerfile              # Gateway Docker 镜像
│   │   └── drizzle.config.ts       # 数据库迁移配置
│   └── webui/
│       ├── netlify.toml            # Netlify 构建配置
│       └── public/
│           └── _redirects          # SPA 路由重定向
```

## 附录：快速检查清单

- [ ] Railway PostgreSQL 服务已创建
- [ ] Railway Gateway 服务已部署
- [ ] Gateway 健康检查通过 (`/health`)
- [ ] 数据库 schema 已推送
- [ ] Netlify WebUI 构建成功
- [ ] `VITE_GATEWAY_URL` 指向正确的 Gateway
- [ ] `GATEWAY_CORS_ORIGINS` 包含 Netlify URL
- [ ] WebUI 可以连接到 Gateway（检查浏览器控制台）
