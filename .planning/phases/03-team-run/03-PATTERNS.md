# Phase 3: 最小端到端 Team Run - Patterns

**Created:** 2026-05-14
**Status:** Ready for implementation planning

## 复用原则

- Ordinary session 仍是所有 conversation、WAL、E2EE、permission、file/Git、history 的唯一拥有者。
- Agent Team projection 只保存 coordination metadata，不保存 target、mailbox body、task body、summary body 或 agent output。
- Gateway 只做 auth、validation、typed RPC routing 和 projection relay，不成为 durable truth，也不接收 target 明文。
- Team-shared worktree 是一个 checkout execution directory，但 workspace grouping 必须继续使用原 repo root。

## Shared Contract Pattern

### 当前模式

- 类型集中在 `packages/shared/src/types/agent-team.ts`。
- Socket RPC shape 由 `packages/shared/src/types/socket-events.ts` 引用。
- 普通 session worktree shape 已定义为 `CreateSessionWorktreeOptions`。

### Phase 3 应用

- 给 `CreateAgentTeamRpcParams` 增加 `worktree?: CreateSessionWorktreeOptions`，不要新增一套 team-only worktree shape。
- 给 `CreateAgentTeamRpcResult` 增加 `leaderSession?: SessionSummary`，用于 WebUI bootstrap E2EE 后发送 target。
- 不给 Agent Team create params 增加 `target`、`prompt`、`content`、`body` 等字段。

## Gateway Pattern

### 当前模式

- `/acp/session` 解析普通 session worktree，校验 `relativeCwd`、branch flag injection，再转发到 CLI。
- `/acp/agent-teams` 当前先递归拒绝 forbidden plaintext/secret-like keys，再转发 typed RPC。
- `TeamRouter` 只根据 user/machine 找 CLI socket，并等待 typed RPC response。

### Phase 3 应用

- 把普通 session route 的 worktree parsing 抽成共享小 helper 或在 Agent Team route 保持等价实现。
- Agent Team route 继续不记录 body 明文；日志只包含 userId、machineId、requestId、team/session ids 和 error code。
- Route response 可以包含 `leaderSession` metadata，因为普通 session create route 已经通过 Gateway 返回 `wrappedDek`；但不得包含 target plaintext。

## CLI Orchestration Pattern

### 当前模式

- `SessionManager.createSession()` 是 ordinary session 正确路径：worktree、ACP connection、WAL、DEK、events、session attached/change 都在这里完成。
- `SessionManager.createTeamSession()` 是 team MCP injection 路径，但还缺 worktree metadata override 和 readiness wait。
- `AgentTeamStore` 是 durable team truth，`buildAgentTeamSummary()` 是 projection 边界。
- `TeamRuntime` 组合 `TeamMcpRouter`、`TeamToolHandlers`、mailbox/task services。

### Phase 3 应用

- 新增 `SessionManager.createAgentTeamRun()` 作为 create/start orchestration owner，避免 `SocketClient` 手写 session lifecycle。
- `SocketClient.rpc:agent-team:create` 调 `SessionManager.createAgentTeamRun()`，然后发送 RPC response、`sessions:changed` 和 `agent-teams:changed`。
- `createTeamSession()` 应支持两种 cwd 模式：
  - 创建 leader 时可传 `worktree`，内部创建一个 team-shared worktree。
  - 创建 member 时复用 leader execution cwd，不再创建新的 worktree，但复制 leader 的 workspace/worktree metadata。
- `SessionManager` 需要发出 Agent Team changed event，让 MCP status、mailbox/task、spawn/member updates 都能 relay 到 WebUI。
- `recordTurnEnd()` 应能把 team member session completion 映射到 `TeamRuntime.onMemberTurnCompleted()`。

## Team Tool Pattern

### 当前模式

- `TeamMcpRouter` 用 `mobvibe-team:<agentTeamId>:<memberId>` 绑定 caller identity。
- `TeamToolHandlers` 只接受 `EXPECTED_TEAM_TOOL_NAMES` 中的工具。
- Mailbox/task tools 返回 structured result，projection 不包含 body。

### Phase 3 应用

- 增加 `mobvibe_team_spawn_member` 到 expected tools，并同步 readiness/list-tools tests。
- Spawn args 只接受结构化 metadata，例如 `name?: string`、`backendId?: string`。不接受 member prompt/body，也不接受 per-member worktree。
- Spawn caller 可以是任意 member；identity 仍来自 server id，不来自 args。
- Spawn 成功创建 ordinary ACP session 并更新 member slot；失败也保留 failed slot 和 safe error。

## WebUI Pattern

### 当前模式

- `useChatStore` 存 ordinary sessions 和 active session。
- `useTeamStore` 存 Agent Team projection，并有 forbidden-key stripping。
- `useSocket` 统一注册 gateway socket handlers。
- `CreateSessionDialog` 已有 cwd/worktree UI，`useSessionHandlers` 已有 worktree request-building。
- `SessionSidebar` 当前展示 backend-grouped ordinary sessions。

### Phase 3 应用

- 创建入口应支持 session/team 两种 flow；team flow 增加 target textarea，复用 cwd/backend/worktree controls。
- Team target 不进入 persisted store；只在 dialog/handler 内短期存在。
- `useSessionMutations` 或独立 `useAgentTeamMutations` 执行两步事务：create team/leader -> bootstrap leader DEK -> encrypted send target。
- `useSocket` 注册 `onAgentTeamsChanged()` 并调用 `useTeamStore.handleAgentTeamsChanged()`。
- `useSessionQueries` 或独立 query 在启动/机器切换时 fetch Agent Teams 并 replace store。
- Sidebar 先构造 team-owned session id set，把 team members 折叠到 Agent Team parent row 下；其他 ordinary sessions 继续走原 backend group。
- `SessionWorkspace` 在 `activeAgentTeamId` 存在时显示最小 `AgentTeamOverview`，点击 member 后回到 ordinary session view。

## 测试模式

- Shared/gateway 用 Vitest：类型 shape、route validation、forbidden-key rejection、worktree parsing。
- CLI 用 Bun test：SessionManager orchestration、AgentTeamStore updates、TeamMcpRouter spawn、SocketClient RPC。
- WebUI 用 Vitest + Testing Library：API payload、team store/socket integration、create transaction、sidebar folding、overview navigation。
- 端到端无法稳定启动真实 agent 时，用 mocked ACP connection/SocketClient path 证明 WebUI -> Gateway -> CLI shape 和 CLI session creation side effects。
