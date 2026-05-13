# Phase 1 上下文：协议、状态模型与持久化边界

## 读者与目标

本文面向接下来实现 Phase 1 的工程师。读完后应能直接设计并实现 `packages/shared` 的 Agent Team 类型、CLI durable store schema、Gateway/WebUI 可见 projection，以及与普通 session/WAL 的边界，不需要重新讨论产品概念、状态粒度或内容安全红线。

## Phase 1 目标

Phase 1 只建立稳定、可恢复、跨 WebUI/Gateway/CLI 一致理解的 Agent Team 元数据基础。它不启动真实 agent，不实现完整 team tools UI，也不实现自动总结。

必须成立的结果：

- 用户拥有一个稳定的 Agent Team 对象，刷新后 ID、标题、machine、workspace、leader、状态和时间戳保持一致。
- 每个 leader/member 都有可恢复的 backend、role、ordinary `sessionId` 关联占位、MCP phase、worktree 策略和状态字段。
- CLI 重启后可以从本地 durable store 恢复 team、member、MCP readiness、mailbox/task metadata 和 source refs。
- Gateway/WebUI 只接收非内容 projection，不接收 mailbox/task/summary 正文或 agent 输出明文。
- `packages/shared` 提供统一类型，避免 WebUI、Gateway 和 CLI 各自发明状态枚举或 payload shape。

## 已锁定产品模型

Mobvibe v1 的用户概念是 **Agent Team**。不要把 “team run” 作为主要用户语言。

Agent Team 采用 AionUI 证明过的协作模型：

- 一个 Agent Team 有 leader、可动态加入/移除/重命名的 members、共享 workspace、mailbox、task board 和 per-agent session 链接。
- 初始 team 可以只有 leader。
- Leader 可以建议成员阵容，但 `team_spawn_member` 必须经过系统 policy 和用户确认。
- 每个 member 都是普通 ACP session，继续拥有原 session 的 WAL、E2EE、权限、文件、Git、worktree 和聊天历史语义。
- Team 层只负责协调事实和聚合视图，不替代普通 session。

核心不变量：**team owns coordination facts; session owns conversation facts**。

## WebUI 展示模型

WebUI 展示方向锁定为 AionUI baseline：**Agent Team 是独立一级对象，不是普通 session 的一种 kind**。

用户应清楚看到两层：

- Agent Team：团队协作容器，展示 title、workspace、leader、members、MCP readiness、task/mailbox projection、source refs 和总体状态。
- Member session：team 内每个 leader/member 仍然是 ordinary ACP session，拥有自己的 `sessionId`、history、permission、文件/Git 和 worktree 能力。

普通 session 列表不应把 team-owned member sessions 当成独立普通会话平铺展示。推荐行为是：

- 普通 session 列表默认隐藏或折叠 `teamId`/`agentTeamId` 标记的 member sessions。
- Agent Team section/list 单独展示 team 对象。
- 进入 Agent Team detail 后，以 tabs、多列或 member cards 展示 leader/members。
- 用户从 member card 跳转或切换到对应 ordinary session history。
- 成员 session 的存在必须可审计，但入口应由 Agent Team 组织，避免用户误以为每个 member 是不相关的普通会话。

因此不采用 `Session(kind = "team")` 作为主模型。Team 与 session 的关系是 aggregate-to-members：

```text
AgentTeam
  leader -> ordinary session
  member -> ordinary session
  member -> ordinary session
```

## Gateway API 形态

Gateway API 采用混合方案：**对 WebUI 暴露显式 Agent Team 资源 API，对 CLI 使用 typed RPC 转发**。

WebUI 面向稳定产品对象调用：

```http
POST /acp/agent-teams
GET /acp/agent-teams
GET /acp/agent-teams/:agentTeamId
```

Gateway 内部不拥有 Agent Team durable truth。它只负责：

- 认证当前用户。
- 校验 machine ownership。
- 校验请求 shape 和内容边界。
- 把资源 API 转换为 typed CLI socket RPC，如 `rpc:agent-team:create`、`rpc:agent-teams:list`、`rpc:agent-team:get`。
- 把 CLI 返回的 Gateway-facing projection 转发给 WebUI。
- 转发 `agent-teams:changed` projection event 给当前用户的 WebUI。

CLI 仍然是 Agent Team durable truth owner：

- CLI AgentTeamStore 保存 `agent_teams`、members、MCP readiness、mailbox/task metadata 和 source refs。
- CLI 生成 projection。
- Gateway 不持久化 Agent Team state，不存 mailbox/task/summary 正文。

该方案避免 generic `machine rpc` 泄漏到 WebUI，同时保持事实来源在 CLI。结论：`/acp/agent-teams` 是 Gateway-facing control API，不代表 Gateway owns Agent Team state。

## 内容边界

Gateway 不能接收、存储或记录以下明文：

- 用户目标、prompt、agent 输出。
- mailbox 正文。
- task 标题、描述或正文。
- summary 正文。
- provider token、master secret、DEK 或任何密钥材料。

CLI 本地可以保存 mailbox/task 正文，供 agents 通过 team tools 协作。Gateway/WebUI team snapshot 只能携带 ids、status、counts、timestamps、backend/workspace metadata、error code/message、source refs 和 projection。

用户查看正文的 v1 路径：

- 用户可以切换到任意 member ordinary session 查看完整 E2EE history。
- mailbox 投递给某个 agent 后，也应在目标 agent 的 ordinary session history 中可见，便于审计完整上下文。
- team projection 不复制正文，只提供跳转和定位信息。
- 后续若要远程展示 mailbox/task 详情，必须走 CLI-local trusted boundary 或 E2EE/encrypted payload，不得让 Gateway 解密或持久化明文。

## 状态模型

状态模型采用拆分维度，不使用 `idle` 或 `ready` 作为 lifecycle 状态。

原因：`idle`/`ready` 容易把“是否有事可做”“MCP 是否可用”“是否等待用户权限”混成一个状态，导致 WebUI、Gateway 和 CLI 字段漂移。Phase 1 应把这些语义拆开，UI 再派生展示状态。

### Team lifecycle

`AgentTeamLifecycle` 表达 team 自身生命周期：

```typescript
type AgentTeamLifecycle =
	| "pending"
	| "starting"
	| "running"
	| "completed"
	| "failed"
	| "cancelled"
	| "archived";
```

### Member lifecycle

`TeamMemberLifecycle` 表达 member ordinary session 的生命周期：

```typescript
type TeamMemberLifecycle =
	| "pending"
	| "creating_session"
	| "running"
	| "completed"
	| "failed"
	| "cancelled"
	| "detached"
	| "archived";
```

`detached` 表示 team 仍知道这个 member，但底层 ordinary session 不再 attached 或暂时无法恢复。它不是失败本身，UI 应结合 health/error 判断。

### MCP readiness

MCP readiness 是独立维度，不进入 member lifecycle：

```typescript
type TeamMcpPhase =
	| "not_started"
	| "server_starting"
	| "server_ready"
	| "session_injecting"
	| "tools_waiting"
	| "tools_ready"
	| "degraded"
	| "error";
```

Phase 1 类型需要表达 transport：

```typescript
type TeamMcpTransport = "acp" | "stdio_bridge" | "http_bridge";
```

Native `mcpCapabilities.acp` 是首选。没有 native support 时，只允许 per-team-session bridge fallback，不允许修改 agent 全局 MCP 配置。

### Permission 与 activity projection

权限等待和 activity 也是独立 projection：

- `pendingPermissionCount` 或 `pendingPermissionRequestIds` 指向普通 session 的 permission request。
- `unreadMailboxCount`、`wakeFailedCount`、`activeTaskCount`、`blockedTaskCount` 用于表达成员是否有待处理协作事项。
- `lastActivityAt`、`lastMailboxAt`、`lastTaskUpdatedAt` 用于排序和 UI 高亮。

这些字段可以让 UI 显示“需要处理”“有未读消息”“任务阻塞”，但不把 `idle` 写入 lifecycle。

### Derived display status

WebUI 可以派生展示状态，但派生状态不是新的事实来源。

建议派生顺序：

- `archived` 优先。
- 任何 pending permission 派生为 `needs_attention`。
- 任何 MCP/member health degraded 派生为 `degraded`。
- 所有成员完成且有失败/取消成员时派生为 `completed_with_errors`。
- 所有成员完成且无错误时派生为 `completed`。
- 其它非终态派生为 `starting` 或 `running`。

## Source refs

Source refs 是强类型定位引用，不承载正文。

Phase 1 应提供 union type，至少覆盖：

```typescript
type TeamSourceRef =
	| {
			type: "session_event";
			agentTeamId: string;
			memberId: string;
			sessionId: string;
			revision: number;
			seq: number;
		}
	| {
			type: "member_session";
			agentTeamId: string;
			memberId: string;
			sessionId: string;
		}
	| {
			type: "mailbox_message";
			agentTeamId: string;
			messageId: string;
			fromMemberId: string;
			toMemberId?: string;
			deliveredSessionId?: string;
		}
	| {
			type: "task";
			agentTeamId: string;
			taskId: string;
			ownerMemberId?: string;
		};
```

跳转语义：

- `session_event` 优先跳到普通 session history 的对应 revision/seq。
- `member_session` 跳到成员普通 session。
- `mailbox_message` 默认跳到接收者普通 session history；如果还没有 `deliveredSessionId`，只显示 metadata 和 delivery/wake 状态。
- `task` 默认定位 task metadata；正文不可通过 Gateway 获取。若 task 有 source session event，则 UI 可跳 ordinary session history。

Source refs 可以出现在 mailbox metadata、task metadata、summary refs 和错误详情中。它们只用于审计、跳转、重试和解释来源。

## 持久化事实来源

Phase 1 锁定为 **CLI SQLite 当前事实表 + projection builder**。

不在 Phase 1 新增 team append-only WAL。成员 transcript 仍由普通 session WAL 拥有。Gateway 只保存在线 presence 和转发 snapshot，不是 durable truth。

建议 CLI durable tables：

```text
agent_teams(
  agent_team_id,
  machine_id,
  workspace_root_cwd,
  title,
  lifecycle,
  leader_member_id,
  workspace_mode,
  created_at,
  updated_at,
  archived_at
)

agent_team_members(
  member_id,
  agent_team_id,
  role,
  name,
  backend_id,
  session_id,
  lifecycle,
  health,
  worktree_source_cwd,
  worktree_branch,
  error_json,
  created_at,
  updated_at
)

agent_team_mcp_status(
  agent_team_id,
  member_id,
  transport,
  server_id,
  phase,
  last_error_json,
  updated_at
)

agent_team_mailbox_messages(
  message_id,
  agent_team_id,
  from_member_id,
  to_member_id,
  body_local_json,
  source_refs_json,
  read_at,
  wake_status,
  created_at
)

agent_team_tasks(
  task_id,
  agent_team_id,
  owner_member_id,
  status,
  body_local_json,
  blocked_by_json,
  blocks_json,
  source_refs_json,
  created_at,
  updated_at
)

agent_team_summary_refs(
  summary_ref_id,
  agent_team_id,
  source_refs_json,
  status,
  created_at,
  updated_at
)
```

`body_local_json` 表示 CLI-local 内容字段。它不得出现在 Gateway-facing payload、socket event、Gateway log 或 WebUI store 的 team projection 中。

Projection builder 负责从 durable tables 生成 `AgentTeamSummary`、`TeamMemberSummary`、mailbox counts、task counts 和 MCP status。projection 是可重建视图，不是新的事实来源。

## Gateway-facing projection

Gateway-facing shape 只允许以下类别：

- IDs：`agentTeamId`、`memberId`、`sessionId`、`messageId`、`taskId`。
- 路由 metadata：`machineId`、`backendId`、`workspaceRootCwd`、worktree branch/source。
- 状态：lifecycle、MCP phase、permission/activity counts、wake status、task status counts。
- 时间戳：created/updated/last activity。
- 错误：`ErrorDetail` 或 team 扩展错误，必须只含 code/message/retryable/scope/detail，不含正文。
- Source refs：强类型定位字段，不含正文。

不允许字段：`prompt`、`content`、`body`、`description`、`summaryText`、`agentOutput`，除非它们是明确的 `EncryptedPayload` 且 Gateway 不解密、不记录。

## Shared 类型实施建议

Phase 1 应新增 team 类型文件，并从 shared 入口导出。建议类型组：

- Team identity：`AgentTeamId`、`TeamMemberId`、`TeamMailboxMessageId`、`TeamTaskId`。
- Lifecycle/status：`AgentTeamLifecycle`、`TeamMemberLifecycle`、`TeamMcpPhase`、`TeamMcpTransport`、`TeamMemberHealth`。
- Projection：`AgentTeamSummary`、`TeamMemberSummary`、`TeamTaskCounts`、`TeamMailboxCounts`、`TeamMcpStatusSummary`。
- Source refs：`TeamSourceRef` union。
- RPC payload：create/list/get Agent Team params/results；Phase 1 可以只定义 shape，不实现 full runtime。
- Redaction helpers 或 type-level comments：明确哪些字段是 Gateway-facing，哪些只能 CLI-local。

`AgentSessionCapabilities` 需要扩展 MCP capability discovery：

```typescript
type AgentMcpCapabilities = {
	acp?: boolean;
	stdio?: boolean;
	perSessionBridge?: boolean;
};
```

最终命名可以按现有 shared 风格调整，但必须表达 native ACP、stdio/bridge fallback 和不可作为自治 teammate 的情况。

## Phase 1 非目标

- 不实现真实 `mobvibe_team_*` MCP tools。
- 不实现 leader spawn member 运行逻辑。
- 不实现 task board/mailbox 正文远程详情 UI。
- 不新增 Gateway durable team storage。
- 不把普通 session event 塞进 team event 类型。
- 不新增 team append-only WAL，除非后续审计需求明确要求。

## 冷读检查结果

冷读检查结论：本文能支持工程师执行 Phase 1 的类型与 store 设计，因为它明确回答了四个实现前必须知道的问题：产品对象是什么、状态如何拆分、正文在哪里、重启后从哪里恢复。剩余实现细节主要是命名和模块切分，可在 Phase 1 plan 中继续拆任务，不需要重新打开产品决策。
