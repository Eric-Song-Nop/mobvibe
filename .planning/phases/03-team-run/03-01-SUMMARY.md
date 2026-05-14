---
phase: 03-team-run
plan: 01
subsystem: api-contract
tags: [agent-team, gateway, webui, worktree, e2ee-boundary]

requires:
  - phase: 01-protocol-state-model-persistence-boundary
    provides: Agent Team projection/RPC metadata boundary and forbidden plaintext rules
  - phase: 02-cli-team-mcp-mailbox-task-board
    provides: CLI-local team runtime and ordinary session ownership semantics
provides:
  - Agent Team create RPC accepts nested ordinary session worktree metadata
  - Agent Team create result can carry leader SessionSummary metadata
  - Gateway and WebUI create payloads remain metadata/worktree-only and reject target/plaintext-like fields
affects: [03-team-run, webui-create-flow, cli-leader-orchestration]

tech-stack:
  added: []
  patterns:
    - Reuse ordinary session CreateSessionWorktreeOptions for team-shared worktree creation
    - Explicit Agent Team create payload allowlists at WebUI and Gateway boundaries

key-files:
  created:
    - .planning/phases/03-team-run/deferred-items.md
  modified:
    - packages/shared/src/types/agent-team.ts
    - packages/shared/tests/agent-team.contract.test.ts
    - apps/gateway/src/routes/agent-teams.ts
    - apps/gateway/src/routes/__tests__/agent-teams.test.ts
    - apps/webui/src/lib/api.ts
    - apps/webui/src/lib/__tests__/api.test.ts

key-decisions:
  - "Agent Team create contract reuses ordinary session worktree metadata instead of introducing team-only worktree field names."
  - "Target/plaintext delivery remains outside `/acp/agent-teams`; WebUI createAgentTeam serializes only metadata and nested worktree options."

patterns-established:
  - "Gateway parses Agent Team worktree options with the same relative path and branch flag validation as ordinary session creation."
  - "Create response may include leader ordinary SessionSummary metadata so later WebUI flow can bootstrap E2EE before sending target."

requirements-completed: [ORCH-01, ORCH-02, ORCH-04, ORCH-06]

duration: 8 min
completed: 2026-05-14
---

# Phase 03 Plan 01: Shared/Gateway Agent Team Create Contract Summary

**Agent Team create contract now carries only safe worktree metadata and optional leader session metadata while keeping target plaintext out of the Gateway create route.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-05-14T03:40:30Z
- **Completed:** 2026-05-14T03:48:44Z
- **Tasks:** 3
- **Files modified:** 6 code/test files + 1 deferred tracking doc

## Accomplishments

- 扩展 `CreateAgentTeamRpcParams`，新增 `worktree?: CreateSessionWorktreeOptions`，复用 ordinary session worktree contract。
- 扩展 `CreateAgentTeamRpcResult`，新增 `leaderSession?: SessionSummary`，为后续 WebUI E2EE target 投递打基础。
- Gateway `/acp/agent-teams` 现在只转发 allowlisted metadata/worktree 字段，并复用普通 session 的 `relativeCwd` 与 branch flag injection 校验语义。
- WebUI `createAgentTeam()` 从 legacy flat `worktreeSourceCwd`/`worktreeBranch` 改为 nested `worktree` payload，并继续丢弃 target/prompt/content/body/secret-like 本地扩展字段。

## Task Commits

1. **Task 1 RED:** `547eb07` — `test(03-01): add failing agent team create contract test`
2. **Task 1 GREEN:** `bbc4175` — `feat(03-01): extend agent team create contract`
3. **Task 2 RED:** `d14597d` — `test(03-01): add failing agent team worktree route tests`
4. **Task 2 GREEN:** `c5cf57f` — `feat(03-01): parse agent team worktree metadata`
5. **Task 3 RED:** `405f067` — `test(03-01): add failing agent team API worktree payload test`
6. **Task 3 GREEN:** `d06f94c` — `feat(03-01): send agent team worktree payload from API`
7. **Formatting:** `2c69704` — `style(03-01): format shared contract test`

_TDD note: Each behavior task produced RED/GREEN commits; the final style commit contains Biome-only formatting from the required repository-wide format step._

## Files Created/Modified

- `packages/shared/src/types/agent-team.ts` — 新增 worktree create params 与 optional leader ordinary session result metadata。
- `packages/shared/tests/agent-team.contract.test.ts` — 覆盖 create contract 的 safe metadata/worktree shape，并确认没有 target plaintext 字段。
- `apps/gateway/src/routes/agent-teams.ts` — 解析并校验 nested worktree payload，拒绝 unsafe `relativeCwd` 与 branch flag injection。
- `apps/gateway/src/routes/__tests__/agent-teams.test.ts` — 覆盖 valid worktree forwarding、absolute/escaping relative path rejection、branch `-` rejection 和 forbidden plaintext rejection。
- `apps/webui/src/lib/api.ts` — `CreateAgentTeamPayload` 改为 nested `worktree?: CreateSessionWorktreeOptions`，保持显式 allowlist serialization。
- `apps/webui/src/lib/__tests__/api.test.ts` — 覆盖 WebUI API 只发送 metadata/worktree，不发送 target/prompt/content/body/secret-like 扩展字段。
- `.planning/phases/03-team-run/deferred-items.md` — 记录本计划外发现的既有 WebUI build 环境问题。

## Decisions Made

- 复用 `CreateSessionWorktreeOptions`，避免增加 team-only worktree schema，降低 Phase 3 CLI/WebUI 之间字段漂移风险。
- `workspaceMode` 继续表示 team workspace policy；实际执行 checkout 信息通过 optional `worktree` 表达。
- `leaderSession` 只作为 ordinary session metadata 返回，不承载目标任务正文；target 后续必须走 existing encrypted ordinary message path。

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- 根目录 `pnpm build` 已执行，但在既有 `apps/webui/src/components/chat/DiffView.tsx` 处失败：当前环境无法解析 `@pierre/diffs` / `@pierre/diffs/react`，并触发该文件内既有隐式 `any` 报错。此问题不由 03-01 修改引入，已记录到 `.planning/phases/03-team-run/deferred-items.md`。

## Verification

- `pnpm -C packages/shared build` — PASS
- `pnpm -C apps/gateway test:run -- src/routes/__tests__/agent-teams.test.ts` — PASS（Vitest 还按现有配置运行 gateway 相关测试，共 10 files / 121 tests）
- `pnpm -C apps/webui exec vitest run src/lib/__tests__/api.test.ts` — PASS（1 file / 9 tests）
- `pnpm -C apps/webui exec tsc -p tsconfig.json --noEmit` — PASS（focused typecheck for WebUI API change）
- `pnpm format && pnpm lint` — PASS
- `pnpm build` — BLOCKED by unrelated existing WebUI dependency resolution issue described above; shared/gateway/cli/website parts reached success before webui build failed.

## Known Stubs

None — modified files do not introduce placeholder UI/data stubs.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: route-validation | `apps/gateway/src/routes/agent-teams.ts` | Agent Team create now accepts nested worktree metadata at a trust boundary; mitigation implemented by allowlist parsing, relative path normalization, branch flag rejection, and existing recursive forbidden plaintext rejection. |

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Ready for `03-02-PLAN.md`: CLI create/start leader session can now receive `worktree` metadata and later return `leaderSession` metadata through the shared contract.
- 注意：在执行依赖 full WebUI build 的后续计划前，应处理或确认 `@pierre/diffs` 解析问题是否为本地安装环境问题。

## Self-Check: PASSED

- Found key implementation files: `packages/shared/src/types/agent-team.ts`, `apps/gateway/src/routes/agent-teams.ts`, `apps/webui/src/lib/api.ts`。
- Found commits: `547eb07`, `bbc4175`, `d14597d`, `c5cf57f`, `405f067`, `d06f94c`, `2c69704`。

---
*Phase: 03-team-run*
*Completed: 2026-05-14*
