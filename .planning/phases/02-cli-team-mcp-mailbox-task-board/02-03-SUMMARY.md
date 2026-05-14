---
phase: 02-cli-team-mcp-mailbox-task-board
plan: 03
subsystem: cli-mailbox
tags: [typescript, bun-sqlite, mobvibe-cli, agent-team, mailbox, mcp]

requires:
  - phase: 02-cli-team-mcp-mailbox-task-board
    provides: Team MCP runtime, per-session injection, caller binding, and tools readiness from 02-02
provides:
  - Durable CLI-local mailbox delivery for `mobvibe_team_send_message`
  - MemberId/name/broadcast recipient resolution with sender-excluded fan-out
  - Metadata-only `TeamSourceRef` persistence for mailbox delivery rows
  - Router-bound sender handling that ignores agent-controlled spoofing args
  - Projection-change hook for `agent-teams:changed` metadata-only updates
affects: [phase-02-wake, phase-02-task-board, phase-03-orchestration, gateway-projection]

tech-stack:
  added: []
  patterns:
    - Durable mailbox writes go through AgentTeamStore and Bun SQLite prepared statements
    - `MailboxService` returns delivery metadata only while body text stays in `body_local_json`
    - `TeamToolHandlers` parses `mobvibe_team_send_message` args and delegates with router-bound caller context
    - Projection updates emit `added: []`, `updated: [team]`, `removed: []` without plaintext body fields

key-files:
  created:
    - apps/mobvibe-cli/src/team/mailbox-service.ts
    - apps/mobvibe-cli/src/team/__tests__/mailbox-service.test.ts
  modified:
    - apps/mobvibe-cli/src/team/agent-team-store.ts
    - apps/mobvibe-cli/src/team/team-tool-handlers.ts
    - apps/mobvibe-cli/src/team/team-runtime.ts
    - apps/mobvibe-cli/src/team/__tests__/team-mcp-router.test.ts
    - apps/mobvibe-cli/src/daemon/socket-client.ts
    - apps/mobvibe-cli/src/daemon/__tests__/socket-client.test.ts

key-decisions:
  - "Mailbox delivery success is the durable SQLite row; wake metadata starts as pending and remains separate for Plan 02-04."
  - "mobvibe_team_send_message sender identity comes only from TeamMcpRouter caller binding; fromMemberId args are ignored."
  - "Gateway-facing Agent Team projections receive mailbox counts/source refs only, never mailbox plaintext or body_local_json."

patterns-established:
  - "Mailbox service boundary: validate recipient resolution and fan-out before inserting rows; invalid recipients create no source refs."
  - "Tool-result boundary: MCP send_message result includes message ids/source refs/status metadata but not message text."
  - "Projection event boundary: changed events use AgentTeamSummary snapshots that pass the existing content-boundary guard."

requirements-completed: [COORD-01, COORD-02, COORD-04, MCP-07]

duration: 14 min
completed: 2026-05-13
---

# Phase 02 Plan 03: Durable Mailbox Send Message Summary

**Router-bound `mobvibe_team_send_message` now writes durable CLI-local mailbox rows with metadata-only source refs and plaintext-free projection updates.**

## Performance

- **Duration:** 14 min
- **Started:** 2026-05-13T13:42:12Z
- **Completed:** 2026-05-13T13:56:41Z
- **Tasks:** 2
- **Files modified:** 8 source/test files plus this summary

## Accomplishments

- Added `MailboxService` over `AgentTeamStore` for direct, name-based, and `*` broadcast addressing, with broadcast excluding the sender.
- Extended `AgentTeamStore` with parameterized mailbox insert/update operations and team timestamp touch after durable delivery.
- Persisted each successful delivery with `body_local_json`, `read_at = null`, `wake_status = "pending"`, and a metadata-only `mailbox_message` `TeamSourceRef`.
- Wired `mobvibe_team_send_message` through `TeamToolHandlers`, validating args while preserving router-bound sender identity and no team-tool confirmation gate.
- Added projection-change emission hooks and SocketClient helper coverage for `agent-teams:changed` updated snapshots without mailbox plaintext.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add durable mailbox store/service operations** - `0bb5516` (feat)
2. **Task 2: Wire `mobvibe_team_send_message` and projection change emission** - `c7c8dd0` (feat)

**Plan metadata:** committed after this summary is written.

_Note: The plan requested task-level TDD. A RED failure was observed for the new mailbox tests before fixing the test expectation, but separate `test(...)` RED commits were not produced; see TDD Gate Compliance._

## Files Created/Modified

- `apps/mobvibe-cli/src/team/mailbox-service.ts` - Durable mailbox service for recipient resolution, broadcast fan-out, structured errors, and metadata-only delivery results.
- `apps/mobvibe-cli/src/team/__tests__/mailbox-service.test.ts` - Covers direct/name/broadcast addressing, source ref persistence, invalid-recipient no-write behavior, and projection plaintext exclusion.
- `apps/mobvibe-cli/src/team/agent-team-store.ts` - Adds prepared statements and methods for mailbox insert, wake metadata update, and team timestamp touch.
- `apps/mobvibe-cli/src/team/team-tool-handlers.ts` - Parses and dispatches `mobvibe_team_send_message` through `MailboxService` with router-bound caller identity.
- `apps/mobvibe-cli/src/team/team-runtime.ts` - Passes projection-change callback wiring into tool handlers.
- `apps/mobvibe-cli/src/team/__tests__/team-mcp-router.test.ts` - Adds router dispatch coverage for spoof prevention, metadata-only results, invalid recipients, and leader/non-leader send success.
- `apps/mobvibe-cli/src/daemon/socket-client.ts` - Adds helper for emitting updated Agent Team projections.
- `apps/mobvibe-cli/src/daemon/__tests__/socket-client.test.ts` - Covers updated projection emission shape and plaintext-free payloads.

## Decisions Made

- Delivery and wake are separate: this plan initializes wake status to `pending`; Plan 02-04 owns actual wake/injection status transitions.
- The mailbox service resolves recipients from durable team members only; unknown recipients return `REQUEST_VALIDATION_FAILED` and do not write rows.
- Tool results and Gateway projections intentionally expose ids, names, statuses, and source refs only; message body remains CLI-local.

## Deviations from Plan

None - plan executed within the planned mailbox/tool/projection scope.

## Issues Encountered

- The initial mailbox source-ref test expected five rows, but direct + name + sender-excluded broadcast correctly produces four rows. The test was corrected before implementation completion.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None - created/modified files were scanned for TODO/FIXME/placeholder text and hardcoded UI data patterns. Wake execution intentionally remains pending for Plan 02-04 and is represented as durable metadata, not a stub blocking this plan.

## Threat Flags

None - the new MCP arg handling, mailbox local body storage, projection update, and logging/content boundaries are covered by the plan threat model.

## TDD Gate Compliance

- **RED evidence:** `pnpm -C apps/mobvibe-cli test -- src/team/__tests__/mailbox-service.test.ts src/team/__tests__/agent-team-store.test.ts` initially failed with 11 pass / 1 fail because the new source-ref row-count expectation was incorrect.
- **GREEN evidence:** After correcting the expectation and implementing durable service/store behavior, the mailbox/store tests passed with 12 pass / 0 fail.
- **Gate warning:** No separate `test(02-03): ...` RED commits were created before the `feat(...)` commits, so the ideal GSD TDD commit sequence was not fully preserved.

## Verification

- `pnpm -C apps/mobvibe-cli test -- src/team/__tests__/mailbox-service.test.ts src/team/__tests__/team-mcp-router.test.ts src/daemon/__tests__/socket-client.test.ts` — PASS, 27 tests / 78 assertions.
- `pnpm -C apps/mobvibe-cli build` — PASS, CLI build complete.
- `pnpm format` — PASS, all six workspace package format tasks successful; no fixes after final verification.
- `pnpm lint` — PASS, all six workspace package lint tasks successful; no fixes after final verification.
- Acceptance assertion: `agent-team-store.ts` projection mailbox SELECT still omits `body_local_json` — PASS.
- Acceptance assertion: `team-mcp-router.test.ts` proves spoofed `fromMemberId` does not change persisted `from_member_id` — PASS.
- Acceptance assertion: router and socket tests serialize projection/result payloads and assert plaintext mailbox text/body keys are absent — PASS.

## Self-Check: PASSED

- Found `apps/mobvibe-cli/src/team/mailbox-service.ts`.
- Found `apps/mobvibe-cli/src/team/__tests__/mailbox-service.test.ts`.
- Found `apps/mobvibe-cli/src/team/agent-team-store.ts`.
- Found `apps/mobvibe-cli/src/team/team-tool-handlers.ts`.
- Found `apps/mobvibe-cli/src/team/team-runtime.ts`.
- Found `apps/mobvibe-cli/src/team/__tests__/team-mcp-router.test.ts`.
- Found `apps/mobvibe-cli/src/daemon/socket-client.ts`.
- Found `apps/mobvibe-cli/src/daemon/__tests__/socket-client.test.ts`.
- Found task commits `0bb5516` and `c7c8dd0` in git log.
- Final required tests, format, lint, and CLI build evidence captured above.

## Next Phase Readiness

- Ready for `02-04`: mailbox rows now have durable pending wake metadata and message/source-ref ids for wake/injection updates.
- Ready for `02-05`: the tool handler pattern is established for durable task board service wiring with the same caller and projection boundaries.

---
*Phase: 02-cli-team-mcp-mailbox-task-board*
*Completed: 2026-05-13*
