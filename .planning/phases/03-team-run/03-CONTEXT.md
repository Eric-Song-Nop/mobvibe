# Phase 3: 最小端到端 Team Run - Context

**Gathered:** 2026-05-14T02:58:47Z
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 3 delivers the first end-to-end Agent Team run: the user creates an Agent Team from WebUI, the Gateway routes the request to the owning CLI, the CLI creates a leader ordinary ACP session with team MCP injection, the user target is delivered to the leader, spawned members become ordinary ACP sessions, and WebUI can show a minimal team projection with member session navigation.

This phase must prove the WebUI -> Gateway -> CLI -> leader/member ordinary session loop. It does not deliver cancel/retry/archive controls, permission aggregation UI, recovery polish, automatic summary, automatic merge, per-member worktrees, or rich multi-pane team chat. Those remain later phases.

</domain>

<decisions>
## Implementation Decisions

### 创建与目标投递
- **D-01:** Creating an Agent Team in Phase 3 means **create and start**. The create flow includes the user target task, creates the leader ordinary ACP session, injects team MCP, and delivers the target to the leader.
- **D-02:** WebUI should report create success only after the user target has been accepted for delivery to the leader ordinary session. Returning after only metadata creation or session creation is not enough for this phase's end-to-end goal.
- **D-03:** The target task is the primary user input. Team title is optional; if omitted, derive a short title from the target task.
- **D-04:** Do not show or persist the target task plaintext in Agent Team projection. Team detail should provide a jump to the leader ordinary session for full target context.
- **D-05:** Gateway must not receive, store, or log plaintext target content. Downstream agents must preserve the Phase 1 content boundary: target content must stay E2EE/CLI-local/ordinary-session-owned, not become Gateway-facing team metadata.

### 自动成员创建
- **D-06:** Phase 3 should turn spawn requests into real ordinary member sessions. Unlike Phase 2, where spawn was only an intent/fact, Phase 3 must execute the minimal member session creation path.
- **D-07:** Spawn is automatic after capability and structural validation. Do not add a separate WebUI confirmation step for Phase 3.
- **D-08:** Any team member may trigger automatic spawn through team tooling. Do not make Phase 3 spawn leader-only.
- **D-09:** If a spawn request omits backend/worktree details, inherit the leader backend and the Agent Team execution checkout policy by default. Tool arguments may override backend when valid; CLI must still enforce team-capable backend validation.
- **D-10:** Member creation failure should leave an auditable failed member slot in the team projection: sessionId may be absent, lifecycle/health/error should explain the failure. Do not silently roll back or hide failed attempts.

### Workspace 与 Worktree 语义
- **D-11:** Workspace and worktree are different concepts. A workspace is the logical Git project/repo context; a worktree is one checkout/execution directory of that same workspace. Do not treat a new worktree as a new workspace.
- **D-12:** Phase 3 supports a **team-shared worktree** mode: one Agent Team remains under one workspace, and if worktree creation is enabled, leader and all spawned members execute in the same newly created team worktree checkout.
- **D-13:** Do not implement per-member worktrees in Phase 3. Per-member checkout isolation would pull in merge/conflict/reconciliation complexity outside this phase.
- **D-14:** Reuse the existing ordinary session worktree UI/parameters for team creation: cwd selection, Git repo detection, repoRoot, relativeCwd, worktree enable checkbox, branch, baseBranch, path preview, and execution path preview.
- **D-15:** The team worktree checkbox defaults to off, matching current ordinary session behavior. Users explicitly opt into creating a team-shared worktree.
- **D-16:** If the user enables team worktree creation and worktree creation fails, the Agent Team create flow fails. Do not silently downgrade to the current checkout.

### WebUI Navigation And Detail Shape
- **D-17:** Use an overview + jump model for Phase 3. Do not build an AionUI-style multi-column team chat surface in this phase.
- **D-18:** In the workspace's session list, show Agent Team as a parent entry that appears alongside ordinary sessions and defaults expanded to show leader/member child rows. This is a UI placement decision only; Agent Team is still not `Session(kind="team")`.
- **D-19:** Team-owned member sessions should be folded under the Agent Team parent entry by default, not flattened as unrelated ordinary sessions.
- **D-20:** Clicking a member child row jumps to that member's ordinary session and reuses the existing chat, file, Git, permission, model/mode, and history UI.
- **D-21:** Team overview/detail should stay minimal in Phase 3: member identities, basic status/MCP state, and links to ordinary sessions. Avoid rich timelines, permission aggregation, or embedded chat previews.
- **D-22:** Roadmap still requires task/mailbox non-content projection in Phase 3. Keep it lightweight by showing compact task/mailbox count badges on the Agent Team parent row.

### the agent's Discretion
- Downstream agents may choose the exact field names and module split, but they must preserve the semantics above: team-shared worktree is an execution checkout under the same workspace, not a new workspace and not per-member worktrees.
- Downstream agents may decide whether to adjust the existing `TeamWorkspaceMode` union or add separate team-level execution checkout metadata, as long as WebUI grouping and projection semantics remain clear.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Scope And Locked Prior Decisions
- `.planning/PROJECT.md` — Product model, content boundary, CLI durable truth ownership, AionUI reference notes, and MCP-over-ACP isolation preference.
- `.planning/REQUIREMENTS.md` — Phase 3 requirement mapping: ORCH-01 through ORCH-06 and UI-01 through UI-05.
- `.planning/ROADMAP.md` — Phase 3 goal and success criteria; Phase 4/5 boundaries.
- `.planning/STATE.md` — Current project state and Phase 1/2 implementation decisions carried into Phase 3.
- `.planning/phases/01-protocol-state-model-persistence-boundary/01-CONTEXT.md` — Locked Agent Team model, content boundary, state model, source refs, CLI durable store, and projection rules.
- `.planning/phases/02-cli-team-mcp-mailbox-task-board/02-CONTEXT.md` — Locked team MCP runtime, mailbox, task board, caller binding, wake behavior, and AionUI reference list.

### Current Mobvibe Code
- `packages/shared/src/types/agent-team.ts` — Existing Agent Team projection, member, MCP, workspace mode, source ref, and create/list/get RPC types.
- `packages/shared/src/types/socket-events.ts` — Existing ordinary session create/worktree RPC shape, including `CreateSessionWorktreeOptions`.
- `packages/shared/src/types/session.ts` — Ordinary session worktree metadata (`worktreeSourceCwd`, `worktreeBranch`) and session summary shape.
- `packages/shared/src/worktree-names.ts` — Existing branch name generation and path sanitization helpers for worktree creation.
- `apps/webui/src/components/app/CreateSessionDialog.tsx` — Existing ordinary session worktree UI to reuse for Agent Team creation.
- `apps/webui/src/hooks/useSessionHandlers.ts` — Existing ordinary session create handler that resolves repoRoot/relativeCwd and sends worktree params.
- `apps/webui/src/lib/api.ts` — Current Agent Team API client and ordinary session create client.
- `apps/webui/src/lib/team-store.ts` — Current projection-only Agent Team Zustand store with forbidden content key stripping.
- `apps/webui/src/lib/socket.ts` — Existing `agent-teams:changed` socket handler registration point.
- `apps/webui/src/lib/workspace-utils.ts` — Existing workspace grouping rule that keeps worktree sessions under the source repo workspace.
- `apps/webui/src/hooks/useSessionList.ts` — Existing session filtering/grouping by workspace key.
- `apps/webui/src/components/session/SessionSidebar.tsx` — Current workspace/session sidebar where the Agent Team parent + member child rows should integrate.
- `apps/gateway/src/routes/agent-teams.ts` — Current Agent Team REST route; currently creates metadata and rejects forbidden content keys.
- `apps/gateway/src/services/team-router.ts` — Current typed Gateway-to-CLI Team RPC router.
- `apps/gateway/src/routes/sessions.ts` — Existing ordinary session worktree validation and route parsing.
- `apps/gateway/src/socket/cli-handlers.ts` — Existing Agent Team RPC handlers and `agent-teams:changed` relay.
- `apps/gateway/src/socket/webui-handlers.ts` — Existing user-scoped WebUI socket event forwarding.
- `apps/mobvibe-cli/src/team/agent-team-store.ts` — Current durable Agent Team store, projection builder entry, member rows, mailbox/task rows, and tool intents.
- `apps/mobvibe-cli/src/team/projection-builder.ts` — Existing non-content projection, task/mailbox counts, MCP summaries, and source ref collection.
- `apps/mobvibe-cli/src/team/team-runtime.ts` — Current mailbox wake/injection runtime and member completion notification behavior.
- `apps/mobvibe-cli/src/team/team-mcp-router.ts` — Current team MCP caller binding and tools_ready/degraded state path.
- `apps/mobvibe-cli/src/team/team-tool-handlers.ts` — Current `mobvibe_team_*` tool dispatch and lifecycle intent support.
- `apps/mobvibe-cli/src/acp/session-manager.ts` — Existing ordinary session creation, worktree creation, `createTeamSession`, mailbox prompt injection, WAL, E2EE, and permission handling.
- `apps/mobvibe-cli/src/acp/acp-connection.ts` — Existing per-session `mcpServers` injection and MCP-over-ACP callback routing.
- `apps/mobvibe-cli/src/daemon/socket-client.ts` — Current CLI-side Agent Team RPC handling; currently metadata create/list/get only.

### AionUI Reference Implementation
- `../AionUi/src/process/team/TeamSessionService.ts` — Reference team creation, addAgent/spawn, shared workspace inheritance, team session start, MCP config injection, and session repair.
- `../AionUi/src/process/team/TeamSession.ts` — Reference coordinator owning mailbox, task manager, teammate manager, MCP server, and user message delivery to leader/member.
- `../AionUi/src/process/team/TeammateManager.ts` — Reference wake flow, unread mailbox injection, active wake guard, idle notification, crash handling, and member lifecycle updates.
- `../AionUi/src/process/team/mcp/team/TeamMcpServer.ts` — Reference team tool dispatch, spawn behavior, member resolution, message delivery, rename/shutdown, and task tools.
- `../AionUi/src/process/agent/acp/mcpSessionConfig.ts` — Reference per-session MCP server config construction.
- `../AionUi/src/renderer/pages/team/components/TeamCreateModal.tsx` — Reference team creation UI and supported-agent filtering.
- `../AionUi/src/renderer/pages/team/TeamPage.tsx` — Reference rich team page; use as inspiration only, not as Phase 3 UI scope.
- `../AionUi/src/renderer/pages/team/components/TeamTabs.tsx` — Reference agent tab/status affordances.
- `../AionUi/src/renderer/components/layout/Sider/TeamSiderSection.tsx` — Reference team sidebar entry and badges.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `SessionManager.createSession` already creates ordinary sessions with optional worktree creation. Phase 3 should reuse this behavior conceptually for team leader/member sessions rather than adding a parallel worktree implementation.
- `SessionManager.createTeamSession` already creates a team-enabled ordinary session with team MCP injection, but it currently lacks the ordinary session worktree options and is not yet wired into Agent Team create RPC.
- `CreateSessionDialog` and `useSessionHandlers` already provide the worktree UI and request-building behavior the user wants reused for Agent Team creation.
- `workspace-utils.ts` and `useSessionList.ts` already encode the important grouping rule: worktree sessions remain under the source repo workspace.
- `AgentTeamStore` already persists team/member/MCP/mailbox/task facts and builds Gateway-facing projection; extend it instead of adding a second team truth source.
- `TeamRuntime`, `TeamMcpRouter`, and `TeamToolHandlers` already provide team MCP callback routing, mailbox/task behavior, and tool intent recording that Phase 3 should connect to real session orchestration.

### Established Patterns
- Gateway routes authenticate, validate shape/content boundaries, and forward typed RPC to CLI. Gateway must remain a router, not durable Agent Team truth.
- Ordinary sessions own conversation facts, WAL, E2EE, permission requests, files/Git, worktree execution directory, and history. Agent Team projection owns only coordination metadata.
- WebUI stores only projection-safe Agent Team data. Plaintext target, mailbox body, task body, and agent output must not enter `team-store` or Gateway-facing payloads.
- Worktree sessions group under the same logical workspace as their source repo; do not let team-shared worktree create a separate workspace group.

### Integration Points
- WebUI: add Agent Team create UI by extending existing app/sidebar/dialog patterns, reusing worktree selection logic, and storing projection through `team-store`.
- Gateway: extend Agent Team create route/RPC without allowing plaintext target or forbidden content keys into logs or durable gateway state.
- CLI: Agent Team create should create durable team/member rows, create leader ordinary team session, inject MCP, deliver target, update member sessionId/lifecycle/MCP state, and emit `agent-teams:changed`.
- CLI spawn path: connect team lifecycle intents/tool calls to `createTeamSession` for members, with inherited leader backend/team execution checkout defaults and failed member-slot projection on errors.
- WebUI navigation: integrate Agent Team parent rows into the workspace session list, default expanded with member child rows that activate ordinary sessions.

</code_context>

<specifics>
## Specific Ideas

- Use AionUI as a solid behavior reference for team creation, spawn, wake, mailbox injection, status updates, and sidebar/team navigation, but do not copy its rich multi-column TeamPage as Phase 3 scope.
- Product wording should keep Agent Team as the user-facing object. Team row can live inside the workspace session list, but it is still not a session kind.
- For Phase 3 UI, prefer a compact Agent Team parent row with small task/mailbox badges and expanded member rows. Clicking members should reuse existing ordinary session UI.
- Worktree wording must be precise: the team can create a shared worktree checkout for execution, but it remains the same workspace/logical Git project.

</specifics>

<deferred>
## Deferred Ideas

- Per-member worktrees and any merge/conflict matrix remain out of Phase 3.
- AionUI-style multi-column embedded team chat remains out of Phase 3.
- Cancel/retry/archive controls, permission aggregation UI, recovery behavior, and security/logging hardening remain Phase 4.
- Rich desktop/mobile polish, advanced team list UX, timelines, and full v1 polish remain Phase 5.

</deferred>

---

*Phase: 3-最小端到端 Team Run*
*Context gathered: 2026-05-14T02:58:47Z*
