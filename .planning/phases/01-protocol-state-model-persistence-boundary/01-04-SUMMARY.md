---
phase: 01-protocol-state-model-persistence-boundary
plan: 04
subsystem: cli-persistence
tags: [typescript, bun-sqlite, mobvibe-cli, agent-team, projection-boundary]
requires:
  - phase: 01-protocol-state-model-persistence-boundary
    provides: CLI durable Agent Team store and base non-content projection from 01-02
provides:
  - Durable mailbox metadata projection with unread/wake counts and source refs
  - Durable task metadata projection with status/dependency counts and source refs
  - MCP readiness and summary refs recovery independent from lifecycle state
  - Runtime lifecycle validation that rejects idle/ready persisted values
affects: [mobvibe-cli, gateway, webui, phase-01]
tech-stack:
  added: []
  patterns:
    - Metadata-only projection from CLI-local SQLite rows into Gateway-safe AgentTeamSummary
    - Persisted JSON parsed as unknown and narrowed before projection
    - Lifecycle validation keeps MCP readiness, activity, and lifecycle as separate dimensions
key-files:
  created:
    - apps/mobvibe-cli/src/team/__tests__/projection-builder.test.ts
  modified:
    - apps/mobvibe-cli/src/team/agent-team-store.ts
    - apps/mobvibe-cli/src/team/projection-builder.ts
    - apps/mobvibe-cli/src/team/__tests__/agent-team-store.test.ts
key-decisions:
  - "Mailbox/task/summary source refs are projected as typed metadata only; body_local_json remains CLI-local."
  - "Task blocked count includes explicit blocked status and non-empty blocked_by_json dependency metadata."
  - "Persisted lifecycle strings are validated at projection time so idle/ready cannot cross into Gateway-facing summaries."
patterns-established:
  - "Projection hardening: JSON columns use unknown-to-typed narrowing with safe empty fallback for malformed local metadata."
  - "TDD coverage: projection-builder tests exercise mailbox/task/MCP/summary metadata without depending on Gateway routes."
requirements-completed: [TEAM-03, TEAM-05, LIFE-01]
duration: 5 min
completed: 2026-05-13
---

# Phase 01 Plan 04: CLI Mailbox/Task/MCP Projection Hardening Summary

**CLI SQLite coordination metadata now rebuilds mailbox/task counts, source refs, MCP readiness, and summary refs without exposing local plaintext content.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-05-13T04:20:32Z
- **Completed:** 2026-05-13T04:25:51Z
- **Tasks:** 3
- **Files modified:** 4 source/test files plus this summary

## Accomplishments

- Added focused projection-builder tests for mailbox metadata counts/source refs and verified local `body_local_json` values never appear in Gateway-facing projection JSON.
- Hardened task projection so status counts cover todo/in_progress/blocked/completed/failed/cancelled, with dependency metadata contributing to blocked counts.
- Aggregated mailbox and task `TeamSourceRef` metadata onto team/member summaries after parsing persisted JSON through unknown-to-typed guards.
- Added MCP readiness and summary-ref recovery coverage after SQLite reopen, proving MCP phase stays independent from team/member lifecycle.
- Added runtime lifecycle validation so persisted `idle` and `ready` values are rejected rather than projected as lifecycle state.

## Task Commits

Each task was committed atomically using TDD RED/GREEN flow:

1. **Task 1 RED: mailbox projection invariants** - `fe70a63` (test)
2. **Task 1 GREEN: safe mailbox metadata projection** - `1874116` (feat)
3. **Task 2 RED: task projection invariants** - `fff9733` (test)
4. **Task 2 GREEN: task metadata/source-ref projection** - `48ea2cd` (feat)
5. **Task 3 RED: MCP recovery and lifecycle validation tests** - `73e8f18` (test)
6. **Task 3 GREEN: lifecycle validation and independent MCP recovery** - `c8ea429` (feat)
7. **Formatting:** `bb16a0b` (style)

**Plan metadata:** committed after this summary is written.

## Files Created/Modified

- `apps/mobvibe-cli/src/team/__tests__/projection-builder.test.ts` - New TDD coverage for mailbox/task/MCP projection invariants and non-content leakage checks.
- `apps/mobvibe-cli/src/team/__tests__/agent-team-store.test.ts` - Adds SQLite reopen coverage for MCP phase and summary source refs without summary text.
- `apps/mobvibe-cli/src/team/projection-builder.ts` - Aggregates typed source refs, parses JSON safely, counts dependency-blocked tasks, and validates lifecycle values.
- `apps/mobvibe-cli/src/team/agent-team-store.ts` - Selects task dependency JSON columns needed by projection hardening.

## Decisions Made

- Kept mailbox/task body fields out of row types used by `buildAgentTeamSummary`; tests can seed local content but projection only sees/counts metadata.
- Treated malformed persisted JSON as empty metadata for source refs and dependency arrays, matching the local-row hardening requirement without breaking recovery.
- Preserved existing shared count shape (`unread`, `wakeFailed`, `todo`, `inProgress`, etc.) rather than renaming public fields mid-phase.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- RED tests intentionally failed before each GREEN implementation, as required by the task-level TDD flow.
- `pnpm build` completed with pre-existing Vite/Rolldown warnings for website/webui bundle size and `web-tree-sitter` eval/externalization; these are unrelated to CLI projection changes.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None - created/modified files were scanned for TODO/FIXME/placeholder text and hardcoded empty UI data patterns. Empty arrays in projection parsing are safe fallbacks for malformed local metadata, not UI stubs.

## Threat Flags

None - this plan hardened the trust boundaries already listed in the threat model: CLI-local body rows → projection counts/source refs, persisted JSON → narrowed TypeScript objects, and summary refs without summary body.

## TDD Gate Compliance

- **RED 1:** `fe70a63 test(01-04): add failing mailbox projection test` — failed because mailbox source refs were not projected.
- **GREEN 1:** `1874116 feat(01-04): project mailbox metadata safely` — mailbox projection tests passed after source-ref aggregation and JSON narrowing.
- **RED 2:** `fff9733 test(01-04): add failing task projection test` — failed because dependency-blocked tasks were not counted.
- **GREEN 2:** `48ea2cd feat(01-04): project task metadata safely` — task projection tests passed after dependency metadata parsing and task source-ref aggregation.
- **RED 3:** `73e8f18 test(01-04): add failing MCP recovery tests` — failed because `ready`/`idle` lifecycle values were not rejected.
- **GREEN 3:** `c8ea429 feat(01-04): recover MCP metadata independently` — MCP/summary recovery tests passed after lifecycle validation.
- **REFACTOR/STYLE:** `bb16a0b style(01-04): format projection builder` — Biome formatting only; required tests still pass.

## Verification

- `pnpm -C apps/mobvibe-cli test -- src/team/__tests__/projection-builder.test.ts src/team/__tests__/agent-team-store.test.ts` — PASS, 10 tests / 71 assertions.
- `pnpm format` — PASS, Biome formatted workspace and fixed `projection-builder.ts`.
- `pnpm lint` — PASS, all workspace packages checked with no fixes after formatting.
- `pnpm build` — PASS, all workspace packages built. Existing website/webui bundle-size and `web-tree-sitter` warnings remain non-blocking pre-existing dependency/build warnings.
- Source assertion: `projection-builder.ts` has no `any` and parses persisted JSON as `unknown` — PASS.
- Source assertion: `projection-builder.ts` does not reference `body_local_json` — PASS.
- Behavior assertion: mailbox/task/MCP/summary metadata tests pass after reopening the SQLite database — PASS.

## Self-Check: PASSED

- Found `apps/mobvibe-cli/src/team/__tests__/projection-builder.test.ts`.
- Found `apps/mobvibe-cli/src/team/__tests__/agent-team-store.test.ts`.
- Found `apps/mobvibe-cli/src/team/projection-builder.ts`.
- Found `apps/mobvibe-cli/src/team/agent-team-store.ts`.
- Found task commits `fe70a63`, `1874116`, `fff9733`, `48ea2cd`, `73e8f18`, `c8ea429`, and `bb16a0b` in git log.
- Final required CLI tests, workspace format/lint, and workspace build evidence captured above.

## Next Phase Readiness

Ready for `01-05-PLAN.md`: WebUI API/store/socket projection boundary can consume hardened CLI/Gateway `AgentTeamSummary` snapshots knowing mailbox/task/summary plaintext remains outside Gateway-facing payloads.

---
*Phase: 01-protocol-state-model-persistence-boundary*
*Completed: 2026-05-13*
