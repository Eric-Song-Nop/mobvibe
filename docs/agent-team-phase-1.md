# Agent Team Phase 1 实现说明

本文记录 Phase 1「协议、状态模型与持久化边界」已经落地的实现。Phase 1 只建立可恢复的 Agent Team 元数据骨架，不启动真实成员 agent，也不实现完整 Team UI。

## 总体边界

Agent Team 的事实来源在 CLI 本地 SQLite。Gateway 只做认证、授权、RPC 路由和非内容 projection 转发；WebUI 只调用 metadata API、接收 projection socket event，并把 projection 存入独立 store。

核心不变量：team owns coordination facts; session owns conversation facts。

## Shared 协议

共享类型位于 `packages/shared/src/types/agent-team.ts`，并通过 `packages/shared/src/index.ts` 显式导出。

已定义的核心类型：

- `AgentTeamSummary`：Gateway/WebUI 可见的 Agent Team projection。
- `TeamMemberSummary`：leader/member 的 role、backend、ordinary `sessionId` 占位、MCP、mailbox/task counts 和 source refs。
- `AgentTeamLifecycle` 与 `TeamMemberLifecycle`：不包含 `idle` 或 `ready`。
- `TeamMcpStatusSummary`、`TeamMcpPhase`、`TeamMcpTransport`：把 MCP readiness 从 lifecycle 中拆出。
- `TeamMailboxCounts`、`TeamTaskCounts`：只表达统计和时间戳。
- `TeamSourceRef`、`TeamSummaryRef`：只表达定位引用，不承载正文。
- `CreateAgentTeamRpcParams`、`CreateAgentTeamRpcResult`、`ListAgentTeamsRpcResult`、`GetAgentTeamRpcResult`、`AgentTeamsChangedPayload`。

Socket 事件位于 `packages/shared/src/types/socket-events.ts`：

- CLI → Gateway：`agent-teams:changed`。
- Gateway → WebUI：`agent-teams:changed`。
- Gateway → CLI：`rpc:agent-team:create`、`rpc:agent-teams:list`、`rpc:agent-team:get`。
- CLI/Gateway RPC 响应沿用 `rpc:response` 与 `ErrorDetail`。

## CLI 持久化

CLI 使用现有 WAL SQLite 数据库和 `schema_version` migration path，不新增第二套数据库。

Agent Team 当前事实表由 `apps/mobvibe-cli/src/wal/migrations.ts` 创建：

- `agent_teams`
- `agent_team_members`
- `agent_team_mcp_status`
- `agent_team_mailbox_messages`
- `agent_team_tasks`
- `agent_team_summary_refs`

`apps/mobvibe-cli/src/team/agent-team-store.ts` 提供 durable truth 读写方法：

- `createAgentTeam(params)`：创建 team metadata、leader member metadata 和默认 MCP 状态。
- `listAgentTeams(params)`：读取当前用户机器上的 team projection 列表。
- `getAgentTeam(params)`：按 `agentTeamId` 读取单个 projection。
- `close()`：关闭 SQLite 连接。

`apps/mobvibe-cli/src/team/projection-builder.ts` 负责把 CLI-local rows 组装为 `AgentTeamSummary`。它会恢复 mailbox/task counts、source refs、MCP readiness 和 summary refs，并在 projection 时验证 lifecycle，拒绝把 `idle` 或 `ready` 当作 lifecycle 输出。

`apps/mobvibe-cli/src/team/content-boundary.ts` 提供 Gateway-facing payload 的 forbidden-key 断言。CLI 可以在本地保存 mailbox/task 正文，但 projection builder 不读取或输出 `body_local_json`。

## CLI Socket RPC

`apps/mobvibe-cli/src/daemon/socket-client.ts` 负责把 Agent Team store 暴露给 Gateway typed RPC：

- 收到 `rpc:agent-team:create` 后调用 `AgentTeamStore.createAgentTeam`。
- 收到 `rpc:agent-teams:list` 后调用 `AgentTeamStore.listAgentTeams`。
- 收到 `rpc:agent-team:get` 后调用 `AgentTeamStore.getAgentTeam`。
- 创建成功后向 Gateway 发送 `agent-teams:changed` projection event。
- 测试通过 `agentTeamStore` 注入隔离每个 socket-client 用例，避免全局 mock 共享状态。

## Gateway 路由与转发

Gateway Agent Team REST API 位于 `apps/gateway/src/routes/agent-teams.ts`：

- `POST /acp/agent-teams`
- `GET /acp/agent-teams`
- `GET /acp/agent-teams/:agentTeamId`

这些路由先执行 `requireAuth` 和 `getUserId`，再通过 `apps/gateway/src/services/team-router.ts` 转发到当前用户拥有的 CLI。Gateway 不创建 Agent Team 数据库表，也不把 Agent Team durable truth 写入 Gateway DB。

`TeamRouter` 复用 SessionRouter 的 requestId/pending map/timeout 模式：

- `createAgentTeam(params, userId)` → `rpc:agent-team:create`
- `listAgentTeams(params, userId)` → `rpc:agent-teams:list`
- `getAgentTeam(params, userId)` → `rpc:agent-team:get`
- `handleRpcResponse(response)` 消费属于 TeamRouter 的 `rpc:response`

`apps/gateway/src/socket/cli-handlers.ts` 同时把 `rpc:response` 分发给 SessionRouter 和 TeamRouter。每个 router 只消费自己 pending requestId 对应的响应。

`apps/gateway/src/socket/cli-handlers.ts` 还会把 CLI 发来的 `agent-teams:changed` 只 relay 给该 CLI record 的 `userId`，不会全局广播给其他用户。

## WebUI 边界

WebUI API client 位于 `apps/webui/src/lib/api.ts`：

- `fetchAgentTeams(machineId?)` 调用 `GET /acp/agent-teams`，可附带 `machineId` query。
- `fetchAgentTeam(agentTeamId, machineId?)` 调用 `GET /acp/agent-teams/:agentTeamId`，沿用 `ApiError` 与 `ErrorDetail`。
- `createAgentTeam(payload)` 调用 `POST /acp/agent-teams`，显式重建允许字段后序列化。
- `CreateAgentTeamPayload` 只包含 `machineId`、`title`、`workspaceRootCwd`、`leaderBackendId`、`workspaceMode`、`worktreeSourceCwd`、`worktreeBranch`。

WebUI projection store 位于 `apps/webui/src/lib/team-store.ts`：

- `teams: Record<string, AgentTeamSummary>` 保存 projection。
- `activeAgentTeamId` 保存当前选择。
- `lastSyncAt` 保存最后同步时间。
- `appError` 是 runtime-only，不进入 persist partial state。
- `replaceAgentTeams(teams)` 用完整列表替换 projection。
- `handleAgentTeamsChanged(payload)` 合并 added/updated，删除 removed，并在 active team 被移除时清空 `activeAgentTeamId`。

`team-store.ts` 的 persisted partial state 只包含 `teams`、`activeAgentTeamId`、`lastSyncAt`。持久化前会递归移除正文和密钥类 forbidden keys，避免把非 projection 字段写入浏览器存储。

WebUI socket helper 位于 `apps/webui/src/lib/socket.ts`：

- `onAgentTeamsChanged(handler)` 注册/注销 `agent-teams:changed` handler。
- 事件类型来自 `GatewayToWebuiEvents` 和 `AgentTeamsChangedPayload`。

## 内容红线

Gateway 不得接受、持久化、转发或记录以下内容：

- `prompt`
- `agentOutput`
- mailbox body
- task body/title/description
- summary body
- `providerToken`
- `masterSecret`
- `dek` / DEK
- `secret` 或任何密钥材料

Phase 1 中对应防线：

- Shared projection 类型不包含正文类字段。
- CLI projection builder 不输出 `body_local_json`。
- CLI content boundary 递归拒绝 forbidden keys。
- Gateway `/acp/agent-teams` route 在转发前递归拒绝 forbidden keys。
- WebUI `createAgentTeam` 显式构造 metadata-only request body。
- WebUI `team-store` persist partial state 移除正文和密钥类字段。

## 验证命令

Phase 1 已使用以下命令验证关键边界：

```bash
pnpm -C packages/shared test:run -- tests/agent-team.contract.test.ts
pnpm -C apps/mobvibe-cli test -- src/team/__tests__/agent-team-store.test.ts src/team/__tests__/projection-builder.test.ts
pnpm -C apps/gateway test:run -- src/services/__tests__/team-router.test.ts src/routes/__tests__/agent-teams.test.ts
pnpm -C apps/webui test:run -- src/lib/__tests__/api.test.ts src/lib/__tests__/team-store.test.ts src/lib/__tests__/socket.test.ts
pnpm format
pnpm lint
pnpm build
PLAYWRIGHT_WEB_PORT=45173 PLAYWRIGHT_GATEWAY_PORT=45005 timeout 300 pnpm test:run
```

## 后续阶段使用方式

Phase 2 可以在 CLI 本地继续实现 team MCP tools、durable mailbox 和 task board 正文读写，但正文仍不得进入 Gateway/WebUI projection。Phase 3 以后 WebUI 可以基于 `team-store.ts` 和 `socket.ts` 构建 Agent Team list/detail UI，并通过 `sourceRefs` 跳转到 ordinary member session history。
