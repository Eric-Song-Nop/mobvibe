---
phase: 03-team-run
plan: 03
subsystem: cli-team-orchestration
tags: [mobvibe-cli, agent-team, acp, mcp, spawn, bun-test]

requires:
  - phase: 03-team-run
    provides: [leader ordinary ACP session creation, team MCP readiness gate, shared checkout metadata]
provides:
  - mobvibe_team_spawn_member MCP tool surface
  - real member ordinary ACP session spawning through SessionManager
  - failed spawn member slot preservation with safe error metadata
  - member turn completion projection update path
affects: [03-team-run, cli, agent-team-runtime, phase-04-lifecycle]

tech-stack:
  added: []
  patterns: [metadata-only MCP args, SessionManager-owned team lifecycle side effects, shared checkout inheritance]

key-files:
  created:
    - .planning/phases/03-team-run/03-03-SUMMARY.md
  modified:
    - apps/mobvibe-cli/src/team/team-tool-handlers.ts
    - apps/mobvibe-cli/src/team/team-runtime.ts
    - apps/mobvibe-cli/src/team/team-bridge-stdio.ts
    - apps/mobvibe-cli/src/acp/session-manager.ts
    - apps/mobvibe-cli/src/team/__tests__/team-mcp-router.test.ts
    - apps/mobvibe-cli/src/team/__tests__/team-bridge-stdio.test.ts
    - apps/mobvibe-cli/src/acp/__tests__/session-manager.test.ts

key-decisions:
  - "mobvibe_team_spawn_member 只接受 name/backendId 元数据，拒绝 prompt/body/target/worktree 与调用者身份覆盖字段。"
  - "Spawn member 由 SessionManager 创建普通 ACP session，并复用 leader 的 cwd/workspaceRootCwd/worktreeSourceCwd/worktreeBranch。"
  - "Spawn 失败保留 member slot，使用安全 ErrorDetail 标记 failed/error，而不是回滚成员行。"
  - "普通 member session 的 turn_end 通过 sessionId 映射回 TeamRuntime，完成后发出 projection 更新。"

patterns-established:
  - "Team MCP 工具新增时必须同步 EXPECTED_TEAM_TOOL_NAMES、readiness gate 和 stdio bridge manifest。"
  - "Agent 控制的工具参数不能携带 prompt/body/target 或 per-member worktree；身份始终来自 MCP serverId 绑定。"
  - "Team 成员生命周期副作用集中在 SessionManager，TeamRuntime 只编排工具服务和 projection 通知。"

requirements-completed: [ORCH-03, ORCH-04, ORCH-05, ORCH-06]

duration: 73min
completed: 2026-05-14
---

# Phase 03-team-run Plan 03: Spawn Member Orchestration Summary

**真实 `mobvibe_team_spawn_member` 工具创建普通 member ACP session，并继承 leader 的 team-shared checkout 元数据。**

## Performance

- **Duration:** 73 min
- **Started:** 2026-05-14T04:23:54Z
- **Completed:** 2026-05-14T05:36:28Z
- **Tasks:** 4
- **Files modified:** 7

## Accomplishments

- 新增 `mobvibe_team_spawn_member` 到 Team MCP expected tool set，`tools_ready` 现在要求 spawn 工具也出现在 list-tools 结果中。
- Spawn 工具参数收敛为 metadata-only：仅允许 `name?: string` 与 `backendId?: string`，拒绝调用者身份、prompt/body/target/content 和 per-member worktree 字段。
- `TeamRuntime` 将 spawn tool call 转发到 `SessionManager.spawnAgentTeamMember()`，任意已绑定 leader/member 都可以发起 spawn。
- `SessionManager` 在创建 member session 前先插入 member row；成功时返回 `memberId/sessionId`，失败时保留 failed slot 与安全错误。
- Spawned member 使用普通 ACP session、带 team MCP declaration，并继承 leader 的 execution cwd 与 shared checkout metadata。
- `recordTurnEnd()` 能把非 leader team member 的普通 session turn completion 映射回 `TeamRuntime.onMemberTurnCompleted()`，并发出 Agent Team projection 更新。

## Task Commits

每个 TDD 步骤按 RED/GREEN 拆分提交：

1. **Task 1: Add spawn member tool to team MCP surface**
   - `e53cee7` test: add failing spawn tool surface tests
   - `a5dd467` feat: expose spawn member team tool
2. **Task 2: Implement TeamRuntime spawn orchestration service**
   - `7e0ec8a` test: add failing spawn orchestration router tests
   - `88ae007` feat: route spawn member tool calls
3. **Task 3: Create member ordinary session with inherited shared checkout**
   - `9893845` test: add failing spawned member session tests
   - `0382e71` feat: spawn members on leader shared checkout
4. **Task 4: Map member turn completion back to TeamRuntime**
   - `7d37745` test: add failing team member completion test
   - `455ac56` feat: complete member turn lifecycle mapping

**Plan metadata:** 本 SUMMARY 将单独提交。

## Files Created/Modified

- `apps/mobvibe-cli/src/team/team-tool-handlers.ts` - 注册 spawn tool、解析 metadata-only 参数、拒绝敏感/身份/worktree 字段，并接入 spawn service。
- `apps/mobvibe-cli/src/team/team-runtime.ts` - 将 spawn tool call 转发到 SessionManager，并在 member turn completion 后发出当前 team projection。
- `apps/mobvibe-cli/src/team/team-bridge-stdio.ts` - 同步 dormant stdio bridge manifest，声明 spawn tool 仅接收 `name`/`backendId`。
- `apps/mobvibe-cli/src/acp/session-manager.ts` - 新增 `spawnAgentTeamMember()`，复用 leader shared checkout，失败保留 member slot，并把普通 member turn_end 映射回 TeamRuntime。
- `apps/mobvibe-cli/src/team/__tests__/team-mcp-router.test.ts` - 覆盖 spawn tool readiness、metadata-only args、leader/member 发起 spawn 与拒绝敏感字段。
- `apps/mobvibe-cli/src/team/__tests__/team-bridge-stdio.test.ts` - 覆盖 bridge manifest 的 spawn 参数面。
- `apps/mobvibe-cli/src/acp/__tests__/session-manager.test.ts` - 覆盖 member ordinary session 创建、shared checkout 继承、失败 slot 和 turn completion projection 更新。

## Decisions Made

- Spawn 不实现 per-member worktree；member 复用 leader/team-shared checkout，这是 Phase 3 的安全和范围边界。
- Backend 未传时继承 leader backend；传入 backendId 时先通过 `resolveBackend()` 校验，非法 backend 返回结构化工具错误。
- `TeamRuntime.onMemberTurnCompleted()` 在完成 lifecycle/mailbox 处理后主动 emit 当前 team projection，让 WebUI/Gateway 看到 member completed 状态。

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] 修复 TeamSessionInjector 类型导致的 CLI build 失败**
- **Found during:** Task 4 verification
- **Issue:** `TeamSessionInjector` 新增 `spawnAgentTeamMember` 后，既有测试中的 mailbox-only injector 缺少该方法，`pnpm -C apps/mobvibe-cli build` 失败。
- **Fix:** 将 `spawnAgentTeamMember` 标记为 optional，并在 runtime 中显式处理不可用情况，保持 mailbox-only 注入器兼容。
- **Files modified:** `apps/mobvibe-cli/src/team/team-runtime.ts`
- **Verification:** `pnpm -C apps/mobvibe-cli build` 通过。
- **Committed in:** `455ac56`

**2. [Rule 3 - Blocking] 修复 Bun mock calls tuple 类型构建错误**
- **Found during:** Task 4 verification
- **Issue:** 新增 session-manager 测试直接访问 `mock.calls[1][0]`，TypeScript 在 build 中推断为空 tuple。
- **Fix:** 将该 call 明确收窄为 `unknown[] | undefined`，并保留运行时断言。
- **Files modified:** `apps/mobvibe-cli/src/acp/__tests__/session-manager.test.ts`
- **Verification:** `pnpm -C apps/mobvibe-cli build` 通过。
- **Committed in:** `455ac56`

---

**Total deviations:** 2 auto-fixed（均为 Rule 3 blocking）。
**Impact on plan:** 仅修复当前任务引入的类型/构建阻塞，没有扩大功能范围。

## Issues Encountered

- 首次 Task 4 验证中，`recordTurnEnd()` 尚未调用 TeamRuntime，新增测试保持 RED；随后在 `SessionManager` 中按 `sessionId` 查找 team member 并异步调用 `onMemberTurnCompleted()` 后通过。
- 首次 build 暴露可选 injector 与 Bun mock tuple 类型问题，已在 `455ac56` 中修复。

## Verification

- `pnpm -C apps/mobvibe-cli test -- src/team/__tests__/team-mcp-router.test.ts src/acp/__tests__/acp-connection.test.ts src/acp/__tests__/session-manager.test.ts` → 103 pass, 0 fail。
- `pnpm -C apps/mobvibe-cli build` → Build complete。

## Known Stubs

None - stub scan only found non-UI runtime guard messages and existing test/array initialization patterns; no placeholder data blocks the plan goal.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: team-session-spawn | `apps/mobvibe-cli/src/acp/session-manager.ts` | 新增由 team MCP tool 触发普通 ACP member session 创建的 lifecycle surface；已通过 metadata-only args、serverId caller binding、backend validation、shared checkout inheritance 和 failed slot 记录缓解。 |

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 3 后续 WebUI flow 可以依赖真实 spawn member tool、member ordinary session id、shared checkout metadata 和 failed slot projection。
- Phase 4 生命周期/权限计划可在此基础上补充用户确认、取消/重试/下线与更完整的 permission policy。

## Self-Check: PASSED

- SUMMARY 文件已创建：`.planning/phases/03-team-run/03-03-SUMMARY.md`
- 任务提交已存在：`e53cee7`, `a5dd467`, `7e0ec8a`, `88ae007`, `9893845`, `0382e71`, `7d37745`, `455ac56`
- 未修改 `.planning/STATE.md`、`.planning/ROADMAP.md` 或 `.planning/REQUIREMENTS.md`

---
*Phase: 03-team-run*
*Completed: 2026-05-14*
