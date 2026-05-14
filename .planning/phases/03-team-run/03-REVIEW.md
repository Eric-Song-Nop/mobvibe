---
phase: 03-team-run
reviewed: 2026-05-14T06:28:13Z
depth: standard
files_reviewed: 42
files_reviewed_list:
  - apps/gateway/src/routes/__tests__/agent-teams.test.ts
  - apps/gateway/src/routes/agent-teams.ts
  - apps/mobvibe-cli/src/acp/__tests__/session-manager.test.ts
  - apps/mobvibe-cli/src/acp/session-manager.ts
  - apps/mobvibe-cli/src/daemon/__tests__/socket-client.test.ts
  - apps/mobvibe-cli/src/daemon/socket-client.ts
  - apps/mobvibe-cli/src/team/__tests__/agent-team-store.test.ts
  - apps/mobvibe-cli/src/team/__tests__/team-bridge-stdio.test.ts
  - apps/mobvibe-cli/src/team/__tests__/team-mcp-router.test.ts
  - apps/mobvibe-cli/src/team/agent-team-store.ts
  - apps/mobvibe-cli/src/team/team-bridge-stdio.ts
  - apps/mobvibe-cli/src/team/team-runtime.ts
  - apps/mobvibe-cli/src/team/team-tool-handlers.ts
  - apps/webui/src/__tests__/app-session-restore.test.tsx
  - apps/webui/src/app/MainLayout.tsx
  - apps/webui/src/app/SessionWorkspace.tsx
  - apps/webui/src/app/use-main-app-controller.tsx
  - apps/webui/src/components/app/AppSidebar.tsx
  - apps/webui/src/components/app/CreateSessionDialog.tsx
  - apps/webui/src/components/app/__tests__/CreateSessionDialog.test.tsx
  - apps/webui/src/components/session/SessionSidebar.tsx
  - apps/webui/src/components/team/AgentTeamOverview.tsx
  - apps/webui/src/components/team/__tests__/AgentTeamOverview.test.tsx
  - apps/webui/src/hooks/__tests__/useSessionHandlers.test.tsx
  - apps/webui/src/hooks/__tests__/useSessionList.test.tsx
  - apps/webui/src/hooks/__tests__/useSessionMutations.test.tsx
  - apps/webui/src/hooks/__tests__/useSessionQueries.test.tsx
  - apps/webui/src/hooks/__tests__/useSocket.test.tsx
  - apps/webui/src/hooks/useSessionHandlers.ts
  - apps/webui/src/hooks/useSessionList.ts
  - apps/webui/src/hooks/useSessionMutations.ts
  - apps/webui/src/hooks/useSessionQueries.ts
  - apps/webui/src/hooks/useSocket.ts
  - apps/webui/src/i18n/locales/en/translation.json
  - apps/webui/src/i18n/locales/zh/translation.json
  - apps/webui/src/lib/__tests__/api.test.ts
  - apps/webui/src/lib/api.ts
  - apps/webui/src/lib/ui-store.ts
  - apps/webui/src/lib/workspace-utils.ts
  - apps/webui/tests/session-sidebar.test.tsx
  - packages/shared/src/types/agent-team.ts
  - packages/shared/tests/agent-team.contract.test.ts
findings:
  critical: 1
  warning: 2
  info: 0
  total: 3
status: issues_found
---

# Phase 03: Code Review Report

**Reviewed:** 2026-05-14T06:28:13Z
**Depth:** standard
**Files Reviewed:** 42
**Status:** issues_found

## Summary

审查了 `272b6d9..HEAD` 范围内 Phase 03 的 gateway、CLI、webui 与 shared 类型/测试变更。主要风险集中在 Agent Team worktree 语义：UI 没有把 worktree 创建映射为 `per_member_worktree`，而 CLI 在 spawn 成员时直接复用 leader 的执行目录，因此“每成员独立 worktree”的隔离承诺会被破坏。另有创建流程先创建团队/会话、再发送目标消息，失败时会遗留无任务的运行团队。

纯性能问题按本次 code-review v1 规则未单独评级；没有发现命令注入或明文 secret 泄露的可证明问题。测试覆盖包含路由、store、hooks 与 sidebar，但缺少能保护 per-member worktree 隔离和创建失败补偿的断言。

## Critical Issues

### CR-01: Agent Team worktree 模式不会产生每成员隔离，成员会共享 leader worktree

**Severity:** BLOCKER
**File:** `apps/webui/src/hooks/useSessionMutations.ts:367-373`, `apps/mobvibe-cli/src/team/agent-team-store.ts:247`, `apps/mobvibe-cli/src/acp/session-manager.ts:1368-1373`

**Issue:** `createAgentTeam()` 请求只转发 `worktree`，没有设置 `workspaceMode`；CLI store 因此默认把团队持久化为 `shared_workspace`。即便后续补上传 `workspaceMode: "per_member_worktree"`，当前 `spawnAgentTeamMember()` 仍直接把新成员的 `executionContext` 设置为 leader session 的 `cwd/worktreeSourceCwd/worktreeBranch`，不会为成员创建自己的 worktree。用户在创建 Agent Team 时启用 worktree 后，后续成员会在同一个 leader worktree 中读写，破坏隔离，可能导致文件互相覆盖或把并行成员工作混在同一分支里。

**Failure scenario:** 用户创建 “per member worktree” Agent Team，leader 之后调用 `mobvibe_team_spawn_member` 生成两个成员。两个成员都继承 leader 的 `cwd` 和 `worktreeBranch`，同时修改同一工作树；UI/合同类型仍暗示 per-member 隔离，最终产生冲突或错误提交。

**Fix:**
```ts
// webui: 创建 Agent Team 时显式表达模式
await createAgentTeam({
  machineId: variables.machineId,
  leaderBackendId: variables.leaderBackendId,
  workspaceRootCwd: variables.worktree?.sourceCwd ?? variables.workspaceRootCwd,
  title: variables.title,
  workspaceMode: variables.worktree ? "per_member_worktree" : "shared_workspace",
  worktree: variables.worktree,
});
```

同时在 CLI 保存团队创建时的 worktree 模板（source/base/relativeCwd），并在 `spawnAgentTeamMember()` 中按 `team.workspaceMode` 分支：

```ts
if (team.workspaceMode === "per_member_worktree") {
  session = await this.createTeamSession({
    backendId,
    title: memberName,
    agentTeamId: input.agentTeamId,
    memberId,
    worktree: buildMemberWorktreeOptions(team, memberName),
  });
} else {
  session = await this.createTeamSession({
    backendId,
    title: memberName,
    agentTeamId: input.agentTeamId,
    memberId,
    executionContext: sharedLeaderContext,
  });
}
```

补充测试：创建 Agent Team 启用 worktree 时请求必须包含 `workspaceMode: "per_member_worktree"`；spawn 成员时不能复用 leader 的 `cwd/worktreeBranch`。

## Warnings

### WR-01: Agent Team 创建与初始目标发送不是原子流程，发送失败会遗留无任务团队

**Severity:** WARNING
**File:** `apps/webui/src/hooks/useSessionMutations.ts:367-389`

**Issue:** `createAgentTeamRunMutation` 先调用 `createAgentTeam()`，成功拿到 `leaderSession` 后才调用 `sendMessage()` 发送用户填写的 `target`。如果 E2EE bootstrap 成功但 `sendMessage()` 因网络、权限、后端断开或 session 竞态失败，后端已经创建并运行了 Agent Team/leader session，但 UI 会进入 `onError` 并显示创建失败。当前代码没有回滚、归档、关闭 leader session，也没有把已创建的团队激活给用户处理。

**Failure scenario:** Gateway 成功创建团队并返回 leader session；随后 WebUI 到 `/acp/sessions/:id/messages` 的发送请求超时。用户看到“创建失败”，但 CLI 端留下一支 running Agent Team，leader session 没有收到目标任务，后续列表刷新后出现一个没有任务上下文的团队。

**Fix:** 将“创建团队 + 注入初始目标”做成有补偿的流程：
- 首选：新增受 E2EE 保护的初始化 RPC/endpoint，由后端在 leader session 创建后立即注入目标，失败时把团队标记为 failed 并关闭/归档 leader session。
- 最小修复：WebUI 在 `sendMessage()` 失败时调用明确的 cleanup API（archive/cancel team 或 close leader session），并把已创建 team/session 信息展示给用户；同时为该失败路径加测试。

### WR-02: worktree Agent Team 的 workspaceRootCwd 使用子目录，导致团队与 leader session 工作区分组不一致

**Severity:** WARNING
**File:** `apps/webui/src/hooks/useSessionHandlers.ts:338-345`, `apps/webui/src/hooks/__tests__/useSessionHandlers.test.tsx:477-491`

**Issue:** `buildWorktreeRequest()` 已解析出 `sourceCwd: "/projects/repo"` 和 `relativeCwd: "apps/webui"`，但 Agent Team 创建仍把 `workspaceRootCwd` 设置为用户输入的 `draftCwd`（例如 `/projects/repo/apps/webui`）。CLI 创建 leader worktree session 时会把 session 的 `workspaceRootCwd` 归一到 repo root（`resolveSessionExecutionContext()` 返回 `workspaceRootCwd: repoDir`），于是同一个团队和它的 leader session 会有不同 workspace group key。当前测试还把这个不一致值固定为期望值。

**Failure scenario:** 用户从仓库子目录创建 worktree Agent Team。团队显示在 `/projects/repo/apps/webui` 工作区，leader session/后续普通 worktree session 则按 `/projects/repo` 分组；刷新或 socket 更新后侧边栏可能隐藏 team-owned session、workspace 切换也会把 team 与关联会话分到不同入口。

**Fix:** 创建 worktree Agent Team 时发送 repo root 作为团队 `workspaceRootCwd`，把子目录只放在 `worktree.relativeCwd`：
```ts
const workspaceRootCwd = worktree?.sourceCwd ?? draftCwd;
await mutations.createAgentTeamRunMutation.mutateAsync({
  leaderBackendId: draftBackendId,
  workspaceRootCwd,
  title: isUserCustomTitle ? title : undefined,
  machineId: selectedMachineId,
  target,
  worktree,
});
```
更新 `useSessionHandlers.test.tsx`，断言 worktree Agent Team 使用 `/projects/repo` 作为 `workspaceRootCwd`，并保留 `relativeCwd: "apps/webui"`。

---

## Testing Reviewed / Residual Risks

- 已检查新增测试范围：gateway `agent-teams` route、CLI `session-manager` / team store / MCP router、webui hooks / API / sidebar / team overview。
- 残余测试风险：缺少跨层测试证明 `per_member_worktree` 会为每个 spawned member 创建独立 worktree；缺少 `sendMessage` 初始化目标失败后的 cleanup/可恢复路径测试。
- 未运行测试命令；本报告基于静态 diff 与相关调用链审查。

## Orchestrator Disposition

- `CR-01` 处置为 Phase 3 范围外 / false-positive：03-03 计划明确锁定“Phase 3 spawn uses leader/team shared execution cwd only”，并在 `03-03-SUMMARY.md` 记录“Spawn 不实现 per-member worktree；member 复用 leader/team-shared checkout”。独立 per-member worktree 属于后续 lifecycle/reliability 范围，不在本次执行中改动。
- `WR-01` 接受为 Phase 4/恢复语义风险：当前 Phase 3 交付最小 create + encrypted target delivery，create 成功但 target send 失败后的 cancel/archive/retry 补偿应随 Phase 4 生命周期、权限、恢复一起处理。
- `WR-02` 已在本次审查后修复：WebUI worktree Agent Team create payload 现在使用 `worktree.sourceCwd` 作为 `workspaceRootCwd`，子目录继续保存在 `worktree.relativeCwd`，避免 team 与 leader/member session 分组漂移。

_Reviewed: 2026-05-14T06:28:13Z_  
_Reviewer: the agent (gsd-code-reviewer)_  
_Depth: standard_
