---
phase: 02-cli-team-mcp-mailbox-task-board
plan: 02
subsystem: cli-mcp-runtime
tags: [typescript, acp, mcp, mobvibe-cli, bun-sqlite, agent-team]

requires:
  - phase: 02-cli-team-mcp-mailbox-task-board
    provides: SDK/capability foundation and narrow MCP-over-ACP adapter boundary from 02-01
provides:
  - Team-only ACP MCP declaration injection for create/load paths
  - Team MCP router with per-member server id caller binding
  - Tools readiness gate requiring all five expected `mobvibe_team_*` names
  - Team tool registry shell without leader-only or Mobvibe confirmation gates
  - CLI-local durable spawn/rename/shutdown request fact persistence
affects: [phase-02-mailbox, phase-02-task-board, phase-03-orchestration]

tech-stack:
  added: []
  patterns:
    - Team session injection uses explicit `teamMcpDeclaration`; ordinary sessions keep `mcpServers: []`
    - Caller identity is derived from `mobvibe-team:<agentTeamId>:<memberId>` binding
    - `tools_ready` is set only after expected team tool names are listed
    - Lifecycle tool requests are persisted as local request facts, not executed in Phase 2

key-files:
  created:
    - apps/mobvibe-cli/src/team/team-runtime.ts
    - apps/mobvibe-cli/src/team/team-mcp-router.ts
    - apps/mobvibe-cli/src/team/team-tool-handlers.ts
    - apps/mobvibe-cli/src/team/__tests__/team-mcp-router.test.ts
  modified:
    - apps/mobvibe-cli/src/acp/acp-connection.ts
    - apps/mobvibe-cli/src/acp/session-manager.ts
    - apps/mobvibe-cli/src/acp/__tests__/acp-connection.test.ts
    - apps/mobvibe-cli/src/acp/__tests__/session-manager.test.ts
    - apps/mobvibe-cli/src/team/agent-team-store.ts
    - apps/mobvibe-cli/src/wal/migrations.ts

key-decisions:
  - "Team MCP caller identity is bound from per-member ACP server ids and tool arguments cannot override it."
  - "tools_ready requires all five expected mobvibe_team_* tools from list-tools; mcp/connect alone only reaches tools_waiting."
  - "spawn/rename/shutdown remain CLI-local durable request facts in Phase 2 and do not execute session lifecycle side effects."

patterns-established:
  - "ACP boundary: team MCP injection is opt-in per SessionManager team path and per AcpConnection option."
  - "Router boundary: TeamMcpRouter owns serverId binding and passes only router-bound caller context to handlers."
  - "Tool shell: TeamToolHandlers exposes exact Phase 2 tool names and delegates mailbox/task bodies to later injectable services."

requirements-completed: [MCP-01, MCP-02, MCP-03, MCP-06, MCP-07]

duration: 35 min
completed: 2026-05-13
---

# Phase 02 Plan 02: Team MCP Runtime, Injection, Caller Binding, and Tools Readiness Summary

**Native MCP-over-ACP team runtime with per-member caller binding, verified tool-list readiness, and durable lifecycle intent facts.**

## Performance

- **Duration:** 35 min
- **Started:** 2026-05-13T12:57:00Z
- **Completed:** 2026-05-13T13:32:22Z
- **Tasks:** 2
- **Files modified:** 10 source/test files plus planning metadata

## Accomplishments

- Added team-only ACP injection options so ordinary `session/new` and `session/load` still send `mcpServers: []`, while explicit team sessions send exactly one `mobvibe-team` declaration.
- Added `SessionManager.createTeamSession` with MCP capability validation before ACP session creation and preserved the ordinary ACP permission request handler flow.
- Created `TeamRuntime`, `TeamMcpRouter`, and `TeamToolHandlers` for MCP connect/list-tools/tool-call routing with router-bound caller context.
- Persisted readiness transitions through `agent_team_mcp_status`, with `mcp/connect` reaching `tools_waiting` and `tools_ready` requiring all five expected team tools.
- Added migration-backed `agent_team_tool_intents` persistence for spawn/rename/shutdown request facts without invoking session lifecycle side effects.

## Task Commits

Each task was committed atomically using TDD RED/GREEN flow:

1. **Task 1 RED: team ACP injection tests** - `2a457b9` (test)
2. **Task 1 GREEN: team ACP injection path** - `91f14b0` (feat)
3. **Task 2 RED: team MCP router tests** - `25eb40a` (test)
4. **Task 2 GREEN: team MCP router runtime** - `6194d8c` (feat)
5. **Formatting:** `5214295` (style)

**Plan metadata:** committed after this summary is written.

## Files Created/Modified

- `apps/mobvibe-cli/src/acp/acp-connection.ts` - Adds optional team MCP declaration payloads while preserving empty ordinary `mcpServers` defaults.
- `apps/mobvibe-cli/src/acp/session-manager.ts` - Adds validated team session creation with native ACP requirement and unchanged ordinary permission handling.
- `apps/mobvibe-cli/src/acp/__tests__/acp-connection.test.ts` - Covers ordinary and team ACP create/load MCP server payloads.
- `apps/mobvibe-cli/src/acp/__tests__/session-manager.test.ts` - Covers unsupported team-capability rejection, team declaration injection, and ordinary permission request preservation.
- `apps/mobvibe-cli/src/team/team-runtime.ts` - Composes store, router, and handlers for future mailbox/task service injection.
- `apps/mobvibe-cli/src/team/team-mcp-router.ts` - Binds server ids to caller context, updates readiness, dispatches tools, and records lifecycle intents.
- `apps/mobvibe-cli/src/team/team-tool-handlers.ts` - Defines exact Phase 2 `mobvibe_team_*` registry shell with no leader-only or confirmation gates.
- `apps/mobvibe-cli/src/team/agent-team-store.ts` - Adds member insertion, MCP readiness upsert, and durable tool intent persistence methods.
- `apps/mobvibe-cli/src/wal/migrations.ts` - Adds migration version 8 for `agent_team_tool_intents`.
- `apps/mobvibe-cli/src/team/__tests__/team-mcp-router.test.ts` - Covers binding, readiness, spoofing prevention, durable intents, and no team-tool confirmation path.

## Decisions Made

- Team MCP caller identity comes only from `mobvibe-team:<agentTeamId>:<memberId>` server binding; `fromMemberId`/`memberId` tool args are ignored for identity.
- `tools_ready` is not a connection state; it requires a list-tools result containing every expected `mobvibe_team_*` name.
- Phase 2 lifecycle requests are stored as request facts with sanitized local payloads and router-bound requester identity; execution remains deferred.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- TDD RED tests intentionally failed before implementation: ACP injection tests failed because team options did not exist; router tests failed because the MCP router module did not exist.
- Required AionUI reference files were not present at the referenced sibling path in this checkout; implementation followed the phase research and pattern map already extracted from those references.
- Root `pnpm build` completed with pre-existing webui/website bundle-size and `web-tree-sitter` eval/externalization warnings unrelated to CLI MCP runtime changes.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None - created/modified files were scanned for TODO/FIXME/placeholder text and hardcoded UI data patterns. Default empty tool results in `TeamToolHandlers` are callable Phase 2 registry shells whose mailbox/task persistence is explicitly delegated to later Phase 2 plans.

## Threat Flags

None - new ACP MCP routing, caller binding, readiness persistence, and lifecycle request facts are covered by this plan's threat model.

## TDD Gate Compliance

- **RED 1:** `2a457b9 test(02-02): add failing team ACP injection tests` — failed because ACP create/load ignored team declarations and `SessionManager.createTeamSession` did not exist.
- **GREEN 1:** `91f14b0 feat(02-02): add team ACP injection path` — ACP/session-manager tests passed after adding team-only injection and validation.
- **RED 2:** `25eb40a test(02-02): add failing team MCP router tests` — failed because `team-mcp-router.js` did not exist.
- **GREEN 2:** `6194d8c feat(02-02): implement team MCP router runtime` — router tests passed after adding runtime/router/handler/store/migration support.
- **REFACTOR/STYLE:** `5214295 style(02-02): format team MCP runtime changes` — Biome formatting/lint fixes only; behavior tests and build still pass.

## Verification

- `pnpm -C apps/mobvibe-cli test -- src/team/__tests__/team-mcp-router.test.ts src/acp/__tests__/session-manager.test.ts src/acp/__tests__/acp-connection.test.ts` — PASS, 82 tests / 161 assertions.
- `pnpm -C apps/mobvibe-cli build` — PASS, CLI build complete.
- `pnpm format` — PASS, Biome formatted workspace and fixed 7 CLI files.
- `pnpm lint` — PASS, Biome checked workspace and fixed 3 CLI files.
- `pnpm build` — PASS, all 6 Turbo package build tasks successful; existing webui/website warnings remain non-blocking.
- Source assertion: `team-tool-handlers.ts` contains all five expected `mobvibe_team_*` names — PASS.
- Source assertion: no `team_spawn_agent`, `team_rename`, or `team_shutdown` copied names exist under `apps/mobvibe-cli/src/team` — PASS.

## Self-Check: PASSED

- Found `apps/mobvibe-cli/src/team/team-runtime.ts`.
- Found `apps/mobvibe-cli/src/team/team-mcp-router.ts`.
- Found `apps/mobvibe-cli/src/team/team-tool-handlers.ts`.
- Found `apps/mobvibe-cli/src/team/__tests__/team-mcp-router.test.ts`.
- Found task commits `2a457b9`, `91f14b0`, `25eb40a`, `6194d8c`, and `5214295` in git log.
- Final required CLI tests, workspace format/lint, and workspace build evidence captured above.

## Next Phase Readiness

- Ready for `02-03`: `mobvibe_team_send_message` can now delegate to a mailbox service through `TeamToolHandlers` with caller identity already bound by the router.
- Ready for `02-05`: task board tools have stable registry entries and injectable handler signatures for durable task create/list/update implementation.

---
*Phase: 02-cli-team-mcp-mailbox-task-board*
*Completed: 2026-05-13*
