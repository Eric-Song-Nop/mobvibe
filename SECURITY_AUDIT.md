# Mobvibe 安全审计报告

**审计日期**: 2026-02-08
**审计范围**: 全仓库 (gateway, webui, mobvibe-cli, packages)
**审计方法**: 静态代码分析 + 依赖漏洞扫描

---

## 一、审计摘要

| 类别 | 严重 (Critical) | 高危 (High) | 中危 (Medium) | 低危 (Low) | 信息 (Info) |
|------|:-:|:-:|:-:|:-:|:-:|
| 认证与授权 | 0 | 2 | 2 | 1 | 0 |
| API 端点安全 | 0 | 1 | 1 | 0 | 0 |
| WebSocket 安全 | 0 | 1 | 1 | 0 | 0 |
| 数据库安全 | 0 | 0 | 0 | 1 | 0 |
| 前端安全 | 0 | 0 | 1 | 0 | 0 |
| 秘钥与配置 | 0 | 0 | 1 | 1 | 0 |
| 依赖漏洞 | 0 | 4 | 6 | 0 | 0 |
| CLI 安全 | 0 | 1 | 1 | 0 | 0 |
| **合计** | **0** | **9** | **13** | **3** | **0** |

---

## 二、高危发现 (High)

### H-1: Session/FS 路由使用 `optionalAuth` 而非 `requireAuth`，允许未认证访问

**位置**: `apps/gateway/src/routes/sessions.ts:55`, `apps/gateway/src/routes/fs.ts:47`

**描述**: ACP 会话路由和文件系统路由使用 `optionalAuth` 中间件。当请求不携带认证凭据时，`userId` 为 `undefined`，代码回退到返回**所有用户**的会话和数据。

```typescript
// sessions.ts:58-63
router.get("/sessions", (request, response) => {
    const userId = getUserId(request);
    const sessions = userId
        ? cliRegistry.getSessionsForUser(userId)
        : cliRegistry.getAllSessions(); // ← 未认证时返回全部
    response.json({ sessions });
});
```

类似地在 `SessionRouter` 中：当 `userId` 为 `undefined` 时，所有授权检查被跳过。

**影响**: 未认证用户可以查看所有会话、发送消息、关闭/取消任意会话、浏览远程机器的文件系统。

**建议**: 所有操作类路由应改用 `requireAuth` 中间件，或在 `userId` 为空时拒绝请求。将 `optionalAuth` 仅限于真正不需要认证的只读端点（如 health check）。

---

### H-2: `/health` 和 `/status` 端点无需认证且泄露内部信息

**位置**: `apps/gateway/src/routes/health.ts:4-29`

**描述**: `/status` 端点返回所有已连接 CLI 的详细信息，包括 `machineId`、`hostname`、`version`、`connectedAt`，以及所有会话的完整列表。无需任何认证。

```typescript
router.get("/status", (_request, response) => {
    const clis = cliRegistry.getAllClis();
    response.json({
        clis: clis.map((cli) => ({
            machineId: cli.machineId,
            hostname: cli.hostname,
            version: cli.version,
            connectedAt: cli.connectedAt.toISOString(),
            sessionCount: cli.sessions.length,
        })),
        sessions: cliRegistry.getAllSessions(),
    });
});
```

**影响**: 攻击者可通过 `/status` 端点枚举所有用户的机器名、主机名、会话信息，为进一步攻击提供侦察数据。

**建议**: `/status` 端点应要求认证，或至少限制返回的信息量。`/health` 可以保持公开但只返回 `{ok: true}`。

---

### H-3: SSE 流端点手动设置 CORS 头，绕过全局 CORS 中间件

**位置**: `apps/gateway/src/routes/machines.ts:134-139`

**描述**: `/api/machines/stream` 的 SSE 处理器直接将请求中的 `origin` 头反射回 `Access-Control-Allow-Origin`，没有对 origin 进行验证：

```typescript
const origin = req.headers.origin;
if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");
}
```

**影响**: 任意网站可以通过 CSRF 方式订阅 SSE 流，获取用户的机器状态更新（因为 `credentials: true`，浏览器会自动附带 cookie）。

**建议**: 删除手动 CORS 设置，或将其替换为白名单验证逻辑（与全局 CORS 配置保持一致）。

---

### H-4: Socket.io CORS 配置过于宽松，接受所有 RFC 1918 私有 IP

**位置**: `apps/gateway/src/index.ts:43-84`

**描述**: Socket.io 的 CORS 回调对所有私有 IP 段（10.x.x.x, 192.168.x.x, 172.16-31.x.x）无条件放行。在共享网络环境中（如公司 WiFi、云 VPC），同网络下的任何设备都可建立 WebSocket 连接。

**影响**: 在共享网络环境中，局域网内的恶意设备可以连接到 WebSocket 并窃取会话数据。

**建议**: 仅保留 localhost (127.0.0.1, ::1) 的宽松策略，其他私有 IP 需通过显式配置白名单。

---

### H-5: CLI `AcpConnection.createTerminal` 执行任意命令

**位置**: `apps/mobvibe-cli/src/acp/acp-connection.ts:490-589`

**描述**: `createTerminal` 方法接收来自 ACP agent 的 `command`、`args`、`cwd` 和 `env` 参数，直接调用 `spawn()` 执行：

```typescript
const child = spawn(params.command, params.args ?? [], {
    cwd: params.cwd ?? undefined,
    env: resolvedEnv ? { ...process.env, ...resolvedEnv } : process.env,
});
```

虽然这是 ACP 协议的设计目的（代理需要执行工具调用），但网关中的权限请求(permission:request)机制是用户批准工具调用的唯一防线。如果 permission handler 未配置或被绕过，agent 可以在用户机器上执行任意命令。

**影响**: 如果权限系统被绕过或用户不慎批准，恶意 agent 可在用户机器上执行任意命令。

**建议**: 考虑添加命令白名单/黑名单机制；确保默认 permission handler 在无法获取用户决策时拒绝（当前已默认返回 `cancelled`，这是正确的）。

---

### H-6: CLI 文件系统操作缺少路径遍历保护

**位置**: `apps/mobvibe-cli/src/daemon/socket-client.ts:527-580`

**描述**: `rpc:hostfs:entries` 和 `rpc:fs:file` 处理器接收任意路径，直接调用 `readDirectoryEntries(requestPath)` 和 `fs.readFile(resolved, "utf8")`。虽然 session 级别的文件操作会基于 `record.cwd` 解析路径，但 `rpc:hostfs:entries` 接受的 `path` 参数无限制，可以读取机器上的任何目录。

对于 session 级别的 `rpc:fs:entries` 和 `rpc:fs:file`，虽然路径会基于 `cwd` 解析，但绝对路径会直接使用，不会检查是否在 session 的 cwd 之下：

```typescript
const resolved = path.isAbsolute(requestPath)
    ? requestPath        // ← 绝对路径直接使用
    : path.join(record.cwd, requestPath);
```

**影响**: 通过 WebUI 或 API，攻击者可以读取 CLI 机器上的任意文件，包括 `~/.ssh/`, `/etc/passwd` 等敏感文件。

**建议**:
- `rpc:hostfs:entries` 应限制在用户 home 目录及其子目录下
- session 级别的文件操作应验证解析后的路径在 session cwd 之内（使用 `path.resolve()` + `startsWith()` 检查）
- 拒绝符号链接指向 cwd 外部的路径

---

## 三、中危发现 (Medium)

### M-1: API Key 速率限制被禁用

**位置**: `apps/gateway/src/lib/auth.ts:111-113`

**描述**: Better Auth 的 API Key 插件配置中，速率限制被显式禁用：

```typescript
apiKey({
    rateLimit: {
        enabled: false,
    },
}),
```

**影响**: API key 可以无限频率调用，容易被暴力攻击或滥用。

**建议**: 启用速率限制，建议配置合理的请求频率上限。

---

### M-2: Cookie `sameSite` 在生产环境设为 `none`

**位置**: `apps/gateway/src/lib/auth.ts:96`

**描述**: 生产环境下 cookie 属性 `sameSite` 设为 `"none"`：

```typescript
defaultCookieAttributes: {
    secure: !isDevelopment,
    sameSite: isDevelopment ? "lax" : "none",
},
```

虽然这是为了支持跨域场景（Tauri app 访问网关），但 `sameSite: none` 意味着浏览器会在跨站请求中发送 cookie。

**影响**: 增加 CSRF 攻击面。任何第三方网站发起的跨站请求都会自动携带认证 cookie。

**建议**: 如果跨域需求仅限于 Tauri 应用，考虑在浏览器场景下使用 `lax`，仅在 Tauri 场景下使用 `none`。或者使用 API key 替代 cookie 认证进行跨域请求。

---

### M-3: WebUI Socket.io 连接认证为可选

**位置**: `apps/gateway/src/socket/webui-handlers.ts:103-139`

**描述**: WebUI 的 Socket.io 命名空间没有强制认证中间件。连接建立后才在 `connection` 事件中检查 cookie，且认证失败不会断开连接：

```typescript
webuiNamespace.on("connection", async (socket) => {
    // Authenticate via handshake cookies
    try {
        // ... validation logic
        if (session?.user) {
            authSocket.data.userId = session.user.id;
        } else {
            logger.warn({ socketId: socket.id }, "webui_auth_missing_session");
            // ← 未断开连接，继续允许操作
        }
    }
    // ...
});
```

未认证的 WebSocket 连接在后续操作中 `userId` 为 `undefined`，这与 H-1 中发现的问题相同，会导致操作回退到返回所有用户的数据。

**影响**: 未认证用户可以通过 WebSocket 订阅任意会话、接收事件流、发送权限决策。

**建议**: 像 `/cli` 命名空间一样，在 `webuiNamespace.use()` 中添加强制认证中间件。认证失败时应拒绝连接。

---

### M-4: `BETTER_AUTH_SECRET` 未在配置中显式要求

**位置**: `apps/gateway/src/config.ts`

**描述**: 网关配置文件中没有对 `BETTER_AUTH_SECRET` 环境变量进行任何显式检查或要求。Better Auth 库内部会使用此变量来签名 session token。如果此变量未设置，Better Auth 可能会回退到不安全的默认值或启动失败。

**建议**: 在 `getGatewayConfig()` 中添加对 `BETTER_AUTH_SECRET` 的显式检查，确保在未设置时立即报错退出。

---

### M-5: WebUI 通过 `window.location` 动态构造网关 URL

**位置**: `apps/webui/src/lib/gateway-config.ts:37`

**描述**: 当 `VITE_GATEWAY_URL` 未设置时，WebUI 使用 `window.location` 动态构造网关 URL：

```typescript
return `${window.location.protocol}//${window.location.hostname}:3005`;
```

**影响**: 如果 WebUI 被部署在非预期的域名下（例如通过 DNS 劫持或中间人攻击），API 请求会被发送到攻击者控制的服务器。

**建议**: 在生产构建中始终显式配置 `VITE_GATEWAY_URL`，不依赖 `window.location` 推断。

---

### M-6: 错误响应中可能泄露内部实现细节

**位置**: 多个路由文件

**描述**: 部分错误处理直接将 `error.message` 传递给客户端：

```typescript
respondError(response, createInternalError("service", message));
```

`createInternalError` 将底层错误消息（可能包含数据库错误、文件路径等）发送到客户端。

**影响**: 内部错误消息可能泄露数据库结构、文件路径、第三方服务信息等。

**建议**: 对 500 级错误使用通用错误消息，仅在日志中记录详细信息。

---

### M-7: RPC 错误响应泄露服务端堆栈信息

**位置**: `apps/mobvibe-cli/src/daemon/socket-client.ts:1001-1024`

**描述**: `sendRpcError` 方法将完整的 `error.stack` 作为 `detail` 字段发送到网关：

```typescript
const detail = error instanceof Error ? error.stack : undefined;
const response: RpcResponse<unknown> = {
    requestId,
    error: {
        code: "INTERNAL_ERROR",
        message,
        detail,  // ← 包含完整堆栈
    },
};
```

**影响**: 客户端可以看到 CLI 进程的完整堆栈跟踪，包含文件路径和内部代码结构。

**建议**: 仅在开发模式下发送堆栈信息，生产模式下省略 `detail` 字段。

---

## 四、低危发现 (Low)

### L-1: `CliRecord` 在内存中存储 API Key 明文

**位置**: `apps/gateway/src/services/cli-registry.ts:23`

**描述**: `CliRecord` 结构中存储了 CLI 连接使用的 API key 明文：

```typescript
export type CliRecord = {
    apiKey?: string;  // ← 明文存储
    // ...
};
```

**影响**: 如果网关进程被攻击（如内存转储），所有已连接 CLI 的 API key 会被泄露。

**建议**: 仅在注册时验证 API key，之后不保留明文。如需标识，可存储 key 的哈希前缀。

---

### L-2: `@types/bun` 使用 `"latest"` 版本标记

**位置**: `apps/mobvibe-cli/package.json`

**描述**: `@types/bun` 的版本使用 `"latest"` 标记而非固定版本范围。

**影响**: 安装时可能引入不兼容的类型定义版本，导致构建问题或类型安全性降低。

**建议**: 固定为具体版本范围，如 `"^1.x.x"`。

---

### L-3: 缺少 Helmet 等安全 HTTP 头中间件

**位置**: `apps/gateway/src/index.ts`

**描述**: 网关服务器未设置常见的安全 HTTP 响应头：
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Strict-Transport-Security`
- `Content-Security-Policy`

**建议**: 添加 `helmet` 中间件或手动设置安全头。

---

## 五、依赖漏洞

通过 `pnpm audit` 扫描发现 **10 个已知漏洞**（4 高危 + 6 中危），全部来自 `shadcn` 的传递依赖。

### 高危 (High) - 4 项

| 包名 | 漏洞 | 修复版本 | 依赖链 |
|------|------|---------|--------|
| `hono` | JWT algorithm confusion (GHSA-3vhc, GHSA-f67f) | ≥4.11.4 | `shadcn` → `@modelcontextprotocol/sdk` → `hono` |
| `@modelcontextprotocol/sdk` | 跨客户端数据泄露 (GHSA-345p) | ≥1.26.0 | `shadcn` → `@modelcontextprotocol/sdk` |
| `@isaacs/brace-expansion` | ReDoS (GHSA-7h2j) | ≥5.0.1 | `shadcn` → `ts-morph` → `minimatch` → `@isaacs/brace-expansion` |

### 中危 (Moderate) - 6 项

| 包名 | 漏洞 |
|------|------|
| `esbuild` | 开发服务器无认证 (GHSA-67mh, GHSA-9hcr) |
| `hono` | XSS/缓存/IP 绕过/任意文件读取 (4 项) |

### 修复建议

1. **将 `shadcn` 从 `dependencies` 移动到 `devDependencies`**（`apps/webui/package.json`）。`shadcn` 是 CLI 代码生成工具，不应出现在生产依赖中。这一步可以消除所有 10 个漏洞在生产环境中的影响。
2. 升级 `shadcn` 到 `^3.8.4` 以获取修复的传递依赖。

---

## 六、架构层面建议

### 6.1 认证架构重构 (优先级: 高)

当前系统的根本问题在于 `optionalAuth` 的使用模式：当 `userId` 为空时，代码回退到 "返回所有数据" 的逻辑。这在设计初期可能是为了方便开发，但在生产环境中会导致严重的权限泄露。

**建议**:
1. 所有操作类端点（POST/DELETE）必须使用 `requireAuth`
2. 数据查询端点在无认证时应返回空集而非全量数据
3. WebSocket `/webui` 命名空间应增加强制认证中间件
4. `SessionRouter` 中当 `userId` 为 `undefined` 时应拒绝请求而非跳过检查

### 6.2 文件系统访问控制 (优先级: 高)

CLI 的文件系统 RPC 处理器需要增加路径边界检查：
- Host FS 操作应限制在用户 home 目录
- Session FS 操作应验证路径在 session cwd 内
- 拒绝目录遍历（`../`）和绝对路径逃逸

### 6.3 安全 HTTP 头 (优先级: 中)

添加 `helmet` 或等效的安全头中间件，至少包含：
- `Strict-Transport-Security` (如果使用 HTTPS)
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`

### 6.4 速率限制 (优先级: 中)

- 启用 API Key 的速率限制
- 为 REST API 添加全局速率限制（如 `express-rate-limit`）
- 为 WebSocket 连接添加消息频率限制

---

## 七、良好实践确认

以下方面代码实践良好，无需修改：

1. **密码存储**: Better Auth 框架内置安全的密码哈希
2. **SQL 注入**: 全程使用 Drizzle ORM 参数化查询，无原始 SQL
3. **秘钥管理**: 无硬编码密钥，所有敏感值通过环境变量配置
4. **CLI 凭据存储**: 文件权限设置为 `0o600`（仅所有者可读写）
5. **Email 验证**: 注册和登录都要求邮箱验证
6. **CSRF 保护**: Better Auth 内置 `trustedOrigins` 白名单机制
7. **日志记录**: 使用 pino 结构化日志，未记录敏感数据
8. **`.gitignore`**: 正确排除 `.env`、`node_modules`、`.mobvibe` 目录
9. **数据库外键**: 所有关联表正确设置了级联删除
10. **RPC 超时**: 所有 RPC 调用设有 2 分钟超时防止悬挂

---

*本报告仅基于静态代码分析，未进行动态渗透测试。建议在修复上述问题后进行一轮动态安全测试。*
