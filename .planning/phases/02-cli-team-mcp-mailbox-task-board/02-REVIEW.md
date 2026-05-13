---
phase: 02-cli-team-mcp-mailbox-task-board
reviewed: 2026-05-13T15:34:40Z
depth: standard
files_reviewed: 25
files_reviewed_list:
  - apps/mobvibe-cli/package.json
  - packages/shared/src/types/session.ts
  - packages/shared/src/types/agent-team.ts
  - apps/mobvibe-cli/src/acp/acp-connection.ts
  - apps/mobvibe-cli/src/acp/session-manager.ts
  - apps/mobvibe-cli/src/team/team-capability.ts
  - apps/mobvibe-cli/src/team/team-bridge-stdio.ts
  - apps/mobvibe-cli/src/team/team-runtime.ts
  - apps/mobvibe-cli/src/team/team-mcp-router.ts
  - apps/mobvibe-cli/src/team/team-tool-handlers.ts
  - apps/mobvibe-cli/src/team/agent-team-store.ts
  - apps/mobvibe-cli/src/team/mailbox-service.ts
  - apps/mobvibe-cli/src/team/task-board-service.ts
  - apps/mobvibe-cli/src/team/projection-builder.ts
  - apps/mobvibe-cli/src/wal/migrations.ts
  - apps/mobvibe-cli/src/daemon/socket-client.ts
  - apps/mobvibe-cli/src/acp/__tests__/acp-connection.test.ts
  - apps/mobvibe-cli/src/acp/__tests__/session-manager.test.ts
  - apps/mobvibe-cli/src/team/__tests__/team-capability.test.ts
  - apps/mobvibe-cli/src/team/__tests__/team-mcp-router.test.ts
  - apps/mobvibe-cli/src/team/__tests__/mailbox-service.test.ts
  - apps/mobvibe-cli/src/team/__tests__/task-board-service.test.ts
  - apps/mobvibe-cli/src/team/__tests__/projection-builder.test.ts
  - apps/mobvibe-cli/src/team/__tests__/team-bridge-stdio.test.ts
  - apps/mobvibe-cli/src/daemon/__tests__/socket-client.test.ts
findings:
  critical: 2
  warning: 2
  info: 0
  total: 4
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-05-13T15:34:40Z
**Depth:** standard
**Files Reviewed:** 25
**Status:** issues_found

## Summary

审查了 Phase 02 的计划/总结、AGENTS 约束，以及计划 frontmatter 中列出的 CLI MCP/team mailbox/task-board 源码与测试。实现中存在会阻止 Phase 2 运行时生效的阻断问题：team MCP router 只在测试中被直接调用，生产 ACP 连接没有把 RFD MCP 请求接到该 router；stdio bridge fallback 也只生成了一个指向普通 TypeScript 模块的声明，而不是可运行 MCP stdio server。另有 wake 重试与 bridge manifest 一致性风险。

## Critical Issues

### CR-01: BLOCKER - Team MCP router/runtime 没有接入生产 ACP 连接

**File:** `apps/mobvibe-cli/src/acp/acp-connection.ts:126-166`, `apps/mobvibe-cli/src/acp/acp-connection.ts:857-860`, `apps/mobvibe-cli/src/team/team-runtime.ts:46-49`

**Issue:** Phase 2 声称实现 native MCP-over-ACP runtime，但生产 `AcpConnection` 的 `buildClient()` 只注册 permission/session/terminal handlers，没有任何 `mcp/connect`、`mcp/message`、list-tools 或 tool-call 分发入口。`createSessionInternal()` 仅把 `mcpServers` declaration 注入 ACP payload；`TeamRuntime` 虽然创建了 `TeamMcpRouter`，但没有被 `AcpConnection` 或 `SocketClient` 持有/调用。现有测试直接 new `TeamMcpRouter` 并调用 `handleConnect`/`handleToolCall`，无法证明真实 ACP backend 发来的 MCP 请求会到达 `TeamToolHandlers`。结果是 team session 可以被声明为带 `mobvibe-team` server，但 tools 无法在生产路径响应，`tools_ready`、mailbox、task board 行为都是不可达的。

**Fix:** 在 ACP client 边界显式接入 team runtime，例如把 `TeamRuntime`/`TeamMcpRouter` 作为 `AcpConnection` 或 `SessionManager.createTeamSession` 的 team option，并在 SDK/RFD 支持的 MCP handler 中路由真实请求：

```ts
const buildClient = (handlers: ClientHandlers): Client => ({
  // existing handlers...
  async mcpConnect(params) {
    return handlers.onTeamMcpConnect?.(params);
  },
  async mcpMessage(params) {
    return handlers.onTeamMcpMessage?.(params);
  },
});

// createTeamSession should bind the selected declaration/server id to TeamRuntime
// and tests should drive the same AcpConnection callback path instead of calling
// TeamMcpRouter directly.
```

如果当前 ACP SDK 没有可用 callback 类型，应新增 Mobvibe-owned RFD adapter 层，并添加集成测试：ACP connection receives MCP request → router binding → `mobvibe_team_*` handler → store mutation/projection event。

### CR-02: BLOCKER - stdio bridge fallback 声明指向的脚本不是 MCP stdio server

**File:** `apps/mobvibe-cli/src/team/team-capability.ts:114-119`, `apps/mobvibe-cli/src/team/team-bridge-stdio.ts:1-91`, `apps/mobvibe-cli/src/acp/session-manager.ts:1036-1044`

**Issue:** 当 backend 只有 `mcp.stdio && perSessionBridge` 时，`buildTeamMcpSessionSelection()` 会选择 `stdio_bridge` 并默认把 `bridgeScriptPath` 设为 `./team-bridge-stdio.js`。但 `team-bridge-stdio.ts` 只导出 declaration/manifest builder，没有 CLI entrypoint、没有解析 `--agent-team-id`/`--member-id`、没有 MCP stdio server loop，也没有把 stdio tool calls 路由到 `TeamToolHandlers`。`SessionManager.createTeamSession()` 会把这个声明传给 ACP backend，backend 若真的启动它，只会运行一个无副作用模块并退出，导致 bridge-capable backend 被误判为可用但实际无法提供 team tools。

**Fix:** 二选一：

```ts
// Option A: 真正实现可执行 bridge entrypoint，并让 declaration 指向该 entrypoint
command: process.execPath,
args: [bridgeEntrypointPath, "--agent-team-id", input.agentTeamId, "--member-id", input.memberId]
```

该 entrypoint 必须启动 MCP stdio server，注册五个 `mobvibe_team_*` tools，并把调用发送回当前 CLI runtime/store。或：

```ts
// Option B: 在 bridge server 未实现前不要选择 stdio_bridge
if (transport === "stdio_bridge") {
  throw createCapabilityNotSupportedError();
}
```

同时补一条测试，执行/模拟 declaration.command + args 所指模块，断言它实际提供 MCP initialize/list-tools/call-tool，而不只是检查 declaration shape。

## Warnings

### WR-01: WARNING - Wake 失败前已把消息标记为 read，后续 wakeMember 不会重试失败投递

**File:** `apps/mobvibe-cli/src/team/team-runtime.ts:59-91`, `apps/mobvibe-cli/src/team/agent-team-store.ts:554-574`

**Issue:** `wakeMember()` 先调用 `readUnreadAndMark()`，该方法在同一事务中立即设置 `read_at`，随后才执行 ordinary session prompt injection。若 injection 抛错，代码只把 `wake_status` 改成 `failed`；下一次 `wakeMember()` 仍然只查询 `read_at IS NULL`，因此这些 `failed` 消息不会再被自动重试。测试只验证 row 仍存在，没有覆盖“失败后重试”的行为。这会让临时 ACP prompt 故障变成永久未送达，降低 mailbox wake 的可靠性。

**Fix:** 要么只在 prompt 成功后标记 read，要么把 wake retry 查询条件改为包含 `wake_status = 'failed'` / `pending` 的可重试 rows，并在达到重试上限后显式停止。示例：

```ts
// read for delivery without marking first
const messages = this.store.listWakePendingMessages(agentTeamId, memberId);
try {
  const sessionRef = await this.sessionManager.injectTeamMailboxPrompt(...);
  this.store.markReadAndUpdateWakeSuccess(messages, sessionRef);
} catch (error) {
  this.store.updateWakeFailure(messages, toSafeWakeError(error));
}
```

并新增测试：第一次 injection 失败后第二次 `wakeMember()` 成功时，同一消息被注入并从 `failed`/unread-pending 状态转为 `sent`。

### WR-02: WARNING - stdio bridge tool manifest 与实际 task tool 参数不一致

**File:** `apps/mobvibe-cli/src/team/team-bridge-stdio.ts:30-42`, `apps/mobvibe-cli/src/team/task-board-service.ts:148-181`

**Issue:** `TaskBoardService` 的真实 parser 接受 `task_create.status`，以及 `task_update.title` / `task_update.description`；但 bridge manifest 对 `mobvibe_team_task_create` 没有列出 `status`，对 `mobvibe_team_task_update` 没有列出 `title`/`description`，反而列出 parser 完全忽略的 `blocks`。如果 bridge entrypoint 用该 manifest 生成 schema，bridge 用户将无法发现/提交实际支持的字段，或会提交无效字段而被静默忽略。

**Fix:** 让 manifest 由实际 parser/schema 单一来源生成，至少先手动对齐：

```ts
const toolInputKeys: Record<TeamToolName, string[]> = {
  mobvibe_team_send_message: ["to", "message", "summary"],
  mobvibe_team_members: [],
  mobvibe_team_task_create: ["title", "description", "owner", "status", "blockedBy"],
  mobvibe_team_task_list: [],
  mobvibe_team_task_update: ["taskId", "status", "owner", "title", "description", "blockedBy"],
};
```

同时添加 manifest 参数级测试，断言每个 manifest key 与 `parseCreateArgs`/`parseUpdateArgs` 支持字段一致，并断言未知字段（如 `blocks`）不会出现在 manifest 中。

---

_Reviewed: 2026-05-13T15:34:40Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
