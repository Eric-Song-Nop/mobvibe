---
phase: 03-team-run
plan: 05
subsystem: ui
tags: [webui, react, agent-team, sidebar, overview, metadata-projection]

# Dependency graph
requires:
  - phase: 03-team-run
    provides: [Agent Team create flow, projection sync, leader/member ordinary session metadata]
provides:
  - Workspace session list 中的 Agent Team parent + member child rows
  - Metadata-only Agent Team overview workspace view
  - Team-owned ordinary sessions 默认从普通顶层列表折叠隐藏
affects: [phase-03-team-run, phase-04-lifecycle, phase-05-ui-polish]

# Tech tracking
tech-stack:
  added: []
  patterns: [sidebar-specific derived entry model, metadata-only team overview, ordinary session jump reuse]

key-files:
  created:
    - apps/webui/src/hooks/__tests__/useSessionList.test.tsx
    - apps/webui/src/components/team/AgentTeamOverview.tsx
    - apps/webui/src/components/team/__tests__/AgentTeamOverview.test.tsx
  modified:
    - apps/webui/src/hooks/useSessionList.ts
    - apps/webui/src/lib/workspace-utils.ts
    - apps/webui/src/components/session/SessionSidebar.tsx
    - apps/webui/src/components/app/AppSidebar.tsx
    - apps/webui/src/app/MainLayout.tsx
    - apps/webui/src/app/use-main-app-controller.tsx
    - apps/webui/src/app/SessionWorkspace.tsx
    - apps/webui/src/i18n/locales/en/translation.json
    - apps/webui/src/i18n/locales/zh/translation.json

key-decisions:
  - "Agent Team sidebar 使用独立 SidebarSessionListEntry 派生模型，不把 team 伪装成普通 ChatSession。"
  - "点击 member child row 继续调用普通 onSelectSession(sessionId)，复用既有 ordinary session 激活路径。"
  - "AgentTeamOverview 只读取 AgentTeamSummary metadata/count/source-safe 字段，不展示 mailbox/task/summary 正文或 agent output。"

patterns-established:
  - "Team-owned ordinary sessions 由 team member sessionId set 过滤出普通顶层列表，同时在 sidebar team parent 下展示。"
  - "选择 team parent 写入 useTeamStore.activeAgentTeamId；选择普通 session 清除 activeAgentTeamId。"
  - "Overview 内的 member jump button 是普通 session navigation，不新增 team-specific chat/session kind。"

requirements-completed: [UI-02, UI-03, UI-04, UI-05, ORCH-04, ORCH-05, ORCH-06]

# Metrics
duration: 约24min
completed: 2026-05-14
---

# Phase 03-team-run Plan 05: Agent Team 最小可观察 UI Summary

**Agent Team 现在作为 workspace session list 的一级 parent row 展示，成员 ordinary sessions 默认折叠在 team 下，并可进入 metadata-only overview 或跳回普通 session。**

## Performance

- **Duration:** 约24分钟
- **Started:** 2026-05-14T05:54:08Z
- **Completed:** 2026-05-14T06:18:31Z
- **Tasks:** 4
- **Files modified:** 12

## Accomplishments

- `useSessionList` 新增 sidebar 专用 Agent Team 派生 entry：按 selected machine/effective workspace 过滤，worktree team 仍归入 source repo workspace，并隐藏 team-owned ordinary sessions 的顶层重复项。
- `SessionSidebar` 支持默认展开的 Agent Team parent row：显示 lifecycle/MCP phase、task/mailbox compact badges、member child rows、worktree branch 和 linked session 状态。
- `SessionWorkspace` 增加 `AgentTeamOverview` 分支：点击 team parent 进入 metadata-only overview，点击 member jump button 调用普通 session 选择路径并恢复既有 chat UI。
- Overview 与测试明确排除 target/mailbox/task/summary body 和 agent output，只展示 projection metadata、counts、安全 error 与成员 session 链接。

## Task Commits

1. **Task 1: Derive team-aware session list entries** - `081250f` (feat)
2. **Task 2: Render Agent Team parent and member child rows in SessionSidebar** - `38e2957` (feat)
3. **Task 3: Add minimal AgentTeamOverview workspace view** - `6ff3a53` (feat)
4. **Task 4: Run UI quality checks and update Chinese docs** - `da0e878` (fix, verification follow-up)

## Files Created/Modified

- `apps/webui/src/hooks/useSessionList.ts` - 生成 ordinary list 与 sidebar-specific team/session union entry，并过滤 team-owned duplicates。
- `apps/webui/src/lib/workspace-utils.ts` - workspace 收集纳入 Agent Team projection，保持 worktree team source repo grouping。
- `apps/webui/src/components/session/SessionSidebar.tsx` - 渲染 Agent Team parent/member rows，保留普通 session row 与 archive 行为。
- `apps/webui/src/components/app/AppSidebar.tsx` - 将 sidebar entries 和 team selection 回调传给桌面/移动 sidebar。
- `apps/webui/src/app/MainLayout.tsx` - 从 controller 传递 `sidebarSessionList`、`activeAgentTeamId` 和 team selection handler。
- `apps/webui/src/app/use-main-app-controller.tsx` - 管理 `activeAgentTeamId` 与普通 session 互斥选择；member jump 复用普通 session activation。
- `apps/webui/src/app/SessionWorkspace.tsx` - active Agent Team 时展示 overview 分支，不进入普通 chat rendering。
- `apps/webui/src/components/team/AgentTeamOverview.tsx` - 新增 metadata-only overview 组件。
- `apps/webui/src/components/team/__tests__/AgentTeamOverview.test.tsx` - 覆盖 metadata-only projection、禁用正文泄漏和 member jump。
- `apps/webui/src/hooks/__tests__/useSessionList.test.tsx` - 覆盖 worktree source workspace grouping 与 duplicate hiding。
- `apps/webui/tests/session-sidebar.test.tsx` - 覆盖 expanded Agent Team parent、badges、member row 和 session jump。
- `apps/webui/src/i18n/locales/en/translation.json`, `apps/webui/src/i18n/locales/zh/translation.json` - 增加 Agent Team badge/button 文案。

## Decisions Made

- Agent Team 不是 fake ordinary session：sidebar 用 `SidebarSessionListEntry` union，ordinary chat store 不新增 team session kind。
- Team parent 与 ordinary session selection 互斥：team parent 设置 `activeAgentTeamId` 并清除 `activeSessionId`；普通 session selection 清除 active team。
- Overview 只做最小可观察 metadata UI：展示 lifecycle、workspace、members、MCP phase、worktree branch、安全 error、task/mailbox counts 和 jump button，不展示协作正文。

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] active ordinary session 不能因折叠到 team 下而被清空**
- **Found during:** Task 1
- **Issue:** `sessionList` 顶层列表隐藏 team-owned session 后，原有 active session validity check 会把隐藏的 leader/member ordinary session 当作“不在列表中”并清空。
- **Fix:** 新增 `sidebarEntryContainsSession()`，active validity 改为检查 sidebar union entry 中的 ordinary row 和 team member sessionId。
- **Files modified:** `apps/webui/src/app/use-main-app-controller.tsx`
- **Verification:** `pnpm -C apps/webui test:run -- src/hooks/__tests__/useSessionList.test.tsx src/__tests__/app-session-restore.test.tsx` 通过（50 files / 580 tests）。
- **Committed in:** `081250f`

**2. [Rule 3 - Blocking] overview test fixture 使用完整 ErrorDetail shape**
- **Found during:** Task 4 build verification
- **Issue:** `AgentTeamOverview.test.tsx` 使用 `{ code: "service" }` 作为 error fixture，违反 shared `ErrorDetail.code` 类型，导致 `pnpm -C apps/webui build` 的 `tsc -b` 失败。
- **Fix:** 将 fixture 改为 `{ code: "INTERNAL_ERROR", retryable: true, scope: "service" }`。
- **Files modified:** `apps/webui/src/components/team/__tests__/AgentTeamOverview.test.tsx`
- **Verification:** `pnpm -C apps/webui build` 通过。
- **Committed in:** `da0e878`

---

**Total deviations:** 2 auto-fixed（Rule 1 bug ×1，Rule 3 blocking ×1）
**Impact on plan:** 都是当前 UI 切片正确性/可构建性所需修复；没有扩大功能范围或引入新架构。

## Issues Encountered

- Vitest scoped command 在当前 webui 配置下仍会执行完整测试集合；本计划记录的是实际输出中的 full run 结果。
- WebUI build 继续输出既有 `web-tree-sitter` direct eval、chunk size、Tauri deep-link dynamic import 警告；构建成功，这些不是本计划新增问题。

## Verification

- `pnpm -C apps/webui test:run -- src/components/app/__tests__/AppSidebar.test.tsx src/components/team/__tests__/AgentTeamOverview.test.tsx src/hooks/__tests__/useSessionList.test.tsx` — 通过（51 files / 582 tests）。
- `pnpm -C apps/webui lint` — 通过（Biome checked 192 files, no fixes）。
- `pnpm -C apps/webui build` — 通过（`tsc -b && vite build` completed；仅既有 dependency/chunk warnings）。

## React Best Practices Review

- `useSessionList` 的 `useMemo` 仅用于 Zustand serialized selector 结果、Set 构建和 sidebar derived entries，避免在 render 中重复建立 team-owned lookup；没有新增不必要的 `useCallback`/memoized component。
- `SessionSidebar` 保持 ordinary session row 组件复用，新增 team row 独立组件，避免把 team model 塞进 chat store 或普通 session props。
- `AgentTeamOverview` 是纯 props metadata component，无额外 client data fetching、无 effect waterfall、无 large-list virtualization 风险（当前最小 team member projection）。

## Web Design Guideline Review

- 已 fetch 最新 Web Interface Guidelines（2026-05-14）并检查 `SessionSidebar.tsx`、`AgentTeamOverview.tsx`、`MainLayout.tsx`、`SessionWorkspace.tsx`。
- 通过项：所有新交互使用 `<button>`；icon-only expand button 有 `aria-label`；decorative icons `aria-hidden`; `outline-none` 均配套 `focus-visible:ring-*`；长标题/metadata 使用 `min-w-0` + `truncate`；移动 sidebar 仍复用同一 `SessionSidebar`，保留 safe-area padding/overscroll containment。
- 残余风险：未做浏览器截图验证；当前证据来自 Testing Library + static guideline review。视觉 polish 可在 Phase 5 继续增强。

## Known Stubs

None - 本计划没有引入阻塞目标达成的 mock UI 或 hardcoded empty projection 数据。

## Threat Flags

None - 本计划只消费既有 Agent Team projection metadata，没有新增网络端点、auth path、文件访问或 schema trust boundary。

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 3 最小端到端可观察闭环完成：create flow、projection sync、sidebar folding、overview、member session jump 都已有基础测试覆盖。
- Phase 4 可继续在当前 UI 模式上扩展 lifecycle/cancel/retry/permission aggregation，不需要改变 ordinary session ownership 模型。

## Self-Check: PASSED

- Summary 文件已创建：`.planning/phases/03-team-run/03-05-SUMMARY.md`
- 任务提交存在：`081250f`, `38e2957`, `6ff3a53`, `da0e878`
- Verification 命令已在 Summary 中记录，build/lint/test 均通过。

---
*Phase: 03-team-run*
*Completed: 2026-05-14*
