# Mobvibe Agent Team 编排架构研究

**项目：** Mobvibe Agent Team  
**研究维度：** Brownfield Architecture / Team Run Orchestration  
**研究日期：** 2026-05-12  
**总体置信度：** HIGH（基于当前代码与规划文档；未依赖外部生态假设）

## 结论摘要

Agent team 不应被设计成一套独立于现有 session 的并行运行时。正确结构是：**team run 是一层编排元数据与生命周期聚合；team member 仍然展开为普通 ACP session**。这样可以最大化复用当前已经验证的 WebUI → Gateway → CLI daemon → ACP process 分层、WAL 回放、E2EE、权限请求、Socket.io 事件、文件/Git RPC 与 session UI。

持久化边界应保持清晰：**成员 session 内容与事件继续归 CLI 本地 WAL 所有；team run 元数据也应由 CLI 本地 SQLite 持久化，Gateway 只做认证、路由、在线状态转发与短暂 presence 索引**。Gateway 的 `CliRegistry` 当前明确是进程内连接/session 索引，不能承载跨重启 team 状态。WebUI 可以持久化视图选择、草稿和聚合缓存，但不能成为 team run 的系统事实来源。

安全边界不应改变：**Gateway 不解密 session 内容，不理解 agent 输出，不持有 E2EE DEK 或用户 provider token**。Team 元数据可以是明文，但必须限制为非敏感结构化信息：teamRunId、memberId、backendId、machineId、cwd/worktreeSourceCwd、角色名称、执行策略、状态、关联 sessionId、错误摘要。每个成员的提示词正文与 summary 如果包含用户任务内容或 agent 输出，应沿用现有 `EncryptedPayload` 流程或只存在于 WebUI/CLI 解密域。

建议构建顺序是：先加 shared team 类型与只读投影；再在 CLI 增加 TeamRunStore + TeamOrchestrator；然后通过 Gateway 增加 team RPC/REST 路由；再接 Socket.io team 状态事件；最后扩展 WebUI Zustand/React Query 与 team run 页面。不要先做复杂 planner、自动合并或跨机器编排。

## 推荐架构

```text
WebUI
  ├─ team-run-store：team 聚合视图、选择状态、运行中状态
  ├─ chat-store：仍按普通 session 存储消息与 WAL cursor
  └─ REST + Socket.io：创建/取消/重试/订阅 team run
        │
        ▼
Gateway
  ├─ team routes：认证、请求校验、按 userId + machineId/sessionId 授权
  ├─ session-router/team-router：RPC broker 到目标 CLI
  └─ cli-registry：仅保存在线机器、session/team presence 快照
        │
        ▼
CLI daemon
  ├─ TeamOrchestrator：把 team run 展开为多个普通 ACP session
  ├─ SessionManager：不改语义；继续管理 ACP session、权限、事件、WAL
  ├─ WalStore：继续保存 session events；新增 team run metadata tables
  └─ ACP backends：每个成员是独立 backend session
        │
        ▼
Local ACP agent processes
```

核心原则：**team run 只引用 member session，不拥有 member session 内容**。

## 组件边界

| 组件 | 职责 | 不应承担 | 通信对象 |
|------|------|----------|----------|
| `packages/shared` team 类型 | 定义 `TeamRunSummary`、`TeamMemberSpec`、`TeamMemberState`、team RPC/REST/socket payload | 不放运行逻辑，不依赖 app 内部类型 | WebUI、Gateway、CLI |
| Gateway team routes | Better Auth 鉴权、参数校验、用户/机器授权、HTTP 错误标准化 | 不保存 durable team 状态，不解密提示词/summary，不执行编排 | WebUI、TeamRouter/SessionRouter |
| Gateway team router | 将 team RPC 发给指定用户的指定 CLI；管理 requestId/timeout | 不跨 CLI 聚合执行，不扫描 agent 输出 | CliRegistry、CLI socket |
| CliRegistry | 保存在线机器、backends、sessions、可选 team presence 快照 | 不作为 durable storage | socket handlers、routes |
| CLI TeamOrchestrator | 创建/启动/取消/重试 team run；按顺序或并行创建成员 session；调用 SessionManager | 不直接写 session event 内容，不绕过 E2EE | WalStore、SessionManager、SocketClient |
| CLI WalStore | 持久化 session WAL、discovered sessions；新增 team metadata | 不保存 WebUI UI state | SessionManager、TeamOrchestrator |
| CLI SessionManager | 保持普通 session 生命周期、权限、WAL、E2EE DEK、worktree 创建 | 不理解 team 聚合策略；只通过可选 parent metadata 暴露关联 | TeamOrchestrator、SocketClient |
| WebUI team store | 聚合 team 列表、member 状态、当前 selected team/member | 不保存解密后长期输出，不替代 chat-store | React Query、socket、chat-store |
| WebUI chat-store | 保持普通 session 消息、cursor、权限 UI、E2EE runtime 状态 | 不把 team run 塞进 ChatSession 作为伪 session | team UI 通过 sessionId 跳转 |

## 共享类型建议

当前 shared 类型以 `SessionSummary`、`SessionEvent`、`SessionsChangedPayload`、RPC wrapper 为核心。新增 team 应保持同样的协议边界，而不是在各 app 内定义临时 payload。

建议新增 `packages/shared/src/types/team.ts`，并从 `packages/shared/src/index.ts` 导出：

```typescript
export type TeamRunStatus =
	| "draft"
	| "queued"
	| "running"
	| "waiting_for_permission"
	| "completed"
	| "failed"
	| "canceled"
	| "archived";

export type TeamMemberStatus =
	| "pending"
	| "creating_session"
	| "running"
	| "waiting_for_permission"
	| "completed"
	| "failed"
	| "canceled";

export type TeamExecutionMode = "parallel" | "sequential";

export type TeamMemberSpec = {
	memberId: string;
	role: string;
	backendId: string;
	backendLabel?: string;
	order: number;
	worktree?: CreateSessionWorktreeOptions;
	// 如包含任务正文，应作为 EncryptedPayload 单独传输，不放明文 spec。
};

export type TeamMemberSummary = TeamMemberSpec & {
	sessionId?: string;
	status: TeamMemberStatus;
	error?: ErrorDetail;
	createdAt?: string;
	updatedAt?: string;
};

export type TeamRunSummary = {
	teamRunId: string;
	machineId: string;
	workspaceRootCwd: string;
	title: string;
	status: TeamRunStatus;
	executionMode: TeamExecutionMode;
	members: TeamMemberSummary[];
	createdAt: string;
	updatedAt: string;
};
```

在 `socket-events.ts` 中新增 team RPC 与 socket payload：

- `CreateTeamRunParams`：machineId、workspaceRootCwd、title、executionMode、members、可选 encrypted task payload。
- `TeamRunResponse` / `TeamRunsResponse`。
- `CancelTeamRunParams`、`RetryTeamMemberParams`、`ArchiveTeamRunParams`。
- `TeamRunChangedPayload`：added/updated/removed 或单个 summary；优先保持与 `SessionsChangedPayload` 相似。
- `TeamRunEvent`（可选）：如果需要细粒度生命周期事件，可为 team metadata 建单独事件流；不要混入 `SessionEventKind`，避免污染 session WAL reducer。

## 数据流

### 创建 team run

1. WebUI 创建 Team Run 表单选择：同一 `machineId`、workspace、多个不同 `backendId`、角色、顺序、是否 worktree。
2. WebUI 对任务正文/成员 prompt 片段按现有 E2EE 能力加密；明文 team metadata 仅包含非敏感结构。
3. WebUI `POST /acp/team-runs`。
4. Gateway route 通过 Better Auth 取得 `userId`，校验 machine 属于该用户，校验 backend 在该机器注册的 backends 中存在。
5. Gateway TeamRouter 通过 `/cli` RPC 发给目标 CLI：`rpc:team:create`。
6. CLI TeamOrchestrator 在本地 SQLite 创建 team run 与 member rows，状态从 `queued` 开始。
7. CLI 按 `executionMode` 展开成员：对每个 member 调用现有 `SessionManager.createSession({ backendId, cwd/worktree, title })`。
8. `SessionManager` 返回普通 `SessionSummary`，照常创建 WAL session、DEK、ACP connection、permission handler。
9. TeamOrchestrator 将 memberId ↔ sessionId 关联写入 team metadata，并 emit `team:changed`。
10. Gateway 只转发 `team:changed` 给该 user 的 WebUI；同时现有 `sessions:changed` / `session:event` 继续独立流动。

### 向成员发送任务

1. TeamOrchestrator 在 member session 创建成功后，通过 SessionManager 的现有 send message 路径或新增内部方法发送成员 prompt。
2. 成员 prompt 必须遵守现有 `SendMessageParams.prompt: EncryptedPayload` 边界；如果 CLI 需要解密后发给 ACP，则仍只发生在 CLI 解密域。
3. 成员输出以普通 `session:event` 进入成员 session WAL。
4. Team UI 通过 member.sessionId 订阅/展示对应 session 的最新状态；team run 自身只记录 member status 和错误摘要。

### 取消 / 重试 / 归档

- **取消 team run**：Gateway → CLI `rpc:team:cancel`；CLI 标记 team run canceled，并对 running member 调用 `SessionManager.cancelSession(sessionId)`。不要直接关闭或删除 session，除非用户显式归档。
- **重试成员**：对失败 member 创建新的普通 session，更新 member attempt/sessionId；旧 session 仍可从 UI 跳转查看。
- **归档 team run**：归档 team metadata；是否归档成员 session 应作为显式选项，默认保留成员 session 历史。

## 持久化所有权

| 数据 | 系统事实来源 | 说明 |
|------|--------------|------|
| ACP session events / messages / terminal / permission events | CLI `WalStore.session_events` | 保持现状；team 不复制事件内容 |
| Session metadata（backend、cwd、title、revision、wrappedDek） | CLI `WalStore.sessions` + active SessionManager | 保持现状；可给 `SessionSummary` 加可选 team 引用 |
| Team run metadata | CLI SQLite（建议扩展 WalStore 或新增 TeamRunStore） | 因 team 绑定本地机器、workspace、ACP sessions，跨 Gateway 重启仍可恢复 |
| Team member ↔ session 映射 | CLI SQLite | member session 是普通 session；映射用于聚合 UI 与恢复 |
| Gateway online presence | Gateway `CliRegistry` | 仅连接期缓存；可包括 team summary 快照但不可作为 durable |
| WebUI selection/drafts | WebUI Zustand/local storage | 仅 UI 状态；不可作为系统事实来源 |
| Summary 文本 | 若包含 agent/user 内容则 CLI/WebUI E2EE 域 | Gateway 不解密；v1 可先只做用户触发的本地/客户端 summary 占位 |

建议 SQLite 表：

```text
team_runs(
  team_run_id primary key,
  machine_id,
  title,
  workspace_root_cwd,
  execution_mode,
  status,
  created_at,
  updated_at,
  archived_at nullable
)

team_members(
  member_id primary key,
  team_run_id,
  role,
  backend_id,
  backend_label nullable,
  order_index,
  session_id nullable,
  status,
  worktree_source_cwd nullable,
  worktree_branch nullable,
  error_json nullable,
  created_at,
  updated_at
)
```

如果需要保存 prompt 片段，建议另建 `team_member_prompts` 并存 `EncryptedPayload` JSON，而不是明文列。

## 授权与 E2EE 边界

### 授权

- Gateway 所有 team REST 路由必须 `requireAuth`，并通过 `getCliByMachineIdForUser(machineId, userId)` 验证机器归属。
- 对 member 操作如果只有 `teamRunId/memberId`，Gateway 不能只信任 ID；必须先让 CLI user-scoped 解析，或在 Gateway presence 中确认 teamRun 属于该 user 的 machine。
- 对 session 级操作继续使用当前 `resolveCliForSession(sessionId, userId)` 语义，避免 sessionId 跨用户碰撞泄漏。
- 错误信息保持当前风格：未找到与未授权合并为通用 “not found / not authorized”，不要泄露其他用户机器或 session 存在性。

### E2EE

- Gateway 仍只路由 `EncryptedPayload` 和 metadata，不解密、不检查 promptBlocks、不生成 summary。
- Team metadata 中不要放 provider token、master secret、DEK、明文 agent 输出。
- 如果 team title/role/prompt 中可能包含敏感任务内容，v1 应在 UI 上明确区分：`title`/`role` 是明文 metadata；任务正文和成员 prompt 是 encrypted payload。
- 成员 session 的 `wrappedDek` 继续来自 `SessionSummary`，WebUI 继续通过 `bootstrapSessionE2EE(sessionId, wrappedDek)` 初始化。

## Socket 事件策略

不要把 team 生命周期硬塞进 `SessionEventKind`。`SessionEvent` 是 per-session WAL cursor 语义，带 `sessionId/revision/seq`，用于消息回放和 backfill。Team run 是跨 session 聚合，应走独立事件：

- CLI → Gateway：`team-runs:list` 或 `team-runs:changed`
- Gateway → WebUI：`team-runs:changed`
- WebUI → Gateway：可选 `subscribe:team-run` / `unsubscribe:team-run`

推荐 v1 先简单广播给用户所有 WebUI socket，避免引入复杂 subscription；当 team 数量增多再加订阅索引。成员 session 实时内容仍靠现有 `subscribe:session` 与 `session:event`。

## WebUI 状态结构

建议新增 `apps/webui/src/lib/team-store.ts`，不要继续扩大 `chat-store.ts`：

```typescript
type TeamState = {
	teamRuns: Record<string, TeamRunSummary>;
	activeTeamRunId?: string;
	selectedMemberId?: string;
	syncTeamRuns: (runs: TeamRunSummary[]) => void;
	handleTeamRunsChanged: (payload: TeamRunsChangedPayload) => void;
	setActiveTeamRunId: (id?: string) => void;
};
```

UI 展示建议：

- Team run 列表按 `workspaceRootCwd + machineId` 分组，和现有 workspace/session 结构对齐。
- Team detail 展示 member cards：role、backendLabel、status、sessionId、最近错误、权限等待状态。
- 点击 member 跳转到现有单 session chat；不要复制 chat 面板逻辑。
- 若要展示总览输出，v1 只显示每个 member 的状态和链接；summary 作为后续阶段。

`use-main-app-controller.tsx` 当前已经很大，team 逻辑应通过 `useTeamQueries`、`useTeamMutations`、`useTeamSocket` 注入，controller 只组合少量返回值，不直接写复杂 team 状态机。

## Gateway 路由与服务结构

推荐新增文件：

```text
apps/gateway/src/routes/team-runs.ts
apps/gateway/src/services/team-router.ts
```

不要把 team endpoints 继续塞进 `routes/sessions.ts` 或把 team RPC 塞进现有 `SessionRouter` 的大文件。`TeamRouter` 可以复用相同 `sendRpc` 思路，但应在独立类中管理 `rpc:team:*`。

REST API 建议：

| Method | Path | 作用 |
|--------|------|------|
| GET | `/acp/team-runs?machineId=` | 列出某机器 team runs |
| POST | `/acp/team-runs` | 创建并启动 team run |
| POST | `/acp/team-runs/:teamRunId/cancel` | 取消 team run |
| POST | `/acp/team-runs/:teamRunId/archive` | 归档 team run |
| POST | `/acp/team-runs/:teamRunId/members/:memberId/retry` | 重试成员 |

## CLI 编排结构

推荐新增：

```text
apps/mobvibe-cli/src/team/team-orchestrator.ts
apps/mobvibe-cli/src/team/team-store.ts
apps/mobvibe-cli/src/team/__tests__/team-orchestrator.test.ts
```

`TeamOrchestrator` 持有 `SessionManager` 引用，暴露：

- `createTeamRun(params)`
- `listTeamRuns()`
- `cancelTeamRun(teamRunId)`
- `retryMember(teamRunId, memberId)`
- `archiveTeamRun(teamRunId, options)`

成员调度规则：

- v1 限制同一个 `machineId` 与同一个 workspace，避免跨机器事务、跨机器权限和跨 WAL 聚合。
- `parallel`：并行创建多个 session，但每个 backend session 仍由 SessionManager 独立管理。
- `sequential`：只有前一个 member `turn_end` 后才启动下一个；TeamOrchestrator 可监听 SessionManager 的 `session:event`，只读取 event kind/status，不解密内容。
- 权限等待：当某 member 的 session 产生 `permission_request`，chat-store 已能展示；TeamOrchestrator 可把 member/team 状态标记为 `waiting_for_permission`，但权限决策仍走现有 session permission flow。

## 什么必须保持不变

- WebUI → Gateway → CLI daemon → ACP process 分层不变。
- 每个 team member 是普通 ACP session；现有 session 创建、取消、权限、WAL、backfill、E2EE 和 file/git RPC 不变。
- Gateway 不保存 chat history，不解密 prompt/output，不承担 durable team storage。
- `SessionEvent` 的 per-session `revision/seq` 语义不变；team 不复用 session WAL cursor。
- `CliRegistry` 仍是 ephemeral registry，不作为恢复来源。
- 单会话 UI 和 API 必须继续独立可用；没有 teamRunId 的 session 行为不变。

## 建议构建顺序

1. **Shared 协议切片**  
   新增 team 类型、RPC/socket payload、index exports。先用类型测试或编译验证所有 app 可引用。

2. **CLI durable metadata 切片**  
   新增 team store/migrations，只实现 create/list/update 状态，不启动 agent。验证 CLI 重启后 team run 元数据可恢复。

3. **CLI 编排最小闭环**  
   TeamOrchestrator 创建一个 team run，并为每个 member 调用现有 `SessionManager.createSession`。先支持 parallel，sequential 可作为下一步。

4. **Gateway REST/RPC 切片**  
   新增 `team-runs.ts` 与 `team-router.ts`，完成 user-scoped machine 授权和 RPC 转发。

5. **Socket presence 切片**  
   CLI emit `team-runs:changed`，Gateway 转发到 WebUI；WebUI store 应用增量变更。

6. **WebUI 最小 team 页面**  
   显示 team run list/detail/member cards，点击 member 跳转现有 session。此阶段不做 summary、不做自动合并。

7. **Sequential / retry / cancel / archive**  
   在有端到端可观察性后补生命周期操作。

8. **Summary 与高级编排**  
   后续阶段再研究 summary 的 E2EE 归属、是否由用户指定某个 backend 总结、是否需要引用各 member 原文。

## 主要风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| 把 team 状态放进 Gateway registry | Gateway 重启丢失 team run | team metadata 属于 CLI SQLite；Gateway 只缓存 presence |
| 扩大现有大文件 | 回归 session/WAL/socket 行为 | 新增 team-router/team-orchestrator/team-store/team-store.ts，少改 SessionManager |
| team 事件混入 session:event | 破坏 cursor/backfill 语义 | team 使用独立 socket event；member 内容仍走 session:event |
| Gateway 解密 summary/prompt | 破坏 E2EE 承诺 | 明确 metadata/content 分界；内容只在 WebUI/CLI 解密域 |
| 自动归档成员 session | 用户失去原始上下文 | 归档 team 默认保留 member session；删除需显式选项 |
| sequential 依赖解密内容判断完成 | Gateway/Orchestrator 需要读输出 | 只依赖 `turn_end`/session status，不读明文 |

## 阶段规划含义

- **第一阶段应是协议与持久化骨架**，因为后续 Gateway、CLI、WebUI 都依赖稳定 shared 类型和 durable team metadata。
- **第二阶段做最小端到端 team run 创建**，目标是能从 WebUI 创建 team，CLI 展开为多个普通 session，WebUI 能看到 member session。
- **第三阶段补生命周期与实时状态**，包括 cancel/retry/archive、permission waiting 聚合、socket 增量同步。
- **第四阶段再做 UX polish 与 summary**，因为 summary 涉及 E2EE 内容边界和产品语义，不应阻塞基础编排。

## 参考代码依据

- `.planning/PROJECT.md`：明确 team member 复用普通 ACP session、Gateway 不解密、team metadata 需要跨重启恢复。
- `.planning/codebase/ARCHITECTURE.md`：确认现有分层、WAL 所有权、Socket.io 事件路径与 E2EE 边界。
- `.planning/codebase/CONCERNS.md`：指出 SessionManager、SessionRouter、chat-store 等大文件风险，支持新增独立 team 模块。
- `packages/shared/src/types/session.ts`：当前 session summary 是跨层 session 投影，应以可选 team 引用扩展而不是替换。
- `packages/shared/src/types/socket-events.ts`：当前 RPC/socket 类型集中在 shared，team payload 应沿用该协议边界。
- `apps/gateway/src/services/cli-registry.ts`：registry 是在线 CLI/session 索引，适合 presence，不适合 durable team storage。
- `apps/gateway/src/services/session-router.ts` 与 `routes/sessions.ts`：已具备 user-scoped session/machine RPC 模式；team 应复用模式但拆新 router/routes。
- `apps/mobvibe-cli/src/acp/session-manager.ts`：SessionManager 已拥有 session lifecycle、WAL、E2EE、worktree、permission 能力；TeamOrchestrator 应调用它而不是复制能力。
- `apps/mobvibe-cli/src/wal/wal-store.ts`：SQLite 是本地 durable session 元数据与事件来源；team metadata 应与其同处 CLI 本地持久化域。
- `apps/webui/src/lib/chat-store.ts`：chat-store 已很大且专注 per-session 消息/cursor；team 应单独 store 聚合。
- `apps/webui/src/lib/machines-store.ts` 与 `use-main-app-controller.tsx`：WebUI 已有 machine/backend/session 组合模式，team 应作为新 hook/store 注入而不是重写主控制器。
