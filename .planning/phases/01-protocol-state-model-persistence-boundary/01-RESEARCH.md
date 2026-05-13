# Phase 1: 协议、状态模型与持久化边界 - Research

**Researched:** 2026-05-13  
**Domain:** 分布式 ACP Agent Team 协议、状态模型、CLI SQLite durable store、Gateway projection 边界  
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

以下内容逐字来自 Phase 1 CONTEXT，用作 planner 必须遵守的用户约束。[VERIFIED: .planning/phases/01-protocol-state-model-persistence-boundary/01-CONTEXT.md]

### Locked Decisions

Mobvibe v1 的用户概念是 **Agent Team**。不要把 “team run” 作为主要用户语言。

Agent Team 采用 AionUI 证明过的协作模型：

- 一个 Agent Team 有 leader、可动态加入/移除/重命名的 members、共享 workspace、mailbox、task board 和 per-agent session 链接。
- 初始 team 可以只有 leader。
- Leader 可以建议成员阵容，但 `team_spawn_member` 必须经过系统 policy 和用户确认。
- 每个 member 都是普通 ACP session，继续拥有原 session 的 WAL、E2EE、权限、文件、Git、worktree 和聊天历史语义。
- Team 层只负责协调事实和聚合视图，不替代普通 session。

核心不变量：**team owns coordination facts; session owns conversation facts**。

WebUI 展示方向锁定为 AionUI baseline：**Agent Team 是独立一级对象，不是普通 session 的一种 kind**。

Gateway API 采用混合方案：**对 WebUI 暴露显式 Agent Team 资源 API，对 CLI 使用 typed RPC 转发**。

CLI 仍然是 Agent Team durable truth owner：

- CLI AgentTeamStore 保存 `agent_teams`、members、MCP readiness、mailbox/task metadata 和 source refs。
- CLI 生成 projection。
- Gateway 不持久化 Agent Team state，不存 mailbox/task/summary 正文。

Gateway 不能接收、存储或记录以下明文：

- 用户目标、prompt、agent 输出。
- mailbox 正文。
- task 标题、描述或正文。
- summary 正文。
- provider token、master secret、DEK 或任何密钥材料。

状态模型采用拆分维度，不使用 `idle` 或 `ready` 作为 lifecycle 状态。

Phase 1 锁定为 **CLI SQLite 当前事实表 + projection builder**。

不在 Phase 1 新增 team append-only WAL。成员 transcript 仍由普通 session WAL 拥有。Gateway 只保存在线 presence 和转发 snapshot，不是 durable truth。

### the agent's Discretion

最终命名可以按现有 shared 风格调整，但必须表达 native ACP、stdio/bridge fallback 和不可作为自治 teammate 的情况。

### Deferred Ideas (OUT OF SCOPE)

- 不实现真实 `mobvibe_team_*` MCP tools。
- 不实现 leader spawn member 运行逻辑。
- 不实现 task board/mailbox 正文远程详情 UI。
- 不新增 Gateway durable team storage。
- 不把普通 session event 塞进 team event 类型。
- 不新增 team append-only WAL，除非后续审计需求明确要求。
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TEAM-01 | 用户可以拥有稳定 team run/Agent Team 对象，包含 ID、title、machine、workspace、leader、状态和创建/更新时间。 | 使用 `AgentTeamSummary` + CLI `agent_teams` 当前事实表 + Gateway projection；用户语言应显示 Agent Team 而非把它建模成 `Session(kind="team")`。[VERIFIED: .planning/REQUIREMENTS.md][VERIFIED: .planning/phases/01-protocol-state-model-persistence-boundary/01-CONTEXT.md] |
| TEAM-02 | Team run 可以包含 leader 和 member；每个成员包含 memberId、role、backendId、sessionId 关联、MCP phase、worktree 策略和状态。 | 使用 `TeamMemberSummary`、`TeamMcpStatusSummary`、`TeamMemberLifecycle` 与 worktree 字段；member 仍关联 ordinary ACP `sessionId`。[VERIFIED: .planning/REQUIREMENTS.md][VERIFIED: packages/shared/src/types/session.ts] |
| TEAM-03 | CLI 可以本地持久化 team、member 映射、MCP readiness、mailbox、task board 和 summary source refs，并在 CLI 重启后恢复。 | 复用现有 Bun SQLite/WAL migration 风格新增 AgentTeamStore 当前事实表；不要把 team coordination facts 写入 Gateway durable DB。[VERIFIED: apps/mobvibe-cli/src/wal/migrations.ts][VERIFIED: .planning/phases/01-protocol-state-model-persistence-boundary/01-CONTEXT.md] |
| TEAM-04 | WebUI、Gateway 和 CLI 使用 `packages/shared` 中统一的 team、MCP、mailbox、task、RPC payload、状态枚举和错误结构。 | 新增 `packages/shared/src/types/agent-team.ts` 并从 `packages/shared/src/index.ts` 显式导出；Socket/HTTP/RPC payload 使用 shared 类型。[VERIFIED: packages/shared/src/index.ts][VERIFIED: packages/shared/AGENTS.md] |
| TEAM-05 | Team metadata、mailbox metadata、task metadata 和 summary refs 明确区分 Gateway-facing 非内容字段、加密 payload、CLI-local 内容和 source refs。 | 类型层强制分离 `GatewayProjection`、`EncryptedPayload`、`CliLocalContent`、`TeamSourceRef`；Gateway validators 拒绝 `prompt/content/body/description/summaryText/agentOutput` 等明文字段。[VERIFIED: .planning/phases/01-protocol-state-model-persistence-boundary/01-CONTEXT.md][VERIFIED: packages/shared/src/crypto/types.ts via index export] |
| LIFE-01 | Team/member lifecycle 与 MCP phase、permission waiting、degraded health、activity projection 分维度表达；不把 idle/ready 作为 lifecycle 状态。 | 采用 locked lifecycle union：team `pending/starting/running/completed/failed/cancelled/archived`，member `pending/creating_session/running/completed/failed/cancelled/detached/archived`，MCP readiness 独立。[VERIFIED: .planning/REQUIREMENTS.md][VERIFIED: .planning/phases/01-protocol-state-model-persistence-boundary/01-CONTEXT.md] |
</phase_requirements>

## Summary

Phase 1 应交付的是“协议与事实边界”，不是完整运行时：把 Agent Team 作为独立产品对象建模，leader/member 仍是 ordinary ACP session，team 层只保存协调事实、projection 与 source refs。[VERIFIED: .planning/phases/01-protocol-state-model-persistence-boundary/01-CONTEXT.md][VERIFIED: .planning/PROJECT.md] 计划应优先在 `packages/shared` 锁定类型与错误结构，然后在 CLI 增加 SQLite current-state AgentTeamStore 和 projection builder，最后让 Gateway/WebUI 只处理非内容 snapshot 与 typed RPC payload。[VERIFIED: packages/shared/src/index.ts][VERIFIED: apps/mobvibe-cli/src/wal/migrations.ts][VERIFIED: apps/gateway/src/routes/sessions.ts]

最关键的架构边界是：CLI owns coordination facts，ordinary session WAL owns conversation facts，Gateway owns auth/routing/presence only。[VERIFIED: .planning/phases/01-protocol-state-model-persistence-boundary/01-CONTEXT.md][VERIFIED: apps/gateway/src/services/cli-registry.ts] AionUI/Claude Team prior art 支持 durable mailbox/task board、leader/member 多 agent 协作与状态可观测性；ACP MCP-over-ACP RFD 支持 per-session MCP server declaration、`mcpCapabilities.acp` 和按 server `id` 路由 callback，这些决定 Phase 1 必须提前建模 MCP readiness 与 capability shape，虽然真实 MCP runtime 留到 Phase 2。[VERIFIED: ../AionUi/docs/research/claude-team-mode-analysis.md][CITED: https://agentclientprotocol.com/rfds/mcp-over-acp]

**Primary recommendation:** 先做 shared `agent-team.ts` 类型 + CLI `agent_team_*` SQLite current-state schema + projection builder + Gateway/WebUI 非内容 contract tests；不要实现 team MCP tools、spawn runtime、UI polish 或 team append-only WAL。[VERIFIED: .planning/phases/01-protocol-state-model-persistence-boundary/01-CONTEXT.md]

## Project Constraints (from AGENTS.md)

- 使用 `pnpm`，不要使用 `npm`；提交前标准命令是 `pnpm format && pnpm lint` 与 `pnpm build`。[VERIFIED: AGENTS.md]
- Biome 是唯一格式化与 lint 依据；缩进 tabs、字符串双引号、不要手动整理 import 顺序。[VERIFIED: AGENTS.md]
- TypeScript 禁止 `any`，未知类型使用 `unknown` 并收窄；函数尽量聚焦且 50 行以内。[VERIFIED: AGENTS.md]
- 所有包均使用 ESM；新增公共类型或工具时必须更新对应入口，例如 `packages/shared/src/index.ts`。[VERIFIED: AGENTS.md][VERIFIED: packages/shared/AGENTS.md]
- gateway/CLI 日志优先使用现有 pino 体系，避免长期 `console.log`；不得静默捕获异常。[VERIFIED: AGENTS.md]
- gateway 新增 env 变量需同步文档，禁止提交密钥。[VERIFIED: AGENTS.md]
- gateway/core/cli 测试放在 `src/**/__tests__/` 且命名 `*.test.ts`；webui 测试放在 `src/__tests__/` 或 `tests/` 且命名 `*.test.ts(x)`。[VERIFIED: AGENTS.md]
- 与 webui 相关提交前需进行 React Best Practice 与 Web Design Guideline 检查。[VERIFIED: AGENTS.md]
- 沟通与文档使用中文；代码标识符与注释使用英文。[VERIFIED: /home/eric/.config/opencode/AGENTS.md]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Agent Team shared protocol/types | Shared package | WebUI/Gateway/CLI | 所有跨进程 payload 必须从 `packages/shared` 导出，避免 WebUI、Gateway、CLI 字段漂移。[VERIFIED: packages/shared/src/index.ts][VERIFIED: .planning/REQUIREMENTS.md] |
| Team durable truth | CLI / Storage | Shared package | Phase 1 locked 为 CLI SQLite 当前事实表；Gateway 不持久化 Agent Team truth。[VERIFIED: .planning/phases/01-protocol-state-model-persistence-boundary/01-CONTEXT.md] |
| Member conversation history | CLI ordinary session WAL | WebUI session store | 成员仍是 ordinary ACP session，conversation facts 继续由普通 session WAL/事件回放拥有。[VERIFIED: .planning/phases/01-protocol-state-model-persistence-boundary/01-CONTEXT.md][VERIFIED: apps/mobvibe-cli/src/wal/wal-store.ts] |
| Gateway-facing Agent Team resources | API / Gateway | CLI RPC | WebUI 调 `/acp/agent-teams`，Gateway 认证、校验 ownership 与内容边界，再转 typed CLI RPC。[VERIFIED: .planning/phases/01-protocol-state-model-persistence-boundary/01-CONTEXT.md][VERIFIED: apps/gateway/src/routes/sessions.ts] |
| Team projection events | CLI projection builder | Gateway socket relay / WebUI store | CLI 生成 `agent-teams:changed` 非内容 projection，Gateway 只按 user 转发。[VERIFIED: .planning/phases/01-protocol-state-model-persistence-boundary/01-CONTEXT.md][VERIFIED: apps/gateway/src/socket/cli-handlers.ts] |
| MCP readiness/capability state | CLI / Shared model | ACP backend capability cache | ACP RFD 规定 agent 通过 `mcpCapabilities.acp` 广告能力；Phase 1 需持久化 readiness phase 但不启动 runtime。[CITED: https://agentclientprotocol.com/rfds/mcp-over-acp][VERIFIED: packages/shared/src/types/session.ts] |
| Content boundary enforcement | Shared types + Gateway validators | CLI local store | Gateway payload 只允许 ids/status/counts/errors/source refs；正文必须留在 CLI-local 或 encrypted payload。[VERIFIED: .planning/phases/01-protocol-state-model-persistence-boundary/01-CONTEXT.md][VERIFIED: apps/gateway/src/routes/sessions.ts] |

## Standard Stack

### Core

| Library / Tool | Version | Purpose | Why Standard |
|----------------|---------|---------|--------------|
| TypeScript | 当前项目 `~5.9.3`；npm current `6.0.3`，modified 2026-04-16 | shared 类型、Gateway/CLI/WebUI payload contract | 项目已统一 TS/ESM；Phase 1 是类型和边界工作，应避免引入新运行时协议层。[VERIFIED: package.json][VERIFIED: npm registry] |
| `@agentclientprotocol/sdk` | 当前项目 `^0.16.1`；npm current `0.21.0`，modified 2026-04-28 | ACP session 类型、capability discovery、`newSession/loadSession` mcpServers 参数 | 当前 shared/CLI 已依赖 SDK；Context7 示例显示 `newSession`/`loadSession` 接受 `mcpServers`，ACP RFD 定义 MCP-over-ACP capability shape。[VERIFIED: packages/shared/package.json][VERIFIED: Context7 /agentclientprotocol/typescript-sdk][CITED: https://agentclientprotocol.com/rfds/mcp-over-acp] |
| Bun `bun:sqlite` | Bun runtime `1.3.13` verified local | CLI durable SQLite store | CLI WAL 已使用 `bun:sqlite`、schema migrations、`PRAGMA journal_mode=WAL`；AgentTeamStore 应复用同类模式而非引入 `better-sqlite3`。[VERIFIED: apps/mobvibe-cli/src/wal/wal-store.ts][VERIFIED: apps/mobvibe-cli/src/wal/migrations.ts][VERIFIED: local `bun --version`] |
| Zod | 当前项目 `^4.3.5`；npm current `4.4.3`，modified 2026-05-04 | Gateway route/RPC payload runtime validation、content-boundary reject list | 项目已在 shared 依赖 zod；Gateway 需要 runtime shape validation，纯 TS 类型不足以拒绝 hostile JSON body。[VERIFIED: packages/shared/package.json][VERIFIED: npm registry][ASSUMED] |
| Socket.io | gateway `^4.8.1` / webui client `^4.8.1` | CLI ↔ Gateway ↔ WebUI event/RPC relay | 现有 gateway socket handlers 已使用 `rpc:response`、`sessions:changed`、`session:event` 模式；team RPC/event 应复用同一 typed socket channel。[VERIFIED: apps/gateway/package.json][VERIFIED: packages/shared/src/types/socket-events.ts] |
| Biome | 当前项目 `2.3.11`；npm current `2.4.15`，modified 2026-05-09 | 格式化/lint | AGENTS.md 明确 Biome 是唯一格式化与 lint 依据。[VERIFIED: AGENTS.md][VERIFIED: npm registry] |

### Supporting

| Library / Tool | Version | Purpose | When to Use |
|----------------|---------|---------|-------------|
| Vitest | 当前项目 `^2.1.8`；npm current `4.1.6`，modified 2026-05-11 | shared/gateway/webui unit tests | 用于 shared type guards、Gateway validators、webui store tests；项目现有 gateway/webui/shared scripts 已支持。[VERIFIED: packages/shared/package.json][VERIFIED: apps/gateway/package.json][VERIFIED: npm registry] |
| Bun test | Bun `1.3.13` local | CLI AgentTeamStore/projection tests | CLI package test script 是 `bun test`，新增 CLI store tests 应放 `apps/mobvibe-cli/src/**/__tests__/`。[VERIFIED: apps/mobvibe-cli/package.json][VERIFIED: apps/mobvibe-cli/AGENTS.md][VERIFIED: local `bun --version`] |
| pino | CLI/Gateway `^9.6.0` | structured logs and redaction | Gateway/CLI 已使用 pino；Agent Team route/store 不应用 `console.log` 或记录明文内容。[VERIFIED: apps/gateway/package.json][VERIFIED: apps/mobvibe-cli/package.json][VERIFIED: AGENTS.md] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Bun `bun:sqlite` current-state tables | `better-sqlite3` | `better-sqlite3` npm current `12.10.0`，但项目 CLI 已有 `bun:sqlite` migration/WAL 模式；引入新 sqlite binding 会增加构建和分发风险。[VERIFIED: apps/mobvibe-cli/src/wal/wal-store.ts][VERIFIED: npm registry][ASSUMED] |
| CLI current-state tables | Team append-only WAL | CONTEXT 锁定 Phase 1 不新增 team append-only WAL；当前 facts + projection 足够支持恢复，member transcript 继续由 ordinary WAL 拥有。[VERIFIED: .planning/phases/01-protocol-state-model-persistence-boundary/01-CONTEXT.md] |
| Explicit `/acp/agent-teams` API | Generic machine RPC exposed to WebUI | CONTEXT 锁定 WebUI 使用稳定资源 API，Gateway 内部转 typed CLI RPC；generic RPC 会泄漏 CLI implementation detail。[VERIFIED: .planning/phases/01-protocol-state-model-persistence-boundary/01-CONTEXT.md] |

**Installation:** Phase 1 不应新增 runtime dependency；如采用 Zod validators，优先复用已有 `@mobvibe/shared` dependency。[VERIFIED: packages/shared/package.json]

```bash
pnpm install
```

**Version verification:** 2026-05-13 已用 `pnpm view` 验证 `@agentclientprotocol/sdk`、`zod`、`typescript`、`@biomejs/biome`、`vitest`、`better-sqlite3` 当前 npm 版本与 `time.modified`。[VERIFIED: npm registry]

## Architecture Patterns

### System Architecture Diagram

```text
WebUI Agent Team list/detail
  │  GET/POST /acp/agent-teams (non-content params/projection only)
  ▼
Gateway REST route
  ├─ authenticate user
  ├─ validate machine ownership
  ├─ reject plaintext content fields
  └─ typed Socket.io RPC: rpc:agent-team:{create,list,get}
       ▼
CLI daemon AgentTeamRpcHandler
  ├─ AgentTeamStore (SQLite current facts)
  │    ├─ agent_teams
  │    ├─ agent_team_members
  │    ├─ agent_team_mcp_status
  │    ├─ agent_team_mailbox_messages (body_local_json never projected)
  │    ├─ agent_team_tasks (body_local_json never projected)
  │    └─ agent_team_summary_refs
  ├─ ProjectionBuilder (counts/status/source refs/errors)
  └─ ordinary SessionManager/WAL link by sessionId
       ▼
Gateway relay
  └─ agent-teams:changed → authenticated user's WebUI sockets
       ▼
WebUI Team Store
  ├─ stores projection only
  └─ uses source refs/sessionId to navigate into ordinary session history
```

该数据流保持 WebUI/Gateway/CLI 分层，Gateway 不成为 durable truth，也不接触 team/mailbox/task/summary 正文。[VERIFIED: .planning/PROJECT.md][VERIFIED: .planning/phases/01-protocol-state-model-persistence-boundary/01-CONTEXT.md]

### Recommended Project Structure

```text
packages/shared/src/types/
├── agent-team.ts              # AgentTeam IDs, lifecycle, projection, source refs, RPC payloads
├── errors.ts                  # extend ErrorScope/ErrorCode for team/member/MCP validation
└── session.ts                 # extend AgentSessionCapabilities with mcp capability fields

apps/mobvibe-cli/src/team/
├── agent-team-store.ts        # SQLite current facts + migrations wrapper
├── projection-builder.ts      # durable facts -> Gateway-facing AgentTeamSummary
├── content-boundary.ts        # redaction/assert helpers for projection payloads
└── __tests__/
    ├── agent-team-store.test.ts
    └── projection-builder.test.ts

apps/gateway/src/routes/
└── agent-teams.ts             # /acp/agent-teams resource API -> typed CLI RPC

apps/gateway/src/socket/
└── cli-handlers.ts            # add agent-teams:changed relay + rpc response handling reuse
```

该结构遵循 shared 类型显式导出、CLI tests colocated、Gateway routes/services/socket 分层等现有约定。[VERIFIED: packages/shared/AGENTS.md][VERIFIED: apps/mobvibe-cli/AGENTS.md][VERIFIED: apps/gateway/AGENTS.md]

### Pattern 1: Shared-first Contract

**What:** 所有 HTTP、Socket.io、CLI RPC、WebUI store 使用 `@mobvibe/shared` 导出的 team 类型；Gateway route 只接受/返回这些 projection/result shape。[VERIFIED: packages/shared/src/index.ts][VERIFIED: packages/shared/src/types/socket-events.ts]

**When to use:** 任何跨 WebUI/Gateway/CLI 边界的 Agent Team 字段，包括 lifecycle、MCP phase、mailbox/task counts、source refs、error detail。[VERIFIED: .planning/REQUIREMENTS.md]

**Example:**

```typescript
// Source: packages/shared/src/types/socket-events.ts existing RpcRequest/RpcResponse pattern
export type CreateAgentTeamRpcParams = {
	machineId: string;
	title: string;
	workspaceRootCwd: string;
	leaderBackendId: string;
	workspaceMode: TeamWorkspaceMode;
};

export type CreateAgentTeamRpcResult = {
	agentTeam: AgentTeamSummary;
};
```

### Pattern 2: Current Facts + Rebuildable Projection

**What:** CLI SQLite tables store normalized current facts; projection builder computes `AgentTeamSummary`/counts/MCP status/source refs for Gateway/WebUI.[VERIFIED: .planning/phases/01-protocol-state-model-persistence-boundary/01-CONTEXT.md]

**When to use:** Team snapshot/list/get/reconnect paths and `agent-teams:changed` events.[VERIFIED: .planning/ROADMAP.md]

**Example:**

```typescript
// Source: apps/mobvibe-cli/src/wal/wal-store.ts uses JSON.stringify for persisted payloads
const rowToProjection = (team: AgentTeamRow, members: TeamMemberRow[]) => ({
	agentTeamId: team.agent_team_id,
	title: team.title,
	lifecycle: team.lifecycle,
	leaderMemberId: team.leader_member_id,
	members: members.map(rowToMemberSummary),
	createdAt: team.created_at,
	updatedAt: team.updated_at,
});
```

### Pattern 3: Content Boundary by Type and Validator

**What:** 明确区分 `GatewayFacing`、`CliLocal`、`EncryptedPayload`、`TeamSourceRef`，并在 Gateway route 对 JSON body 做 reject-list 检查。[VERIFIED: .planning/phases/01-protocol-state-model-persistence-boundary/01-CONTEXT.md][VERIFIED: apps/gateway/src/routes/sessions.ts]

**When to use:** create/list/get result、projection event、error detail、summary refs、mailbox/task metadata。[VERIFIED: .planning/REQUIREMENTS.md]

**Example:**

```typescript
// Source: CONTEXT.md content boundary + existing ErrorDetail shape
const forbiddenGatewayKeys = [
	"prompt",
	"content",
	"body",
	"description",
	"summaryText",
	"agentOutput",
] as const;
```

### Anti-Patterns to Avoid

- **把 Agent Team 建成 `Session(kind="team")`:** CONTEXT 锁定 Agent Team 是独立一级对象，member sessions 仍是 ordinary sessions。[VERIFIED: .planning/phases/01-protocol-state-model-persistence-boundary/01-CONTEXT.md]
- **Gateway 保存 team durable truth:** Gateway `CliRegistry` 是 in-memory connection/session registry；Phase 1 durable truth 应在 CLI SQLite。[VERIFIED: apps/gateway/src/services/cli-registry.ts][VERIFIED: .planning/phases/01-protocol-state-model-persistence-boundary/01-CONTEXT.md]
- **lifecycle 中加入 `idle`/`ready`:** LIFE-01 明确禁止；这些语义拆到 MCP readiness、permission waiting、health/activity projection。[VERIFIED: .planning/REQUIREMENTS.md]
- **projection 包含正文:** `body_local_json`、mailbox/task/summary text 不得出现在 Gateway-facing payload、socket event、Gateway log 或 WebUI team projection。[VERIFIED: .planning/phases/01-protocol-state-model-persistence-boundary/01-CONTEXT.md]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cross-process protocol drift | WebUI/Gateway/CLI 各自定义 team payload | `packages/shared/src/types/agent-team.ts` exported from `index.ts` | shared 已是 repo 标准公共 contract 层。[VERIFIED: packages/shared/src/index.ts][VERIFIED: packages/shared/AGENTS.md] |
| Durable storage abstraction | 新 ORM 或 `better-sqlite3` binding | Bun `Database` + existing migration style | CLI WAL 已使用 `bun:sqlite`，复用可降低分发和测试复杂度。[VERIFIED: apps/mobvibe-cli/src/wal/wal-store.ts] |
| MCP transport semantics | 自定义 global MCP config injection | ACP RFD `mcpCapabilities.acp` + per-session `mcpServers` model, Phase 2 runtime | RFD 明确 server `id`、`mcp/connect`、`mcp/message`、bridge fallback；Phase 1 只需建模 readiness/capability。[CITED: https://agentclientprotocol.com/rfds/mcp-over-acp] |
| Error shape | ad-hoc `{ ok, error }` strings | existing `ErrorDetail` + extended code/scope | `RpcResponse<TResult>` 已使用 `ErrorDetail`；Gateway REST errors 已返回 `{ error: detail }`。[VERIFIED: packages/shared/src/types/errors.ts][VERIFIED: packages/shared/src/types/socket-events.ts][VERIFIED: apps/gateway/src/routes/sessions.ts] |
| Content redaction | 每个 route 手写 logging discipline | shared projection types + centralized forbidden-key validator/redaction helper | 人工约定容易漏；Phase 1 success criteria 要类型化边界。[VERIFIED: .planning/ROADMAP.md][ASSUMED] |

**Key insight:** Phase 1 的难点不是数据表数量，而是防止事实来源与内容边界漂移；越多 hand-rolled payload，后续 Phase 2-4 越容易把正文或运行时状态错误传播到 Gateway。[VERIFIED: .planning/research/PITFALLS.md]

## Runtime State Inventory

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | 当前 Phase 是新增 Agent Team schema，不是 rename/refactor；未发现需迁移的现有 `agent_team` runtime records。[VERIFIED: grep AgentTeam/agent_teams over repo] | 新增 migration/table；无需迁移旧 team 数据。 |
| Live service config | Phase 1 不修改外部服务配置；Gateway/WebUI/CLI 使用现有 connection/RPC layer。[VERIFIED: .planning/ROADMAP.md] | None。 |
| OS-registered state | Phase 1 不涉及 systemd/launchd/pm2/task scheduler 注册名变更。[VERIFIED: .planning/ROADMAP.md] | None。 |
| Secrets/env vars | Phase 1 不需要新增 env；现有相关 env 为 `DATABASE_URL`, `BETTER_AUTH_SECRET`, `GATEWAY_CORS_ORIGINS`, `REDIS_URL`, `VITE_GATEWAY_URL`, `MOBVIBE_GATEWAY_URL`, `MOBVIBE_MASTER_SECRET`。[VERIFIED: AGENTS.md] | 若后续新增 env，必须同步中文文档且不得提交密钥。 |
| Build artifacts | 新增 shared types/CLI store 后需要 rebuild package outputs；不要提交 `dist` 以外非预期 artifacts。[VERIFIED: package scripts][VERIFIED: AGENTS.md] | `pnpm -C packages/shared build`、相关 tests；不处理 installed global package。 |

**Nothing found in category:** 这是 greenfield schema/protocol phase；所有 runtime state categories 已显式检查，未发现需要 data migration 的旧 Agent Team state。[VERIFIED: grep AgentTeam/agent_teams over repo]

## Common Pitfalls

### Pitfall 1: Team 对象与 ordinary session 边界混淆

**What goes wrong:** 把 team 建成普通 session subtype，导致 member session 出现在普通 session 列表中、team coordination facts 与 transcript facts 混在一起。[VERIFIED: .planning/phases/01-protocol-state-model-persistence-boundary/01-CONTEXT.md]  
**Why it happens:** 现有产品主要围绕 `SessionSummary`、`session:event`、WAL 构建，新对象容易被塞进旧模型。[VERIFIED: packages/shared/src/types/session.ts][VERIFIED: packages/shared/src/types/socket-events.ts]  
**How to avoid:** `AgentTeamSummary` 独立于 `SessionSummary`；只通过 `member.sessionId` 链接 ordinary session。[VERIFIED: .planning/phases/01-protocol-state-model-persistence-boundary/01-CONTEXT.md]  
**Warning signs:** `SessionSummary` 增加 `kind: "team"`，或 team projection 包含 transcript arrays。[VERIFIED: .planning/research/PITFALLS.md]

### Pitfall 2: MCP readiness 隐藏在 member lifecycle

**What goes wrong:** member 显示 running 但 MCP server/injection/tools 未 ready，用户无法诊断 team 卡死原因。[VERIFIED: .planning/research/PITFALLS.md]  
**Why it happens:** `idle/ready/running` 被当成单一状态维度。[VERIFIED: .planning/REQUIREMENTS.md]  
**How to avoid:** 持久化独立 `TeamMcpPhase`，并投影 `degraded/error` 与 `lastError`。[VERIFIED: .planning/phases/01-protocol-state-model-persistence-boundary/01-CONTEXT.md]  
**Warning signs:** `TeamMemberLifecycle` 包含 `ready`，或 `agent_team_mcp_status` 缺失。[VERIFIED: .planning/research/PITFALLS.md]

### Pitfall 3: Gateway payload 明文字段泄漏

**What goes wrong:** Gateway route/log/socket 看到 prompt、mailbox body、task description、summary text 或 agent output。[VERIFIED: .planning/phases/01-protocol-state-model-persistence-boundary/01-CONTEXT.md]  
**Why it happens:** 为了 UI 展示方便，把 task/mailbox 正文与 metadata 放在同一 DTO。[ASSUMED]  
**How to avoid:** DTO 命名明确：`*Projection`/`*Metadata` 不含正文；正文只在 `body_local_json` 或 `EncryptedPayload`。[VERIFIED: .planning/phases/01-protocol-state-model-persistence-boundary/01-CONTEXT.md]  
**Warning signs:** Gateway code 出现 `prompt`, `content`, `body`, `description`, `summaryText`, `agentOutput` team route 字段。[VERIFIED: .planning/phases/01-protocol-state-model-persistence-boundary/01-CONTEXT.md]

### Pitfall 4: Mailbox/task 只作为 UI projection，没有 durable metadata

**What goes wrong:** 刷新或 CLI 重启后 mailbox/task counts、wake status、task owner/status、source refs 无法恢复。[VERIFIED: .planning/REQUIREMENTS.md][VERIFIED: .planning/research/PITFALLS.md]  
**Why it happens:** 只从 leader output 或 WebUI state 推断协作状态。[VERIFIED: .planning/research/PITFALLS.md]  
**How to avoid:** Phase 1 先建 `agent_team_mailbox_messages` 与 `agent_team_tasks` metadata/current-facts tables，即使 Phase 2 才实现工具写入。[VERIFIED: .planning/phases/01-protocol-state-model-persistence-boundary/01-CONTEXT.md]  
**Warning signs:** 没有 `messageId/taskId/sourceRefs/status/timestamps` 类型，只有 markdown parsing。[VERIFIED: .planning/research/PITFALLS.md]

### Pitfall 5: AionUI prior art 被照搬到错误层级

**What goes wrong:** 复刻 AionUI/Claude Team 的文件 mailbox、worker loop 或 UI 操作方式，破坏 Mobvibe 的 ACP/WebUI/Gateway/CLI 分层。[VERIFIED: ../AionUi/docs/research/claude-team-mode-analysis.md][VERIFIED: .planning/PROJECT.md]  
**Why it happens:** AionUI 是 Electron/IPC local app，而 Mobvibe 是 remote WebUI → Gateway → local CLI daemon 架构。[VERIFIED: ../AionUi/docs/research/team-implementation-diff-report.md][VERIFIED: .planning/PROJECT.md]  
**How to avoid:** 只采用 prior art 的“协作事实”模型：team object、leader/member、mailbox、task board、source refs、MCP tools readiness；不要照搬 transport/runtime 到 Gateway。[VERIFIED: .planning/PROJECT.md][VERIFIED: ../AionUi/docs/research/claude-team-mode-analysis.md]  
**Warning signs:** Gateway 开始保存 mailbox 正文，或 WebUI 通过测试 bridge 直接触发 team 操作。[VERIFIED: ../AionUi/tests/e2e/specs/README.md][VERIFIED: .planning/phases/01-protocol-state-model-persistence-boundary/01-CONTEXT.md]

## Code Examples

Verified patterns from official/project sources:

### ACP `newSession` with MCP server declarations

```typescript
// Source: Context7 /agentclientprotocol/typescript-sdk and ACP MCP-over-ACP RFD
const session = await connection.newSession({
	cwd: process.cwd(),
	mcpServers: [
		{
			type: "acp",
			name: "mobvibe-team",
			id: "component-generated-unique-server-id",
		},
	],
});
```

ACP RFD 要求 ACP-transport MCP server 使用 `type: "acp"`、`name`、component-generated `id`，agent 通过 `mcp/connect` 的 `acpId` 回连该 id。[CITED: https://agentclientprotocol.com/rfds/mcp-over-acp]

### Existing project RPC wrapper pattern

```typescript
// Source: packages/shared/src/types/socket-events.ts
export type RpcRequest<TParams> = {
	requestId: string;
	params: TParams;
};

export type RpcResponse<TResult> = {
	requestId: string;
	result?: TResult;
	error?: ErrorDetail;
};
```

Team RPC 应复用该 wrapper 并新增 `rpc:agent-team:create/list/get` event names。[VERIFIED: packages/shared/src/types/socket-events.ts][VERIFIED: .planning/phases/01-protocol-state-model-persistence-boundary/01-CONTEXT.md]

### Existing CLI SQLite migration pattern

```typescript
// Source: apps/mobvibe-cli/src/wal/migrations.ts
export function runMigrations(db: Database): void {
	db.exec("PRAGMA journal_mode = WAL");
	db.exec("PRAGMA synchronous = NORMAL");
	// read schema_version, run pending migrations, insert version
}
```

AgentTeamStore 应复用 schema version/migration 风格，避免多个 SQLite migration systems。[VERIFIED: apps/mobvibe-cli/src/wal/migrations.ts]

### Existing Gateway error response pattern

```typescript
// Source: apps/gateway/src/routes/sessions.ts
const buildRequestValidationError = (message = "Invalid request") =>
	createErrorDetail({
		code: "REQUEST_VALIDATION_FAILED",
		message,
		retryable: false,
		scope: "request",
	});
```

Team route validation/content-boundary failures should return `ErrorDetail` rather than ad-hoc strings。[VERIFIED: apps/gateway/src/routes/sessions.ts][VERIFIED: packages/shared/src/types/errors.ts]

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| prompt fan-out / UI 聚合 | CLI-hosted team MCP server + durable mailbox/task board + ordinary ACP sessions | Project research updated 2026-05-12 | Phase 1 必须提前建模 mailbox/task metadata 与 MCP readiness，即使 runtime 在 Phase 2。[VERIFIED: .planning/PROJECT.md][VERIFIED: .planning/research/PITFALLS.md] |
| 修改 agent 全局 MCP 配置 | MCP-over-ACP per-session `mcpServers` 或 per-session bridge fallback | ACP RFD current docs fetched 2026-05-13 | 普通 session 不暴露 team tools；Phase 1 capability model 要表达 native ACP 与 bridge fallback。[CITED: https://agentclientprotocol.com/rfds/mcp-over-acp] |
| 单一 `idle/ready/running` lifecycle | lifecycle + MCP readiness + permission/activity/health split dimensions | Phase 1 CONTEXT locked 2026-05-13 | UI derived status 不能成为事实来源；tests 要覆盖没有 `idle/ready` lifecycle。[VERIFIED: .planning/phases/01-protocol-state-model-persistence-boundary/01-CONTEXT.md] |
| Gateway durable team storage | CLI durable truth + Gateway auth/routing/projection relay | Phase 1 CONTEXT locked 2026-05-13 | Gateway DB 不新增 team state tables；Gateway routes 转发 typed CLI RPC。[VERIFIED: .planning/phases/01-protocol-state-model-persistence-boundary/01-CONTEXT.md] |

**Deprecated/outdated:**

- `Session(kind="team")` 主模型：被 CONTEXT 明确否决，Agent Team 是独立一级对象。[VERIFIED: .planning/phases/01-protocol-state-model-persistence-boundary/01-CONTEXT.md]
- Team append-only WAL in Phase 1：被 CONTEXT 明确排除；member transcript 继续 ordinary session WAL。[VERIFIED: .planning/phases/01-protocol-state-model-persistence-boundary/01-CONTEXT.md]
- Global MCP config injection：被 PROJECT/REQUIREMENTS 明确列为 out of scope，因为会让普通 session 暴露 team tools。[VERIFIED: .planning/PROJECT.md][VERIFIED: .planning/REQUIREMENTS.md]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Zod validators 是 Phase 1 Gateway runtime validation 的推荐实现，而不是手写 type guards。 | Standard Stack / Content Boundary | 若项目偏好手写 validator，计划需改为 shared predicate functions；不影响类型/边界原则。 |
| A2 | 中央 forbidden-key validator 比 route-local discipline 更可靠。 | Don't Hand-Roll / Pitfalls | 若实现成本过高，可先做 route-local validator + tests，但泄漏风险更高。 |
| A3 | Gateway 明文字段泄漏通常来自为 UI 方便合并正文和 metadata。 | Common Pitfalls | 若实际实现路径不同，仍需保持 projection/content 分离 tests。 |

## Open Questions (RESOLVED)

1. **是否升级 `@agentclientprotocol/sdk` 到 current `0.21.0`？**
   - What we know: 当前项目依赖 `^0.16.1`，npm current 是 `0.21.0`；ACP RFD 已描述 `mcpCapabilities.acp` 与 `type:"acp"` schema。[VERIFIED: packages/shared/package.json][VERIFIED: npm registry][CITED: https://agentclientprotocol.com/rfds/mcp-over-acp]
   - What's unclear: 当前 lockfile 实际解析版本与 SDK exported TS types 是否已经包含 RFD 字段。[ASSUMED]
   - RESOLVED: Phase 1 不计划升级 `@agentclientprotocol/sdk`。使用当前项目依赖；除非实现时发现无法绕过的 compile-time blocker，否则依赖升级 deferred/out of scope。ACP-over-MCP capability shape 在 Mobvibe shared types 与 tests 中建模，保持 native ACP、stdio 和 per-session bridge capability 表达。[VERIFIED: revision locked_resolution_guidance]

2. **AgentTeamStore 是否复用现有 WAL database file 还是单独 SQLite file？**
   - What we know: CLI WAL 使用 Bun SQLite + migrations；CONTEXT 只锁定 CLI SQLite 当前事实表，没有锁定 DB 文件边界。[VERIFIED: apps/mobvibe-cli/src/wal/wal-store.ts][VERIFIED: .planning/phases/01-protocol-state-model-persistence-boundary/01-CONTEXT.md]
   - What's unclear: 现有 CLI config/db path 管理位置未在本次研究完全展开。[ASSUMED]
   - RESOLVED: AgentTeamStore 复用现有 CLI WAL SQLite database file 与 migration pathway。Agent Team current-state tables 作为现有 `apps/mobvibe-cli/src/wal/migrations.ts` 的后续 migration 加入，不创建第二个 SQLite database，也不创建第二套 migration 系统。[VERIFIED: revision locked_resolution_guidance]

3. **Phase 1 是否实现 minimal `/acp/agent-teams` route 还是只定义 shared/CLI types？**
   - What we know: Success criteria 要用户能看到刷新后稳定对象，CONTEXT 锁定 Gateway API shape。[VERIFIED: .planning/ROADMAP.md][VERIFIED: .planning/phases/01-protocol-state-model-persistence-boundary/01-CONTEXT.md]
   - What's unclear: 既有 PLAN 是否已把 WebUI route/client/store 纳入 Phase 1；本研究按 phase goal 认为需至少 create/list/get projection vertical slice。[VERIFIED: .planning/phases/01-protocol-state-model-persistence-boundary/PLAN.md]
   - RESOLVED: Phase 1 实现 minimal Gateway `/acp/agent-teams` resource routes：`POST /acp/agent-teams`、`GET /acp/agent-teams`、`GET /acp/agent-teams/:agentTeamId`。Gateway 通过 typed CLI RPC create/list/get 转发到 CLI durable AgentTeamStore；WebUI 只接收 metadata/projection，不做 visual UI polish。[VERIFIED: revision locked_resolution_guidance]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | pnpm/turbo/build tooling | ✓ | v24.15.0 | 项目 engine 要求 `>=22.12.0`。[VERIFIED: local `node --version`][VERIFIED: package.json] |
| pnpm | workspace scripts/package manager | ✓ | 10.32.1 | 无；AGENTS 禁止 npm 作为项目包管理器。[VERIFIED: local `pnpm --version`][VERIFIED: AGENTS.md] |
| Bun | CLI runtime/tests + `bun:sqlite` | ✓ | 1.3.13 | 无；CLI package 使用 Bun build/test/start。[VERIFIED: local `bun --version`][VERIFIED: apps/mobvibe-cli/package.json] |
| sqlite3 CLI | manual DB inspection/debug | ✓ | 3.53.1 | 可用 Bun `Database` tests 代替手动 CLI。[VERIFIED: local `sqlite3 --version`] |
| Graphify planning graph | semantic code graph context | ✗ | disabled | 使用 file reads/grep/glob；graphify status reported disabled。[VERIFIED: gsd-tools graphify status] |

**Missing dependencies with no fallback:** None for Phase 1 research/planning。[VERIFIED: local env probes]

**Missing dependencies with fallback:** Graphify disabled；已用 direct file/context research 代替。[VERIFIED: gsd-tools graphify status]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | yes | Gateway `/acp/agent-teams` routes must use existing `requireAuth`/session auth and userId extraction.[VERIFIED: apps/gateway/src/routes/sessions.ts] |
| V3 Session Management | yes | WebUI socket/user routing must stay user-scoped; do not broadcast team projection without user filter.[VERIFIED: apps/gateway/src/socket/webui-handlers.ts] |
| V4 Access Control | yes | Gateway validates machine ownership before typed RPC; session/team subscription must be owner-scoped.[VERIFIED: apps/gateway/src/services/cli-registry.ts][VERIFIED: apps/gateway/src/socket/webui-handlers.ts] |
| V5 Input Validation | yes | Use shared types plus runtime validators/reject-list for team route bodies and CLI RPC params.[VERIFIED: apps/gateway/src/routes/sessions.ts][ASSUMED] |
| V6 Cryptography | yes | Existing `EncryptedPayload` remains only acceptable content payload over Gateway; Gateway never decrypts mailbox/task/summary body.[VERIFIED: packages/shared/src/index.ts][VERIFIED: .planning/phases/01-protocol-state-model-persistence-boundary/01-CONTEXT.md] |
| V7 Error Handling and Logging | yes | Use `ErrorDetail`; pino logs must include ids/status/error codes only, not body/prompt/output.[VERIFIED: packages/shared/src/types/errors.ts][VERIFIED: AGENTS.md] |
| V9 Communications | yes | Existing Socket.io channels are authenticated/user scoped; team events should reuse same authenticated namespaces.[VERIFIED: apps/gateway/src/socket/cli-handlers.ts][VERIFIED: apps/gateway/src/socket/webui-handlers.ts] |

### Known Threat Patterns for ACP Agent Team protocol/state boundary

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-user team projection leakage | Information Disclosure | Use authenticated WebUI namespace and `emitToUser(userId, ...)`; validate machine/team ownership before RPC.[VERIFIED: apps/gateway/src/socket/webui-handlers.ts][VERIFIED: apps/gateway/src/services/cli-registry.ts] |
| Plaintext prompt/mailbox/task/summary entering Gateway | Information Disclosure | Shared Gateway-facing projection types + reject-list validators + log redaction.[VERIFIED: .planning/phases/01-protocol-state-model-persistence-boundary/01-CONTEXT.md][ASSUMED] |
| Team/member state tampering via JSON body | Tampering | Runtime validation for `lifecycle`, `mcpPhase`, IDs, workspace fields; Gateway should not trust client-supplied state facts.[VERIFIED: apps/gateway/src/routes/sessions.ts][ASSUMED] |
| Capability spoofing for team-capable backend | Elevation of Privilege | CLI capability discovery should own `AgentSessionCapabilities`; WebUI choices are advisory only.[VERIFIED: packages/shared/src/types/session.ts][VERIFIED: apps/gateway/src/socket/cli-handlers.ts] |
| Error detail leaking local paths/content | Information Disclosure | `ErrorDetail.detail` for Gateway-facing team errors should be code/scope/ref oriented and avoid body/output; source refs may locate content without containing it.[VERIFIED: packages/shared/src/types/errors.ts][VERIFIED: .planning/phases/01-protocol-state-model-persistence-boundary/01-CONTEXT.md] |
| Global MCP config pollution | Elevation of Privilege / Tampering | Phase 1 model native ACP/per-session bridge only; no global config edits.[CITED: https://agentclientprotocol.com/rfds/mcp-over-acp][VERIFIED: .planning/REQUIREMENTS.md] |

## Sources

### Primary (HIGH confidence)

- `.planning/phases/01-protocol-state-model-persistence-boundary/01-CONTEXT.md` — locked product model, Gateway API shape, content boundary, state unions, durable schema proposal.
- `.planning/REQUIREMENTS.md` — TEAM-01..05, LIFE-01 requirement text and v1 out-of-scope.
- `.planning/ROADMAP.md` — Phase 1 goal/success criteria and phase sequencing.
- `.planning/PROJECT.md` — architecture/security/persistence constraints and key decisions.
- `AGENTS.md`, `packages/shared/AGENTS.md`, `apps/mobvibe-cli/AGENTS.md`, `apps/gateway/AGENTS.md`, `apps/webui/AGENTS.md` — repo commands/style/testing constraints.
- `packages/shared/src/types/{errors,session,socket-events,acp}.ts`, `packages/shared/src/index.ts` — existing shared type/export/RPC/error/capability patterns.
- `apps/mobvibe-cli/src/wal/{migrations,wal-store}.ts` — Bun SQLite migration/current WAL store pattern.
- `apps/gateway/src/routes/sessions.ts`, `apps/gateway/src/services/cli-registry.ts`, `apps/gateway/src/socket/{cli-handlers,webui-handlers}.ts` — current Gateway REST/socket/user routing patterns.
- ACP MCP-over-ACP RFD `https://agentclientprotocol.com/rfds/mcp-over-acp` — `mcpCapabilities.acp`, per-session `mcpServers`, `mcp/connect`, `mcp/message`, bridging semantics.
- Context7 `/agentclientprotocol/typescript-sdk` — TypeScript SDK examples for `newSession`/`loadSession` with `mcpServers` and ACP connection patterns.
- npm registry via `pnpm view` — current package versions and modified dates for `@agentclientprotocol/sdk`, `zod`, `typescript`, `@biomejs/biome`, `vitest`, `better-sqlite3`.

### Secondary (MEDIUM confidence)

- `../AionUi/docs/research/claude-team-mode-analysis.md` — durable mailbox/task/team runtime prior art and limitations, based on AionUI local research.
- `../AionUi/docs/research/team-implementation-diff-report.md` — AionUI vs Claude Team architectural/data model differences.
- `../AionUi/docs/design/agent-team-guide-flow.md` — AionUI team creation and UI flow prior art.
- `.planning/research/PITFALLS.md` — project-local prior research on Agent Team failure modes.

### Tertiary (LOW confidence)

- Assumptions A1-A3 about exact validator implementation and likely leakage mechanisms; require planner/user confirmation before locking implementation detail.

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — package versions verified through project package files and npm registry; no new dependency required except possible reuse of existing Zod.[VERIFIED: package.json][VERIFIED: npm registry]
- Architecture: HIGH — primary decisions locked in CONTEXT/PROJECT/ROADMAP and match existing code boundaries.[VERIFIED: .planning/phases/01-protocol-state-model-persistence-boundary/01-CONTEXT.md][VERIFIED: apps/gateway/src/services/cli-registry.ts]
- Pitfalls: HIGH — project prior research plus AionUI prior art plus ACP RFD agree on MCP readiness, mailbox/task durability, per-session MCP isolation, and Gateway content boundary.[VERIFIED: .planning/research/PITFALLS.md][CITED: https://agentclientprotocol.com/rfds/mcp-over-acp][VERIFIED: ../AionUi/docs/research/claude-team-mode-analysis.md]
- Open implementation details: MEDIUM — exact DB file boundary and SDK upgrade need Wave 0 inspection during planning/execution.[ASSUMED]

**Research date:** 2026-05-13  
**Valid until:** 2026-06-12 for project architecture; 2026-05-20 for ACP SDK/RFD/npm version details.
