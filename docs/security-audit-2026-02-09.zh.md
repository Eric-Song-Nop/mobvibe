# Mobvibe 安全审计记录（2026-02-09）

本文档记录本次对 `apps/gateway`、`apps/webui`、`apps/mobvibe-cli`、`packages/core/shared` 的安全审计问题清单，重点覆盖数据传输、会话隔离、泄露与篡改风险。

## 审计范围与方法

- 范围：网关 REST/Socket、WebUI/Tauri、CLI 守护进程与 RPC、共享类型与状态持久化。
- 方法：静态代码审计 + 关键路径追踪 + 最小化本地验证（PoC）。
- 未完成项：依赖漏洞在线审计（`pnpm audit`）因网络解析失败（`EAI_AGAIN registry.npmjs.org`）未完成。

## 问题总览

| ID | 严重级别 | 问题 |
|---|---|---|
| SEC-001 | Critical | CLI `git diff` 命令注入（可执行任意命令） |
| SEC-002 | High | `sessions:discovered` 跨用户广播 |
| SEC-003 | High | CLI 断开时 `session:detached` 跨用户广播 |
| SEC-004 | High | 已认证 CLI 可注入跨用户 `session:attached/detached` 事件 |
| SEC-005 | High | 会话路由以 `sessionId` 单键隔离，存在跨用户冲突面 |
| SEC-013 | High | 机器级查找 TOCTOU + 信息泄露（getCliByMachineId + isMachineOwnedByUser 两步模式） |
| SEC-014 | Medium | CLI 文件 RPC 路径遍历（rpc:fs:entries/file/git:fileDiff 接受绝对路径逃逸 cwd） |
| SEC-015 | Medium | REST `GET /sessions` 存在全局回退（无 userId 时返回所有会话） |
| SEC-016 | Low | 死代码错误匹配分支（`message.includes("Not authorized")`）修复后不再触发 |
| SEC-006 | High（条件） | 传输层未强制 HTTPS/WSS |
| SEC-007 | Medium（争议） | CLI 文件 RPC 路径边界宽（会话/主机文件读取面） |
| SEC-008 | Medium | `SameSite=None` 场景缺少显式 CSRF 防护 |
| SEC-009 | Medium（争议） | CLI 配置加载日志可能泄露敏感信息 |
| SEC-010 | Medium（接受风险） | 凭据/会话数据本地明文持久化 |
| SEC-011 | Medium | 登录回跳 `returnUrl` 可开放重定向 |
| SEC-012 | Low（接受风险） | Socket CORS 对 localhost 放行 |

## 详细问题

### SEC-001（Critical）CLI `git diff` 命令注入

- 证据：
`apps/mobvibe-cli/src/lib/git-utils.ts:231`
`apps/mobvibe-cli/src/lib/git-utils.ts:245`
- 描述：通过模板字符串拼接 shell 命令执行 `git diff`/`wc -l`，路径参数可触发 shell 命令替换。
- 影响：可导致本地任意命令执行（RCE）。
- 触发条件：攻击者能控制进入 `getFileDiff` 的路径参数。
- 复核：本地最小 PoC 验证结果为 `VULNERABLE`。
- 修复建议：改 `execAsync("...")` 为 `spawn/execFile` 参数数组，完全禁用 shell 拼接。
- 状态：`已修复`（commit 958349f：替换为 execFile + readFile）。

### SEC-002（High）`sessions:discovered` 跨用户广播

- 证据：
`apps/gateway/src/socket/cli-handlers.ts:202`
`apps/gateway/src/index.ts:121`
- 描述：CLI 上报历史会话后，事件进入默认分支并 `emitToAll`，未携带用户定向信息。
- 影响：会话元数据（`sessionId/title/cwd/backend/machineId`）可被其他用户 WebUI 接收。
- 修复建议：该事件必须改为 `emitToUser(cliRecord.userId, ...)`，禁止默认广播。
- 状态：`已修复`（commit b1cd7ce：使用单用户范围查找，移除 emitToAll 回退）。

### SEC-003（High）CLI 断开时 `session:detached` 跨用户广播

- 证据：
`apps/gateway/src/socket/cli-handlers.ts:309`
`apps/gateway/src/socket/cli-handlers.ts:316`
`apps/gateway/src/index.ts:97`
`apps/gateway/src/index.ts:101`
- 描述：先 `unregister` 删除机器到用户映射，再发送 detached 事件，导致无法定向用户，回落到 `emitToAll`。
- 影响：跨用户收到他人会话 detach 事件，造成状态污染和信息泄露。
- 修复建议：先缓存 `userId` 再广播，或直接在 `cli-handlers` 内调用 `emitToUser`。
- 状态：`已修复`（commit b1cd7ce：先缓存 userId 再 unregister，使用 emitToUser）。

### SEC-004（High）已认证 CLI 可注入跨用户 `session:attached/detached` 事件

- 证据：
`apps/gateway/src/socket/cli-handlers.ts:223`
`apps/gateway/src/socket/cli-handlers.ts:236`
`apps/gateway/src/index.ts:91`
`apps/gateway/src/index.ts:101`
- 描述：连接后即可发送 attach/detach 事件，若 machine 映射缺失会回落全量广播。
- 影响：拥有合法 API key 的恶意客户端可向全体用户注入假事件（篡改 UI 状态）。
- 修复建议：要求完成 `cli:register` 后才允许会话事件；且所有事件必须附带并校验 `userId/machineId`。
- 状态：`已修复`（commit b1cd7ce：要求注册后才处理事件，校验 userId 一致性）。

### SEC-005（High）会话路由以 `sessionId` 单键隔离，存在跨用户冲突面

- 证据：
`apps/gateway/src/socket/webui-handlers.ts:33`
`apps/gateway/src/socket/webui-handlers.ts:248`
`apps/gateway/src/services/cli-registry.ts:303`
`apps/gateway/src/db/schema.ts:174`
- 描述：订阅与转发使用 `sessionId` 单键；归属判定使用“首个匹配 CLI”。若出现会话 ID 冲突，会破坏隔离。
- 影响：可能出现错路由、越权拒绝/放行或跨用户事件干扰。
- 修复建议：订阅键改为 `(userId, machineId, sessionId)`；后端路由按用户上下文做强校验。
- 状态：`需修复`。

### SEC-006（High，条件）传输层未强制 HTTPS/WSS

- 证据：
`apps/gateway/src/index.ts:3`
`apps/mobvibe-cli/src/daemon/socket-client.ts:141`
`apps/webui/src/lib/gateway-config.ts:30`
`apps/webui/src/components/app/GatewaySettings.tsx:56`
- 描述：网关使用 HTTP server，客户端允许配置 `http`，未统一在运行时强制 TLS。
- 影响：在未前置 TLS 的部署中，cookie/API key/事件可被窃听与篡改。
- 修复建议：生产环境强制 HTTPS/WSS；非 localhost 阻止明文 URL。
- 备注（Tauri）：当前 capability 允许 `http://localhost:*/*` 与 `https://*`，远端应走 HTTPS。
- 状态：`需修复（部署与代码双侧）`。

### SEC-007（Medium，争议）CLI 文件 RPC 路径边界宽

- 证据：
`apps/mobvibe-cli/src/daemon/socket-client.ts:542`
`apps/mobvibe-cli/src/daemon/socket-client.ts:579`
`apps/mobvibe-cli/src/daemon/socket-client.ts:609`
- 描述：`rpc:hostfs:entries`、`rpc:fs:entries`、`rpc:fs:file` 接受绝对路径或拼接路径，缺少 `realpath + containment`。
- 影响：在调用链被滥用时，可能访问会话根目录或 home 之外文件。
- 修复建议：统一路径规范化、根目录白名单、拒绝 `..` 与符号链接逃逸。
- 状态：`争议（用户判定“不是问题”）`。

### SEC-008（Medium）`SameSite=None` 下缺少显式 CSRF 防护

- 证据：
`apps/gateway/src/lib/auth.ts:96`
`apps/gateway/src/middleware/auth.ts:31`
- 描述：会话鉴权主要基于 cookie，未见 CSRF token 或统一 Origin/Referer 强校验中间件。
- 影响：在跨站请求场景中可能被滥用。
- 修复建议：增加 CSRF token 或严格 Origin 校验；评估 `SameSite=Lax/Strict` 可行性。
- 状态：`需修复`。

### SEC-009（Medium，争议）CLI 配置日志可能泄露敏感信息

- 证据：
`apps/mobvibe-cli/src/config-loader.ts:189`
- 描述：配置加载后输出完整 JSON，可能包含 `env` 内 token/secret。
- 影响：日志持久化后造成密钥泄露面。
- 修复建议：删除明文打印或按关键字脱敏。
- 状态：`争议（用户判定“cli没问题”）`。

### SEC-010（Medium，接受风险）本地明文持久化

- 证据：
`apps/mobvibe-cli/src/auth/credentials.ts:21`
`apps/mobvibe-cli/src/wal/wal-store.ts:313`
`packages/core/src/stores/storage-adapter.ts:24`
`apps/webui/src/lib/tauri-storage-adapter.ts:30`
- 描述：API key、会话内容、状态数据在本地以明文落盘（部分文件权限受限但未加密）。
- 影响：设备被入侵/共享/备份泄露时存在数据暴露风险。
- 修复建议：引入系统密钥链或可选本地加密。
- 状态：`接受风险（用户判定“没问题”）`。

### SEC-011（Medium）登录回跳 `returnUrl` 可开放重定向

- 证据：
`apps/webui/src/App.tsx:829`
`apps/webui/src/App.tsx:831`
- 描述：登录成功后直接 `window.location.href = returnUrl`，未做白名单/协议校验。
- 影响：可被构造为跳转到恶意站点（钓鱼链路）。
- 修复建议：限制为白名单域名或仅允许相对路径。
- 备注：前后端不同域部署并不否定该风险，应采用显式 allowlist。
- 状态：`需修复`。

### SEC-012（Low，接受风险）Socket CORS 对 localhost 放行

- 证据：
`apps/gateway/src/index.ts:50`
- 描述：`localhost/127.0.0.1` 默认通过 Socket CORS 校验。
- 影响：本机恶意页面有机会连接本地网关。
- 修复建议：仅开发环境保留，生产关闭。
- 状态：`接受风险（用户判定“没关系”）`。

### SEC-013（High）机器级查找 TOCTOU + 信息泄露

- 证据：
`apps/gateway/src/services/session-router.ts` — `createSession`、`getHostFsRoots`、`getHostFsEntries`、`discoverSessions`、`loadSession`、`reloadSession`
`apps/gateway/src/services/cli-registry.ts:413` — `isMachineOwnedByUser()`
- 描述：先调用 `getCliByMachineId(machineId)` 获取全局记录，再调用 `isMachineOwnedByUser(machineId, userId)` 检查归属。两步之间存在 TOCTOU 竞态窗口；且查找失败时的错误消息可泄露机器/会话是否存在。
- 影响：竞态条件下可跨用户操作他人机器；错误消息差异可用于枚举。
- 修复建议：新增 `getCliByMachineIdForUser(machineId, userId)` 单步用户范围查找；统一返回 "Machine not found" 消除信息泄露。
- 状态：`已修复`。

### SEC-014（Medium）CLI 文件 RPC 路径遍历

- 证据：
`apps/mobvibe-cli/src/daemon/socket-client.ts:578` — `rpc:fs:entries`
`apps/mobvibe-cli/src/daemon/socket-client.ts:609` — `rpc:fs:file`
`apps/mobvibe-cli/src/daemon/socket-client.ts:825` — `rpc:git:fileDiff`
- 描述：`rpc:fs:entries` 和 `rpc:fs:file` 接受绝对路径或 `..` 拼接路径，可读取 cwd 之外的文件。`rpc:git:fileDiff` 将 filePath 直接传入 git 命令，未校验路径是否在 cwd 内。
- 影响：经过网关认证的 WebUI 用户可通过构造路径读取 CLI 主机上任意文件。
- 修复建议：新增 `resolveWithinCwd(cwd, requestPath)` 工具函数，拒绝绝对路径和逃逸 cwd 的路径。
- 状态：`已修复`。

### SEC-015（Medium）REST `GET /sessions` 全局回退

- 证据：
`apps/gateway/src/routes/sessions.ts:58-64`
- 描述：当 `getUserId(request)` 返回 `undefined` 时，回退到 `cliRegistry.getAllSessions()` 返回全部会话。
- 影响：若 `requireAuth` 中间件被绕过或降级，将泄露所有用户的会话。
- 修复建议：删除 `getAllSessions()` 回退，断言 userId 存在否则 401。
- 状态：`已修复`。

### SEC-016（Low）死代码错误匹配分支

- 证据：
`apps/gateway/src/routes/sessions.ts` — 多处 `message.includes("Not authorized")`
`apps/gateway/src/routes/fs.ts` — 多处 `message.includes("Not authorized")`
- 描述：前轮修复后，`SessionRouter` 不再抛出 "Not authorized" 错误（统一为 "Session not found"/"Machine not found"），但路由层仍保留对该消息的匹配分支。
- 影响：死代码增加维护负担；若未来意外匹配可能导致错误的 403 响应而非正确的 404/500。
- 修复建议：删除所有 `message.includes("Not authorized")` 分支。
- 状态：`已修复`。

## 当前优先级建议

1. 立即修复：`SEC-001`, `SEC-002`, `SEC-003`, `SEC-004`, `SEC-005`。
2. 次优先级：`SEC-006`, `SEC-008`, `SEC-011`。
3. 风险接受或待复议：`SEC-007`, `SEC-009`, `SEC-010`, `SEC-012`。

## 备注

- 本文档是 2026-02-09 的审计快照，后续代码变更需重新复核。
- 建议后续配套新增针对跨用户事件隔离的自动化测试（尤其是 `sessions:discovered` 与 CLI disconnect 场景）。
