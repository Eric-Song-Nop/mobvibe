# Mobvibe Agent Team

## What This Is

Mobvibe 是一个分布式 ACP WebUI，用于从 Web、桌面和移动端远程管理本地 AI 编程 agent。当前系统已经支持多个 ACP backend、多个机器、会话历史、文件/代码浏览、Git 视图、工作树创建、实时流式消息和端到端加密。

本项目的下一阶段是在现有单会话模型之上构建“agent team”：让用户把不同 ACP agent 组成一个编排式团队，为同一个代码任务分配不同角色，并通过 Mobvibe 统一启动、观察、协调和汇总它们的工作。

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

### Active

- [ ] 用户可以创建一个 team run，选择同一台机器、workspace、目标任务和多个不同 ACP agent 成员
- [ ] 用户可以为每个 team member 指定角色、提示词片段、执行顺序和是否使用独立 worktree
- [ ] 系统可以把 team run 展开为多个普通 ACP session，并保持每个 session 的既有 WAL、E2EE、权限和路由语义
- [ ] 用户可以在 WebUI 中看到 team run 总览，包括每个成员的 agent、状态、当前输出、错误和需要处理的权限请求
- [ ] 用户可以启动、取消、重试或归档 team run，同时不破坏底层单 session 的独立生命周期
- [ ] 用户可以把多个 agent 的结果汇总成一个 team summary，并从 summary 跳回对应成员 session 的原始上下文
- [ ] Gateway 和 CLI 可以用共享类型传递 team run 元数据，而不引入 app-to-app 直接依赖

### Out of Scope

- 云端托管 agent 执行 — 当前产品价值是远程控制用户本地 ACP agent，v1 不把 agent 迁移到 Gateway
- Gateway 解密或理解会话内容 — 必须保持现有 E2EE 边界，Gateway 只路由 team 元数据和加密事件
- 替换 ACP 协议或为某个 agent 写深度私有适配 — v1 只利用 ACP backend 的现有会话/提示/权限能力
- 完整多用户协作项目管理 — v1 面向单用户拥有的机器和 agent team，不做团队账号、审计流或多人权限模型
- 自动代码合并与冲突解决 — v1 可以支持独立 worktree 和结果汇总，但不自动把多个 agent 的变更合并到主分支
- 复杂自治 planner — v1 由用户配置角色和任务，不构建长期自主 agent 管理平台

## Context

- 当前仓库是 pnpm + Turborepo monorepo，核心应用包括 `apps/gateway`、`apps/webui`、`apps/mobvibe-cli`、`apps/website`，共享协议类型在 `packages/shared`，共享 UI 在 `packages/ui`。
- 当前主链路是 WebUI 发起 REST/Socket.io 请求，Gateway 认证并路由到用户本地 CLI daemon，CLI 通过 ACP stdio 控制本地 agent 进程。
- 当前 session 核心标识是 `sessionId`、`backendId`、`machineId` 和 `cwd/workspaceRootCwd`，WebUI 已经按 backend 和 workspace 展示 session。
- CLI 已有 per-backend connection、session lifecycle、worktree 创建、WAL 持久化、E2EE DEK 初始化、permission request/response 处理。
- Gateway `CliRegistry` 当前是实时连接/session 索引，不是 durable storage；team 元数据如果需要跨重启恢复，不能只放在 Gateway 内存。
- WebUI 当前 session sidebar、workspace list、chat store、machine store 已经具备展示多 session 的基础，但缺少 team run 这种跨 session 聚合模型。
- 代码库中 session orchestration 文件较大，新增 team 功能应先建立清晰 shared 类型和最小端到端垂直切片，避免在大文件中一次性塞入完整自治系统。

## Constraints

- **Architecture**: 必须保持现有 WebUI → Gateway → CLI daemon → ACP agent 分层；新增 team 能力应复用 `SessionRouter`、`SessionManager`、WAL 和 socket 事件模型。
- **Security**: Gateway 不解密 session 内容；team metadata 不应包含用户密钥、provider token 或明文敏感输出。
- **Compatibility**: 不要求所有 ACP agent 支持相同能力；v1 必须能处理某些 backend 不支持 session list/load、模型切换或图片输入的情况。
- **Persistence**: 底层成员 session 的历史仍由 CLI WAL 负责；team run 元数据需要明确存放位置，避免依赖 Gateway ephemeral registry。
- **UI**: WebUI 变更要遵循现有 React 19、Zustand、React Query、Tailwind 和 `@mobvibe/ui` 模式，并保持移动端可用。
- **Testing**: 行为变更至少覆盖 shared 类型、Gateway routing/authorization、CLI team orchestration 和 WebUI team 状态展示的关键路径。
- **Scope**: v1 先做“用户配置的编排式团队”，不做完全自治 planner 或自动合并。

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| v1 采用编排式团队，而不是仅会话分组或多 agent 对比 | 用户明确选择；这最能体现“across different ACP agents”的产品差异化 | — Pending |
| Team member 复用普通 ACP session | 保持 WAL、E2EE、权限、文件/Git RPC 和现有 UI 能力，不另建并行协议 | — Pending |
| Team run 以粗粒度 MVP 阶段推进 | 该功能横跨 shared/gateway/CLI/webui，先验证端到端闭环比过早细拆更重要 | — Pending |
| 后续 planning 启用 research、plan_check、verifier | 跨 agent 编排存在状态一致性、权限和 UI 风险，需要前后验证 | — Pending |
| 规划文档提交到 git | 让后续 `/gsd-plan-phase 1` 能稳定读取上下文并审计变更 | — Pending |

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
*Last updated: 2026-05-12 after initialization*
