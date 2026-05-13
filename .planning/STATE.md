---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
stopped_at: Completed 01-01-PLAN.md
last_updated: "2026-05-13T03:49:29.993Z"
last_activity: 2026-05-13
progress:
  total_phases: 5
  completed_phases: 0
  total_plans: 5
  completed_plans: 1
  percent: 20
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-12)

**Core value:** 用户可以在一个 Mobvibe 团队任务中安全地协调多个不同 ACP agent，让它们围绕同一代码目标协作，并清楚看到每个 agent 的进展、任务、消息、产出和最终汇总。
**Current focus:** Phase 01 — protocol-state-model-persistence-boundary

## Current Position

Phase: 01 (protocol-state-model-persistence-boundary) — EXECUTING
Plan: 2 of 5
Status: Ready to execute
Last activity: 2026-05-13

Progress: [██░░░░░░░░] 20%

## Performance Metrics

**Velocity:**

- Total plans completed: 0
- Average duration: N/A
- Total execution time: 0.0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1. 协议、状态模型与持久化边界 | 0 | TBD | N/A |
| 2. CLI Team MCP、Mailbox 与 Task Board | 0 | TBD | N/A |
| 3. 最小端到端 Team Run | 0 | TBD | N/A |
| 4. 生命周期、权限、E2EE 与恢复 | 0 | TBD | N/A |
| 5. UI 规模化与 v1 Polish | 0 | TBD | N/A |

**Recent Trend:**

- Last 5 plans: N/A
- Trend: N/A

*Updated after each plan completion*
| Phase 01 P01 | 7 min | 1 tasks | 5 files |

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
- [Phase 1]: Gateway 采用混合方案：对 WebUI 暴露 `/acp/agent-teams`，内部只转发 typed CLI RPC，不持久化 Agent Team truth。
- [Phase 1]: Gateway-facing team projection 不携带 mailbox/task/summary 正文；CLI-local store 可以保存协作正文。
- [Phase 1]: lifecycle 不使用 `idle`/`ready`；MCP readiness、permission waiting、activity counts 和 health 独立表达。
- [Phase 1]: source refs 是强类型定位引用，不承载正文；优先跳转到 member ordinary session history。
- [Phase 1]: CLI SQLite 当前事实表是 team durable truth；Gateway 只做 presence 与 snapshot 转发。
- [Phase 01]: ---

phase: 01-protocol-state-model-persistence-boundary
plan: 01
subsystem: shared-protocol
tags: [typescript, shared-types, socket-events, agent-team, mcp]
requires:

  - phase: project-initialization
    provides: Agent Team product model, requirements, roadmap, and Phase 1 context
provides:

  - Shared Agent Team projection contract
  - Typed Agent Team create/list/get RPC payloads
  - Typed Agent Team changed socket event payload
  - MCP capability discovery extension on session capabilities

affects: [gateway, mobvibe-cli, webui, phase-01]
tech-stack:
  added: []
  patterns:

    - Shared protocol types exported from packages/shared/src/index.ts
    - Gateway-facing projections exclude coordination plaintext and secret-bearing fields

key-files:
  created:

    - packages/shared/src/types/agent-team.ts
    - packages/shared/tests/agent-team.contract.test.ts
  modified:

    - packages/shared/src/types/session.ts
    - packages/shared/src/types/socket-events.ts
    - packages/shared/src/index.ts

key-decisions:

  - "Agent Team lifecycle and member lifecycle are modeled as explicit shared unions without idle/ready lifecycle states."
  - "Agent Team RPC errors continue to use the existing RpcResponse<...>.error: ErrorDetail path instead of ad-hoc error shapes."
  - "Gateway-facing Agent Team types carry IDs, state, counts, timestamps, errors, and source refs only; coordination plaintext remains outside shared projection fields."

patterns-established:

  - "Agent Team protocol: shared type aliases, projections, source refs, and RPC payloads live in packages/shared/src/types/agent-team.ts and are explicitly exported."
  - "MCP capability discovery: AgentSessionCapabilities.mcp reports acp, stdio, and perSessionBridge support without adding team lifecycle to SessionSummary."

requirements-completed: [TEAM-01, TEAM-02, TEAM-04, TEAM-05, LIFE-01]
duration: 7 min
completed: 2026-05-13
---

# Phase 01 Plan 01: Shared Agent Team Contract Summary

**Shared Agent Team metadata/RPC contract with lifecycle unions, MCP capability discovery, source refs, and socket event payloads.**

## Performance

- **Duration:** 7 min
- **Started:** 2026-05-13T03:41:00Z
- **Completed:** 2026-05-13T03:48:11Z
- **Tasks:** 1
- **Files modified:** 5 source/test files

## Accomplishments

- Added `AgentTeamSummary`, `TeamMemberSummary`, lifecycle/status unions, MCP status, mailbox/task counts, summary refs, and source refs in shared types.
- Added typed Agent Team create/list/get RPC payload/result contracts and `AgentTeamsChangedPayload` for incremental projection updates.
- Extended `AgentSessionCapabilities` with `AgentMcpCapabilities` and wired Agent Team RPC/events through typed socket interfaces and public shared exports.
- Added a Vitest contract test that pins public exports, exact lifecycle unions, MCP phases, RPC payloads, and forbidden plaintext/secret field boundaries.

## Task Commits

Each task was committed atomically using the TDD RED/GREEN flow:

1. **Task 1 RED: Agent Team contract assertions** - `939db4f` (test)
2. **Task 1 GREEN: shared Agent Team contract** - `150adcf` (feat)

**Plan metadata:** committed after this summary is written.

## Files Created/Modified

- `packages/shared/src/types/agent-team.ts` - New shared Agent Team IDs, lifecycles, MCP status, projections, source refs, RPC payloads, and changed-event payload.
- `packages/shared/src/types/session.ts` - Adds `AgentMcpCapabilities` and `AgentSessionCapabilities.mcp` discovery metadata.
- `packages/shared/src/types/socket-events.ts` - Adds typed Agent Team RPC requests and `agent-teams:changed` events for CLI/Gateway/WebUI sockets.
- `packages/shared/src/index.ts` - Explicitly exports the new Agent Team and MCP capability public types.
- `packages/shared/tests/agent-team.contract.test.ts` - Contract test for shared exports, lifecycle unions, MCP phases, RPC shapes, and content-boundary field names.

## Decisions Made

- Agent Team lifecycle and member lifecycle use exact shared unions from Phase 1 context and intentionally exclude `idle`/`ready` as lifecycle states.
- Agent Team RPC result types model successful payloads only; failure continues through existing `RpcResponse<TResult>.error?: ErrorDetail`.
- Source refs are metadata-only discriminated unions and do not carry mailbox, task, prompt, summary, or agent-output plaintext.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed workspace dependencies before running the RED test**

- **Found during:** Task 1 (Define shared Agent Team contract and socket payloads)
- **Issue:** `pnpm -C packages/shared test:run -- tests/agent-team.contract.test.ts` failed because `vitest` was unavailable and `node_modules` was missing.
- **Fix:** Ran `pnpm install` using the existing lockfile; no source or lockfile changes were produced.
- **Files modified:** None
- **Verification:** Re-ran the RED test and observed the expected failing contract assertion before implementation.
- **Committed in:** Not applicable (environment repair only)

---

**Total deviations:** 1 auto-fixed (1 blocking).
**Impact on plan:** Environment repair only; no scope change and no generated dependency artifacts committed.

## Issues Encountered

- Initial RED test run was blocked by missing dependencies; resolved with `pnpm install`.
- No implementation blockers remained after dependencies were installed.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None - modified files were scanned for TODO/FIXME/placeholder text and hardcoded empty UI data patterns.

## Threat Flags

None - the new surface is the shared protocol contract already covered by the plan threat model. No network endpoint, file access path, schema, or auth boundary was introduced.

## TDD Gate Compliance

- **RED:** `939db4f test(01-01): add failing agent team contract test` — first run failed because `agent-team.ts` did not exist.
- **GREEN:** `150adcf feat(01-01): add shared agent team contract` — contract tests and `pnpm -C packages/shared build` pass.
- **REFACTOR:** No separate refactor commit was needed after Biome formatting.

## Verification

- `pnpm -C packages/shared test:run -- tests/agent-team.contract.test.ts` — PASS, 2 test files / 11 tests passed.
- `pnpm -C packages/shared build` — PASS.
- `grep -E 'export type (AgentTeamId|TeamMemberId|TeamMailboxMessageId|TeamTaskId|TeamSummaryRefId|AgentTeamLifecycle|TeamMemberLifecycle|TeamMcpPhase|TeamMcpTransport|TeamSourceRef|AgentTeamSummary|TeamMemberSummary|CreateAgentTeamRpcParams|CreateAgentTeamRpcResult|ListAgentTeamsRpcParams|ListAgentTeamsRpcResult|GetAgentTeamRpcParams|GetAgentTeamRpcResult|AgentTeamsChangedPayload)' packages/shared/src/types/agent-team.ts` — PASS.
- `grep -E 'AgentMcpCapabilities|mcp\\?: AgentMcpCapabilities' packages/shared/src/types/session.ts` — PASS.
- `grep -E 'rpc:agent-team:create|rpc:agent-teams:list|rpc:agent-team:get|agent-teams:changed' packages/shared/src/types/socket-events.ts` — PASS.
- `grep -v '^#' packages/shared/src/types/agent-team.ts | grep -E 'prompt|content|body|description|summaryText|agentOutput|providerToken|masterSecret|dek|secret' || true` — PASS, no matches.

## Self-Check: PASSED

- Found `packages/shared/src/types/agent-team.ts`.
- Found `packages/shared/tests/agent-team.contract.test.ts`.
- Found task commit `939db4f` in git log.
- Found task commit `150adcf` in git log.
- Final build and contract test evidence captured above.

## Next Phase Readiness

Ready for `01-02-PLAN.md`: CLI durable Agent Team store and base non-content projection can now consume the shared `AgentTeamSummary`, member/MCP/count/source-ref, and RPC types.

---
*Phase: 01-protocol-state-model-persistence-boundary*
*Completed: 2026-05-13* — ---
phase: 01-protocol-state-model-persistence-boundary
plan: 01
subsystem: shared-protocol
tags: [typescript, shared-types, socket-events, agent-team, mcp]
requires:

  - phase: project-initialization
    provides: Agent Team product model, requirements, roadmap, and Phase 1 context
provides:

  - Shared Agent Team projection contract
  - Typed Agent Team create/list/get RPC payloads
  - Typed Agent Team changed socket event payload
  - MCP capability discovery extension on session capabilities

affects: [gateway, mobvibe-cli, webui, phase-01]
tech-stack:
  added: []
  patterns:

    - Shared protocol types exported from packages/shared/src/index.ts
    - Gateway-facing projections exclude coordination plaintext and secret-bearing fields

key-files:
  created:

    - packages/shared/src/types/agent-team.ts
    - packages/shared/tests/agent-team.contract.test.ts
  modified:

    - packages/shared/src/types/session.ts
    - packages/shared/src/types/socket-events.ts
    - packages/shared/src/index.ts

key-decisions:

  - "Agent Team lifecycle and member lifecycle are modeled as explicit shared unions without idle/ready lifecycle states."
  - "Agent Team RPC errors continue to use the existing RpcResponse<...>.error: ErrorDetail path instead of ad-hoc error shapes."
  - "Gateway-facing Agent Team types carry IDs, state, counts, timestamps, errors, and source refs only; coordination plaintext remains outside shared projection fields."

patterns-established:

  - "Agent Team protocol: shared type aliases, projections, source refs, and RPC payloads live in packages/shared/src/types/agent-team.ts and are explicitly exported."
  - "MCP capability discovery: AgentSessionCapabilities.mcp reports acp, stdio, and perSessionBridge support without adding team lifecycle to SessionSummary."

requirements-completed: [TEAM-01, TEAM-02, TEAM-04, TEAM-05, LIFE-01]
duration: 7 min
completed: 2026-05-13
---

# Phase 01 Plan 01: Shared Agent Team Contract Summary

**Shared Agent Team metadata/RPC contract with lifecycle unions, MCP capability discovery, source refs, and socket event payloads.**

## Performance

- **Duration:** 7 min
- **Started:** 2026-05-13T03:41:00Z
- **Completed:** 2026-05-13T03:48:11Z
- **Tasks:** 1
- **Files modified:** 5 source/test files

## Accomplishments

- Added `AgentTeamSummary`, `TeamMemberSummary`, lifecycle/status unions, MCP status, mailbox/task counts, summary refs, and source refs in shared types.
- Added typed Agent Team create/list/get RPC payload/result contracts and `AgentTeamsChangedPayload` for incremental projection updates.
- Extended `AgentSessionCapabilities` with `AgentMcpCapabilities` and wired Agent Team RPC/events through typed socket interfaces and public shared exports.
- Added a Vitest contract test that pins public exports, exact lifecycle unions, MCP phases, RPC payloads, and forbidden plaintext/secret field boundaries.

## Task Commits

Each task was committed atomically using the TDD RED/GREEN flow:

1. **Task 1 RED: Agent Team contract assertions** - `939db4f` (test)
2. **Task 1 GREEN: shared Agent Team contract** - `150adcf` (feat)

**Plan metadata:** committed after this summary is written.

## Files Created/Modified

- `packages/shared/src/types/agent-team.ts` - New shared Agent Team IDs, lifecycles, MCP status, projections, source refs, RPC payloads, and changed-event payload.
- `packages/shared/src/types/session.ts` - Adds `AgentMcpCapabilities` and `AgentSessionCapabilities.mcp` discovery metadata.
- `packages/shared/src/types/socket-events.ts` - Adds typed Agent Team RPC requests and `agent-teams:changed` events for CLI/Gateway/WebUI sockets.
- `packages/shared/src/index.ts` - Explicitly exports the new Agent Team and MCP capability public types.
- `packages/shared/tests/agent-team.contract.test.ts` - Contract test for shared exports, lifecycle unions, MCP phases, RPC shapes, and content-boundary field names.

## Decisions Made

- Agent Team lifecycle and member lifecycle use exact shared unions from Phase 1 context and intentionally exclude `idle`/`ready` as lifecycle states.
- Agent Team RPC result types model successful payloads only; failure continues through existing `RpcResponse<TResult>.error?: ErrorDetail`.
- Source refs are metadata-only discriminated unions and do not carry mailbox, task, prompt, summary, or agent-output plaintext.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed workspace dependencies before running the RED test**

- **Found during:** Task 1 (Define shared Agent Team contract and socket payloads)
- **Issue:** `pnpm -C packages/shared test:run -- tests/agent-team.contract.test.ts` failed because `vitest` was unavailable and `node_modules` was missing.
- **Fix:** Ran `pnpm install` using the existing lockfile; no source or lockfile changes were produced.
- **Files modified:** None
- **Verification:** Re-ran the RED test and observed the expected failing contract assertion before implementation.
- **Committed in:** Not applicable (environment repair only)

---

**Total deviations:** 1 auto-fixed (1 blocking).
**Impact on plan:** Environment repair only; no scope change and no generated dependency artifacts committed.

## Issues Encountered

- Initial RED test run was blocked by missing dependencies; resolved with `pnpm install`.
- No implementation blockers remained after dependencies were installed.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None - modified files were scanned for TODO/FIXME/placeholder text and hardcoded empty UI data patterns.

## Threat Flags

None - the new surface is the shared protocol contract already covered by the plan threat model. No network endpoint, file access path, schema, or auth boundary was introduced.

## TDD Gate Compliance

- **RED:** `939db4f test(01-01): add failing agent team contract test` — first run failed because `agent-team.ts` did not exist.
- **GREEN:** `150adcf feat(01-01): add shared agent team contract` — contract tests and `pnpm -C packages/shared build` pass.
- **REFACTOR:** No separate refactor commit was needed after Biome formatting.

## Verification

- `pnpm -C packages/shared test:run -- tests/agent-team.contract.test.ts` — PASS, 2 test files / 11 tests passed.
- `pnpm -C packages/shared build` — PASS.
- `grep -E 'export type (AgentTeamId|TeamMemberId|TeamMailboxMessageId|TeamTaskId|TeamSummaryRefId|AgentTeamLifecycle|TeamMemberLifecycle|TeamMcpPhase|TeamMcpTransport|TeamSourceRef|AgentTeamSummary|TeamMemberSummary|CreateAgentTeamRpcParams|CreateAgentTeamRpcResult|ListAgentTeamsRpcParams|ListAgentTeamsRpcResult|GetAgentTeamRpcParams|GetAgentTeamRpcResult|AgentTeamsChangedPayload)' packages/shared/src/types/agent-team.ts` — PASS.
- `grep -E 'AgentMcpCapabilities|mcp\\?: AgentMcpCapabilities' packages/shared/src/types/session.ts` — PASS.
- `grep -E 'rpc:agent-team:create|rpc:agent-teams:list|rpc:agent-team:get|agent-teams:changed' packages/shared/src/types/socket-events.ts` — PASS.
- `grep -v '^#' packages/shared/src/types/agent-team.ts | grep -E 'prompt|content|body|description|summaryText|agentOutput|providerToken|masterSecret|dek|secret' || true` — PASS, no matches.

## Self-Check: PASSED

- Found `packages/shared/src/types/agent-team.ts`.
- Found `packages/shared/tests/agent-team.contract.test.ts`.
- Found task commit `939db4f` in git log.
- Found task commit `150adcf` in git log.
- Final build and contract test evidence captured above.

## Next Phase Readiness

Ready for `01-02-PLAN.md`: CLI durable Agent Team store and base non-content projection can now consume the shared `AgentTeamSummary`, member/MCP/count/source-ref, and RPC types.

---
*Phase: 01-protocol-state-model-persistence-boundary*
*Completed: 2026-05-13*

### Pending Todos

- 确认 `.planning/phases/01-protocol-state-model-persistence-boundary/PLAN.md` 后开始 Phase 1 代码实现。

### Blockers/Concerns

- [Phase 1]: 实现仍需扩展当前 ACP capability discovery，表达 native `mcpCapabilities.acp` 与安全的 per-session bridge fallback。
- [Phase 1]: 实现仍需测试证明 Gateway-facing payload 会拒绝或省略 mailbox/task/summary 明文。

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| v2 | 模板、角色库、自动合并、复杂自动 DAG 调度、跨 machine team、多用户协作 | Deferred | Project initialization |

## Session Continuity

Last session: 2026-05-13T03:49:29.985Z
Stopped at: Completed 01-01-PLAN.md
Resume file: None
