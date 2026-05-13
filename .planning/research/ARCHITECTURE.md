# Mobvibe Agent Team 协作架构研究

**项目：** Mobvibe Agent Team  
**研究维度：** Brownfield Architecture / ACP Team MCP Coordination
**研究日期：** 2026-05-12  
**总体置信度：** HIGH

## 结论摘要

Agent Team 不应被设计成独立 agent runtime，也不应只是外部 orchestrator 分发 prompt 后做 UI 聚合。正确结构是：**CLI 本地拥有 team coordination runtime；leader/member 仍然是普通 ACP session；team MCP server 只注入 team ACP session；mailbox 和 task board 提供 durable agent 间协作事实**。

这保留现有 WebUI → Gateway → CLI daemon → ACP agent 分层。成员 session 的消息、权限、WAL、E2EE、worktree、文件/Git、历史恢复继续走现有链路。新增的 team 层只保存协作所需事实：team run metadata、leader/member 映射、MCP readiness、mailbox、task board、tool policy、wake/idle 状态和 summary source refs。ACP 官方 MCP-over-ACP RFD 是隔离机制：team tools 作为 per-session MCP server 声明在 team `session/new` 中，普通 session 不声明该 server，因此普通 agent 使用路径不变。

Gateway 的边界必须更严格：它可以认证用户、校验 machine/session ownership、路由 RPC、广播 non-content snapshot，但不能保存或生成 prompt、agent output、mailbox content、task description 或 summary 明文。所有含内容字段应停留在 WebUI/CLI 可信域，或以现有 E2EE/加密 payload 形式传输。

## 推荐架构

```text
WebUI
  ├─ Team create/monitor UI
  ├─ Team store: team snapshots, MCP readiness, task/mailbox projection
  ├─ Chat/session store: unchanged per-session transcript and permissions
  └─ REST + Socket.io: team intent, snapshots, realtime non-content deltas
        │
        ▼
Gateway
  ├─ Team routes: auth, validation, user/machine/session authorization
  ├─ Team router: typed RPC to target CLI, timeout/error shaping
  └─ CliRegistry: online machine/session/team presence only
        │
        ▼
CLI daemon
  ├─ TeamStore: team runs, members, MCP readiness, tool policy
  ├─ TeamMcpServer: per-team MCP-over-ACP server or per-session bridge
  ├─ MailboxStore: durable agent-to-agent messages and read state
  ├─ TaskBoardStore: durable tasks, owners, status, dependencies
  ├─ TeamSessionManager: leader/member lifecycle, wake/idle, recovery
  ├─ SessionManager: unchanged ordinary ACP sessions
  └─ WalStore: unchanged per-session WAL plus optional team store tables
        │
        ▼
Local ACP agent processes
  ├─ leader ACP session + injected team MCP config
  └─ member ACP sessions + injected team MCP config
```

核心原则：**team owns coordination facts; session owns conversation facts**。

## 组件边界

| 组件 | 职责 | 不应承担 |
|------|------|----------|
| `packages/shared` team 类型 | 定义 team、member、MCP readiness、mailbox/task metadata、RPC/socket payload、错误 shape | 不放运行逻辑，不依赖 app 内部类型 |
| WebUI team feature | 创建 team intent，展示 leader/member、MCP readiness、task board、mailbox 活动、权限定位和 summary refs | 不复制成员 transcript，不保存大量明文输出，不直接启动多个普通 session 假装 team |
| Gateway team routes | Auth、machine ownership、参数校验、错误标准化 | 不保存 durable truth，不解密内容，不执行 agent coordination |
| Gateway team router | 把 user-scoped team RPC 发给目标 CLI，转发 snapshot/change events | 不跨 CLI 聚合，不扫描 agent 输出，不解析 task/mailbox 正文 |
| CLI TeamStore | 持久化 team run、member、MCP readiness、tool policy、summary refs | 不保存成员 transcript 副本 |
| CLI TeamMcpServer | 启动本地 MCP server，优先生成 MCP-over-ACP server declaration，必要时生成 per-session bridge config，处理 `mobvibe_team_*` tool calls | 不写全局 agent MCP 配置，不绕过权限/确认直接执行高风险操作 |
| CLI MailboxStore | 持久化消息、read/unread、delivery/wake 状态 | 不把正文投影给 Gateway 明文 |
| CLI TaskBoardStore | 持久化任务、owner、status、blockedBy/blocks、更新时间 | 不把任务正文投影给 Gateway 明文 |
| CLI TeamSessionManager | 创建 leader/member 普通 ACP session、注入 MCP、wake agents、恢复 degraded team | 不替代 SessionManager 的 WAL/E2EE/permission 语义 |
| CLI SessionManager | 管理普通 ACP session、worktree、WAL、permission、E2EE | 不理解 task board，不保存 team mailbox |

## 共享类型建议

新增 `packages/shared/src/types/team.ts`，并从 shared 入口导出。核心类型应覆盖以下概念。

```typescript
export type TeamRunStatus =
	| "draft"
	| "starting"
	| "running"
	| "waiting_for_permission"
	| "degraded"
	| "completed"
	| "completed_with_errors"
	| "failed"
	| "cancelled"
	| "archived";

export type TeamMemberStatus =
	| "pending"
	| "creating_session"
	| "injecting_mcp"
	| "idle"
	| "active"
	| "waiting_for_permission"
	| "completed"
	| "failed"
	| "cancelled"
	| "detached";

export type TeamMcpPhase =
	| "not_started"
	| "server_starting"
	| "server_ready"
	| "session_injecting"
	| "tools_waiting"
	| "tools_ready"
	| "degraded"
	| "error";

export type TeamMemberRole = "leader" | "member";
export type TeamWorkspaceMode = "shared_cwd" | "isolated_worktree";

export type TeamMemberSummary = {
	memberId: string;
	teamRunId: string;
	role: TeamMemberRole;
	name: string;
	backendId: string;
	backendLabel?: string;
	sessionId?: string;
	status: TeamMemberStatus;
	mcpPhase: TeamMcpPhase;
	workspaceMode: TeamWorkspaceMode;
	worktreeBranch?: string;
	error?: ErrorDetail;
	createdAt: string;
	updatedAt: string;
};

export type TeamRunSummary = {
	teamRunId: string;
	machineId: string;
	workspaceRootCwd: string;
	title: string;
	status: TeamRunStatus;
	leaderMemberId: string;
	members: TeamMemberSummary[];
	taskCounts: TeamTaskCounts;
	mailboxCounts: TeamMailboxCounts;
	createdAt: string;
	updatedAt: string;
};
```

Gateway-facing payload 应只包含 ids、status、counts、timestamps、backend/workspace metadata、error code/message 等非内容字段。含用户目标、prompt、mailbox message、task description、summary body 的字段必须是 encrypted payload、local-only field 或 source ref。

## MCP Transport Isolation

Mobvibe 应优先采用 ACP RFD `MCP-over-ACP: MCP Transport via ACP Channels`：CLI 在创建 team leader/member session 时，在该 session 的 `tools.mcpServers` 中声明 team MCP server：

```json
{
	"tools": {
		"mcpServers": {
			"mobvibe-team": {
				"transport": "acp",
				"id": "team-run-and-member-scoped-id"
			}
		}
	}
}
```

隔离规则：

- `id` 由 CLI 生成并映射到具体 `teamRunId/memberId/sessionId`。
- Agent tool calls 通过 `mcp/connect`、`mcp/message`、`mcp/disconnect` 回到 CLI，无需额外全局端口或全局 agent MCP 配置。
- 普通 Mobvibe session 不包含 `mobvibe-team` MCP server declaration，因此完全不暴露 team tools。
- 如果 backend 没有 native `mcpCapabilities.acp`，CLI 只能使用只作用于该 team session 的 stdio/HTTP bridge；bridge config 也不能写入 agent 全局配置。
- 如果 backend 既不支持 native ACP transport，也无法安全 bridge，则不能作为自治 leader/member。

这个机制是“team 功能不影响其他 agent 使用”的关键 invariant，必须进入 shared capability model、CLI session creation tests 和 WebUI capability UI。

## MCP Tool Surface

Mobvibe v1 建议使用 `mobvibe_team_*` 命名，避免与其他 MCP server 工具冲突。

最小工具集合：

- `mobvibe_team_send_message`：向 leader、指定 member 或全体发送消息。
- `mobvibe_team_task_create`：创建任务，支持 owner 和 blockedBy。
- `mobvibe_team_task_update`：更新 status、owner、description 或 blockedBy。
- `mobvibe_team_task_list`：列出当前任务板。
- `mobvibe_team_members`：列出成员、角色、状态和能力。
- `mobvibe_team_spawn_member`：请求创建成员；leader-only，并受用户确认/能力校验约束。
- `mobvibe_team_rename_member`：更新成员显示名；leader-only 或系统确认。
- `mobvibe_team_shutdown_member`：请求成员下线；不能关闭 leader，必须记录确认/拒绝。

可选后续工具：

- `mobvibe_team_describe_agent`：查看可用 backend/preset/assistant 能力。
- `mobvibe_team_list_models`：查看某 backend 可用模型。
- `mobvibe_team_report_progress`：让成员显式更新进度，减少从自然语言输出推断状态。

Tool policy 要持久化并可测试：哪些工具 leader-only，哪些需要用户确认，哪些要求同一 workspace，哪些必须检查 native MCP-over-ACP 或 per-session bridge 能力。

## 数据流

### 创建 team run

1. WebUI 创建 team intent：machine、workspace、title、目标任务、leader backend、workspaceMode、可选成员模板。
2. WebUI 对目标任务或敏感 prompt 使用现有 E2EE/加密路径；明文 metadata 只包含可路由字段。
3. Gateway `POST /acp/team-runs` 认证用户并校验 machine 属于该用户。
4. Gateway 通过 team RPC 把 intent 发给目标 CLI。
5. CLI TeamStore 创建 team run row、leader member row、初始 MCP readiness row。
6. CLI TeamMcpServer 启动本地 server，并为 leader 生成 MCP-over-ACP declaration 或 per-session bridge config。
7. CLI SessionManager 创建 leader 普通 ACP session，并只在该 session 注入 team MCP config。
8. MCP tools ready 后，CLI 通过普通 session send path 把用户目标交给 leader。
9. CLI emit team snapshot；Gateway 转发给 WebUI。

### Leader 协调成员

1. Leader 调用 `mobvibe_team_task_create` 创建任务，TaskBoardStore 持久化。
2. Leader 调用 `mobvibe_team_spawn_member` 请求创建成员。
3. CLI 检查 caller 是 leader、backend 支持 native MCP-over-ACP 或安全 per-session bridge、workspace/worktree 规则满足、是否需要用户确认。
4. CLI 创建普通 member ACP session，只给该 member session 注入同一 team MCP server 的 per-session config，并在 MCP server id 或 bridge metadata 中标记 member identity。
5. Leader 调用 `mobvibe_team_send_message` 给成员分配任务；MailboxStore 先持久化，再 wake 目标成员。
6. 成员读取 unread mailbox、更新 task board、通过普通 session 输出工作进展。

### Mailbox delivery

1. Tool call 到达 CLI TeamMcpServer，server 校验 token、teamRunId、caller member identity 和 tool policy。
2. MailboxStore 写入 message：sender、recipient、type、content/encryptedRef、summary/sourceRef、createdAt、read=false。
3. TeamSessionManager 对目标 member 执行 wake。
4. Wake 成功只更新 wake 状态；wake 失败记录 `wake_failed`，但 message 仍保持已持久化。
5. 目标 agent 下次被唤醒或轮询时读取 unread messages，并原子标记 read。

### Task board update

1. Tool call 创建或更新 task。
2. TaskBoardStore 写入 task metadata、owner、status、blockedBy/blocks、updatedAt。
3. 如果任务完成，store 计算被 unblock 的任务并发出 task changed event。
4. WebUI team detail 通过 snapshot/change event 展示 task board；正文按权限和加密边界处理。

### 取消、重试、归档

- **取消 team run：** 停止或降级 TeamMcpServer，取消 running member 普通 session，取消 pending permission，记录 per-member result。
- **重试 member：** 创建新的 ordinary session/attempt，并重新注入 MCP；旧 session 和 mailbox/task refs 保留。
- **归档 team run：** 标记 team metadata archived，默认不删除成员 session WAL、mailbox 或 task 历史；删除需要用户显式确认。

## 持久化所有权

| 数据 | 系统事实来源 | Gateway 可见内容 |
|------|--------------|------------------|
| ACP session events / transcript | CLI per-session WAL | 加密事件和非内容 routing metadata |
| Session metadata | CLI session store/WAL | `sessionId`、backend、machine、cwd、status、wrappedDek 等现有字段 |
| Team run metadata | CLI TeamStore | `teamRunId`、machine、workspace、status、timestamps、member ids |
| Member mapping | CLI TeamStore | `memberId`、role、backendId、sessionId、status、mcpPhase |
| MCP readiness | CLI TeamStore | transport、phase、timestamps、error code/message |
| Mailbox | CLI MailboxStore | counts、unread count、message ids/source refs；不含正文明文 |
| Task board | CLI TaskBoardStore | status/owner/counts/source refs；正文不明文进 Gateway |
| Summary | WebUI/CLI trusted boundary or encrypted payload | source refs and status only |

建议 CLI store tables：

```text
team_runs(team_run_id, machine_id, workspace_root_cwd, title, status, leader_member_id, workspace_mode, created_at, updated_at, archived_at)
team_members(member_id, team_run_id, role, name, backend_id, session_id, status, mcp_phase, worktree_branch, error_json, created_at, updated_at)
team_mcp_status(team_run_id, member_id nullable, transport, phase, server_id, last_error_json, updated_at)
team_mailbox_messages(message_id, team_run_id, from_member_id, to_member_id, type, encrypted_content_json, source_ref_json, read_at, wake_status, created_at)
team_tasks(task_id, team_run_id, subject_encrypted_json, description_encrypted_json, owner_member_id, status, blocked_by_json, blocks_json, created_at, updated_at)
```

如果 v1 暂时不实现字段级加密，正文只能留在 CLI 本地 store，Gateway-facing snapshot 仍不得包含正文。

## 授权与安全边界

- Gateway 所有 team routes 必须 `requireAuth`，并通过 user-scoped machine/session lookup 验证归属。
- CLI 对 tool call 再做 team/member identity 校验，不能只相信 MCP env。
- MCP-over-ACP 优先走现有 ACP channel；bridge fallback 如需本地 server，只能监听 loopback，并使用 per-team token 或等价鉴权。
- `spawn_member`、`shutdown_member`、跨 workspace、修改 worktree 策略、高风险权限必须有系统 policy 和用户确认边界。
- Gateway logs 只记录 IDs、counts、status、backendId、error code；不记录 prompt、mailbox、task、summary、agent output。
- 未授权和不存在应继续合并为 generic not found / not authorized，避免泄漏其他用户资源。

## Socket 事件策略

不要把 team 生命周期、mailbox 或 task board 事件塞进 `SessionEventKind`。成员 transcript 仍走现有 `session:event`；team coordination 使用独立 snapshot/change event。

推荐事件：

- CLI → Gateway：`team-runs:changed`、`team-run:mcp-status`、`team-run:task-changed`、`team-run:mailbox-changed`。
- Gateway → WebUI：同名或规范化为 `team-run:changed`、`team-task:changed`、`team-mailbox:changed`。
- WebUI → Gateway：`subscribe:team-run`、`unsubscribe:team-run`。

v1 可先广播用户所有 team snapshot，后续再加 per-team subscription。成员 session 内容仍通过现有 `subscribe:session` 展示。

## WebUI 状态结构

Team store 只保存 coordination projection，不保存 transcript。

```typescript
type TeamState = {
	teamRuns: Record<string, TeamRunSummary>;
	activeTeamRunId?: string;
	selectedMemberId?: string;
	mcpStatusByMember: Record<string, TeamMcpPhase>;
	taskCountsByTeam: Record<string, TeamTaskCounts>;
	mailboxCountsByTeam: Record<string, TeamMailboxCounts>;
};
```

UI 展示建议：

- Team list 按 machine/workspace 分组。
- Team detail 第一屏显示 leader、members、MCP readiness、task counts、permission blockers 和 errors。
- Task board 和 mailbox 活动默认显示非内容摘要；点击后按可信域权限加载详情。
- Member card 永远提供普通 session 跳转。
- Mobile 使用折叠卡片，不依赖大表格。

## Gateway 路由与服务结构

推荐新增独立 team routes/router，不继续扩大 session routes/router：

```text
apps/gateway/src/routes/team-runs.ts
apps/gateway/src/services/team-router.ts
```

Gateway 只负责 user-scoped RPC 和 shape validation。Team 状态机、MCP server、mailbox、task board 都在 CLI。

## CLI 模块结构

推荐新增：

```text
apps/mobvibe-cli/src/team/team-store.ts
apps/mobvibe-cli/src/team/team-session-manager.ts
apps/mobvibe-cli/src/team/team-mcp-server.ts
apps/mobvibe-cli/src/team/mailbox-store.ts
apps/mobvibe-cli/src/team/task-board-store.ts
apps/mobvibe-cli/src/team/team-capabilities.ts
```

`SessionManager` 只暴露必要内部方法供 `TeamSessionManager` 创建 session、send message、cancel session、archive session。不要把 team mailbox/task/MCP tool dispatch 直接塞进 SessionManager。

## Testing Strategy

- Shared tests：status derivation、payload redaction、tool policy validation、MCP-over-ACP/bridge capability gating helpers。
- CLI Bun tests：TeamMcpServer tool dispatch、per-session MCP declaration/bridge isolation、mailbox write/read/wake state、task dependency update、MCP readiness recovery、spawn backend capability check。
- Gateway Vitest：auth/ownership、RPC routing、payload 不接受 plaintext content、generic error shape。
- WebUI Vitest：team store 不复制 transcript、MCP degraded 显示、permission 定位、task/mailbox projection。
- E2E/manual：创建 leader team、leader spawn member、成员通过 mailbox/task board 协作、Gateway 重启后恢复 snapshot。

## Sources

- `.planning/research/AIONUI-ACP-TEAM.md` — AionUI team MCP/mailbox/task board 研究。
- `.planning/codebase/ARCHITECTURE.md` — 当前 WebUI/Gateway/CLI/ACP 分层。
- `.planning/codebase/CONCERNS.md` — WAL、E2EE、permission、Gateway registry 风险。
- Current Mobvibe session/router/WAL/WebUI store patterns.
- ACP RFD `https://agentclientprotocol.com/rfds/mcp-over-acp` — per-session MCP server declaration over ACP channels, `mcpCapabilities.acp`, routing by component-generated id, and bridge fallback.

---
*Architecture research updated: 2026-05-12 after AionUI ACP team correction*
