# Phase 3: 最小端到端 Team Run - Research

**Created:** 2026-05-14
**Status:** Ready for plan execution review

## 目标

Phase 3 要交付第一条可用的端到端 Agent Team run：WebUI 发起创建，Gateway 路由到 CLI，CLI 创建 leader 普通 ACP session 并注入 team MCP，WebUI 将用户目标以现有 E2EE message path 投递给 leader，leader/member 通过 team tools 协作，WebUI 可以展示最小 team projection 并跳转到成员普通 session。

本研究只覆盖 Phase 3；取消、重试、归档、权限聚合、恢复、自动 summary、自动 merge、per-member worktree 和富 team chat 延后。

## 现状结论

### Shared/Gateway

- `packages/shared/src/types/agent-team.ts` 目前的 `CreateAgentTeamRpcParams` 只有 metadata：`machineId`、`backendId`、`workspaceRootCwd`、`title`、`workspaceMode`、`leaderName`。
- `CreateAgentTeamRpcResult` 只返回 `team`，没有 leader `SessionSummary`。如果 WebUI 要在创建后立即通过现有 `sendMessage` 发送目标，它需要 leader `wrappedDek` 来完成 E2EE bootstrap。
- `packages/shared/src/types/socket-events.ts` 已有普通 session 的 `CreateSessionWorktreeOptions`，可直接复用给 team-shared worktree。
- `apps/gateway/src/routes/agent-teams.ts` 当前会递归拒绝 `prompt`、`content`、`body`、`description` 等字段，这符合 Phase 3 的 target plaintext 边界；新设计不应把 target 明文塞入该 route。
- `apps/gateway/src/routes/sessions.ts` 已有 worktree parsing 和 `relativeCwd` 标准化逻辑。Agent Team route 需要复用相同规则，避免 team worktree 与 ordinary session worktree 行为漂移。

### CLI

- `apps/mobvibe-cli/src/daemon/socket-client.ts` 的 `rpc:agent-team:create` 当前只调用 `AgentTeamStore.createAgentTeam()`，因此只创建 durable metadata，不创建 leader ordinary ACP session，也不注入 MCP。
- `apps/mobvibe-cli/src/acp/session-manager.ts` 已有 `createSession()`，完整支持 ordinary session、worktree、WAL、DEK、socket session events；也已有 `createTeamSession()`，但它缺少 ordinary worktree creation/metadata override 能力。
- `createTeamSession()` 会注入 `mobvibe-team` MCP declaration，但目前不会等待 `tools_ready` 后再返回。
- `TeamRuntime` 已能处理 mailbox wake 和 task/mailbox tools，但 `SessionManager` 没有对外发出 Agent Team projection change 事件；因此 MCP status、mailbox/task 变化不会稳定推送到 WebUI。
- `TeamToolHandlers.EXPECTED_TEAM_TOOL_NAMES` 目前只有五个工具：members、send_message、task_create、task_list、task_update。Phase 3 需要增加真实 spawn member tool，并把它接到 ordinary member session 创建。
- `AgentTeamStore.updateTeamMemberRuntimeState()` 只能更新 `session_id` 和 `lifecycle`，不足以记录 Phase 3 需要的 `health`、`error`、`worktreeSourceCwd`、`worktreeBranch` 和 team lifecycle。
- `recordTurnEnd()` 当前只更新 ordinary session WAL/sidebar，不会把 team member completion 反馈给 `TeamRuntime.onMemberTurnCompleted()`。

### WebUI

- `apps/webui/src/lib/api.ts` 已有 Agent Team API client，但 `CreateAgentTeamPayload` 只发送 metadata，并且 worktree fields 不是普通 session 的 `worktree` shape。
- `apps/webui/src/lib/team-store.ts` 已有 projection-only Zustand store 和 forbidden-key stripping；这是 Phase 3 team UI 的正确状态源。
- `apps/webui/src/hooks/useSocket.ts` 已有 `gatewaySocket.onAgentTeamsChanged()` 能力，但尚未注册 handler 到 `useTeamStore.handleAgentTeamsChanged()`。
- `apps/webui/src/hooks/useSessionQueries.ts` 尚未 fetch Agent Teams；刷新后仅靠 persisted team-store，无法保证当前 projection 最新。
- `CreateSessionDialog` 和 `useSessionHandlers` 已经实现 cwd、repoRoot、relativeCwd、branch、baseBranch 和 preview 逻辑，Phase 3 应复用这套交互/参数语义。
- `SessionSidebar` 当前按 backend group 展示普通 session。Phase 3 需要在同一 workspace session list 中插入 Agent Team parent row，并将 team-owned leader/member ordinary sessions 折叠到 parent 下。
- `SessionWorkspace` 当前只能展示 ordinary session chat。Phase 3 需要一个最小 `AgentTeamOverview`，用于展示成员、MCP/status、task/mailbox counts 和跳转入口。

## 目标投递设计

Gateway 不能接收 target 明文，因此不应让 `POST /acp/agent-teams` 携带 `target`、`prompt`、`content` 或类似字段。

Phase 3 采用 WebUI 内部的两步用户事务：

1. WebUI 调 `createAgentTeam()` 创建 team + leader ordinary session，返回 `team` 和 `leaderSession` metadata。
2. WebUI 用 `leaderSession.wrappedDek` bootstrap leader session DEK，然后通过现有 `sendMessage()` 发送 target text block。该请求对 Gateway 是 encrypted payload。

用户感知上这是一次 “Create Agent Team” 操作；只有第二步 `sendMessage()` 被接受后，UI 才报告创建成功并关闭 dialog。若 leader session 没有可用 `wrappedDek` 或 WebUI 无法 unwrap，则 create flow 必须失败，避免 target 明文经过 Gateway。

标题是 Gateway-facing metadata。若用户没有输入 title，WebUI 可以从 target 第一行生成短标题；这只生成标题，不把完整 target 存入 Agent Team projection。

## 风险与约束

- 如果 target 投递失败，team/leader session 可能已经创建。Phase 3 不实现自动回滚或 retry UI；WebUI 应展示错误并保留可跳转的 leader session，用户可手动发送目标。
- 等待 `tools_ready` 可能受 backend 行为影响。CLI create path 需要有明确 timeout 和 structured error；失败时要保留 failed leader/team metadata。
- 新增 `mobvibe_team_spawn_member` 会改变 expected tools readiness gate，相关 MCP tests 和 bridge manifest 必须同步。
- Team-shared worktree 必须让 leader/member 都归入原 repo workspace，而不是 worktree checkout 自己的新 workspace group。
- 不引入 per-member worktree；spawn args 不能创建独立 worktree。

## 推荐执行顺序

1. 先扩展 shared/gateway contract，保持 target 不进入 Agent Team create route。
2. 再实现 CLI create/start leader，复用 ordinary session/worktree/E2EE/WAL 机制。
3. 再实现真实 spawn member tool 和 member completion wake。
4. 再接 WebUI create flow，完成 target encrypted delivery。
5. 最后接 sidebar/overview/detail navigation，形成可见端到端闭环。

## 验证重点

- Gateway Agent Team route 仍拒绝 target/plaintext-like keys。
- WebUI team target delivery 只有在 E2EE bootstrap 成功后才调用 `sendMessage()`。
- CLI create flow 创建普通 leader session，session list 能看到该 session，team projection member 带 `sessionId`。
- `mobvibe_team_spawn_member` 成功创建普通 member session；失败保留 failed member slot。
- Team-owned sessions 在 WebUI session list 中默认折叠于 Agent Team parent row 下，点击 member 跳到普通 session。
