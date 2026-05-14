# Mobvibe Agent Team

## What This Is

Mobvibe 是一个分布式 ACP WebUI，用于从 Web、桌面和移动端远程管理本地 AI 编程 agent。当前系统已经支持多个 ACP backend、多个机器、会话历史、文件/代码浏览、Git 视图、工作树创建、实时流式消息和端到端加密。

本项目的下一阶段是在现有单会话模型之上构建“agent team”：让用户把不同 ACP agent 组成一个编排式团队，为同一个代码任务分配不同角色，并通过 Mobvibe 统一启动、观察、协调和汇总它们的工作。修正后的核心设计不是简单 prompt handoff，而是在 CLI 本地运行 team MCP server，只给 team leader/member ACP session 注入 `mobvibe_team_*` 工具，让 agents 通过持久化 mailbox 和 task board 协作。工具注入优先采用 ACP 官方 MCP-over-ACP RFD 的 per-session transport，确保普通 agent session 不声明 team MCP server、不受 team 功能影响。

## Core Value

用户可以在一个 Mobvibe 团队任务中安全地协调多个不同 ACP agent，让它们围绕同一代码目标并行或顺序协作，并清楚看到每个 agent 的进展、产出和最终汇总。

## Requirements

### Validated

- ✓ 用户可以通过 WebUI/Gateway/CLI daemon 控制本地 ACP agent 会话 — existing
- ✓ CLI 可以从 ACP registry 检测并启用多个本地 ACP backend — existing
- ✓ Gateway 可以按用户、机器、backend 和 session 路由 REST/RPC/Socket.io 请求 — existing
- ✓ 会话事件通过 CLI WAL 持久化，并通过统一 `session:event` 回放到 WebUI — existing
- ✓ 会话内容保持端到端加密，Gateway 只做路由不解密 — existing
- ✓ 用户可以在指定机器和目录创建会话，并可选择 Git worktree 隔离执行 — existing
- ✓ WebUI 可以展示机器、workspace、session、文件浏览器、Git 状态和流式聊天 — existing
- ✓ Agent Team create contract、Gateway route、CLI durable store 和 WebUI projection store 已使用 shared 类型和 metadata-only 边界统一 — Phase 1
- ✓ CLI 可以为 team session 注入 per-session `mobvibe_team_*` MCP tools，并用 durable mailbox/task board 保存协作事实 — Phase 2
- ✓ 用户可以从 WebUI 创建 leader-driven Agent Team，CLI 创建 leader/member ordinary ACP session，并在 WebUI 看到 team parent、member rows、metadata-only overview 和 ordinary session jump — Phase 3
- ✓ Agent Team target 明文不进入 `/acp/agent-teams`；WebUI 创建 metadata-only team 后，通过 ordinary session E2EE `sendMessage()` 路径投递目标 — Phase 3

### Active

- [ ] 用户可以取消运行中的 team run，并看到 running members、MCP server/bridge、pending wake、pending permission 和 ordinary session cancel 的 per-member 结果
- [ ] 用户可以只重试 failed/degraded member，重试会创建新的 attempt/session 和 MCP readiness，不重跑已成功成员
- [ ] 用户可以归档 team run，同时保留底层 member session WAL、mailbox 和 task history
- [ ] 用户可以在 WebUI 中看到 team run 的权限等待聚合，并跳转到对应 ordinary session 完成权限决策
- [ ] WebUI 刷新、Gateway 重启或 CLI 重连后，team run、成员状态、MCP phase、mailbox/task counts 和 member-to-session 映射可以恢复或显示 degraded
- [ ] 用户可以启动、取消、重试、下线成员或归档 team run，同时不破坏底层普通 session 的独立生命周期
- [ ] 用户可以把多个 agent 的结果汇总成一个 team summary，并从 summary 跳回对应成员 session、mailbox message 或 task 的原始上下文
- [ ] Gateway 日志、路由和持久化内容中不会出现 provider token、master secret、DEK、明文 prompt、mailbox、task、summary 或 agent 输出

### Out of Scope

- 云端托管 agent 执行 — 当前产品价值是远程控制用户本地 ACP agent，v1 不把 agent 迁移到 Gateway
- Gateway 解密或理解会话内容 — 必须保持现有 E2EE 边界，Gateway 只路由 team 元数据和加密事件
- 替换 ACP 协议或为某个 agent 写深度私有适配 — v1 只利用 ACP backend 的现有会话/提示/权限能力
- 修改 agent 全局 MCP 配置 — v1 通过 MCP-over-ACP 或 per-session bridge 注入 team tools，不让普通 session 暴露 team 工具
- 完整多用户协作项目管理 — v1 面向单用户拥有的机器和 agent team，不做团队账号、审计流或多人权限模型
- 自动代码合并与冲突解决 — v1 可以支持独立 worktree 和结果汇总，但不自动把多个 agent 的变更合并到主分支
- 不受约束的自治 planner — v1 允许 leader agent 使用受限 team tools 协调团队，但所有 spawn/remove/shutdown、高风险权限、跨 workspace 行为必须受系统规则和用户确认约束

## Context

- 当前仓库是 pnpm + Turborepo monorepo，核心应用包括 `apps/gateway`、`apps/webui`、`apps/mobvibe-cli`、`apps/website`，共享协议类型在 `packages/shared`，共享 UI 在 `packages/ui`。
- 当前主链路是 WebUI 发起 REST/Socket.io 请求，Gateway 认证并路由到用户本地 CLI daemon，CLI 通过 ACP stdio 控制本地 agent 进程。
- 当前 session 核心标识是 `sessionId`、`backendId`、`machineId` 和 `cwd/workspaceRootCwd`，WebUI 已经按 backend 和 workspace 展示 session。
- CLI 已有 per-backend connection、session lifecycle、worktree 创建、WAL 持久化、E2EE DEK 初始化、permission request/response 处理。
- AionUI 的 ACP team 实现显示，真正的 agent team 需要给 ACP session 注入一个本地 team MCP server，而不是只由外部 orchestrator 分发 prompt；agents 通过工具调用写 mailbox、更新 task board、spawn/rename/shutdown teammates。
- ACP 官方 MCP-over-ACP RFD 提供了更适合 Mobvibe 的隔离方式：team MCP server 可以作为 per-session ACP transport 注入，tool callbacks 通过同一 ACP channel 回到 CLI；普通 session 不声明该 server，因此不受 team 功能影响。对不支持 native MCP-over-ACP 的 agent，只允许使用 per-team-session bridge，不修改全局 agent 配置。
- Gateway `CliRegistry` 当前是实时连接/session 索引，不是 durable storage；team 元数据如果需要跨重启恢复，不能只放在 Gateway 内存。
- WebUI 当前 session sidebar、workspace list、chat store、machine store 已经具备展示多 session 的基础，但缺少 team run 这种跨 session 聚合模型。
- 代码库中 session orchestration 文件较大，新增 team 功能应先建立清晰 shared 类型和最小端到端垂直切片，避免在大文件中一次性塞入完整自治系统。

## Constraints

- **Architecture**: 必须保持现有 WebUI → Gateway → CLI daemon → ACP agent 分层；新增 team 能力应复用 `SessionRouter`、`SessionManager`、WAL 和 socket 事件模型，并在 CLI 本地新增 team MCP server、mailbox、task board、leader/member session 管理。
- **Security**: Gateway 不解密 session 内容；team metadata 不应包含用户密钥、provider token、明文 prompt、明文 mailbox 内容、明文 task content 或明文 agent 输出。
- **Compatibility**: 不要求所有 ACP agent 支持 team mode；能作为自治 teammate 的 backend 必须支持 native MCP-over-ACP，或支持只作用于该 team session 的 stdio/HTTP bridge，否则只能作为普通 session 或非自治成员降级。
- **Persistence**: 底层成员 session 的历史仍由 CLI WAL 负责；team run、mailbox、task board、MCP readiness、member-to-session 映射需要明确持久化，避免依赖 Gateway ephemeral registry。
- **UI**: WebUI 变更要遵循现有 React 19、Zustand、React Query、Tailwind 和 `@mobvibe/ui` 模式，并保持移动端可用。
- **Testing**: 行为变更至少覆盖 shared 类型、Gateway routing/authorization、CLI team orchestration 和 WebUI team 状态展示的关键路径。
- **Scope**: v1 先做“用户确认 + leader 使用受限 team tools 的编排式团队”，不做不受约束的长期自治 planner 或自动合并。

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| v1 采用编排式团队，而不是仅会话分组或多 agent 对比 | 用户明确选择；这最能体现“across different ACP agents”的产品差异化 | 已锁定：用户概念使用 Agent Team |
| Team member 复用普通 ACP session | 保持 WAL、E2EE、权限、文件/Git RPC 和现有 UI 能力，不另建并行协议 | 已锁定：leader/member 都是一等 ordinary session |
| Agent 间通信通过 CLI-hosted team MCP server + durable mailbox/task board | AionUI 证明只做 supervisor handoff 不完整；ACP agents 需要可调用的 team tools 才能主动协作 | 已锁定：CLI owns coordination facts |
| Team tools 通过 MCP-over-ACP per-session 注入 | ACP RFD 让 client 在单个 `session/new` 中声明 MCP server；普通 session 不声明 team server，避免影响其他 agent 使用 | 已锁定：native ACP transport 优先，bridge 只能 per-session |
| Leader agent 负责协作脑，系统 orchestrator 负责事实来源和安全边界 | 让 LLM 拆分/分配/汇总，同时由 Mobvibe 控制持久化、权限、恢复、workspace 和用户确认 | 已锁定：spawn/shutdown 等高风险行为需要 policy 和用户确认 |
| Team run 以粗粒度 MVP 阶段推进 | 该功能横跨 shared/gateway/CLI/webui，先验证端到端闭环比过早细拆更重要 | 已锁定：保持 5 个 coarse MVP phase |
| 后续 planning 启用 research、plan_check、verifier | 跨 agent 编排存在状态一致性、权限和 UI 风险，需要前后验证 | 已锁定：Phase 1 先写决策上下文再制定实现计划 |
| 规划文档提交到 git | 让后续 `/gsd-plan-phase 1` 能稳定读取上下文并审计变更 | — Pending |
| Phase 3 spawned members 复用 team shared checkout | 当前阶段目标是最小端到端闭环；per-member worktree isolation 会牵涉 lifecycle/retry/cleanup 语义，延后处理更安全 | 已锁定：Phase 3 shared checkout，Phase 4/后续再扩展隔离策略 |

## Current State

Phase 3 已完成并通过验证：WebUI 可以 metadata-only 创建 Agent Team，Gateway 认证并路由到 CLI，CLI 创建 leader ordinary ACP session、注入 Team MCP 并等待 tools ready；leader 可以通过 `mobvibe_team_spawn_member` 创建普通 member session；WebUI 展示 team sidebar parent/member rows、metadata-only overview，并可跳转到成员 ordinary session。

下一步进入 Phase 4：补齐取消、重试、归档、权限聚合、恢复/降级状态和日志/内容边界强化。

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-14 after Phase 3 verification*
