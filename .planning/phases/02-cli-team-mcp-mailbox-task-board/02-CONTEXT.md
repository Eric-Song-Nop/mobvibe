# Phase 2: CLI Team MCP、Mailbox 与 Task Board - Context

**Gathered:** 2026-05-13T10:53:03Z
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 2 delivers the CLI-local Agent Team coordination runtime: native MCP-over-ACP team tool injection, durable mailbox delivery, durable task board operations, and the CLI-side runtime services needed for agents to coordinate through `mobvibe_team_*` tools.

This phase does not deliver the WebUI create flow, full leader/member ordinary session orchestration, cancel/retry/archive lifecycle UI, or automatic code merge. Those remain later roadmap phases. Phase 2 may define and persist spawn/rename/shutdown tool intents, but should not pull the full Phase 3/4 session lifecycle into this phase.

</domain>

<decisions>
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

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Scope And Locked Prior Decisions
- `.planning/PROJECT.md` — Product model, Agent Team value, E2EE/content boundaries, MCP-over-ACP preference, and CLI durable truth ownership.
- `.planning/REQUIREMENTS.md` — Phase 2 requirement mapping for MCP and coordination runtime. Interpret MCP-07 in light of this context: no role/user-confirmation gates for team tools, but caller identity, workspace/capability validation, and ordinary ACP permissions remain required.
- `.planning/ROADMAP.md` — Phase 2 scope and success criteria; Phase 3/4 boundaries for ordinary session orchestration and lifecycle controls.
- `.planning/STATE.md` — Current project position and Phase 1 implementation decisions that affect Phase 2.
- `.planning/phases/01-protocol-state-model-persistence-boundary/01-CONTEXT.md` — Locked Agent Team model, content boundary, state model, source refs, CLI durable store, and projection rules.

### Current Mobvibe Code
- `packages/shared/src/types/agent-team.ts` — Agent Team, MCP status, mailbox/task counts, source refs, and RPC/event payload types.
- `packages/shared/src/types/session.ts` — `AgentSessionCapabilities` and `AgentMcpCapabilities` shape.
- `packages/shared/src/types/socket-events.ts` — Team RPC and `agent-teams:changed` socket payload integration.
- `apps/mobvibe-cli/src/team/agent-team-store.ts` — Existing CLI durable Agent Team store and projection entry point.
- `apps/mobvibe-cli/src/team/projection-builder.ts` — Existing non-content projection builder and task/mailbox count logic.
- `apps/mobvibe-cli/src/team/content-boundary.ts` — Gateway-facing forbidden plaintext/secret key guard.
- `apps/mobvibe-cli/src/wal/migrations.ts` — Existing team/mailbox/task/MCP SQLite tables.
- `apps/mobvibe-cli/src/acp/acp-connection.ts` — Current `session/new` and `session/load` paths pass `mcpServers: []`; Phase 2 extends this for team sessions.
- `apps/mobvibe-cli/src/acp/session-manager.ts` — Existing session creation, worktree setup, WAL initialization, permission handling, and ACP connection ownership.
- `apps/mobvibe-cli/src/daemon/socket-client.ts` — Existing CLI RPC handlers and `AgentTeamStore` wiring.

### AionUI Reference Implementation
- `../AionUi/src/process/team/mcp/team/TeamMcpServer.ts` — Reference tool dispatch, caller slot handling, send_message, spawn, task tools, members, rename, shutdown request, and wake behavior.
- `../AionUi/src/process/team/mcp/team/teamMcpStdio.ts` — Reference stdio bridge, tool schemas, TCP relay, auth token, and `mcp_ready` notification.
- `../AionUi/src/process/agent/acp/mcpSessionConfig.ts` — Reference per-session MCP config construction.
- `../AionUi/src/process/team/Mailbox.ts` — Reference mailbox service API.
- `../AionUi/src/process/team/TeammateManager.ts` — Reference wake flow, unread message injection, idle notifications, wake-loop guard, crash testament, and member cleanup behavior.
- `../AionUi/src/process/team/TeamSession.ts` — Reference composition of mailbox, task manager, teammate manager, and MCP server.
- `../AionUi/src/process/team/TaskManager.ts` — Reference task CRUD and dependency/unblock behavior.
- `../AionUi/src/process/team/repository/SqliteTeamRepository.ts` — Reference durable mailbox/task persistence, atomic read-and-mark, short task id lookup, and dependency mutation.
- `../AionUi/src/process/team/prompts/leadPrompt.ts` — Reference lead coordination prompt and user-approved lineup workflow. Use for behavior inspiration, but Mobvibe no longer requires team tool confirmation gates.
- `../AionUi/src/process/team/prompts/teammatePrompt.ts` — Reference teammate prompt and coordination rules.
- `../AionUi/tests/unit/team-TeamMcpServer.test.ts` — Reference expected team tool behavior.
- `../AionUi/tests/unit/team-Mailbox.test.ts` — Reference mailbox write/read contract.
- `../AionUi/tests/unit/team-TaskManager.test.ts` — Reference task dependency behavior.
- `../AionUi/tests/unit/team-SqliteTeamRepository.test.ts` — Reference durable repository behavior.

### Protocol Reference
- `https://agentclientprotocol.com/rfds/mcp-over-acp` — Official MCP-over-ACP RFD: `mcpCapabilities.acp`, `session/new` declarations with `{ type: "acp", name, id }`, `mcp/connect`, `mcp/message`, `mcp/disconnect`, per-server id routing, and bridge compatibility model.
- `node_modules/@agentclientprotocol/sdk/schema/schema.json` — Installed SDK schema. At context time it exposes stdio/http/sse MCP server schemas but not the RFD `acp` transport, which is why SDK upgrade research is required.

### Codebase Maps
- `.planning/codebase/ARCHITECTURE.md` — System layering and CLI durable state ownership.
- `.planning/codebase/INTEGRATIONS.md` — ACP SDK, local backend, Socket.IO, SQLite, and environment integration map.
- `.planning/codebase/CONCERNS.md` — Large session orchestration files, WAL/reconnect fragility, permission lifecycle fragility, and content-boundary risks.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `AgentTeamStore` already owns durable Agent Team metadata and can be extended with mailbox/task write/update methods instead of adding a parallel store.
- `projection-builder.ts` already excludes local body fields from Gateway-facing summaries and computes mailbox/task counts; new runtime writes should continue feeding this builder.
- `content-boundary.ts` already asserts forbidden Gateway-facing keys; keep or expand this guard when adding new projection fields.
- `AcpConnection.createSession` and `loadSession` are the direct `mcpServers` injection points; ordinary non-team sessions must continue passing an empty list.
- `SessionManager.createSession` already handles worktree, WAL session initialization, E2EE DEK initialization, and ordinary ACP permission handler setup.

### Established Patterns
- CLI owns durable coordination facts; Gateway routes typed RPC and projections only.
- Gateway-facing Agent Team payloads must not include mailbox body, task description, prompt, summary text, agent output, tokens, secrets, or DEK material.
- Ordinary member sessions own conversation facts, WAL, E2EE, permission requests, files/Git, and history replay.
- Tests in this repo are close to the module being changed: CLI runtime behavior should use Bun tests under `apps/mobvibe-cli/src/**/__tests__/`.

### Integration Points
- Extend shared types before runtime code if new tool payload/result/error types cross process boundaries.
- Add team MCP runtime modules under `apps/mobvibe-cli/src/team/` rather than growing `session-manager.ts` significantly.
- Extend `AcpConnection` with team-specific MCP server declarations, keeping ordinary `createSession` behavior unchanged.
- Update `AgentTeamStore` and migrations only through the existing SQLite migration path.
- Emit `agent-teams:changed` projection events after durable mailbox/task/MCP state changes that affect Gateway-facing counts/status.

</code_context>

<specifics>
## Specific Ideas

- Follow AionUI’s team behavior patterns for each subsystem before planning: MCP tool dispatch, mailbox wake/injection, idle guard, and task dependency behavior.
- Do not copy AionUI transport as the primary design. AionUI’s TCP + stdio bridge is reference material for fallback behavior; Mobvibe’s primary design is official MCP-over-ACP.
- Tool names should use Mobvibe naming (`mobvibe_team_*`), not AionUI’s `team_*` names.
- The Phase 2 context intentionally changes the earlier tool-policy assumption: no team tool is leader-only and no Agent Team tool-layer user confirmation gate is required.

</specifics>

<deferred>
## Deferred Ideas

- Full WebUI creation flow, member ordinary session creation from WebUI, and visible team detail UI remain Phase 3.
- Cancel/retry/archive lifecycle controls, permission aggregation UI, and recovery polish remain Phase 4.
- Desktop/mobile UI polish remains Phase 5.

</deferred>

---

*Phase: 2-CLI Team MCP、Mailbox 与 Task Board*
*Context gathered: 2026-05-13T10:53:03Z*
