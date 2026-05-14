---
phase: 02-cli-team-mcp-mailbox-task-board
plan: 05
subsystem: cli-coordination
tags: [mobvibe-cli, mcp, task-board, sqlite, bun]

requires:
  - phase: 02-03
    provides: durable mailbox tool path and projection event pattern
provides:
  - Durable `TaskBoardService` for create/list/update task operations
  - SQLite transaction-backed bidirectional task dependency mutation
  - MCP handlers for `mobvibe_team_task_create/list/update`
  - Gateway-safe task projection counts/source refs without task body content
affects: [phase-03-team-run, phase-04-lifecycle-recovery, cli-team-runtime]

tech-stack:
  added: []
  patterns:
    - AgentTeamStore owns SQLite task graph mutations behind service APIs
    - MCP task tools return CLI-local DTOs while AgentTeamSummary remains metadata-only

key-files:
  created:
    - apps/mobvibe-cli/src/team/task-board-service.ts
    - apps/mobvibe-cli/src/team/__tests__/task-board-service.test.ts
  modified:
    - apps/mobvibe-cli/src/team/agent-team-store.ts
    - apps/mobvibe-cli/src/team/team-tool-handlers.ts
    - apps/mobvibe-cli/src/team/__tests__/team-mcp-router.test.ts

key-decisions:
  - "Task board body fields stay only in `body_local_json`; MCP list returns local body DTOs, but Gateway projection never selects or serializes them."
  - "Task dependency mutation is centralized in AgentTeamStore transactions so `blockedBy` and `blocks` stay bidirectional."
  - "Task tools remain callable by bound leader and non-leader members without Mobvibe team-tool confirmation gates."

patterns-established:
  - "Service wrapper pattern: TeamToolHandlers delegates durable task work to TaskBoardService."
  - "Projection event pattern: successful task create/update emits `onAgentTeamChanged` with rebuilt safe AgentTeamSummary."

requirements-completed: [COORD-03, COORD-04, MCP-07]

duration: 11 min
completed: 2026-05-13
---

# Phase 02 Plan 05: Durable Task Board MCP Tool Path Summary

**Durable SQLite task board with Mobvibe status vocabulary, bidirectional dependency mutation, and metadata-only Gateway projection.**

## Performance

- **Duration:** 11 min
- **Started:** 2026-05-13T14:37:52Z
- **Completed:** 2026-05-13T14:48:45Z
- **Tasks:** 2/2 completed
- **Files modified:** 5

## Accomplishments

- Added `TaskBoardService` and AgentTeamStore task graph methods for durable create/list/update operations.
- Implemented dependency semantics: create with `blockedBy` marks task `blocked`, appends upstream `blocks`, and completing an upstream task auto-unblocks downstream tasks.
- Wired `mobvibe_team_task_create`, `mobvibe_team_task_list`, and `mobvibe_team_task_update` through MCP router handlers.
- Preserved content boundary: MCP task list can return local title/description to the caller, while `AgentTeamSummary` exposes only counts/source refs.

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: Task board service behavior tests** — `f477600` (test)
2. **Task 1 GREEN: Durable task board service** — `9aae568` (feat)
3. **Task 2 RED: MCP task tool router tests** — `cc3d242` (test)
4. **Task 2 GREEN: MCP task tool handlers** — `87fab0f` (feat)

**Plan metadata:** committed after state/roadmap updates.

## Files Created/Modified

- `apps/mobvibe-cli/src/team/task-board-service.ts` — Service-level validation, owner resolution, local task DTOs, and structured task tool results.
- `apps/mobvibe-cli/src/team/agent-team-store.ts` — Transactional SQLite task insert/update, dependency edge reconciliation, and auto-unblock mutation.
- `apps/mobvibe-cli/src/team/team-tool-handlers.ts` — Real task tool dispatch and projection-changed emission after successful durable mutations.
- `apps/mobvibe-cli/src/team/__tests__/task-board-service.test.ts` — Durable task graph, status vocabulary, owner resolution, and projection boundary tests.
- `apps/mobvibe-cli/src/team/__tests__/team-mcp-router.test.ts` — MCP task tool validation, list/update DTO, no confirmation gate, and safe projection event tests.

## Decisions Made

- Task body data (`title`, `description`) is intentionally stored in `body_local_json` and returned only through CLI-local MCP tool DTOs.
- Dependency updates are implemented in AgentTeamStore transactions rather than in separate service-side read/write steps.
- Task tools do not call `requestPermission` and do not distinguish leader/non-leader for authorization beyond router-bound member identity.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## Known Stubs

None. Stub scan produced only intentional empty-array/object initialization and null-check false positives; no placeholder task-board behavior remains.

## Threat Flags

None. The planned MCP task args → SQLite graph and CLI-local body → Gateway projection trust boundaries were implemented with validation and projection tests.

## Verification

- `pnpm -C apps/mobvibe-cli test -- src/team/__tests__/task-board-service.test.ts src/team/__tests__/team-mcp-router.test.ts src/team/__tests__/projection-builder.test.ts` — PASS (21 tests, 78 assertions)
- `pnpm -C apps/mobvibe-cli build` — PASS
- `pnpm format && pnpm lint` — PASS
- `pnpm build` — PASS (existing Vite/web-tree-sitter warnings only)

## Self-Check: PASSED

- Created files exist: `task-board-service.ts`, `task-board-service.test.ts`.
- Task commits exist: `f477600`, `9aae568`, `cc3d242`, `87fab0f`.
- Projection boundary verified by task service, MCP router, and projection builder tests.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Phase 2 CLI task board runtime is complete and ready for Phase 3 team-run orchestration to consume durable task facts through the MCP tool path.

---
*Phase: 02-cli-team-mcp-mailbox-task-board*
*Completed: 2026-05-13*
