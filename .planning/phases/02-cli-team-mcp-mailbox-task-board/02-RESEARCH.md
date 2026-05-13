# Phase 02: CLI Team MCP、Mailbox 与 Task Board - Research

**Researched:** 2026-05-13  
**Domain:** ACP MCP-over-ACP、CLI-local team coordination runtime、Bun SQLite durable mailbox/task board  
**Confidence:** MEDIUM

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

## Implementation Decisions

### MCP 注入路径
- **D-01:** Native MCP-over-ACP is the primary path for Agent Team tools. Phase 2 should implement the RFD model deeply enough for `session/new` MCP declarations, `mcp/connect`, `mcp/message`, server routing, and tool readiness to form a working CLI-local loop.
- **D-02:** Before implementing local compatibility shims, research and attempt an `@agentclientprotocol/sdk` upgrade so the code can use official `type: "acp"` transport types and protocol handlers if available.
- **D-03:** Caller identity must be bound by per-member ACP MCP server ids. One team runtime may own the tool implementation, but each member session gets a unique component-generated MCP server `id` that maps to `agentTeamId + memberId`; agents must not self-report caller identity in tool args.
- **D-04:** Mark `tools_ready` only after MCP connection setup has completed enough to confirm the expected `mobvibe_team_*` tools are listable. `mcp/connect` alone is not enough.
- **D-05:** Bridge fallback is allowed only for backends that cannot use native MCP-over-ACP, and it must remain per-session. Do not modify global agent MCP configuration.

### 工具边界与权限
- **D-06:** Phase 2 tool surface is “core plus intents”: implement `mobvibe_team_send_message`, `mobvibe_team_members`, `mobvibe_team_task_create`, `mobvibe_team_task_list`, and `mobvibe_team_task_update`; represent spawn/rename/shutdown as tool intents or request facts rather than full session lifecycle execution.
- **D-07:** Do not make any `mobvibe_team_*` tool leader-only. This intentionally overrides the earlier assumption that some team tools must have hard role gates.
- **D-08:** Cancel Agent Team tool-layer permission and user-confirmation gates. Tool calls should not require a separate Mobvibe confirmation step in Phase 2.
- **D-09:** Keep existing ordinary ACP session permissions intact. “Cancel gates” applies to the Agent Team tool layer only; do not bypass backend/session permission requests already handled by Mobvibe.
- **D-10:** Structural validation still applies: bind calls to the authenticated team/member connection, validate target members/backends, reject malformed inputs, preserve workspace/team scope, and enforce native MCP-over-ACP or safe per-session bridge capability before exposing autonomous tools.

### Mailbox 唤醒语义
- **D-11:** A mailbox send is successful once the message is durably persisted. Wake is a separate best-effort result and must not roll back an accepted message.
- **D-12:** Wake failures should update wake metadata (`wake_status` / error/source refs) separately from delivery state so users and agents can distinguish “message exists” from “recipient was woken”.
- **D-13:** Follow the AionUI push-style pattern: when a member is woken, unread mailbox messages are atomically read/marked and injected into that member’s ordinary ACP session history/input turn so the message is auditable and visible in the member session.
- **D-14:** Recipient addressing should accept member name or memberId. `*` broadcasts to all other current members and excludes the sender.
- **D-15:** Implement system-generated `idle_notification` behavior like AionUI: after a member turn completes, notify the leader, but wake the leader only when all non-leader members are settled to avoid wake loops.

### Task Board 合约
- **D-16:** Use the Phase 1 shared task statuses: `todo`, `in_progress`, `blocked`, `completed`, `failed`, `cancelled`. Do not introduce AionUI’s `pending`/`deleted` status vocabulary into Mobvibe.
- **D-17:** Task owner parameters should accept member name or memberId, resolve to memberId for persistence, and may display names in tool output for agent readability.
- **D-18:** Preserve AionUI’s dependency behavior: maintain `blockedBy`/`blocks` bidirectionally, append upstream `blocks` on create, and automatically remove completed task ids from downstream `blockedBy` lists when a task becomes `completed`.
- **D-19:** `mobvibe_team_task_list` may return full CLI-local task title/description/status/owner/dependency content to the agent through MCP. Gateway/WebUI projections must still exclude task body/description and expose only metadata/counts/source refs.

### the agent's Discretion
- Downstream agents may choose exact module names and internal helper shapes, but should keep the runtime split clear: MCP transport/router, tool handlers, durable mailbox operations, durable task operations, and projection/content-boundary code should remain separable.

### Deferred Ideas (OUT OF SCOPE)
- Full WebUI creation flow, member ordinary session creation from WebUI, and visible team detail UI remain Phase 3.
- Cancel/retry/archive lifecycle controls, permission aggregation UI, and recovery polish remain Phase 4.
- Desktop/mobile UI polish remains Phase 5.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MCP-01 | CLI 启动/恢复 team MCP server 并暴露 `mobvibe_team_*` tools。 | 使用 CLI-local TeamRuntime + per-member MCP server id router；AionUI 的 `TeamSession` 组合模式可借鉴，但主路径改为 ACP transport。 [VERIFIED: `.planning/REQUIREMENTS.md`; VERIFIED: `../AionUi/src/process/team/TeamSession.ts`; CITED: agentclientprotocol.com/rfds/mcp-over-acp] |
| MCP-02 | Team tools 优先通过 ACP 官方 MCP-over-ACP per-session transport 注入。 | RFD 定义 `type: "acp"`, `name`, `id` declaration；当前 SDK 包未内置该 schema，因此计划需要先做 SDK 升级/类型补丁决策。 [CITED: agentclientprotocol.com/rfds/mcp-over-acp; VERIFIED: `node_modules/@agentclientprotocol/sdk/schema/schema.json`; VERIFIED: npm registry] |
| MCP-03 | 普通非 team session 不包含 team MCP declaration。 | 当前 `AcpConnection.createSession`/`loadSession` 固定传 `mcpServers: []`，应保留普通路径并新增 team-specific options。 [VERIFIED: `apps/mobvibe-cli/src/acp/acp-connection.ts`] |
| MCP-04 | 非 native backend 只允许 per-session bridge，不修改全局配置。 | RFD bridge 模型支持 stdio/HTTP translation；AionUI stdio/TCP bridge 可作为 fallback 参考，不应作为 Mobvibe primary。 [CITED: agentclientprotocol.com/rfds/mcp-over-acp; VERIFIED: `../AionUi/src/process/team/mcp/team/teamMcpStdio.ts`] |
| MCP-05 | 创建/Spawn 前校验 team-capable backend。 | 现有能力缓存只映射 list/load/prompt，未映射 MCP；需要扩展 `getSessionCapabilities()`。 [VERIFIED: `apps/mobvibe-cli/src/acp/acp-connection.ts`; VERIFIED: `packages/shared/src/types/session.ts`] |
| MCP-06 | 持久化并展示 MCP readiness phase。 | Phase 1 表已有 `agent_team_mcp_status`，shared 类型已有 `TeamMcpPhase`。 [VERIFIED: `apps/mobvibe-cli/src/wal/migrations.ts`; VERIFIED: `packages/shared/src/types/agent-team.ts`] |
| MCP-07 | Team tools 携带可验证 caller identity 并执行 workspace 限制。 | caller identity 应来自 `acpId/serverId -> memberId` 映射；Phase 2 不做 leader-only/confirmation gates，但必须做 structural validation。 [VERIFIED: `02-CONTEXT.md`; CITED: agentclientprotocol.com/rfds/mcp-over-acp] |
| COORD-01 | Agent 可通过 `mobvibe_team_send_message` 发送 durable mailbox message。 | 现有 SQLite 表有 `body_local_json/read_at/wake_status`，需要补 store/service methods。 [VERIFIED: `apps/mobvibe-cli/src/wal/migrations.ts`; VERIFIED: `apps/mobvibe-cli/src/team/agent-team-store.ts`] |
| COORD-02 | Mailbox 记录 sender/recipient/read/wake/source refs；持久化与 wake 分离。 | AionUI 将 write 和 wake 分离；Mobvibe 还需单独更新 wake metadata。 [VERIFIED: `../AionUi/src/process/team/TeamSession.ts`; VERIFIED: `apps/mobvibe-cli/src/wal/migrations.ts`] |
| COORD-03 | Agent 可用 task tools 创建/列出/更新 durable task board。 | AionUI task dependency 行为已验证；Mobvibe 应改用 Phase 1 status vocabulary。 [VERIFIED: `../AionUi/src/process/team/TaskManager.ts`; VERIFIED: `packages/shared/src/types/agent-team.ts`] |
| COORD-04 | Mailbox/task 正文与 agent 输出不得作为 Gateway-facing 明文字段。 | `projection-builder` 已不读取 `body_local_json`；`content-boundary.ts` 已拒绝 `body/description/content` 等 key。 [VERIFIED: `apps/mobvibe-cli/src/team/projection-builder.ts`; VERIFIED: `apps/mobvibe-cli/src/team/content-boundary.ts`] |
</phase_requirements>

## Summary

Phase 2 应规划为一个 CLI-local coordination runtime，而不是 WebUI orchestration phase。Mobvibe 已有 Phase 1 的 durable SQLite tables、projection builder、content-boundary guard、team RPC wiring，以及 ordinary ACP session/WAL/permission runtime；本阶段应在这些基础上补齐 MCP transport/router、tool handlers、mailbox/task service methods、per-session injection 和 tests。 [VERIFIED: `apps/mobvibe-cli/src/team/agent-team-store.ts`; VERIFIED: `apps/mobvibe-cli/src/wal/migrations.ts`; VERIFIED: `apps/mobvibe-cli/src/daemon/socket-client.ts`]

关键协议风险是 SDK 状态：项目已安装 `@agentclientprotocol/sdk@0.16.1`，npm registry 最新是 `0.21.0`（published 2026-04-28），但两者 schema 的 `McpCapabilities` 仍只有 `http/sse`，`McpServer` 仍只有 `http/sse/stdio`，没有 RFD 中的 `acp` transport 或 `mcp/connect`/`mcp/message` helpers。规划必须包含 “升级尝试 + 如官方 SDK 仍缺失则用本地窄类型/extension routing 实现 RFD surface” 的 Wave 0/1 决策点。 [VERIFIED: `apps/mobvibe-cli/package.json`; VERIFIED: npm registry; VERIFIED: `node_modules/@agentclientprotocol/sdk/schema/schema.json`; VERIFIED: `/tmp/opencode/acp-sdk-0.21.0/schema/schema.json`; CITED: agentclientprotocol.com/rfds/mcp-over-acp]

**Primary recommendation:** 先实现 native MCP-over-ACP 的 Mobvibe-owned abstraction（per-member `mobvibe-team:<agentTeamId>:<memberId>` id、connection router、tool registry、tools-ready probe），同时把 stdio bridge 作为 per-session fallback slice；mailbox/task board 应通过 `AgentTeamStore` 扩展，不新建平行数据库 owner。 [VERIFIED: `02-CONTEXT.md`; VERIFIED: `apps/mobvibe-cli/src/team/agent-team-store.ts`; CITED: agentclientprotocol.com/rfds/mcp-over-acp]

## Project Constraints (from AGENTS.md)

- 使用 `pnpm`，不要使用 `npm`；CLI 测试用 `pnpm -C apps/mobvibe-cli test -- <file>` 或 `pnpm -F @mobvibe/cli test`。 [VERIFIED: `./AGENTS.md`; VERIFIED: `apps/mobvibe-cli/AGENTS.md`]
- Biome 是唯一格式化/lint 依据；缩进使用 tabs，字符串使用双引号，不手动整理 import 顺序。 [VERIFIED: `./AGENTS.md`]
- TypeScript 使用 ESM，禁止 `any`，未知类型用 `unknown` 并收窄；文件名 `kebab-case`，类/组件 `PascalCase`，函数/变量 `camelCase`。 [VERIFIED: `./AGENTS.md`]
- CLI 日志优先使用现有 pino logger，避免长期 `console.log`；不要静默捕获异常。 [VERIFIED: `./AGENTS.md`]
- 新增 env 变量需同步中文文档，禁止提交密钥；不要提交 `node_modules/`, `.venv/`, `__pycache__/`, `.DS_Store`。 [VERIFIED: `./AGENTS.md`]
- 变更后提交前应运行 `pnpm format && pnpm lint` 和 `pnpm build`；CLI 局部实现可先用 package-level Bun tests 快速验证。 [VERIFIED: `./AGENTS.md`; VERIFIED: `apps/mobvibe-cli/AGENTS.md`]
- AionUI 规则仅用于理解参考仓库结构；其 Arco/UnoCSS/Electron/UI conventions 不适用于 Mobvibe CLI runtime。 [VERIFIED: `../AionUi/AGENTS.md`; VERIFIED: `02-CONTEXT.md`]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| MCP-over-ACP declaration/injection | CLI ACP client/runtime | ACP backend | `session/new`/`session/load` calls originate in CLI `AcpConnection`; backend only consumes per-session declaration. [VERIFIED: `apps/mobvibe-cli/src/acp/acp-connection.ts`; CITED: agentclientprotocol.com/rfds/mcp-over-acp] |
| Team MCP tool implementation | CLI local runtime | MCP bridge/shim | Tools mutate CLI durable team store and must keep Gateway plaintext boundary. [VERIFIED: `apps/mobvibe-cli/src/team/agent-team-store.ts`; VERIFIED: `apps/mobvibe-cli/src/team/content-boundary.ts`] |
| Caller identity binding | CLI MCP router | ACP transport | RFD routes by component-generated server `id`; Mobvibe must map id to `agentTeamId/memberId` and not trust tool args. [CITED: agentclientprotocol.com/rfds/mcp-over-acp; VERIFIED: `02-CONTEXT.md`] |
| Mailbox persistence | CLI SQLite store | Ordinary ACP session WAL for injected wake turns | Mailbox bodies are CLI-local facts; wake injection should also create auditable ordinary session events/turns. [VERIFIED: `apps/mobvibe-cli/src/wal/migrations.ts`; VERIFIED: `../AionUi/src/process/team/TeammateManager.ts`] |
| Task board persistence | CLI SQLite store | MCP tool formatter | Task bodies/dependencies live in `agent_team_tasks.body_local_json` and dependency JSON columns; tool output may include full local content. [VERIFIED: `apps/mobvibe-cli/src/wal/migrations.ts`; VERIFIED: `02-CONTEXT.md`] |
| Gateway projection | CLI projection builder + Gateway router | WebUI store | Gateway must receive only metadata/count/source refs; current builder excludes body fields and applies guard. [VERIFIED: `apps/mobvibe-cli/src/team/projection-builder.ts`; VERIFIED: `apps/mobvibe-cli/src/team/content-boundary.ts`] |
| Team lifecycle/spawn execution | Deferred Phase 3/4 | CLI session manager | Phase 2 may persist intents but not full member ordinary session orchestration. [VERIFIED: `02-CONTEXT.md`; VERIFIED: `.planning/ROADMAP.md`] |

## Standard Stack

### Core

| Library / Runtime | Version | Purpose | Why Standard |
|-------------------|---------|---------|--------------|
| `@agentclientprotocol/sdk` | installed `0.16.1`; latest `0.21.0` published 2026-04-28 | ACP initialize/session/new/session/load/client connection types | Existing Mobvibe ACP runtime already uses it; upgrade must be tried, but latest package still lacks RFD `acp` schema. [VERIFIED: `apps/mobvibe-cli/package.json`; VERIFIED: npm registry; VERIFIED: `/tmp/opencode/acp-sdk-0.21.0/schema/schema.json`] |
| `bun:sqlite` | Bun `1.3.13` built-in | Durable team/mailbox/task persistence | Existing CLI WAL and AgentTeamStore already use Bun SQLite with migrations. [VERIFIED: `apps/mobvibe-cli/src/wal/migrations.ts`; VERIFIED: environment probe] |
| `@mobvibe/shared` | workspace package | Shared team/session types and RPC payload contracts | Phase 1 established cross-process Agent Team contract here. [VERIFIED: `packages/shared/src/types/agent-team.ts`; VERIFIED: `packages/shared/src/types/session.ts`] |
| `pino` | `^9.6.0` | CLI structured logging | Project guidance says gateway/CLI should use existing pino system. [VERIFIED: `apps/mobvibe-cli/package.json`; VERIFIED: `./AGENTS.md`] |

### Supporting

| Library / Runtime | Version | Purpose | When to Use |
|-------------------|---------|---------|-------------|
| `@modelcontextprotocol/sdk` | latest `1.29.0`, registry modified 2026-03-30 | Implement stdio MCP shim/server for bridge fallback | Use only for per-session bridge fallback if native ACP transport unavailable or SDK lacks server helpers. [VERIFIED: npm registry; VERIFIED: `../AionUi/src/process/team/mcp/team/teamMcpStdio.ts`] |
| `zod` | peer range via MCP SDK; no current Mobvibe dependency found | Tool argument schemas in bridge shim | Add only if the fallback shim needs MCP SDK-style schema registration. [VERIFIED: `../AionUi/src/process/team/mcp/team/teamMcpStdio.ts`; VERIFIED: npm registry] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Native MCP-over-ACP primary | AionUI TCP + stdio bridge primary | Bridge is proven but side-channel based; Mobvibe locked decision requires official ACP transport as primary. [VERIFIED: `02-CONTEXT.md`; VERIFIED: `../AionUi/src/process/team/mcp/team/TeamMcpServer.ts`; CITED: agentclientprotocol.com/rfds/mcp-over-acp] |
| Extending `AgentTeamStore` | New `TeamRepository` parallel owner | Parallel owner would duplicate SQLite lifecycle/projection assertions; current store already owns durable team projection. [VERIFIED: `apps/mobvibe-cli/src/team/agent-team-store.ts`] |
| Tool-layer confirmation gates | Existing ACP permission flow only | Locked decision cancels team tool confirmations, but ordinary ACP permission requests must remain intact. [VERIFIED: `02-CONTEXT.md`; VERIFIED: `apps/mobvibe-cli/src/acp/session-manager.ts`] |

**Installation / upgrade research:**

```bash
pnpm -C apps/mobvibe-cli add @agentclientprotocol/sdk@^0.21.0
# only if bridge fallback is implemented as stdio MCP shim:
pnpm -C apps/mobvibe-cli add @modelcontextprotocol/sdk zod
```

**Version verification:** `pnpm view @agentclientprotocol/sdk version time --json` returned latest `0.21.0`, modified `2026-04-28T08:54:27.212Z`; `pnpm view @modelcontextprotocol/sdk version time.modified --json` returned `1.29.0`, modified `2026-03-30T16:50:43.186Z`. [VERIFIED: npm registry]

## Architecture Patterns

### System Architecture Diagram

```text
Team session creation/load request
  ├─ ordinary session path? ── yes ──> AcpConnection.newSession({ mcpServers: [] })
  │                                      └─ no team tools visible
  └─ team member path ──> TeamRuntime.ensureServer(agentTeamId)
                         ├─ resolve backend MCP capability
                         │  ├─ mcpCapabilities.acp true ──> declare { type: "acp", name: "mobvibe-team", id: perMemberServerId }
                         │  └─ no native acp ──> build per-session stdio/http bridge OR fail team-capable validation
                         ├─ AcpConnection.newSession({ mcpServers: [team server declaration] })
                         ├─ agent sends mcp/connect(acpId)
                         ├─ CLI router binds connectionId -> agentTeamId/memberId
                         ├─ mcp/message(list tools) confirms mobvibe_team_* tools
                         └─ update agent_team_mcp_status: tools_ready / degraded / error

Agent tool call
  └─ mcp/message(tool call)
      ├─ validate caller binding + team/member/workspace scope
      ├─ dispatch mobvibe_team_send_message / members / task_*
      ├─ mutate AgentTeamStore SQLite transaction
      ├─ emit agent-teams:changed projection (metadata only)
      └─ wake target ordinary ACP session best-effort, with wake metadata updated separately
```

### Recommended Project Structure

```text
apps/mobvibe-cli/src/team/
├── team-runtime.ts              # owns per-team services and MCP readiness lifecycle
├── team-mcp-router.ts           # ACP mcp/connect/message/disconnect routing and id binding
├── team-tool-handlers.ts        # mobvibe_team_* dispatch, validation, result formatting
├── mailbox-service.ts           # durable write/read-unread/wake metadata operations
├── task-board-service.ts        # durable create/list/update/dependency operations
├── team-capability.ts           # backend MCP capability validation and bridge selection
├── team-bridge-stdio.ts         # optional per-session fallback shim wiring
└── __tests__/
    ├── team-mcp-router.test.ts
    ├── mailbox-service.test.ts
    └── task-board-service.test.ts

apps/mobvibe-cli/src/acp/
└── acp-connection.ts            # add team-specific mcpServers option; ordinary path remains []
```

### Pattern 1: Narrow ACP RFD Adapter Boundary

**What:** Represent RFD-only ACP transport declarations and MCP lifecycle messages behind Mobvibe-owned types/functions until the SDK exposes official types. [CITED: agentclientprotocol.com/rfds/mcp-over-acp; VERIFIED: `/tmp/opencode/acp-sdk-0.21.0/schema/schema.json`]

**When to use:** Use for `type: "acp"`, `mcp/connect`, `mcp/message`, `mcp/disconnect`, and `mcpCapabilities.acp` because installed/latest SDK schema lacks those official generated types. [VERIFIED: `node_modules/@agentclientprotocol/sdk/schema/schema.json`; VERIFIED: `/tmp/opencode/acp-sdk-0.21.0/schema/schema.json`]

**Example:**

```typescript
// Source: https://agentclientprotocol.com/rfds/mcp-over-acp
type TeamAcpMcpServerDeclaration = {
	type: "acp";
	name: "mobvibe-team";
	id: string; // mobvibe-team:<agentTeamId>:<memberId>
	_meta?: Record<string, unknown> | null;
};
```

### Pattern 2: Identity from Transport, Not Tool Args

**What:** Generate one MCP server `id` per member session and map that id to `{ agentTeamId, memberId }`; ignore or reject caller fields in tool arguments. [VERIFIED: `02-CONTEXT.md`; CITED: agentclientprotocol.com/rfds/mcp-over-acp]

**When to use:** Every `mobvibe_team_*` handler should receive a server-bound caller context from router, not parse `fromMemberId` from JSON args. [VERIFIED: `02-CONTEXT.md`]

**Example:**

```typescript
// Source: https://agentclientprotocol.com/rfds/mcp-over-acp
const caller = serverBindingByConnectionId.get(connectionId);
if (!caller) throw new Error("Team MCP caller is not bound");
await teamTools.sendMessage(caller, parsedArgs);
```

### Pattern 3: Durable-First Mailbox with Best-Effort Wake

**What:** Insert mailbox row first; then attempt wake; update wake status separately. [VERIFIED: `02-CONTEXT.md`; VERIFIED: `../AionUi/src/process/team/TeamSession.ts`]

**When to use:** `mobvibe_team_send_message`, broadcast fan-out, idle notifications, and spawn/rename/shutdown intent notifications. [VERIFIED: `02-CONTEXT.md`; VERIFIED: `../AionUi/src/process/team/TeammateManager.ts`]

**Example:**

```typescript
// Source: ../AionUi/src/process/team/TeamSession.ts (adapted; Mobvibe must update wake metadata)
const message = store.createMailboxMessage({ caller, recipient, body });
try {
	await wakeMember(recipient.memberId);
	store.updateMailboxWake(message.messageId, { wakeStatus: "sent" });
} catch (error) {
	store.updateMailboxWake(message.messageId, { wakeStatus: "failed", error });
}
```

### Pattern 4: Atomic Dependency Mutation

**What:** When creating a task with `blockedBy`, append the new task id to each upstream task’s `blocks`; when a task becomes `completed`, remove it from downstream `blockedBy`. [VERIFIED: `../AionUi/src/process/team/TaskManager.ts`; VERIFIED: `../AionUi/tests/unit/team-TaskManager.test.ts`]

**When to use:** `mobvibe_team_task_create` and `mobvibe_team_task_update(status: "completed")`. [VERIFIED: `02-CONTEXT.md`]

**Example:**

```typescript
// Source: ../AionUi/src/process/team/TaskManager.ts (adapted to Mobvibe statuses)
const task = createTask({ status: blockedBy.length ? "blocked" : "todo", blockedBy });
for (const upstreamId of task.blockedBy) appendToBlocks(upstreamId, task.taskId);
if (updates.status === "completed") removeFromDependentsBlockedBy(task.taskId);
```

### Anti-Patterns to Avoid

- **Adding team MCP config to global agent settings:** This violates per-session isolation and can expose team tools to ordinary sessions. [VERIFIED: `.planning/REQUIREMENTS.md`; VERIFIED: `02-CONTEXT.md`]
- **Using AionUI `pending`/`deleted` task statuses:** Mobvibe shared status vocabulary is `todo/in_progress/blocked/completed/failed/cancelled`. [VERIFIED: `packages/shared/src/types/agent-team.ts`; VERIFIED: `02-CONTEXT.md`]
- **Marking `tools_ready` on `mcp/connect` only:** RFD connect only establishes a connection; locked decision requires confirming expected tools are listable. [VERIFIED: `02-CONTEXT.md`; CITED: agentclientprotocol.com/rfds/mcp-over-acp]
- **Putting mailbox/task body into Gateway projection:** Existing guard rejects forbidden keys, and Phase 1 boundary requires body fields stay CLI-local. [VERIFIED: `apps/mobvibe-cli/src/team/content-boundary.ts`; VERIFIED: `.planning/STATE.md`]
- **Expanding Phase 2 into full spawn/session lifecycle:** Spawn/rename/shutdown can be facts/intents only; ordinary member creation is Phase 3. [VERIFIED: `02-CONTEXT.md`; VERIFIED: `.planning/ROADMAP.md`]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SQLite lifecycle and projections | A second repository/database owner | Extend `AgentTeamStore` and existing migrations | Current store already runs migrations and asserts Gateway-safe projections. [VERIFIED: `apps/mobvibe-cli/src/team/agent-team-store.ts`] |
| ACP session lifecycle | A separate process manager for team members | Extend `SessionManager`/`AcpConnection` with team-specific options | Ordinary sessions already own WAL, permissions, E2EE, worktree, terminal and session events. [VERIFIED: `apps/mobvibe-cli/src/acp/session-manager.ts`] |
| MCP stdio protocol | Raw stdio JSON-RPC shim from scratch | `@modelcontextprotocol/sdk` for fallback bridge | AionUI uses official MCP SDK for stdio server/tool registration. [VERIFIED: `../AionUi/src/process/team/mcp/team/teamMcpStdio.ts`; VERIFIED: npm registry] |
| Caller identity | Tool arg `from` / `memberId` | Per-member ACP server id and router binding | RFD server id is component-generated and routes callbacks; tool args are agent-controlled. [CITED: agentclientprotocol.com/rfds/mcp-over-acp; VERIFIED: `02-CONTEXT.md`] |
| Content boundary checks | Manual review of every projection field | `assertGatewayFacingAgentTeamPayload` plus allowlisted projection builder | Existing guard recursively rejects forbidden plaintext/secret keys. [VERIFIED: `apps/mobvibe-cli/src/team/content-boundary.ts`] |

**Key insight:** Phase 2 complexity is not tool CRUD; it is preserving isolation boundaries while making agent-visible local content useful. Use existing ACP/session/store boundaries and add the smallest MCP adapter layer necessary. [VERIFIED: `02-CONTEXT.md`; VERIFIED: `apps/mobvibe-cli/src/acp/session-manager.ts`; VERIFIED: `apps/mobvibe-cli/src/team/agent-team-store.ts`]

## Common Pitfalls

### Pitfall 1: SDK Upgrade Does Not Solve RFD Surface
**What goes wrong:** Planner assumes `@agentclientprotocol/sdk@latest` includes `type: "acp"` and protocol handlers. [VERIFIED: `/tmp/opencode/acp-sdk-0.21.0/schema/schema.json`]  
**Why it happens:** Official RFD exists, but latest npm schema still lacks `acp` transport and `mcp/*` methods. [CITED: agentclientprotocol.com/rfds/mcp-over-acp; VERIFIED: npm registry]  
**How to avoid:** Plan an upgrade probe and a narrow local adapter fallback; isolate all cast/extension code in one module. [VERIFIED: `02-CONTEXT.md`]  
**Warning signs:** `McpServer` type rejects `type: "acp"`; initialize response has no typed `mcpCapabilities.acp`. [VERIFIED: `node_modules/@agentclientprotocol/sdk/schema/schema.json`]

### Pitfall 2: Tool Readiness Too Early
**What goes wrong:** Member marked `tools_ready` after `mcp/connect`, before tools are registered/listable. [VERIFIED: `02-CONTEXT.md`]  
**Why it happens:** RFD separates connect from MCP message exchange. [CITED: agentclientprotocol.com/rfds/mcp-over-acp]  
**How to avoid:** Readiness flow should be `server_ready -> session_injecting -> tools_waiting -> tools_ready` only after an MCP list-tools equivalent confirms all expected `mobvibe_team_*` tools. [VERIFIED: `packages/shared/src/types/agent-team.ts`; VERIFIED: `02-CONTEXT.md`]  
**Warning signs:** Projection shows `tools_ready` but agent tool calls fail with unknown tool/list missing. [ASSUMED]

### Pitfall 3: Wake Failure Rolls Back Delivery
**What goes wrong:** `send_message` returns failure after row insertion because wake failed, causing retries/duplicates. [VERIFIED: `02-CONTEXT.md`; VERIFIED: `../AionUi/src/process/team/TeamSession.ts`]  
**Why it happens:** Delivery and wake are coupled in one try/catch. [VERIFIED: `../AionUi/src/process/team/TeamSession.ts`]  
**How to avoid:** Commit mailbox first, then update `wake_status` independently. [VERIFIED: `02-CONTEXT.md`]  
**Warning signs:** Same message body appears multiple times after a wake exception. [ASSUMED]

### Pitfall 4: Gateway Projection Leaks Content Via “Helpful” Fields
**What goes wrong:** New task list/mailbox projection includes `description`, `body`, `content`, or `summaryText`. [VERIFIED: `apps/mobvibe-cli/src/team/content-boundary.ts`]  
**Why it happens:** Tool result shape and Gateway projection shape get conflated. [VERIFIED: `02-CONTEXT.md`]  
**How to avoid:** Keep CLI MCP tool result DTOs separate from Gateway-facing `AgentTeamSummary`; run existing content-boundary tests after adding fields. [VERIFIED: `apps/mobvibe-cli/src/team/projection-builder.ts`; VERIFIED: `apps/mobvibe-cli/src/team/__tests__/agent-team-store.test.ts`]

### Pitfall 5: AionUI Behavior Copied Too Literally
**What goes wrong:** Planner copies AionUI leader-only spawn, confirmation gates, TCP bridge primary, or `pending/deleted` statuses. [VERIFIED: `../AionUi/src/process/team/mcp/team/TeamMcpServer.ts`; VERIFIED: `../AionUi/src/process/team/mcp/team/teamMcpStdio.ts`; VERIFIED: `02-CONTEXT.md`]  
**Why it happens:** AionUI is mandatory reference but Mobvibe has different locked decisions. [VERIFIED: `02-CONTEXT.md`]  
**How to avoid:** Emulate mailbox wake/injection, runtime composition, and task dependency behavior; do not copy transport primary, tool gates, or status vocabulary. [VERIFIED: `02-CONTEXT.md`]

## Code Examples

### Per-member MCP declaration builder

```typescript
// Source: https://agentclientprotocol.com/rfds/mcp-over-acp
export function buildTeamMcpDeclaration(input: {
	agentTeamId: string;
	memberId: string;
}): TeamAcpMcpServerDeclaration {
	return {
		type: "acp",
		name: "mobvibe-team",
		id: `mobvibe-team:${input.agentTeamId}:${input.memberId}`,
	};
}
```

### Ordinary path must stay empty

```typescript
// Source: apps/mobvibe-cli/src/acp/acp-connection.ts
await connection.newSession({
	cwd,
	mcpServers: [],
});
```

### Broadcast semantics

```typescript
// Source: ../AionUi/src/process/team/mcp/team/TeamMcpServer.ts (adapted)
const recipients = to === "*"
	? members.filter((member) => member.memberId !== caller.memberId)
	: [resolveMember(to)];
```

## Minimal Vertical MVP Slices

1. **SDK/capability foundation:** Upgrade probe to `@agentclientprotocol/sdk@^0.21.0`, add narrow local RFD types if official `acp` transport remains absent, and map `mcpCapabilities.{acp,stdio,http,sse}` into `AgentSessionCapabilities.mcp`. [VERIFIED: npm registry; VERIFIED: `/tmp/opencode/acp-sdk-0.21.0/schema/schema.json`; VERIFIED: `packages/shared/src/types/session.ts`]
2. **Team MCP runtime and per-session injection:** Add team-only `mcpServers` injection options, per-member server id binding, `mcp/connect/message/disconnect` routing, and readiness phase persistence. [VERIFIED: `apps/mobvibe-cli/src/acp/acp-connection.ts`; CITED: agentclientprotocol.com/rfds/mcp-over-acp]
3. **Durable mailbox tool path:** Implement `mobvibe_team_send_message` and mailbox service methods with member/name resolution, broadcast, read/unread separation, wake metadata, and `agent-teams:changed` projection emission. [VERIFIED: `apps/mobvibe-cli/src/wal/migrations.ts`; VERIFIED: `../AionUi/src/process/team/Mailbox.ts`]
4. **Wake/injection semantics:** Implement atomic read-and-mark plus ordinary session prompt/history injection and idle notification guard; record wake success/failure separately. [VERIFIED: `../AionUi/src/process/team/TeammateManager.ts`; VERIFIED: `02-CONTEXT.md`]
5. **Durable task board tools:** Implement create/list/update with Mobvibe statuses, owner resolution, dependency mutation/unblock, short-id support if desired, and Gateway-safe projection tests. [VERIFIED: `../AionUi/src/process/team/TaskManager.ts`; VERIFIED: `../AionUi/src/process/team/repository/SqliteTeamRepository.ts`; VERIFIED: `packages/shared/src/types/agent-team.ts`]
6. **Per-session bridge fallback:** If native ACP is unavailable, add a per-session stdio bridge using `@modelcontextprotocol/sdk`; if no safe bridge can be built, return a team-capable validation error. [CITED: agentclientprotocol.com/rfds/mcp-over-acp; VERIFIED: `../AionUi/src/process/team/mcp/team/teamMcpStdio.ts`]

## Concrete Test Targets

| Target | Command | Behaviors |
|--------|---------|-----------|
| ACP injection/capability tests | `pnpm -C apps/mobvibe-cli test -- src/acp/__tests__/acp-connection.test.ts` | ordinary sessions keep `mcpServers: []`; team session receives per-member declaration; capability mapping includes MCP support. [VERIFIED: existing test path] |
| Session manager team validation tests | `pnpm -C apps/mobvibe-cli test -- src/acp/__tests__/session-manager.test.ts` | backend validation rejects non-team-capable backend; ordinary permission flow remains unchanged. [VERIFIED: existing test path] |
| Store/mailbox/task tests | `pnpm -C apps/mobvibe-cli test -- src/team/__tests__/agent-team-store.test.ts src/team/__tests__/mailbox-service.test.ts src/team/__tests__/task-board-service.test.ts` | durable write/read/unread/wake metadata, dependency mutation, content-boundary projection. [VERIFIED: existing and recommended test paths] |
| MCP runtime/router tests | `pnpm -C apps/mobvibe-cli test -- src/team/__tests__/team-mcp-router.test.ts` | `mcp/connect` id routing, tool list readiness, caller identity cannot be spoofed, unknown member/tool errors. [VERIFIED: recommended test path based on repo test convention] |
| Socket projection regression | `pnpm -C apps/mobvibe-cli test -- src/daemon/__tests__/socket-client.test.ts` | `agent-teams:changed` emitted after durable changes; no Gateway plaintext body fields. [VERIFIED: existing test path; VERIFIED: `apps/mobvibe-cli/src/daemon/socket-client.ts`] |

## State of the Art

| Old Approach | Current / Required Approach | When Changed | Impact |
|--------------|-----------------------------|--------------|--------|
| ACP session MCP only stdio/http/sse in SDK schema | RFD proposes `type: "acp"` transport with `mcp/connect`, `mcp/message`, `mcp/disconnect` | RFD current docs fetched 2026-05-13; npm latest still missing schema | Need local adapter or wait for SDK implementation; do not assume generated SDK support. [CITED: agentclientprotocol.com/rfds/mcp-over-acp; VERIFIED: npm registry] |
| AionUI TCP server + stdio shim as primary | Mobvibe native MCP-over-ACP primary, per-session bridge fallback only | Locked by Phase 2 context 2026-05-13 | Planner must not copy AionUI transport as primary. [VERIFIED: `02-CONTEXT.md`] |
| AionUI `pending/deleted` task vocabulary | Mobvibe `todo/in_progress/blocked/completed/failed/cancelled` | Phase 1 shared types | Tool schemas and tests must use Mobvibe statuses. [VERIFIED: `packages/shared/src/types/agent-team.ts`] |
| Leader-only / confirmation-gated team tools | No Phase 2 team-tool leader-only or Mobvibe confirmation gates | Phase 2 locked decisions D-07/D-08 | MCP-07 means caller/workspace/capability validation, not role/confirmation gates in this phase. [VERIFIED: `02-CONTEXT.md`] |

**Deprecated/outdated:** AionUI `team_spawn_agent` hard leader-only gate and `team_task_update` `pending/deleted` enum are reference-only and should not be copied into Mobvibe Phase 2. [VERIFIED: `../AionUi/src/process/team/mcp/team/TeamMcpServer.ts`; VERIFIED: `02-CONTEXT.md`]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Tool readiness failures may surface as “tools_ready but unknown tool” warning signs. | Common Pitfalls | Low; affects diagnostics wording, not architecture. |
| A2 | Wake retry duplication may appear as duplicate body rows after wake exceptions. | Common Pitfalls | Medium; planner should still test duplicate/retry behavior. |

## Open Questions (RESOLVED)

1. **How should Mobvibe implement RFD `mcp/*` messages with the current SDK connection internals?**
   - What we know: RFD defines the JSON-RPC messages; latest SDK schema lacks typed methods. [CITED: agentclientprotocol.com/rfds/mcp-over-acp; VERIFIED: `/tmp/opencode/acp-sdk-0.21.0/schema/schema.json`]
   - What's unclear: Whether `ClientSideConnection` exposes a safe extension hook for custom methods without patching generated internals. [ASSUMED]
   - RESOLVED: Phase 2 will not block on generated SDK support. Plan 02-01 owns the narrow Mobvibe RFD adapter boundary; Plan 02-02 consumes that adapter through typed local request/result shapes for `mcp/connect`, `mcp/message`, and `mcp/disconnect`. Any SDK extension hook discovered during implementation must remain isolated inside the adapter module, and router/tool code must not patch generated internals directly. [VERIFIED: `apps/mobvibe-cli/src/acp/acp-connection.ts`; VERIFIED: `.planning/phases/02-cli-team-mcp-mailbox-task-board/02-01-PLAN.md`; VERIFIED: `.planning/phases/02-cli-team-mcp-mailbox-task-board/02-02-PLAN.md`]
2. **What exact ordinary session API should wake use for mailbox injection?**
   - What we know: Mobvibe can call `record.connection.prompt(sessionId, prompt)` and persists prompt/session updates via WAL; AionUI injects readable messages into target conversation. [VERIFIED: `apps/mobvibe-cli/src/daemon/socket-client.ts`; VERIFIED: `../AionUi/src/process/team/TeammateManager.ts`]
   - What's unclear: Whether Phase 2 should also append a synthetic WAL event before prompt to ensure mailbox visibility if backend does not echo the user message. [ASSUMED]
   - RESOLVED: Plan 02-04 must add a narrow `SessionManager` injection seam that uses the ordinary ACP `connection.prompt(sessionId, prompt)` path and records auditable ordinary-session source refs. The implementation must persist `TeamSourceRef` entries in mailbox `source_refs_json` for success and failure/audit outcomes; if a synthetic WAL/session event is needed for auditability, it is created inside this seam and referenced as `type: "session_event"`, not sent through team projection plaintext. [VERIFIED: `apps/mobvibe-cli/src/acp/session-manager.ts`; VERIFIED: `.planning/phases/02-cli-team-mcp-mailbox-task-board/02-04-PLAN.md`]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| `pnpm` | package/version checks and workspace scripts | ✓ | `10.32.1` | — [VERIFIED: environment probe] |
| `bun` | CLI tests/build and `bun:sqlite` | ✓ | `1.3.13` | none for CLI tests [VERIFIED: environment probe] |
| `node` | build tooling and optional MCP shim runtime | ✓ | `v24.15.0` | Bun runtime for project code [VERIFIED: environment probe] |
| npm registry access via pnpm | dependency upgrade research | ✓ | `@agentclientprotocol/sdk@0.21.0` visible | Chinese mirror/proxy available in environment output if direct registry is slow. [VERIFIED: npm registry; VERIFIED: environment output] |
| `@modelcontextprotocol/sdk` | optional stdio bridge fallback | ✗ installed; available from registry | latest `1.29.0` | Add only in fallback slice. [VERIFIED: npm registry; VERIFIED: `apps/mobvibe-cli/package.json`] |

**Missing dependencies with no fallback:** None identified for research/planning. [VERIFIED: environment probe]

**Missing dependencies with fallback:** `@modelcontextprotocol/sdk` is not installed; fallback is to defer bridge implementation or add it only if Phase 2 includes bridge slice. [VERIFIED: `apps/mobvibe-cli/package.json`; VERIFIED: npm registry]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | yes | Bind MCP caller to component-generated per-member server id and existing authenticated CLI/team/session ownership; do not trust tool args. [VERIFIED: `02-CONTEXT.md`; CITED: agentclientprotocol.com/rfds/mcp-over-acp] |
| V3 Session Management | yes | Team tools are injected only in team member ordinary sessions; ordinary sessions keep `mcpServers: []`. [VERIFIED: `apps/mobvibe-cli/src/acp/acp-connection.ts`; VERIFIED: `.planning/REQUIREMENTS.md`] |
| V4 Access Control | yes | Validate team/member/workspace/backend scope; Phase 2 does not add leader-only/confirmation gates for team tools. [VERIFIED: `02-CONTEXT.md`] |
| V5 Input Validation | yes | Validate recipient/member identifiers, broadcast `*`, task status enum, dependency ids, body shape and length using explicit parsers; avoid `any`. [VERIFIED: `./AGENTS.md`; VERIFIED: `packages/shared/src/types/agent-team.ts`] |
| V6 Cryptography | yes | Do not send mailbox/task bodies to Gateway plaintext; preserve ordinary session E2EE/WAL paths; do not log secrets/DEK/content. [VERIFIED: `apps/mobvibe-cli/src/team/content-boundary.ts`; VERIFIED: `apps/mobvibe-cli/src/e2ee/__tests__/crypto-service.test.ts`; VERIFIED: `./AGENTS.md`] |

### Known Threat Patterns for CLI Team MCP

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Agent spoofs `fromMemberId` in tool args | Spoofing | Ignore caller args; derive caller from `connectionId -> acpId -> memberId`. [CITED: agentclientprotocol.com/rfds/mcp-over-acp; VERIFIED: `02-CONTEXT.md`] |
| Team tools leak into ordinary session | Elevation of privilege / Information disclosure | Ordinary create/load path remains `mcpServers: []`; team injection requires explicit team context. [VERIFIED: `apps/mobvibe-cli/src/acp/acp-connection.ts`] |
| Global MCP config mutation | Elevation of privilege | Bridge fallback must be per-session only; never patch agent global MCP config. [VERIFIED: `.planning/REQUIREMENTS.md`; VERIFIED: `02-CONTEXT.md`] |
| Gateway receives task/mailbox body | Information disclosure | Keep body in `body_local_json`; projection allowlists metadata and runs forbidden-key guard. [VERIFIED: `apps/mobvibe-cli/src/wal/migrations.ts`; VERIFIED: `apps/mobvibe-cli/src/team/content-boundary.ts`] |
| Logs contain plaintext mailbox/task or secrets | Information disclosure / Repudiation | Use pino structured metadata with ids/status/errors only; avoid logging tool bodies and env secrets. [VERIFIED: `./AGENTS.md`] |
| Dependency mutation race corrupts task graph | Tampering | Use SQLite transactions/atomic update methods for `blockedBy`/`blocks`. [VERIFIED: `../AionUi/src/process/team/repository/SqliteTeamRepository.ts`; VERIFIED: `../AionUi/tests/unit/team-TaskManager.test.ts`] |

## Sources

### Primary (HIGH confidence)
- `./AGENTS.md`, `apps/mobvibe-cli/AGENTS.md`, `../AionUi/AGENTS.md` — project constraints and test/style rules. [VERIFIED]
- `.planning/phases/02-cli-team-mcp-mailbox-task-board/02-CONTEXT.md` — locked decisions, AionUI references, phase boundary. [VERIFIED]
- `.planning/REQUIREMENTS.md`, `.planning/STATE.md`, `.planning/ROADMAP.md` — requirements, history, phase scope/dependencies. [VERIFIED]
- `https://agentclientprotocol.com/rfds/mcp-over-acp` — MCP-over-ACP RFD, transport declaration, lifecycle messages, bridge model. [CITED]
- `apps/mobvibe-cli/src/acp/acp-connection.ts`, `apps/mobvibe-cli/src/acp/session-manager.ts`, `apps/mobvibe-cli/src/team/*`, `apps/mobvibe-cli/src/wal/migrations.ts`, `packages/shared/src/types/*` — current Mobvibe implementation. [VERIFIED]
- AionUI mandatory references: `TeamMcpServer.ts`, `teamMcpStdio.ts`, `mcpSessionConfig.ts`, `Mailbox.ts`, `TeammateManager.ts`, `TeamSession.ts`, `TaskManager.ts`, `SqliteTeamRepository.ts`, and unit tests. [VERIFIED]
- npm registry via `pnpm view` and extracted `@agentclientprotocol/sdk@0.21.0` package. [VERIFIED]

### Secondary (MEDIUM confidence)
- None used; no unverified web search findings were needed. [VERIFIED]

### Tertiary (LOW confidence)
- Assumption log A1/A2 and SDK extension hook uncertainty. [ASSUMED]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — package versions and installed/current SDK schema were verified from package files, registry, and extracted tarball. [VERIFIED]
- Architecture: MEDIUM — boundaries are verified from code/context/RFD, but exact SDK custom-method implementation remains unresolved. [VERIFIED; ASSUMED]
- Pitfalls: HIGH for content boundary/status/transport/permission pitfalls; MEDIUM for readiness and wake warning signs because final implementation details are not written yet. [VERIFIED; ASSUMED]

**Research date:** 2026-05-13  
**Valid until:** 2026-05-20 for ACP SDK/RFD specifics; 2026-06-12 for Mobvibe codebase structure if Phase 2 planning starts promptly.
