---
phase: 03-team-run
plan: 02
subsystem: cli-orchestration
tags: [agent-team, acp, mcp, worktree, socket, sqlite, bun]

requires:
  - phase: 03-team-run
    provides: [Agent Team create contract with worktree metadata]
  - phase: 02-team-mcp-mailbox-task
    provides: [Team MCP router, durable AgentTeamStore, mailbox/task projection boundary]
provides:
  - CLI rpc:agent-team:create now creates a durable team run and leader ordinary ACP session
  - Leader team sessions inject per-session Team MCP and wait for tools_ready before success
  - Team-shared worktree metadata is preserved for leader and reusable by future members
  - SessionManager emits safe Agent Team projection changes for SocketClient relay
affects: [03-team-run, cli, agent-team-runtime, webui-create-flow]

tech-stack:
  added: []
  patterns:
    - SessionManager-owned Agent Team orchestration
    - Narrow AgentTeamStore runtime update methods
    - Shared session execution context for ordinary/team worktree sessions

key-files:
  created: []
  modified:
    - apps/mobvibe-cli/src/team/agent-team-store.ts
    - apps/mobvibe-cli/src/team/__tests__/agent-team-store.test.ts
    - apps/mobvibe-cli/src/acp/session-manager.ts
    - apps/mobvibe-cli/src/acp/__tests__/session-manager.test.ts
    - apps/mobvibe-cli/src/daemon/socket-client.ts
    - apps/mobvibe-cli/src/daemon/__tests__/socket-client.test.ts

key-decisions:
  - "SessionManager owns Agent Team create/start orchestration so durable store updates, ordinary session events, and Team MCP callbacks share one source of truth."
  - "Team-shared worktree keeps workspaceRootCwd/worktreeSourceCwd pointed at the source repo root while cwd points at the execution checkout."
  - "Team create failures use existing shared ErrorCode values while preserving safe failure metadata on the leader member projection."

patterns-established:
  - "AgentTeamStore exposes narrow runtime update methods instead of raw SQL access."
  - "SocketClient delegates rpc:agent-team:create to SessionManager and relays SessionManager Agent Team changed events."

requirements-completed: [ORCH-01, ORCH-02, ORCH-04, ORCH-05, ORCH-06]

duration: 17min
completed: 2026-05-14
---

# Phase 03-team-run Plan 02: CLI create/start leader Summary

**CLI Agent Team create 现在会创建 durable team/member 状态、启动 leader ordinary ACP session、注入 Team MCP 并等待 tools_ready 后返回 team + leaderSession。**

## Performance

- **Duration:** 17 min
- **Started:** 2026-05-14T04:00:43Z
- **Completed:** 2026-05-14T04:17:32Z
- **Tasks:** 4
- **Files modified:** 6

## Accomplishments

- `AgentTeamStore` 新增 team lifecycle 与 member runtime 窄更新方法，可一起更新 `sessionId`、`lifecycle`、`health`、safe error 和 worktree 元数据。
- `SessionManager.createTeamSession()` 复用 ordinary session worktree 解析语义，并支持 future member 复用已解析 execution context，不会重复创建 worktree。
- `SessionManager.createAgentTeamRun()` 负责创建 team/leader rows、启动 leader ACP session、等待 Team MCP `tools_ready`，并在失败时保留可审计 failed projection。
- `SocketClient` 的 `rpc:agent-team:create` 已改为调用 `SessionManager.createAgentTeamRun()`，并 relay SessionManager 发出的 Agent Team projection changes。

## Task Commits

Each task was committed atomically:

1. **Task 1: Add AgentTeamStore runtime update methods**
   - `01133e1` test: add failing tests for team runtime updates
   - `2b219a4` feat: implement team runtime state updates
2. **Task 2: Extend createTeamSession for team-shared worktree metadata**
   - `f1114bf` test: add failing tests for team worktree sessions
   - `507f2f4` feat: support shared worktree team sessions
3. **Task 3: Implement SessionManager.createAgentTeamRun**
   - `a9eddff` test: add failing tests for agent team run creation
   - `cb04499` feat: create agent team runs with ready leader
4. **Task 4: Wire SocketClient Agent Team create RPC to SessionManager**
   - `ca00fd1` test: add failing tests for team create RPC wiring
   - `4b79cbc` feat: wire agent team create RPC to sessions

**Build/lint fix:** `60a5579` fix: satisfy CLI build for team run errors

## Files Created/Modified

- `apps/mobvibe-cli/src/team/agent-team-store.ts` - 增加 team/member runtime update API，并触发 team updated timestamp。
- `apps/mobvibe-cli/src/team/__tests__/agent-team-store.test.ts` - 覆盖 successful/failed leader runtime projection，确认 forbidden plaintext keys 不泄漏。
- `apps/mobvibe-cli/src/acp/session-manager.ts` - 增加共享 execution context、Agent Team changed event、`createAgentTeamRun()` orchestration 和 MCP readiness timeout。
- `apps/mobvibe-cli/src/acp/__tests__/session-manager.test.ts` - 覆盖 leader worktree、member context reuse、createAgentTeamRun 成功/失败/unsupported MCP 行为。
- `apps/mobvibe-cli/src/daemon/socket-client.ts` - 将 create RPC 接到 SessionManager，并 relay Agent Team changed events。
- `apps/mobvibe-cli/src/daemon/__tests__/socket-client.test.ts` - 覆盖 create RPC 返回 leaderSession 与 projection relay。

## Decisions Made

- SessionManager 是 create/start leader 的唯一 orchestration owner，避免 SocketClient 和 TeamRuntime 各自持有不一致的 store/source of truth。
- Team-shared worktree 不改变 workspace grouping：`cwd` 指向执行 checkout，`workspaceRootCwd` 和 `worktreeSourceCwd` 保持 source repo root。
- 失败 projection 使用已有 shared error code（如 `INTERNAL_ERROR` / `SESSION_NOT_READY`）以保持 shared contract build 通过，同时 message 保留具体失败原因。

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] 修复 shared ErrorCode 与测试 mock 类型导致的 CLI build failure**
- **Found during:** Overall verification after Task 4
- **Issue:** `TEAM_CREATE_FAILED` / `TEAM_MCP_NOT_READY` 不是 shared `ErrorCode` 联合类型成员；一个 Bun mock implementation 参数也触发隐式 `any` / 函数签名不匹配。
- **Fix:** 改用已有 `INTERNAL_ERROR` 和 `SESSION_NOT_READY` code，并把测试 mock 参数收窄为 `unknown[]` 后显式 narrowing。
- **Files modified:** `apps/mobvibe-cli/src/acp/session-manager.ts`, `apps/mobvibe-cli/src/acp/__tests__/session-manager.test.ts`, `apps/mobvibe-cli/src/daemon/__tests__/socket-client.test.ts`
- **Verification:** `pnpm -C apps/mobvibe-cli build` passed; targeted Bun tests passed.
- **Committed in:** `60a5579`

---

**Total deviations:** 1 auto-fixed (Rule 3)
**Impact on plan:** 只修复类型/构建阻塞问题；未改变计划目标或引入额外架构。

## Issues Encountered

- 初次 `pnpm -C apps/mobvibe-cli build` 暴露 shared error code 不匹配和测试 mock 参数类型问题；已在 `60a5579` 修复。

## Verification

- `pnpm -C apps/mobvibe-cli test -- src/acp/__tests__/session-manager.test.ts src/daemon/__tests__/socket-client.test.ts src/team/__tests__/agent-team-store.test.ts` → 84 pass, 0 fail
- `pnpm -C apps/mobvibe-cli build` → Build complete
- `pnpm lint` → 6/6 packages successful, no fixes applied on final run
- `pnpm build` → 6/6 packages successful（仅现有 webui/website bundle warning）

## Known Stubs

None.

## Threat Flags

None - new create/start and projection relay surfaces are covered by this plan's threat model.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- WebUI can now rely on CLI create RPC returning `team + leaderSession` once Team MCP tools are ready.
- Plan 03-03 can add real member spawn/member orchestration on top of SessionManager-owned store/runtime state.
- Plan 03-04/03-05 can use Agent Team changed events for WebUI projection refresh and target delivery follow-up.

## Self-Check: PASSED

- Summary file exists at `.planning/phases/03-team-run/03-02-SUMMARY.md`.
- Task commits recorded above exist in git history.
- Final verification commands listed above passed.

---
*Phase: 03-team-run*
*Completed: 2026-05-14*
