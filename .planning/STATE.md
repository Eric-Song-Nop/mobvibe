---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
stopped_at: Completed 01-02-PLAN.md
last_updated: "2026-05-13T04:03:00.227Z"
last_activity: 2026-05-13
progress:
  total_phases: 5
  completed_phases: 0
  total_plans: 5
  completed_plans: 2
  percent: 40
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-12)

**Core value:** 用户可以在一个 Mobvibe 团队任务中安全地协调多个不同 ACP agent，让它们围绕同一代码目标协作，并清楚看到每个 agent 的进展、任务、消息、产出和最终汇总。
**Current focus:** Phase 01 — protocol-state-model-persistence-boundary

## Current Position

Phase: 01 (protocol-state-model-persistence-boundary) — EXECUTING
Plan: 3 of 5
Status: Ready to execute
Last activity: 2026-05-13

Progress: [████░░░░░░] 40%

## Performance Metrics

**Velocity:**

- Total plans completed: 1
- Average duration: 7 min
- Total execution time: 0.1 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1. 协议、状态模型与持久化边界 | 1 | 7 min | 7 min |
| 2. CLI Team MCP、Mailbox 与 Task Board | 0 | TBD | N/A |
| 3. 最小端到端 Team Run | 0 | TBD | N/A |
| 4. 生命周期、权限、E2EE 与恢复 | 0 | TBD | N/A |
| 5. UI 规模化与 v1 Polish | 0 | TBD | N/A |

**Recent Trend:**

- Last 5 plans: 01-01 (7 min)
- Trend: N/A

| Phase 01 P02 | 8 min | 2 tasks | 5 files |

## Accumulated Context

### Decisions

决策记录在 PROJECT.md 的 Key Decisions 表和当前 phase context 文档中。
Recent decisions affecting current work:

- [Roadmap]: v1 按 research 推荐使用 5 个 coarse MVP phase。
- [Roadmap]: Team member 继续展开为普通 ACP session；team coordination 由 CLI-hosted team MCP server、durable mailbox 和 task board 提供。
- [Roadmap]: ACP MCP-over-ACP RFD 是首选隔离机制；team tools 只注入 team session，普通 session 不受影响。
- [Roadmap]: Phase 1 优先锁定 shared 类型、状态模型、CLI durable owner、MCP readiness、mailbox/task 和内容边界。
- [Phase 1]: 产品语言锁定为 Agent Team；每个 leader/member 都是一等 ordinary ACP session。
- [Phase 1]: WebUI 按 AionUI 方向展示：Agent Team 是独立一级对象，team-owned member sessions 默认从普通 session 列表隐藏或折叠。
- [Phase 1]: Gateway 采用混合方案：对 WebUI暴露 `/acp/agent-teams`，内部只转发 typed CLI RPC，不持久化 Agent Team truth。
- [Phase 1]: Gateway-facing team projection 不携带 mailbox/task/summary 正文；CLI-local store 可以保存协作正文。
- [Phase 1]: lifecycle 不使用 `idle`/`ready`；MCP readiness、permission waiting、activity counts 和 health 独立表达。
- [Phase 1]: source refs 是强类型定位引用，不承载正文；优先跳转到 member ordinary session history。
- [Phase 1]: CLI SQLite 当前事实表是 team durable truth；Gateway 只做 presence 与 snapshot 转发。
- [Phase 01-01]: Shared Agent Team contract now defines projection, source refs, MCP capability discovery, typed create/list/get RPC payloads, and `agent-teams:changed` events.
- [Phase 01]: ---

phase: 01-protocol-state-model-persistence-boundary
plan: 02
subsystem: cli-persistence
tags: [typescript, bun-sqlite, mobvibe-cli, agent-team, projection-boundary]
requires:

  - phase: 01-protocol-state-model-persistence-boundary
    provides: Shared Agent Team projection/RPC/source-ref contract from 01-01
provides:

  - CLI-local Agent Team current-state SQLite tables in the existing WAL database
  - AgentTeamStore create/list/get durable metadata operations
  - Gateway-facing Agent Team projection builder with counts, MCP status, source refs, and summary refs
  - Recursive CLI content-boundary assertion for forbidden Gateway-facing content and secret keys

affects: [mobvibe-cli, gateway, webui, phase-01]
tech-stack:
  added: []
  patterns:

    - Existing Bun SQLite WAL migration path extended with Agent Team current-state tables
    - CLI-local rows are projected into shared AgentTeamSummary before crossing Gateway boundary
    - Recursive forbidden-key assertion guards Gateway-facing Agent Team payloads

key-files:
  created:

    - apps/mobvibe-cli/src/team/agent-team-store.ts
    - apps/mobvibe-cli/src/team/projection-builder.ts
    - apps/mobvibe-cli/src/team/content-boundary.ts
    - apps/mobvibe-cli/src/team/__tests__/agent-team-store.test.ts
  modified:

    - apps/mobvibe-cli/src/wal/migrations.ts

key-decisions:

  - "Agent Team durable truth reuses the existing CLI WAL SQLite database and schema_version migration path."
  - "Phase 1 creates only leader metadata and MCP readiness defaults; it does not create an ordinary ACP session."
  - "Gateway-facing Agent Team results are rebuilt projections and are asserted against forbidden plaintext/secret keys before return."

patterns-established:

  - "Current-state store: AgentTeamStore writes normalized agent_team_* facts and reads them back through shared RPC result shapes."
  - "Projection boundary: projection-builder omits body_local_json and computes counts/source refs from metadata rows."
  - "Content guard: assertGatewayFacingAgentTeamPayload recursively rejects prompt/content/body/description/summaryText/agentOutput/providerToken/masterSecret/dek/secret keys."

requirements-completed: [TEAM-01, TEAM-02, TEAM-03, TEAM-05, LIFE-01]
duration: 8 min
completed: 2026-05-13
---

# Phase 01 Plan 02: CLI Durable Agent Team Store Summary

**CLI-local Agent Team SQLite current-state store with restart recovery and Gateway-safe non-content projection.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-05-13T03:54:32Z
- **Completed:** 2026-05-13T04:02:04Z
- **Tasks:** 2
- **Files modified:** 5 source/test files plus this summary

## Accomplishments

- Added `agent_teams`, `agent_team_members`, `agent_team_mcp_status`, `agent_team_mailbox_messages`, `agent_team_tasks`, and `agent_team_summary_refs` to the existing CLI WAL migration path.
- Implemented `AgentTeamStore.createAgentTeam`, `listAgentTeams`, and `getAgentTeam` using Bun SQLite, prepared `$param` binds, `randomUUID()` IDs, and shared RPC result types.
- Added projection building for team/member MCP status, mailbox/task counts, timestamps, summary refs, safe errors, and source refs while omitting `body_local_json` and plaintext fields.
- Added recursive `assertGatewayFacingAgentTeamPayload` with the exact forbidden content/secret keys required by the plan.

## Task Commits

Each task was committed atomically using TDD RED/GREEN flow:

1. **Task 1 RED: durable store/restart/migration tests** - `4769343` (test)
2. **Task 1 GREEN: CLI SQLite Agent Team store** - `f64de51` (feat)
3. **Task 2 RED: projection/content-boundary tests** - `753f67d` (test)
4. **Task 2 GREEN: projection builder and boundary assertion** - `9113685` (feat)

**Plan metadata:** committed after this summary is written.

## Files Created/Modified

- `apps/mobvibe-cli/src/wal/migrations.ts` - Adds migration version 7 with six Agent Team current-state tables and indexes in the existing WAL database.
- `apps/mobvibe-cli/src/team/agent-team-store.ts` - Creates, lists, gets, and closes CLI-local durable Agent Team metadata through shared result shapes.
- `apps/mobvibe-cli/src/team/projection-builder.ts` - Rebuilds `AgentTeamSummary` from durable rows with counts, MCP status, errors, source refs, and summary refs.
- `apps/mobvibe-cli/src/team/content-boundary.ts` - Exports forbidden key constants and recursive Gateway-facing payload assertion.
- `apps/mobvibe-cli/src/team/__tests__/agent-team-store.test.ts` - Covers creation rows, restart recovery, migrations, projection redaction, source refs, and recursive forbidden-key checks.

## Decisions Made

- Reused the existing CLI WAL SQLite database and `runMigrations(db)` path rather than creating a second DB or migration runner.
- Created only metadata for the Phase 1 leader: `sessionId` remains unset, lifecycle is `pending`, health is `healthy`, and MCP phase is `not_started`.
- Kept `body_local_json` exclusively in SQLite rows; projections compute counts/source refs without returning local mailbox/task body data.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None - created/modified files were scanned for TODO/FIXME/placeholder text and hardcoded empty UI data patterns. The `params: ListAgentTeamsRpcParams = {}` default in `AgentTeamStore` is an API default, not a UI/rendering stub.

## Threat Flags

None - the new SQLite schema and projection boundary are covered by the plan threat model. No Gateway table, network endpoint, auth path, or secret-bearing surface was introduced.

## TDD Gate Compliance

- **RED 1:** `4769343 test(01-02): add failing agent team store tests` — failed because `agent-team-store.js` did not exist.
- **GREEN 1:** `f64de51 feat(01-02): add durable agent team store` — store tests passed after migration/store implementation.
- **RED 2:** `753f67d test(01-02): add failing projection boundary tests` — failed because `content-boundary.js` did not exist.
- **GREEN 2:** `9113685 feat(01-02): add agent team projection boundary` — projection and boundary tests passed.
- **REFACTOR:** No separate refactor commit was needed after Biome formatting/linting.

## Verification

- `pnpm -C apps/mobvibe-cli test -- src/team/__tests__/agent-team-store.test.ts` — PASS, 5 tests / 40 assertions.
- `pnpm format` — PASS, all workspace packages formatted; no fixes after final verification.
- `pnpm lint` — PASS, all workspace packages checked; no fixes after final verification.
- `pnpm build` — PASS, all workspace packages built. Existing webui/website bundle-size and `web-tree-sitter` eval warnings remain non-blocking pre-existing dependency/build warnings.
- Source assertion: `migrations.ts` contains all six `agent_team*` tables — PASS.
- Source assertion: no `apps/gateway/src/db` Agent Team table files were added — PASS.
- Source assertion: `AgentTeamStore.createAgentTeam` uses `randomUUID()` for `agentTeamId` and `leaderMemberId` and does not call ordinary session creation — PASS.
- Source assertion: `content-boundary.ts` exports all exact forbidden keys and `assertGatewayFacingAgentTeamPayload` — PASS.
- Source assertion: `projection-builder.ts` imports shared `AgentTeamSummary` and returns Gateway-facing projection data only — PASS.

## Self-Check: PASSED

- Found `apps/mobvibe-cli/src/team/agent-team-store.ts`.
- Found `apps/mobvibe-cli/src/team/projection-builder.ts`.
- Found `apps/mobvibe-cli/src/team/content-boundary.ts`.
- Found `apps/mobvibe-cli/src/team/__tests__/agent-team-store.test.ts`.
- Found task commits `4769343`, `f64de51`, `753f67d`, and `9113685` in git log.
- Final required CLI test, workspace format/lint, and workspace build evidence captured above.

## Next Phase Readiness

Ready for `01-03-PLAN.md`: Gateway `/acp/agent-teams` routes and typed CLI RPC can now call `AgentTeamStore` and receive non-content `AgentTeamSummary` projections.

---
*Phase: 01-protocol-state-model-persistence-boundary*
*Completed: 2026-05-13* — ---
phase: 01-protocol-state-model-persistence-boundary
plan: 02
subsystem: cli-persistence
tags: [typescript, bun-sqlite, mobvibe-cli, agent-team, projection-boundary]
requires:

  - phase: 01-protocol-state-model-persistence-boundary
    provides: Shared Agent Team projection/RPC/source-ref contract from 01-01
provides:

  - CLI-local Agent Team current-state SQLite tables in the existing WAL database
  - AgentTeamStore create/list/get durable metadata operations
  - Gateway-facing Agent Team projection builder with counts, MCP status, source refs, and summary refs
  - Recursive CLI content-boundary assertion for forbidden Gateway-facing content and secret keys

affects: [mobvibe-cli, gateway, webui, phase-01]
tech-stack:
  added: []
  patterns:

    - Existing Bun SQLite WAL migration path extended with Agent Team current-state tables
    - CLI-local rows are projected into shared AgentTeamSummary before crossing Gateway boundary
    - Recursive forbidden-key assertion guards Gateway-facing Agent Team payloads

key-files:
  created:

    - apps/mobvibe-cli/src/team/agent-team-store.ts
    - apps/mobvibe-cli/src/team/projection-builder.ts
    - apps/mobvibe-cli/src/team/content-boundary.ts
    - apps/mobvibe-cli/src/team/__tests__/agent-team-store.test.ts
  modified:

    - apps/mobvibe-cli/src/wal/migrations.ts

key-decisions:

  - "Agent Team durable truth reuses the existing CLI WAL SQLite database and schema_version migration path."
  - "Phase 1 creates only leader metadata and MCP readiness defaults; it does not create an ordinary ACP session."
  - "Gateway-facing Agent Team results are rebuilt projections and are asserted against forbidden plaintext/secret keys before return."

patterns-established:

  - "Current-state store: AgentTeamStore writes normalized agent_team_* facts and reads them back through shared RPC result shapes."
  - "Projection boundary: projection-builder omits body_local_json and computes counts/source refs from metadata rows."
  - "Content guard: assertGatewayFacingAgentTeamPayload recursively rejects prompt/content/body/description/summaryText/agentOutput/providerToken/masterSecret/dek/secret keys."

requirements-completed: [TEAM-01, TEAM-02, TEAM-03, TEAM-05, LIFE-01]
duration: 8 min
completed: 2026-05-13
---

# Phase 01 Plan 02: CLI Durable Agent Team Store Summary

**CLI-local Agent Team SQLite current-state store with restart recovery and Gateway-safe non-content projection.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-05-13T03:54:32Z
- **Completed:** 2026-05-13T04:02:04Z
- **Tasks:** 2
- **Files modified:** 5 source/test files plus this summary

## Accomplishments

- Added `agent_teams`, `agent_team_members`, `agent_team_mcp_status`, `agent_team_mailbox_messages`, `agent_team_tasks`, and `agent_team_summary_refs` to the existing CLI WAL migration path.
- Implemented `AgentTeamStore.createAgentTeam`, `listAgentTeams`, and `getAgentTeam` using Bun SQLite, prepared `$param` binds, `randomUUID()` IDs, and shared RPC result types.
- Added projection building for team/member MCP status, mailbox/task counts, timestamps, summary refs, safe errors, and source refs while omitting `body_local_json` and plaintext fields.
- Added recursive `assertGatewayFacingAgentTeamPayload` with the exact forbidden content/secret keys required by the plan.

## Task Commits

Each task was committed atomically using TDD RED/GREEN flow:

1. **Task 1 RED: durable store/restart/migration tests** - `4769343` (test)
2. **Task 1 GREEN: CLI SQLite Agent Team store** - `f64de51` (feat)
3. **Task 2 RED: projection/content-boundary tests** - `753f67d` (test)
4. **Task 2 GREEN: projection builder and boundary assertion** - `9113685` (feat)

**Plan metadata:** committed after this summary is written.

## Files Created/Modified

- `apps/mobvibe-cli/src/wal/migrations.ts` - Adds migration version 7 with six Agent Team current-state tables and indexes in the existing WAL database.
- `apps/mobvibe-cli/src/team/agent-team-store.ts` - Creates, lists, gets, and closes CLI-local durable Agent Team metadata through shared result shapes.
- `apps/mobvibe-cli/src/team/projection-builder.ts` - Rebuilds `AgentTeamSummary` from durable rows with counts, MCP status, errors, source refs, and summary refs.
- `apps/mobvibe-cli/src/team/content-boundary.ts` - Exports forbidden key constants and recursive Gateway-facing payload assertion.
- `apps/mobvibe-cli/src/team/__tests__/agent-team-store.test.ts` - Covers creation rows, restart recovery, migrations, projection redaction, source refs, and recursive forbidden-key checks.

## Decisions Made

- Reused the existing CLI WAL SQLite database and `runMigrations(db)` path rather than creating a second DB or migration runner.
- Created only metadata for the Phase 1 leader: `sessionId` remains unset, lifecycle is `pending`, health is `healthy`, and MCP phase is `not_started`.
- Kept `body_local_json` exclusively in SQLite rows; projections compute counts/source refs without returning local mailbox/task body data.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None - created/modified files were scanned for TODO/FIXME/placeholder text and hardcoded empty UI data patterns. The `params: ListAgentTeamsRpcParams = {}` default in `AgentTeamStore` is an API default, not a UI/rendering stub.

## Threat Flags

None - the new SQLite schema and projection boundary are covered by the plan threat model. No Gateway table, network endpoint, auth path, or secret-bearing surface was introduced.

## TDD Gate Compliance

- **RED 1:** `4769343 test(01-02): add failing agent team store tests` — failed because `agent-team-store.js` did not exist.
- **GREEN 1:** `f64de51 feat(01-02): add durable agent team store` — store tests passed after migration/store implementation.
- **RED 2:** `753f67d test(01-02): add failing projection boundary tests` — failed because `content-boundary.js` did not exist.
- **GREEN 2:** `9113685 feat(01-02): add agent team projection boundary` — projection and boundary tests passed.
- **REFACTOR:** No separate refactor commit was needed after Biome formatting/linting.

## Verification

- `pnpm -C apps/mobvibe-cli test -- src/team/__tests__/agent-team-store.test.ts` — PASS, 5 tests / 40 assertions.
- `pnpm format` — PASS, all workspace packages formatted; no fixes after final verification.
- `pnpm lint` — PASS, all workspace packages checked; no fixes after final verification.
- `pnpm build` — PASS, all workspace packages built. Existing webui/website bundle-size and `web-tree-sitter` eval warnings remain non-blocking pre-existing dependency/build warnings.
- Source assertion: `migrations.ts` contains all six `agent_team*` tables — PASS.
- Source assertion: no `apps/gateway/src/db` Agent Team table files were added — PASS.
- Source assertion: `AgentTeamStore.createAgentTeam` uses `randomUUID()` for `agentTeamId` and `leaderMemberId` and does not call ordinary session creation — PASS.
- Source assertion: `content-boundary.ts` exports all exact forbidden keys and `assertGatewayFacingAgentTeamPayload` — PASS.
- Source assertion: `projection-builder.ts` imports shared `AgentTeamSummary` and returns Gateway-facing projection data only — PASS.

## Self-Check: PASSED

- Found `apps/mobvibe-cli/src/team/agent-team-store.ts`.
- Found `apps/mobvibe-cli/src/team/projection-builder.ts`.
- Found `apps/mobvibe-cli/src/team/content-boundary.ts`.
- Found `apps/mobvibe-cli/src/team/__tests__/agent-team-store.test.ts`.
- Found task commits `4769343`, `f64de51`, `753f67d`, and `9113685` in git log.
- Final required CLI test, workspace format/lint, and workspace build evidence captured above.

## Next Phase Readiness

Ready for `01-03-PLAN.md`: Gateway `/acp/agent-teams` routes and typed CLI RPC can now call `AgentTeamStore` and receive non-content `AgentTeamSummary` projections.

---
*Phase: 01-protocol-state-model-persistence-boundary*
*Completed: 2026-05-13*

### Pending Todos

- 继续执行 01-02-PLAN.md：CLI durable Agent Team store and base non-content projection。

### Blockers/Concerns

- [Phase 1]: 后续计划仍需实现 CLI durable store 和 Gateway/WebUI runtime validation，继续证明 Gateway-facing payload 会拒绝或省略 mailbox/task/summary 明文。

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| v2 | 模板、角色库、自动合并、复杂自动 DAG 调度、跨 machine team、多用户协作 | Deferred | Project initialization |

## Session Continuity

Last session: 2026-05-13T04:03:00.219Z
Stopped at: Completed 01-02-PLAN.md
Resume file: None
