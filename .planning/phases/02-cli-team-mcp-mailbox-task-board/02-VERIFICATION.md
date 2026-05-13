---
phase: 02-cli-team-mcp-mailbox-task-board
verified: 2026-05-13T15:42:36Z
status: gaps_found
score: 2/6 must-haves verified
overrides_applied: 0
gaps:
  - truth: "CLI can provide a working CLI-hosted team MCP runtime for team sessions, not just declare one"
    status: failed
    reason: "TeamRuntime/TeamMcpRouter exist and are unit-tested, but production AcpConnection only injects mcpServers declarations; it does not expose or route MCP-over-ACP mcp/connect, mcp/message, list-tools, or tool-call callbacks to TeamMcpRouter. The runtime is therefore unreachable from a real ACP backend."
    artifacts:
      - path: "apps/mobvibe-cli/src/acp/acp-connection.ts"
        issue: "buildClient registers permission/session/terminal handlers only; no MCP handlers or TeamRuntime/TeamMcpRouter reference."
      - path: "apps/mobvibe-cli/src/team/team-runtime.ts"
        issue: "Constructs TeamMcpRouter, but grep shows TeamRuntime is instantiated only in tests."
      - path: "apps/mobvibe-cli/src/team/team-mcp-router.ts"
        issue: "Substantive router exists, but is not wired to production ACP client callbacks."
    missing:
      - "Wire ACP MCP-over-ACP callbacks/messages to TeamMcpRouter in the production connection/session boundary."
      - "Add an integration test that drives the AcpConnection callback path into TeamMcpRouter and TeamToolHandlers."
  - truth: "Safe stdio bridge fallback is executable or otherwise explicitly rejected before selecting stdio_bridge"
    status: failed
    reason: "Bridge-capable backends are selected and receive a stdio declaration, but the declaration points at team-bridge-stdio.js, a module that only exports declaration/manifest builders. It has no executable MCP stdio server entrypoint and no tool-call routing to TeamToolHandlers."
    artifacts:
      - path: "apps/mobvibe-cli/src/team/team-bridge-stdio.ts"
        issue: "Contains buildPerSessionTeamStdioBridge/buildTeamStdioBridgeToolManifest only; no CLI main, stdin/stdout loop, MCP initialize/list-tools/call-tool server, or handler bridge."
      - path: "apps/mobvibe-cli/src/team/team-capability.ts"
        issue: "buildTeamMcpSessionSelection defaults bridgeScriptPath to ./team-bridge-stdio.js and returns stdio_bridge instead of rejecting unavailable bridge runtime."
    missing:
      - "Implement an executable per-session MCP stdio server entrypoint and make the declaration point to it, or reject stdio_bridge with CAPABILITY_NOT_SUPPORTED until implemented."
      - "Add a test that executes or simulates declaration.command + args and verifies MCP initialize/list-tools/call-tool behavior."
  - truth: "Agent tool calls can actually reach durable mailbox and task board tools through production MCP transport"
    status: failed
    reason: "Mailbox and task services are substantive, but because the production MCP transport is not connected to the router, real agent calls cannot reach mobvibe_team_send_message or mobvibe_team_task_* through ACP/bridge."
    artifacts:
      - path: "apps/mobvibe-cli/src/team/mailbox-service.ts"
        issue: "Durable direct service is present, but only reachable through unwired TeamMcpRouter or internal TeamRuntime tests."
      - path: "apps/mobvibe-cli/src/team/task-board-service.ts"
        issue: "Durable direct service is present, but only reachable through unwired TeamMcpRouter or tests."
    missing:
      - "Close the production MCP transport wiring gap so agent-originated tool calls reach TeamToolHandlers."
deferred: []
---

# Phase 2: CLI Team MCP、Mailbox 与 Task Board Verification Report

**Phase Goal:** CLI 本地可以为 team session 提供 `mobvibe_team_*` tools，并把 agent 间消息和任务板持久化为可恢复事实
**Verified:** 2026-05-13T15:42:36Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | CLI 可以为 team run 启动 team MCP server，并生成 MCP-over-ACP per-session declaration 或安全 per-session bridge config。 | ✗ FAILED | Declaration/config builders exist (`team-capability.ts:69-120`, `team-bridge-stdio.ts:49-74`), but production ACP client has no MCP callbacks (`acp-connection.ts:126-166`) and `TeamRuntime` is not instantiated outside tests. Bridge declaration points to a non-executable builder module. |
| 2 | 普通非 team session 的 create path 不包含 `mobvibe-team` MCP server declaration，也不会修改 agent 全局 MCP 配置。 | ✓ VERIFIED | `AcpConnection.buildMcpServers()` returns `[]` when no team declaration is passed (`acp-connection.ts:864-869`). No global config write patterns found in team source. |
| 3 | Backend 不支持 native MCP-over-ACP 且无法安全 bridge 时，用户会得到 team-capable validation error，而不是创建一个不可协作成员。 | ✓ VERIFIED | `resolveTeamMcpTransport()` throws `CAPABILITY_NOT_SUPPORTED` when neither `mcp.acp` nor `mcp.stdio && perSessionBridge` is true (`team-capability.ts:83-96`); `createTeamSession()` builds selection before `connection.createSession()` (`session-manager.ts:1035-1044`). |
| 4 | Agent tool call 可以写入 durable mailbox；message 持久化、read/unread 和 wake status 被分开记录。 | ✗ FAILED | `MailboxService` and store methods are substantive (`mailbox-service.ts:40-64`, `agent-team-store.ts:470-614`), but real agent MCP calls cannot reach them because production MCP routing is not wired. Direct unit tests do not prove production transport reachability. |
| 5 | Agent tool call 可以创建、列出和更新 durable task board，包含 owner、status 和 blockedBy/blocks。 | ✗ FAILED | `TaskBoardService` and task graph store methods are substantive (`task-board-service.ts:36-126`, `agent-team-store.ts:357-468`), but real agent MCP calls cannot reach them because production MCP routing is not wired. |
| 6 | Team MCP tools 携带 caller identity，并按 Phase 2 context 的 tool policy 执行。 | ✗ FAILED | Router-level caller binding rejects arg-controlled identity (`team-mcp-router.ts:104-144`), and context D-07/D-08 intentionally removes leader-only/confirmation gates; however the binding is unreachable from production MCP callbacks, so the observable production tool path does not carry verified caller identity. |

**Score:** 2/6 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `apps/mobvibe-cli/src/team/team-capability.ts` | Native/bridge capability selection and declaration helpers | ✓ VERIFIED | Substantive helpers generate `mobvibe-team:<agentTeamId>:<memberId>`, native ACP declaration, stdio_bridge selection, and unsupported errors. |
| `packages/shared/src/types/session.ts` | `AgentSessionCapabilities.mcp` shape | ✓ VERIFIED | Plan-consumed capability shape is used by `team-capability.ts` and `acp-connection.ts`. |
| `apps/mobvibe-cli/src/team/team-runtime.ts` | Team runtime composition and wake orchestration | ⚠️ ORPHANED | Substantive, but production code does not instantiate it; grep found usage only in tests and its own file. |
| `apps/mobvibe-cli/src/team/team-mcp-router.ts` | MCP connect/list-tools/tool-call router | ⚠️ ORPHANED | Substantive router exists, but no production ACP bridge calls it. |
| `apps/mobvibe-cli/src/team/team-tool-handlers.ts` | Five `mobvibe_team_*` handlers | ✓ SUBSTANTIVE / ⚠️ UNREACHABLE | Handlers dispatch mailbox/task tools, but production MCP transport cannot invoke them. |
| `apps/mobvibe-cli/src/team/mailbox-service.ts` | Durable mailbox send/read/wake support | ✓ VERIFIED | Writes via `AgentTeamStore.createMailboxMessages`; body stays in `body_local_json`. |
| `apps/mobvibe-cli/src/team/task-board-service.ts` | Durable task board create/list/update | ✓ VERIFIED | Implements statuses, owner resolution, dependency fields and DTOs. |
| `apps/mobvibe-cli/src/team/team-bridge-stdio.ts` | Per-session stdio bridge fallback | ✗ STUB/HOLLOW | Builds declarations and a manifest only; no executable MCP stdio server entrypoint or handler routing. |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | --- | --- | ------ | ------- |
| `session-manager.ts` | `team-capability.ts` | `buildTeamMcpSessionSelection()` before create | ✓ WIRED | `session-manager.ts:1035-1044` selects declaration before `connection.createSession()`. |
| `acp-connection.ts` | ACP session/new/load payload | `mcpServers: this.buildMcpServers(options)` | ✓ WIRED | `acp-connection.ts:389-393`, `857-869`. |
| ACP MCP callbacks | `TeamMcpRouter` | `mcp/connect` / `mcp/message` / list-tools / call-tool | ✗ NOT_WIRED | `buildClient()` has no MCP handlers; grep found router calls only in tests. |
| `TeamMcpRouter` | `TeamToolHandlers` | `handlers.dispatch()` with bound caller | ✓ WIRED (unit path only) | `team-mcp-router.ts:76-87` dispatches with binding. |
| `TeamToolHandlers` | `MailboxService` | `handleSendMessage()` | ✓ WIRED | `team-tool-handlers.ts:165-178`. |
| `TeamToolHandlers` | `TaskBoardService` | task create/list/update handlers | ✓ WIRED | `team-tool-handlers.ts:135-163`. |
| `team-capability.ts` | `team-bridge-stdio.ts` | stdio_bridge fallback declaration | ⚠️ PARTIAL | Selection is wired, but points to a non-executable module. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| `mailbox-service.ts` | `deliveries` | `AgentTeamStore.createMailboxMessages()` SQLite insert | Yes | ✓ FLOWING in direct service/router tests; production MCP entry still blocked. |
| `task-board-service.ts` | `task/tasks` | `AgentTeamStore.createTeamTask/listLocalTasks/updateTeamTask()` SQLite operations | Yes | ✓ FLOWING in direct service/router tests; production MCP entry still blocked. |
| `projection-builder.ts` | mailbox/task counts and source refs | Store projection SELECTs that omit `body_local_json` | Yes | ✓ FLOWING / projection-safe. |
| `team-bridge-stdio.ts` | tool manifest/declaration | Static manifest and command args | No runtime tool call source | ✗ HOLLOW — config exists, executable behavior missing. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Targeted CLI phase tests | `pnpm -C apps/mobvibe-cli test -- src/team/__tests__/team-mcp-router.test.ts src/team/__tests__/team-bridge-stdio.test.ts src/acp/__tests__/session-manager.test.ts` | `73 pass, 0 fail, 161 expect() calls` | ✓ PASS (unit-level only) |
| Production MCP router reachability | grep for `TeamRuntime\|mcpRouter\|handleConnect\|handleToolCall\|mcp/message\|mcp/connect` under `apps/mobvibe-cli/src` | Production matches only define classes; router calls are in tests | ✗ FAIL |
| Probe discovery | `scripts/**/tests/probe-*.sh` and phase plan/summary grep | No probe files or declarations found | ? SKIPPED (no probes) |

### Probe Execution

| Probe | Command | Result | Status |
| ----- | ------- | ------ | ------ |
| none | Conventional and phase-declared probe discovery | No probes found | SKIPPED |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ---------- | ----------- | ------ | -------- |
| MCP-01 | 02-02 | CLI can start/restore team MCP server and expose `mobvibe_team_*` tools | ✗ BLOCKED | Router/tools exist but production ACP transport cannot reach them; no real server start/restore path verified. |
| MCP-02 | 02-01, 02-02 | Team tools injected through ACP per-session declaration | ⚠️ PARTIAL | Declarations are injected for team create/load, but MCP callback runtime is missing. |
| MCP-03 | 02-02 | Ordinary sessions do not contain `mobvibe-team` | ✓ SATISFIED | `buildMcpServers()` returns empty list unless explicit team declaration is passed. |
| MCP-04 | 02-01, 02-06 | Non-native fallback only safe per-session bridge; no global config mutation | ✗ BLOCKED | No global config mutation found, but selected stdio bridge is not executable, so safe fallback is not actually delivered. |
| MCP-05 | 02-01, 02-06 | Validate backend support before autonomous member/session creation | ✓ SATISFIED | Unsupported branch throws `CAPABILITY_NOT_SUPPORTED` before create. |
| MCP-06 | 02-02, 02-06 | Persist/display MCP readiness phases | ⚠️ PARTIAL | Router persists readiness, including transport, but production runtime cannot receive MCP list-tools events. |
| MCP-07 | 02-02, 02-03, 02-05 | Verified caller identity and tool policy | ✗ BLOCKED | Router-level identity binding exists, with D-07/D-08 context policy, but is not wired to production MCP path. |
| COORD-01 | 02-03 | Durable mailbox send message | ✗ BLOCKED | Store/service works, but agent-originated MCP tool path is unreachable in production. |
| COORD-02 | 02-03, 02-04 | Mailbox sender/recipient/read/wake metadata and source refs | ⚠️ PARTIAL | Store/read/wake metadata exist; wake failure retry semantics are weak (read before injection), and production tool reachability is blocked. |
| COORD-03 | 02-05 | Durable task board create/list/update with owner/status/deps | ✗ BLOCKED | Store/service works, but agent-originated MCP tool path is unreachable in production. |
| COORD-04 | 02-03, 02-04, 02-05 | No mailbox/task body in Gateway-facing projection | ✓ SATISFIED | Projection SELECTs omit `body_local_json`; `buildAgentTeamSummary()` uses metadata rows only. |

No additional Phase 2 requirement IDs were found in `.planning/REQUIREMENTS.md` beyond the IDs claimed by the plans.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| `apps/mobvibe-cli/src/team/team-bridge-stdio.ts` | 30-42 | Manifest/schema mismatch | ⚠️ Warning | Manifest omits supported `task_create.status` and `task_update.title/description`, and includes ignored `blocks`; not the primary blocker because the bridge executable is absent. |
| `apps/mobvibe-cli/src/team/team-runtime.ts` | 59-91 | Wake marks read before successful injection | ⚠️ Warning | Failed wake rows are marked read, so automatic retry through `readUnreadAndMark()` will not pick them up. Delivery remains durable, but retry semantics are fragile. |

Debt marker scan for `TODO|FIXME|XXX|PLACEHOLDER|coming soon|not implemented|not available|console.log` under modified team source returned no matches.

### Human Verification Required

None. The blocking gaps are observable in source wiring; no visual/external-service human check is needed before returning gaps.

### Gaps Summary

Phase 2 does not yet achieve the stated goal. The durable mailbox and task board implementation exists and unit tests pass, but the production ACP/MCP transport does not route MCP requests into the team runtime. Additionally, the stdio bridge fallback is selected as if usable while only a declaration/manifest builder exists. These are BLOCKER gaps because real team sessions can receive a `mobvibe-team` declaration yet have no working production path for agent calls to list or call `mobvibe_team_*` tools.

---

_Verified: 2026-05-13T15:42:36Z_
_Verifier: the agent (gsd-verifier)_
