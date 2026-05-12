# 功能图谱：Mobvibe Agent Team v1

**领域：** 本地 ACP 编程 Agent 的编排式团队运行  
**研究日期：** 2026-05-12  
**总体置信度：** 高（基于现有代码/规划文档 + ACP 官方文档；竞品维度未做深入市场调研）

## 结论摘要

Mobvibe Agent Team v1 应该做成“用户配置的编排式 team run”，而不是自治 planner、多人协作平台或自动代码合并器。现有产品已经有多 ACP backend、多 session、WAL、E2EE、permission、worktree、文件/Git 视图与会话历史；v1 的核心价值是把这些能力用一个可理解、可控制、可恢复的 team run 聚合起来。

v1 的最低可用闭环是：用户在同一台机器、同一 workspace 下创建一个 team run，选择多个 ACP agent 成员，为每个成员指定角色和提示词片段，按顺序或并行展开为普通 session，WebUI 展示成员状态/输出/权限/错误，并允许启动、取消、重试、归档和生成可追溯 summary。所有成员 session 必须继续复用现有 WAL、E2EE、权限和路由语义。

差异化应该来自“跨不同 ACP agent 的透明协作”和“本地安全执行”：用户能看到每个 agent 的职责、进度、产出、worktree 分支和原始上下文链接。v1 不应该追求复杂自动调度、自动合并、云端执行或 gateway 解密理解内容；这些会破坏现有架构边界并显著扩大风险。

## Table Stakes（v1 必须包含）

缺失这些功能，用户无法理解或控制 team run，产品会退化成“多个 session 的手动列表”。

| 功能 | 可测试行为 | 为什么必需 | 复杂度 | 依赖/备注 |
|------|------------|------------|--------|-----------|
| Team run 创建入口 | 用户可以从 workspace/session 创建入口选择“新建团队运行”，选择 machine、workspace、team title、目标任务。提交后产生一个稳定 `teamRunId`。 | 没有一等 team run 对象，后续状态、汇总、归档都只能靠 session 命名约定，无法可靠恢复。 | 中 | 依赖 shared team 类型、WebUI 创建表单、Gateway→CLI RPC。team 元数据不要只放 Gateway 内存。 |
| 成员选择与角色配置 | 创建时至少可添加 2 个成员；每个成员包含 `backendId`、显示名/角色、成员提示词片段、执行策略字段。 | “不同 ACP agent 组成团队”是核心价值；角色让用户知道每个 session 为什么存在。 | 中 | 复用现有 backend 列表；必须处理 backend 能力不一致。 |
| 统一任务提示词分发 | Team run 的全局目标会和成员角色提示词组合后发送给对应成员 session；用户能预览每个成员最终 prompt 的非敏感元数据/结构。 | 用户需要确认每个 agent 收到的任务一致但角色不同，避免误启动多个无关 session。 | 中 | 内容仍按现有 E2EE 路径进入 session；Gateway 不读取明文。 |
| 顺序/并行两种执行模式 | 用户可选择“并行启动所有成员”或“按成员顺序启动”；顺序模式中前一个成员结束后才启动下一个。 | v1 编排至少要支持最常见的 fan-out 和 pipeline。仅手动启动多个 session 不构成编排。 | 中-高 | 顺序模式需要 team orchestrator 监听成员 `turn_end`/错误/取消。不要做复杂 DAG。 |
| 成员 session 复用普通会话模型 | 每个 team member 必须映射到一个普通 `sessionId`，并可点击进入完整聊天、文件、Git、权限上下文。 | 保持 WAL、E2EE、权限、文件/Git RPC、历史恢复能力，降低重写风险。 | 中 | `SessionSummary` 需要可关联 `teamRunId`/`teamMemberId` 或 team 元数据另表关联。 |
| Team run 总览页/面板 | WebUI 展示 team title、目标、状态、成员列表、agent/backend、角色、session 链接、当前阶段、最后更新时间。 | 用户必须能在一个视图里知道团队运行发生了什么，而不是在 sidebar 中猜测多个 session 的关系。 | 中 | 可先做 workspace 内详情页/右侧面板；移动端需要可折叠。 |
| 成员状态模型 | 每个成员有明确状态：`pending`、`starting`、`running`、`waiting_permission`、`completed`、`failed`、`cancelled`、`detached`、`archived`。 | team run 的核心 UX 是“知道谁卡住了”。现有 session dot 不足以表达团队级状态。 | 中 | 从 `session:attached/detached`、`permission:request`、`turn_end`、`session_error` 派生；需要持久化最后状态。 |
| 权限请求聚合提示 | Team 总览中显示哪个成员正在请求权限；用户点击后跳到对应 session 的权限卡片并完成决策。 | 多 agent 并行时，权限请求是最容易被漏掉的阻塞点。 | 中 | 不建议 v1 做跨成员批量授权；只做定位与显著提示。 |
| Team run 控制：启动、取消、重试成员、归档 | 用户可以启动整个 team run、取消正在运行的成员、单独重试失败成员、归档 team run；归档不应破坏底层 session 历史。 | 没有控制能力，用户无法安全试错。重试必须是成员级，避免重跑整个团队。 | 高 | 取消复用 session cancel；重试建议创建新 session 并保留 attempt 关系；归档只隐藏 team 元数据或关联视图。 |
| 独立 worktree 选项 | 每个成员可选择复用当前 workspace 或创建独立 worktree；列表中显示 branch/worktree 来源。 | 多 agent 同时改代码时，没有隔离会导致互相覆盖。现有 worktree 能力应成为 v1 安全默认。 | 中 | 推荐默认并行成员使用独立 worktree；顺序成员可允许共享 workspace。 |
| Team summary | 用户可生成或编辑一个 team summary，包含每个成员结果、状态、关键链接；每条结论能跳回原成员 session。 | v1 需要把多 session 结果收束成用户可消费的产物。 | 中 | 初版可为用户手动编辑 + 系统自动汇集成员标题/状态/链接；不要要求 Gateway 解密内容自动总结。 |
| Team run 历史与恢复 | 刷新 WebUI、Gateway 重启或 CLI 重连后，team run 列表和成员关联可恢复；成员 session 历史继续从 WAL 回放。 | 当前 Gateway registry 是临时状态；team 作为用户任务必须跨重启存在。 | 高 | Team 元数据建议由 CLI 本地持久化或 Gateway durable metadata 持久化；若存 Gateway，不能包含明文敏感内容。 |
| 失败与能力不支持反馈 | 如果某 agent 不支持 list/load、模型切换、图片等能力，team UI 明确标注并允许继续使用可用能力。 | ACP backend 能力不一致是已知约束，v1 不能假设所有 agent 行为一致。 | 中 | 依赖现有 `AgentSessionCapabilities` 和错误形状。 |
| Team 与普通 session 的 sidebar 关系 | Sidebar 或 workspace 视图能区分普通 session 与 team run；team 成员不应被误认为无关联的散乱 session。 | 否则新功能会增加列表噪声，用户难以导航。 | 中 | 可新增 “Teams” tab，或在 session item 上显示 team badge；v1 推荐先加 Teams 分组。 |

## Differentiators（有价值，但可分阶段推进）

这些功能能强化差异化，但不是 v1 闭环的前置条件。建议在 v1 基础稳定后按风险递增加入。

| 功能 | 价值主张 | 可测试行为 | 复杂度 | 建议时机/依赖 |
|------|----------|------------|--------|----------------|
| Team 模板 | 用户可保存“Planner / Implementer / Reviewer”等成员配置，下次一键复用。 | 创建 team 时选择模板自动填充成员、角色、执行模式和 worktree 默认值。 | 中 | v1.1；依赖稳定 team schema。 |
| 预设角色库 | 提供 reviewer、tester、docs、security、frontend polish 等角色 prompt 片段。 | 用户添加成员时可从角色库选择，仍可编辑。 | 低-中 | v1.1；先本地静态配置即可。 |
| Reviewer 汇总成员 | 将某个 agent 标记为 reviewer/summarizer，在其他成员结束后自动收到成员产出摘要/链接提示。 | 顺序模式最后一个成员自动启动，并收到结构化输入。 | 高 | v1.2；需要明确定义如何在 E2EE 下传递内容。初期只传用户可见摘要/链接，不传 Gateway 明文。 |
| 成员 attempt 历史 | 失败成员重试后保留 attempt 1/2/3，用户可比较每次输出和错误。 | Team detail 中显示重试链；旧 attempt session 仍可打开。 | 中 | v1.1；依赖成员重试模型。 |
| Git 变更矩阵 | 总览按成员显示 worktree branch、变更文件数、diff 链接、是否有冲突风险。 | 用户能从 team 页面打开每个成员的 Git 状态。 | 中-高 | v1.1；复用现有 Git RPC，但注意大 diff 限制。 |
| 轻量冲突检测 | 对多个成员 worktree 的改动文件求交集，提示“这些成员可能冲突”。 | 并行成员修改同一文件时显示 warning。 | 中 | v1.2；只检测文件路径，不自动解决冲突。 |
| 运行时间和成本/usage 聚合 | Team 显示总耗时、每成员耗时、usage/cost（如果 backend 提供）。 | 完成后总览展示聚合 usage；缺失能力显示 unknown。 | 中 | v1.1；依赖 `usage_update` 质量。 |
| 成员输出快照卡片 | 总览中显示每个成员最后 N 行/最后状态消息，便于快速浏览。 | 不进入 session 也能看到成员当前进度摘要。 | 中 | v1.1；需避免在 WebUI 持久化过多明文。 |
| 手机端专用 Team Monitor | 移动端以卡片队列展示成员、权限、错误和快捷跳转。 | 小屏下不需要横向表格也能完成观察和授权。 | 中 | v1.1；v1 先保证响应式可用。 |
| Team Run 导出 | 导出 team summary、成员列表、session 链接和状态为 Markdown。 | 用户点击导出得到可复制 Markdown。 | 低 | v1.1；不要导出敏感明文，除非用户显式选择。 |
| Team 活动时间线 | 将成员启动、权限、错误、完成、重试事件聚合成一条时间线。 | Team detail 显示按时间排序的运行事件。 | 中 | v1.2；可由 team metadata 事件表生成。 |

## Anti-Features（v1 明确不做）

这些功能容易扩大范围、破坏安全边界或引入不可控复杂度。v1 应在产品和实现上明确避免。

| Anti-Feature | 为什么避免 | v1 替代方案 |
|--------------|------------|-------------|
| 完全自治 planner / 长期 agent 管理平台 | 会引入任务拆解、动态调度、记忆、预算、权限策略等全新系统，远超当前 brownfield 变更范围。 | 用户显式配置成员、角色和顺序；只做有限编排。 |
| 自动代码合并与冲突解决 | 多 agent 变更自动合并风险高，失败后用户很难理解；还会牵涉 Git 策略和测试策略。 | 使用独立 worktree + Git 变更预览 + summary 链接；可提示潜在冲突但不合并。 |
| Gateway 解密或理解 session 内容 | 违背现有 E2EE 承诺，扩大攻击面和合规风险。 | Gateway 只路由 team 元数据和加密事件；summary 由 WebUI/CLI 端用户可见上下文生成或手动编辑。 |
| 云端托管 agent 执行 | Mobvibe 当前价值是远程控制用户本地 ACP agent；云执行需要密钥托管、沙箱、计费和隔离。 | 继续通过本地 CLI daemon 启动 ACP agent。 |
| 深度私有 agent 适配 | 为单一 agent 写私有能力会破坏 ACP 兼容定位并增加维护负担。 | 只使用 ACP 和现有 backend capabilities；能力缺失时降级。 |
| 多用户团队协作/审计流 | 会引入组织、权限、审计、并发编辑等产品面，和单用户本地 agent team 目标不同。 | v1 面向单用户拥有的机器与 agent。 |
| 任意复杂 DAG 编排 | DAG UI、依赖调度、失败补偿会显著增加状态复杂度。 | v1 只支持并行和线性顺序。 |
| 跨机器 team run | 跨机器涉及路径差异、密钥、worktree、资源访问和状态恢复问题。 | v1 限定同一 machine + workspace。 |
| 批量自动批准权限 | 多 agent 并行下自动授权风险高，可能放大 destructive tool call。 | 聚合提示权限请求，但仍逐个在原 session 中决策。 |
| 把 team 当作普通 chat session | 如果 team 只有一个聊天窗口，会掩盖成员边界、权限来源和 session 历史。 | Team 是聚合对象；成员仍是普通 session，可跳转。 |
| 在 WebUI localStorage 存完整 team 明文输出 | 现有 WebUI 持久化已有容量风险；多成员输出会迅速膨胀并增加敏感数据暴露面。 | 持久化 team 元数据、状态、链接和 summary；详细内容由成员 WAL/backfill 获取。 |

## 功能依赖关系

```text
Shared Team 类型
  → Team 创建 RPC/API
  → CLI/持久化 Team 元数据
  → WebUI Team 创建入口
  → 成员 session 展开
  → Team 总览状态
  → Team 控制（取消/重试/归档）
  → Team summary

成员 session 关联
  → Sidebar/Teams 分组
  → 成员状态模型
  → 权限请求聚合
  → 成员详情跳转

Worktree 选项
  → 并行安全执行
  → Git 变更矩阵（后续差异化）
  → 冲突风险提示（后续差异化）

持久化 Team 元数据
  → 刷新/重连恢复
  → Team 历史
  → 归档
  → attempt 历史（后续差异化）

Team summary
  → 成员结果链接
  → Markdown 导出（后续差异化）
```

## MVP 推荐范围

优先实现一个端到端最小闭环，不要先做模板或自治调度。

1. **Team 基础模型与持久化**：`teamRunId`、title、machine、workspace、目标、状态、成员配置、成员 session 映射。
2. **创建 Team Run 并展开成员 session**：支持 2+ backend，支持并行/顺序，支持成员角色 prompt，成员 session 复用现有 E2EE/WAL/权限。
3. **Team 总览与成员导航**：显示成员状态、backend、角色、worktree branch、错误、权限提示、原 session 链接。
4. **Team 控制**：启动、取消、重试失败成员、归档 team；普通 session 生命周期不被破坏。
5. **Team Summary v1**：先做可编辑 summary + 自动插入成员状态/链接；不做 Gateway 明文自动总结。

**明确延后：** 模板、角色库、reviewer 自动汇总、Git 变更矩阵、冲突检测、导出、时间线、复杂 DAG、跨机器运行。

## 验收标准建议

| 场景 | 验收标准 |
|------|----------|
| 创建并行 team | 选择同一 machine/workspace、两个不同 backend、两个角色，提交后出现一个 team run 和两个成员 session。 |
| 创建顺序 team | 第二个成员在第一个成员 `turn_end` 前保持 `pending`，第一个完成后自动启动。 |
| 成员权限阻塞 | 某成员发出 permission request 后，team 总览显示 `waiting_permission` 并可跳转到原 session 决策。 |
| 成员失败重试 | 一个成员失败后 team 状态变为 partial failed；点击重试只重建该成员 session，不重跑其他成员。 |
| 刷新恢复 | WebUI 刷新后 team run、成员状态、session 链接仍存在；成员聊天历史由原 session WAL 恢复。 |
| 归档 team | Team 从默认列表隐藏；底层 session 历史不被删除，除非用户单独归档 session。 |
| E2EE 边界 | Gateway 不需要解密成员 prompt/输出即可路由和显示 team 元数据状态。 |

## 来源与置信度

- `.planning/PROJECT.md`：项目目标、v1 active requirements、out of scope、架构约束（高置信）。
- `.planning/codebase/ARCHITECTURE.md`：WebUI → Gateway → CLI → ACP 分层、WAL/E2EE/socket/session router 模式（高置信）。
- `.planning/codebase/CONCERNS.md`：大文件风险、Gateway registry 非持久、WAL/permission/E2EE 脆弱区、性能/存储限制（高置信）。
- `packages/shared/src/types/session.ts` 与 `socket-events.ts`：现有 session summary、capabilities、RPC、permission、WAL event 类型（高置信）。
- `apps/webui/src/components/session/SessionSidebar.tsx` 与 `apps/webui/src/lib/chat-store.ts`：现有 sidebar/session 状态、持久化和 UI 限制（高置信）。
- `apps/mobvibe-cli/src/acp/session-manager.ts`：现有 session 创建、worktree、WAL、permission、load/discover/cancel/archive 能力（高置信）。
- ACP 官方文档索引 `https://agentclientprotocol.com/llms.txt`：ACP 已覆盖 session list/resume/close/config、plan、tool calls、terminals、permission 相关扩展入口（中-高置信）。
- ACP TypeScript SDK 文档 `https://agentclientprotocol.github.io/typescript-sdk/`：当前 SDK 版本 v0.21.0，Mobvibe 使用官方 TS SDK 方向合理（中-高置信）。

## 仍需后续确认的问题

- Team 元数据最终放在 CLI 本地 SQLite、Gateway PostgreSQL，还是二者分层存储；这会影响离线恢复与多设备 WebUI 可见性。
- Team summary 是否由 WebUI 端、CLI 端或用户手动生成；若要自动总结，必须先设计不破坏 E2EE 的内容访问边界。
- 顺序执行中“成员完成”的判定是否只依赖 `turn_end`，还是需要用户显式确认继续下一位成员。
- 成员重试是否复用原 worktree branch、创建新 branch，或由用户选择；这影响 Git 安全模型。
