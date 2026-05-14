---
phase: 02-cli-team-mcp-mailbox-task-board
plan: 07
subsystem: cli-team-mcp-runtime
tags: [typescript, acp, mcp, mobvibe-cli, gap-closure, bun-test]

requires:
  - phase: 02-cli-team-mcp-mailbox-task-board
    provides: Durable mailbox/task board services and native MCP declaration/runtime units from 02-01 through 02-06
provides:
  - Production ACP extension callback adapter for `mcp/connect`, `mcp/message`, and `mcp/disconnect`
  - SessionManager-owned TeamRuntime wired into native team ACP sessions
  - Explicit rejection of non-executable `stdio_bridge` fallback before team session creation
  - Callback-path tests proving mailbox and task tools mutate durable team facts without leaking plaintext into projections
affects: [team-session-creation, acp-mcp-callbacks, mailbox, task-board, mcp-readiness]

tech-stack:
  added: []
  patterns:
    - ACP SDK extension methods are normalized at `acp-connection.ts` only.
    - Caller identity remains router-bound by `mobvibe-team:<agentTeamId>:<memberId>` server id.
    - `stdio_bridge` helper code is dormant until a real executable MCP stdio server exists.

key-files:
  created:
    - .planning/phases/02-cli-team-mcp-mailbox-task-board/02-07-SUMMARY.md
  modified:
    - apps/mobvibe-cli/src/acp/acp-connection.ts
    - apps/mobvibe-cli/src/acp/session-manager.ts
    - apps/mobvibe-cli/src/team/team-capability.ts
    - apps/mobvibe-cli/src/team/team-bridge-stdio.ts
    - apps/mobvibe-cli/src/acp/__tests__/acp-connection.test.ts
    - apps/mobvibe-cli/src/acp/__tests__/session-manager.test.ts
    - apps/mobvibe-cli/src/team/__tests__/team-capability.test.ts
    - apps/mobvibe-cli/src/team/__tests__/team-bridge-stdio.test.ts

key-decisions:
  - "Production selection now requires native MCP-over-ACP; bridge-capable-only backends fail with `CAPABILITY_NOT_SUPPORTED` until an executable stdio server exists."
  - "AcpConnection owns a narrow Mobvibe adapter for current RFD MCP callback/message shapes instead of spreading casts through team runtime code."
  - "SessionManager constructs one TeamRuntime on the CLI WAL DB path and passes its router into team ACP sessions."

patterns-established:
  - "Callback adapter: `mcp/connect` binds server id, `mcp/message` routes list-tools/tool-call, and `mcp/disconnect` clears binding."
  - "Production proof tests drive AcpConnection adapter calls into TeamRuntime and inspect durable AgentTeamStore projections."

requirements-completed: [MCP-01, MCP-02, MCP-04, MCP-06, MCP-07, COORD-01, COORD-03]

duration: 39 min
completed: 2026-05-13T17:25:48Z
---

# Phase 02 Plan 07: Verification Gap Closure Summary

Phase 2 的阻断 verification gaps 已按最小安全路径关闭：native ACP callback path 现在可以进入 TeamRuntime，`stdio_bridge` 在没有可执行 server 前不再被生产选择。

## Accomplishments

- 在 `AcpConnection` 增加 `TeamMcpCallbackHandlers` 与 extension adapter，处理 `mcp/connect`、`mcp/message`、`mcp/disconnect`。
- 支持当前需要的 MCP message shape：list-tools 读取 `toolNames` / `tools[].name`，tool-call 读取 `toolName` / `name` 与 `args` / `arguments`。
- `SessionManager` 现在用同一 WAL DB path 创建 `AgentTeamStore` + `TeamRuntime`，team session 创建时把 `teamMcpTransport` 和 `teamMcpHandlers` 传给 ACP connection。
- `team-capability.ts` 不再选择 `stdio_bridge`，bridge-only backend 会在 session creation 前抛出 `CAPABILITY_NOT_SUPPORTED`。
- 对齐 dormant `team-bridge-stdio.ts` manifest：`task_create.status`、`task_update.title/description` 已列出，`task_list` 不暴露无效参数，`blocks` 不再暴露。
- 新增 callback-path 集成测试，证明 mailbox send、task create/list/update 通过 `AcpConnection` adapter 写入 durable store，并且 projection 不包含 mailbox/task plaintext。

## TDD Evidence

- RED 1: `team-capability` / `team-bridge-stdio` 测试失败，暴露当前会返回 `stdio_bridge` 且 manifest 参数不一致。
- GREEN 1: 生产 selection 改为 native-only，manifest 对齐真实 task parser surface。
- RED 2: `acp-connection` / `session-manager` 测试失败，暴露缺少 `handleTeamMcpExtensionMethod` 与 router callbacks 传递。
- GREEN 2: ACP adapter 和 SessionManager-owned TeamRuntime wiring 实现后，相关测试通过。

## Verification

- `pnpm -C apps/mobvibe-cli test -- src/acp/__tests__/acp-connection.test.ts src/acp/__tests__/session-manager.test.ts src/team/__tests__/team-capability.test.ts src/team/__tests__/team-bridge-stdio.test.ts src/team/__tests__/team-mcp-router.test.ts src/team/__tests__/mailbox-service.test.ts src/team/__tests__/task-board-service.test.ts` -> PASS, `118 pass`, `0 fail`, `300 expect() calls`.
- `pnpm -C apps/mobvibe-cli build` -> PASS, `Build complete!`.
- `pnpm -C apps/mobvibe-cli lint` -> PASS, `No fixes applied`.
- `test "$(grep -v '^#' apps/mobvibe-cli/src/team/team-capability.ts | grep -c 'return "stdio_bridge"')" -eq 0` -> PASS.
- `test "$(grep -v '^#' apps/mobvibe-cli/src/team/team-capability.ts | grep -c 'fileURLToPath(new URL("./team-bridge-stdio.js"')" -eq 0` -> PASS.
- `test "$(grep -v '^#' apps/mobvibe-cli/src/acp/acp-connection.ts | grep -c 'TeamMcp')" -ge 1` -> PASS.

## Deviations From Plan

- 未实现 stdio MCP server executable；按计划采用安全拒绝路径。
- 没有引入新的 Gateway projection emitter；本 gap closure 复用现有 `AgentTeamStore.getAgentTeam()` projection，并在 callback-path 测试中验证 plaintext 不出现在 projection payload 中。

## Risks And Follow-Up

- ACP MCP RFD message shapes未来如果稳定为更严格 schema，需要把当前 adapter parser 收敛到正式 SDK 类型。
- `TeamRuntime.wakeMember()` 的失败重试语义仍是 02-REVIEW 的 warning，不属于本次 blocker gap closure 范围。

## User Setup Required

None.
