---
phase: 03-team-run
plan: 04
subsystem: ui
tags: [webui, react, zustand, react-query, e2ee, agent-team]

# Dependency graph
requires:
  - phase: 03-team-run
    provides: [Agent Team create RPC returns leader ordinary session metadata]
provides:
  - WebUI Agent Team projection startup fetch and socket live sync
  - Create dialog Agent Team mode with runtime-only target draft
  - Metadata-only team create transaction followed by encrypted target delivery to leader session
affects: [phase-03-team-run, phase-04-lifecycle, webui-team-overview]

# Tech tracking
tech-stack:
  added: []
  patterns: [React Query startup projection fetch, Zustand runtime draft state, E2EE-gated two-step create mutation]

key-files:
  created: []
  modified:
    - apps/webui/src/hooks/useSocket.ts
    - apps/webui/src/hooks/useSessionQueries.ts
    - apps/webui/src/hooks/useSessionHandlers.ts
    - apps/webui/src/hooks/useSessionMutations.ts
    - apps/webui/src/components/app/CreateSessionDialog.tsx
    - apps/webui/src/lib/ui-store.ts
    - apps/webui/src/i18n/locales/en/translation.json
    - apps/webui/src/i18n/locales/zh/translation.json

key-decisions:
  - "Agent Team target 只保存在 WebUI runtime draft 中，不进入 team-store 持久化，也不传给 createAgentTeam route。"
  - "WebUI create flow 使用两步事务：先创建 team/leader metadata，再 bootstrap leader E2EE 并通过 sendMessage() 投递 target。"
  - "当 leader E2EE bootstrap 不是 ok 时，WebUI 在发送前失败，避免 target 经过非加密 Gateway payload。"

patterns-established:
  - "Agent Team projection sync: startup fetch replaces Zustand projection store, socket event handles live added/updated/removed deltas。"
  - "Agent Team create dialog reuses ordinary session cwd/backend/worktree request builder，避免 team-only worktree shape。"
  - "Dialog success waits for encrypted target send resolve；metadata create success alone不关闭对话。"

requirements-completed: [ORCH-01, ORCH-02, UI-01]

# Metrics
duration: 约85min
completed: 2026-05-14
---

# Phase 03-team-run Plan 04: WebUI Agent Team 创建流程 Summary

**WebUI Agent Team 创建流程现在通过 metadata-only create route 创建 leader，再以现有 E2EE ordinary session message path 投递 target。**

## Performance

- **Duration:** 约85分钟（含中断后 continuation）
- **Started:** 2026-05-14T04:23:55Z
- **Completed:** 2026-05-14
- **Tasks:** 3
- **Files modified:** 13

## Accomplishments

- WebUI 启动时 fetch Agent Team projections 并替换 `useTeamStore`，同时订阅 `agent-teams:changed` 做实时 projection 同步。
- `CreateSessionDialog` 增加 Agent Team 模式：可填写 runtime-only target、可选 team title，并复用 backend/cwd/worktree 控件。
- `createAgentTeamRunMutation` 只向 `createAgentTeam()` 发送 metadata/worktree；收到 leader ordinary session 后 bootstrap E2EE，再调用现有 `sendMessage()` 投递 target。
- 如果 leader session 缺少可用 E2EE DEK，mutation 在发送 target 前失败并展示错误；dialog 只有在 target send resolve 后才关闭。

## Task Commits

1. **Task 1: Add WebUI team projection fetch and socket sync** - `d47ba04` (feat)
2. **Task 2: Extend create dialog/state for Agent Team target** - `6bc2404` (feat)
3. **Task 3: Implement create team transaction and encrypted target delivery** - `55ac29e` (feat)
4. **Task 3 build/type follow-up** - `fb1ec85` (fix)

_Note: TDD tasks were executed with failing tests first during the working session, then committed after GREEN verification._

## Files Created/Modified

- `apps/webui/src/hooks/useSocket.ts` - 注册 `agent-teams:changed` socket handler 并更新 team projection store。
- `apps/webui/src/hooks/useSessionQueries.ts` - 增加 Agent Team projection startup query，成功后 replace store。
- `apps/webui/src/lib/team-store.ts` - 继续作为 projection-only store；现有 forbidden-key stripping 保持不变。
- `apps/webui/src/lib/ui-store.ts` - 增加 `createDialogMode` 与 runtime-only `draftTeamTarget`。
- `apps/webui/src/components/app/CreateSessionDialog.tsx` - 增加 Agent Team 标题/目标 UI，并复用 cwd/backend/worktree 控件。
- `apps/webui/src/hooks/useSessionHandlers.ts` - 增加 Agent Team create flow validation 与 worktree request parity。
- `apps/webui/src/hooks/useSessionMutations.ts` - 增加 metadata-only create + E2EE bootstrap + encrypted target send mutation。
- `apps/webui/src/app/use-main-app-controller.tsx` - 将 Agent Team create mutation pending state 纳入 create dialog loading 状态。
- `apps/webui/src/i18n/locales/en/translation.json` - 增加 Agent Team create UI 文案。
- `apps/webui/src/i18n/locales/zh/translation.json` - 增加 Agent Team create UI 中文文案。
- `apps/webui/src/hooks/__tests__/useSocket.test.tsx` - 覆盖 socket team projection sync。
- `apps/webui/src/hooks/__tests__/useSessionHandlers.test.tsx` - 覆盖 team flow 打开、target 校验和 worktree request parity。
- `apps/webui/src/hooks/__tests__/useSessionMutations.test.tsx` - 覆盖 metadata-only create、E2EE 成功投递和 missing DEK 阻断。

## Decisions Made

- Agent Team create route 继续只承载 metadata/worktree；target 明文只进入 `sendMessage()` 的加密 ordinary session payload。
- Dialog target draft 不进入 persisted store；关闭/重新打开 create dialog 会清空 runtime draft。
- WebUI 不在 target send 失败时自动回滚 team/leader metadata，保持 Phase 3 research 中的“失败展示错误，用户可手动处理”边界。

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] 更新 app controller 与测试 mock 的新 mutation shape**
- **Found during:** Task 3 build verification
- **Issue:** `use-main-app-controller` 的 `uiActions` 缺少新增 draft action，部分测试 mock 也缺少 `createAgentTeamRunMutation`，导致 TypeScript build 失败。
- **Fix:** 将 `setCreateDialogMode`、`setDraftTeamTarget` 加入 controller action selector，并同步测试 mock 与 typed payload。
- **Files modified:** `apps/webui/src/app/use-main-app-controller.tsx`, `apps/webui/src/__tests__/app-session-restore.test.tsx`, `apps/webui/src/hooks/__tests__/useSessionMutations.test.tsx`, `apps/webui/src/hooks/__tests__/useSessionQueries.test.tsx`
- **Verification:** `pnpm -C apps/webui build` 通过。
- **Committed in:** `fb1ec85`

---

**Total deviations:** 1 auto-fixed (Rule 3 blocking)
**Impact on plan:** 仅补齐新 WebUI create flow 的类型与测试 wiring；没有扩大功能范围。

## Issues Encountered

- WebUI build 会输出既有 `web-tree-sitter` direct eval、chunk size、Tauri deep-link dynamic import 警告；构建最终成功，这些不是本计划新增阻塞。

## Verification

- `pnpm -C apps/webui test:run -- src/lib/__tests__/api.test.ts src/lib/__tests__/team-store.test.ts src/hooks/__tests__/useSocket.test.tsx src/hooks/__tests__/useSessionMutations.test.tsx src/hooks/__tests__/useSessionHandlers.test.tsx` — 通过（49 files / 578 tests）。
- `pnpm -C apps/webui build` — 通过（Vite build completed；仅既有依赖/分包警告）。

## Known Stubs

None - 本计划没有引入阻塞目标达成的 mock UI 或 hardcoded empty projection 数据。

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: e2ee-target-delivery | `apps/webui/src/hooks/useSessionMutations.ts` | 新增 create flow 处理用户 target 明文；已通过 E2EE bootstrap ok gate 和 `sendMessage()` 加密路径缓解。 |

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- WebUI 已具备最小 Agent Team create transaction，可供后续 sidebar/overview/detail navigation 继续消费 team projection。
- 后续阶段应继续处理 create metadata 成功但 target send 失败后的 UX（重试/跳转提示），以及更完整的 team overview 展示。

## Self-Check: PASSED

- Summary 文件已创建：`.planning/phases/03-team-run/03-04-SUMMARY.md`
- 任务提交存在：`d47ba04`, `6bc2404`, `55ac29e`, `fb1ec85`
- 未修改 `.planning/STATE.md`、`.planning/ROADMAP.md`、`.planning/REQUIREMENTS.md`

---
*Phase: 03-team-run*
*Completed: 2026-05-14*
