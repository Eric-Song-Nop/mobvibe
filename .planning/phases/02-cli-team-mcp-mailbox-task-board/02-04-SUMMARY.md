---
phase: 02-cli-team-mcp-mailbox-task-board
plan: 04
subsystem: cli-mailbox-wake
tags: [typescript, bun-sqlite, mobvibe-cli, agent-team, mailbox, acp, wal]

requires:
  - phase: 02-cli-team-mcp-mailbox-task-board
    provides: Durable mailbox send_message rows and pending wake metadata from 02-03
provides:
  - Atomic unread mailbox read-and-mark with CLI-local body return for wake injection
  - Wake success/failure metadata updates that preserve delivery source refs
  - Ordinary ACP session mailbox prompt injection with session_event audit refs
  - Idle notification delivery to leader with non-leader settled guard
affects: [phase-02-task-board, phase-03-orchestration, gateway-projection, ordinary-session-wal]

tech-stack:
  added: []
  patterns:
    - Bun SQLite transaction for unread mailbox read-and-mark
    - Wake metadata is updated independently from durable delivery rows
    - Plaintext mailbox content is injected only through ordinary ACP prompt/WAL path
    - Leader idle wake is guarded by non-leader lifecycle settlement

key-files:
  created: []
  modified:
    - apps/mobvibe-cli/src/team/agent-team-store.ts
    - apps/mobvibe-cli/src/team/team-runtime.ts
    - apps/mobvibe-cli/src/acp/session-manager.ts
    - apps/mobvibe-cli/src/wal/migrations.ts
    - apps/mobvibe-cli/src/team/__tests__/mailbox-service.test.ts
    - apps/mobvibe-cli/src/acp/__tests__/session-manager.test.ts

key-decisions:
  - "Wake success and failure are durable metadata updates on accepted mailbox rows, not part of delivery acceptance."
  - "Mailbox plaintext enters recipient visibility only via ordinary ACP session prompt/WAL semantics, never via Agent Team projection."
  - "Member completion sends idle_notification to the leader, but leader wake waits until all non-leader members are not running."

patterns-established:
  - "Mailbox wake seam: TeamRuntime reads unread rows atomically, formats a Mobvibe Agent Team mailbox prompt, injects through SessionManager, then appends session_event source refs."
  - "Wake failure seam: prompt failures set wake_status=failed with safe code/message metadata and do not add deliveredSessionId."
  - "Idle guard: onMemberTurnCompleted marks the member completed, writes an idle_notification row, and wakes the leader only after non-leader settlement."

requirements-completed: [COORD-02, COORD-04]

duration: 12 min
completed: 2026-05-13
---

# Phase 02 Plan 04: Mailbox Wake/Injection Semantics Summary

**Mailbox wake now atomically consumes unread rows, injects teammate messages through ordinary ACP session history, and records wake/session audit refs without leaking plaintext into Agent Team projections.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-05-13T14:19:38Z
- **Completed:** 2026-05-13T14:31:42Z
- **Tasks:** 2
- **Files modified:** 6 source/test files plus this summary

## Accomplishments

- Added atomic unread mailbox read-and-mark in `AgentTeamStore`, returning CLI-local body content only to the wake runtime.
- Added wake metadata updates that set `sent` or `failed`, store safe error metadata, preserve the original `mailbox_message` ref, and append `session_event` audit refs on success.
- Added `SessionManager.injectTeamMailboxPrompt()` to call the ordinary ACP `connection.prompt(sessionId, prompt)` seam and persist a WAL `user_message` audit event.
- Added `TeamRuntime.wakeMember()` to read unread mailbox messages, inject a Mobvibe Agent Team mailbox prompt into the recipient ordinary session, and update wake status per message.
- Added `TeamRuntime.onMemberTurnCompleted()` idle notification behavior with a non-leader settlement guard before waking the leader.

## Task Commits

Each task was committed atomically with TDD RED/GREEN evidence:

1. **Task 1 RED: mailbox wake metadata tests** - `599abb4` (test)
2. **Task 1 GREEN: mailbox read/mark and wake metadata operations** - `142b17d` (feat)
3. **Task 2 RED: wake injection and idle guard tests** - `c7fd728` (test)
4. **Task 2 GREEN: ordinary session injection runtime and idle guard** - `4a619ff` (feat)
5. **Task 2 style: verification formatting** - `f827e6a` (style)

**Plan metadata:** committed after this summary is written.

## Files Created/Modified

- `apps/mobvibe-cli/src/team/agent-team-store.ts` - Adds transactional unread read-and-mark, wake metadata/source-ref updates, and member runtime-state update helper.
- `apps/mobvibe-cli/src/team/team-runtime.ts` - Orchestrates wake injection, best-effort wake status updates, durable send-and-wake behavior, and idle notification guard.
- `apps/mobvibe-cli/src/acp/session-manager.ts` - Adds ordinary session mailbox prompt injection seam with WAL `session_event` source-ref return.
- `apps/mobvibe-cli/src/wal/migrations.ts` - Adds wake error metadata storage and unread mailbox query index.
- `apps/mobvibe-cli/src/team/__tests__/mailbox-service.test.ts` - Covers atomic read/mark, wake metadata preservation, wake success/failure, projection boundaries, and idle guard.
- `apps/mobvibe-cli/src/acp/__tests__/session-manager.test.ts` - Covers ordinary session prompt/WAL injection and returned `session_event` audit ref.

## Decisions Made

- Wake metadata is separate from delivery: accepted mailbox rows remain persisted even when ordinary session prompt injection fails.
- The injected mailbox prompt intentionally includes teammate message body for the recipient ordinary session only; tests assert Agent Team projection JSON does not contain that plaintext.
- `deliveredSessionId` is written only on wake success; failure paths preserve the original delivery ref without fabricating a delivered session ref.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- `pnpm build` initially failed after formatting because the test accessed `TeamSourceRef.seq` before narrowing to `type: "session_event"`; the test was narrowed and committed in `f827e6a`.
- Workspace build still reports pre-existing webui/website Vite/Rolldown warnings for large chunks and `web-tree-sitter` direct `eval`/browser externalization. Build completed successfully; warnings are unrelated to CLI mailbox wake changes.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None - modified files were scanned for TODO/FIXME/placeholder text and hardcoded UI empty-data patterns. The `placeholders` variable in SQL generation is runtime placeholder construction, not a stub.

## Threat Flags

None - this plan implements the declared threat mitigations: plaintext stays in ordinary session prompt/WAL path, wake failures do not roll back durable delivery, and leader wake is guarded to prevent message storms.

## TDD Gate Compliance

- **RED 1:** `599abb4 test(02-04): add failing mailbox wake metadata tests` — failed because `readUnreadAndMark` and `updateWakeMetadata` were not implemented.
- **GREEN 1:** `142b17d feat(02-04): implement mailbox wake metadata operations` — mailbox tests passed after atomic read/mark and wake source-ref updates.
- **RED 2:** `c7fd728 test(02-04): add failing mailbox wake injection tests` — failed because `SessionManager.injectTeamMailboxPrompt`, `TeamRuntime.wakeMember`, and `onMemberTurnCompleted` were not implemented.
- **GREEN 2:** `4a619ff feat(02-04): implement mailbox wake injection runtime` — wake injection and idle guard tests passed.
- **STYLE:** `f827e6a style(02-04): format wake injection changes` — Biome formatting and test type narrowing; final tests/build remained green.

## Verification

- `pnpm -C apps/mobvibe-cli test -- src/team/__tests__/mailbox-service.test.ts src/acp/__tests__/session-manager.test.ts` — PASS, 68 tests / 180 assertions.
- `pnpm format` — PASS, all six workspace package format tasks successful; no fixes on final run.
- `pnpm lint` — PASS, all six workspace package lint tasks successful; no fixes on final run.
- `pnpm -C apps/mobvibe-cli build` — PASS, CLI build complete.
- `pnpm build` — PASS, all six workspace packages built; pre-existing Vite/Rolldown warnings noted above.
- Stub scan: `TODO|FIXME|placeholder|coming soon|not available` over CLI source — PASS for modified files; only SQL placeholder variable and unrelated pre-existing strings matched.
- Threat scan: modified files keep mailbox body in CLI-local `body_local_json` / ordinary session prompt path and projection assertions verify plaintext absence — PASS.

## Self-Check: PASSED

- Found `apps/mobvibe-cli/src/team/mailbox-service.ts`.
- Found `apps/mobvibe-cli/src/team/team-runtime.ts`.
- Found `apps/mobvibe-cli/src/acp/session-manager.ts`.
- Found `apps/mobvibe-cli/src/team/agent-team-store.ts`.
- Found `apps/mobvibe-cli/src/wal/migrations.ts`.
- Found `apps/mobvibe-cli/src/team/__tests__/mailbox-service.test.ts`.
- Found `apps/mobvibe-cli/src/acp/__tests__/session-manager.test.ts`.
- Found task commits `599abb4`, `142b17d`, `c7fd728`, `4a619ff`, and `f827e6a` in git log.
- Final required CLI tests, workspace format/lint, CLI build, and workspace build evidence captured above.

## Next Phase Readiness

- Ready for `02-05`: task board tools can reuse the same durable-store/projection-safe update pattern.
- Ready for Phase 3 orchestration: member ordinary sessions can receive auditable team mailbox wake prompts through the existing ACP session path.

---
*Phase: 02-cli-team-mcp-mailbox-task-board*
*Completed: 2026-05-13*
