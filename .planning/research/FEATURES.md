# 功能图谱：Mobvibe Agent Team v1

**领域：** 本地 ACP 编程 Agent 的 MCP 协作式团队运行
**研究日期：** 2026-05-12  
**总体置信度：** HIGH

## 结论摘要

Mobvibe Agent Team v1 应做成“leader 驱动、CLI 持久化、MCP 工具协作”的 team run。用户创建 team run 后，CLI 启动 team MCP server，只把 `mobvibe_team_*` tools 注入 leader/member ACP session；leader agent 通过 mailbox 和 task board 拆分、分配、协调和汇总。所有成员仍是普通 ACP session，继续复用现有 WAL、E2EE、permission、worktree、文件/Git 和历史恢复。注入机制优先采用 ACP 官方 MCP-over-ACP RFD 的 per-session transport，普通 agent session 不声明 team server，因此不受影响。

v1 的最低可用闭环不再是“选择多个成员并发 prompt 分发”，而是：用户选择 machine/workspace/目标任务/leader backend；CLI 创建 leader session，并只在这个 team session 中通过 MCP-over-ACP 或 per-session bridge 注入 team MCP；leader 可以用工具创建任务、发送消息、受控 spawn 成员；WebUI 可以观察 leader/member、MCP readiness、task board、mailbox 活动、权限等待、错误和成员 session 链接。

差异化来自“跨不同 ACP agent 的透明本地协作”和“Gateway 不接触内容明文”。v1 不追求自动合并、云端执行、长期自治 planner、跨机器 team 或 Gateway 明文总结。

## Table Stakes（v1 必须包含）

| 功能 | 可测试行为 | 为什么必需 | 复杂度 | 依赖/备注 |
|------|------------|------------|--------|-----------|
| Team run 创建入口 | 用户可以选择同一 machine/workspace、title、目标任务、leader backend、workspace/worktree 策略并创建稳定 `teamRunId`。 | 没有一等 team run 对象，MCP server、mailbox、task board 和成员恢复都没有归属。 | 中 | Gateway 只路由 intent；目标任务内容不进 Gateway 明文。 |
| Leader 普通 ACP session | 创建 team 后出现一个 leader member，并绑定普通 `sessionId`，可跳转到原 session。 | Leader 是协作脑，但仍需保留普通 session 的 WAL/E2EE/权限/UI 能力。 | 中 | 创建 leader 前必须检查 backend 是否支持 native MCP-over-ACP 或 per-session bridge。 |
| Team MCP server | CLI 为每个 team 启动本地 team MCP server，并为 team session 生成 MCP-over-ACP declaration 或 per-session bridge config。 | 没有 MCP 工具，agent 无法主动通信、创建任务或管理队友；per-session 注入避免影响普通 agent。 | 高 | 需要 readiness、server id/token、tool policy、dispose/recovery。 |
| MCP readiness 展示 | WebUI 能看到 team/member 的 MCP phase，例如 server ready、session injecting、tools ready、degraded、error。 | MCP 注入是 team 是否可自治的关键，不可隐藏在 running 状态里。 | 中 | AionUI 经验显示 readiness 是排查 team 卡死的关键。 |
| 普通 session 隔离 | 普通 Mobvibe agent session 不包含 `mobvibe-team` MCP server declaration，不能看到或调用 team tools。 | Team 功能不能改变用户在其他地方使用 agent 的行为。 | 中 | 基于 MCP-over-ACP RFD；bridge fallback 也必须 per-session。 |
| Durable mailbox | Agent 调用工具给 leader/member/all 发送消息；消息有 sender、recipient、read、wake status 和时间戳。 | Agent 间通信不能只靠 prompt 拼接或内存事件，否则重启/唤醒失败后不可恢复。 | 高 | 正文不能投影给 Gateway 明文；wake 失败不回滚已持久化消息。 |
| Durable task board | Agent 可以创建、领取、更新、完成任务；任务支持 owner、status、blockedBy/blocks。 | 任务拆解必须成为可观察事实，而不是只存在于 leader 输出里。 | 中-高 | WebUI 可先显示 counts/status，再加载详情。 |
| 受控成员 spawn | Leader 可以请求创建成员；系统校验 leader-only、backend MCP-over-ACP/bridge capability、workspace/worktree、用户确认后创建普通 member session。 | 动态组队是 AionUI 类 team 的核心能力；同时必须防止无限自治扩张。 | 高 | v1 可先支持有限成员数和同一 workspace。 |
| Team-capable backend 校验 | 不支持 native MCP-over-ACP 且无法 per-session bridge 的 backend 在创建 leader/member 时被阻止或降级，并给出成员级错误。 | 不支持工具注入的 agent 无法使用 mailbox/task tools。 | 中 | 依赖 ACP initialize/capabilities 暴露。 |
| 成员普通 session 映射 | 每个 leader/member 都有 `memberId -> sessionId`，可打开完整聊天、文件、Git、权限和历史。 | 保持 Mobvibe 现有核心能力，不复制 transcript 到 team store。 | 中 | `SessionSummary` 可选关联 team/member。 |
| Team detail / monitor | WebUI 展示 leader/member、backend、role、status、MCP phase、task board、mailbox 活动、错误、permission 等待和 session 链接。 | 用户需要知道团队为什么卡住、谁在工作、结果来自哪里。 | 中 | 移动端用卡片/折叠布局。 |
| 权限请求聚合定位 | Team detail 显示哪个 member 等待权限，点击跳转原普通 session 决策。 | 多 agent 并行时权限最容易丢失或误投递。 | 中 | 不做无确认批量授权。 |
| 生命周期控制 | 用户可以取消 team、重试 failed/degraded member、归档 team；默认不删除成员 session WAL/mailbox/task 历史。 | Team 是长任务，必须可恢复和可安全停止。 | 高 | 取消要处理 MCP server、wake、permission、sessions。 |
| Summary refs | 用户可以编辑或生成结构化 summary，并从每条结论跳回 member session、mailbox message 或 task。 | 多 agent 结果需要收束，但必须可追溯。 | 中 | 自动 summary 必须在 WebUI/CLI 可信域或普通 ACP session 中完成。 |
| 恢复能力 | 刷新、Gateway 重启、CLI 重连后，team run、members、MCP phase、mailbox/task counts、session links 可恢复或显示 degraded。 | Team 不应依赖 Gateway 内存或浏览器状态。 | 高 | CLI 是 v1 durable owner。 |

## Differentiators（有价值，但可分阶段推进）

| 功能 | 价值主张 | 可测试行为 | 建议时机 |
|------|----------|------------|----------|
| Team 模板 | 快速创建常见 leader/member 初始配置。 | 用户选择模板后自动填充 leader backend、成员建议和 workspace 策略。 | v1.1 |
| 预设角色库 | 减少用户写角色 prompt 的负担。 | Leader 或用户可以从 reviewer/tester/docs/security 等预设创建成员。 | v1.1 |
| Agent catalog/tool | Leader 可查看可用 backend、preset、model 后再 spawn。 | `mobvibe_team_describe_agent` / `mobvibe_team_list_models` 返回受限能力描述。 | v1.1 |
| Task dependency UI | 用户看到 blockedBy/blocks 图或列表。 | 阻塞任务完成后，依赖任务自动变为可执行。 | v1.1 |
| 成员 attempt 历史 | 重试不覆盖旧结果。 | Team detail 显示 attempt 1/2/3 和各自 session 链接。 | v1.1 |
| Git 变更矩阵 | 多成员 worktree 结果更易比较。 | 总览显示每成员 branch、文件数、diff 链接和冲突提示。 | v1.2 |
| 轻量冲突检测 | 提前发现多个成员改同一文件。 | 并行成员修改路径交集时显示 warning，不自动合并。 | v1.2 |
| 活动时间线 | 提供可审计运行轨迹。 | 显示 MCP ready、spawn、message、task update、permission、error、complete。 | v1.2 |
| Markdown 导出 | 方便用户带走结果。 | 导出 summary refs、成员状态、task board 和 session 链接。 | v1.1 |

## Anti-Features（v1 明确不做）

| Anti-Feature | 为什么避免 | v1 替代方案 |
|--------------|------------|-------------|
| 只做 prompt fan-out 的“假 team” | Agent 之间无法主动通信、领取任务或恢复 mailbox/task 状态。 | CLI team MCP server + durable mailbox/task board。 |
| 完全自治长期 planner | 会引入预算、长期记忆、无限 spawn、权限策略和项目管理平台复杂度。 | Leader 使用受限工具协调；系统控制确认、权限和生命周期。 |
| Gateway 解密/理解内容 | 违背 E2EE 边界，扩大攻击面。 | Gateway 只路由 metadata 和 encrypted/source refs。 |
| 自动代码合并 | 多 agent 变更自动合并风险高，失败后难以解释。 | 独立 worktree + Git 预览 + summary refs。 |
| 云端托管 agent | 需要密钥托管、沙箱、计费和隔离。 | 继续通过本地 CLI daemon 管理 ACP processes。 |
| 深度私有 agent 适配 | 破坏 ACP 兼容定位。 | 只使用 ACP session + MCP-over-ACP 或标准 bridge capability。 |
| 修改全局 agent MCP 配置 | 会让普通 session 也暴露 team tools，改变用户在其他地方的 agent 使用。 | 只在 team `session/new` 中声明 team MCP server。 |
| 跨 machine team | 路径、密钥、worktree 和恢复语义复杂。 | v1 限定同一 machine + workspace。 |
| 无确认批量授权 | 多 agent 下会放大 destructive tool call 风险。 | Team UI 聚合提示，决策仍在原 session。 |
| WebUI localStorage 保存完整 team 输出 | 多成员 transcript 会膨胀并增加敏感数据暴露。 | Team store 保存 projection 和 refs；内容从 session WAL 或可信域读取。 |

## 功能依赖关系

```text
Shared Team/MCP/Mailbox/Task 类型
  → CLI TeamStore 持久化
  → CLI TeamMcpServer + tool policy
  → MailboxStore + TaskBoardStore
  → Backend MCP-over-ACP / per-session bridge capability gating
  → Leader ordinary ACP session with injected MCP
  → WebUI/Gateway team create and monitor
  → Controlled member spawn and session mapping
  → Lifecycle/recovery/security hardening
  → Summary refs and export
```

## MVP 推荐范围

1. **协议和持久化模型**：定义 team run、member、MCP readiness、mailbox、task、tool policy、source refs 和 content boundary。
2. **CLI 本地协作闭环**：TeamMcpServer 可启动，工具调用能写 mailbox/task board，并能记录 readiness 和 wake 结果。
3. **最小端到端 team run**：WebUI 创建 leader team，Gateway 路由，CLI 创建 leader session，并只对该 session 注入 MCP。
4. **受控 member spawn**：leader 请求 spawn，系统校验并创建普通 member session，WebUI 显示 member/session/link。
5. **基础 monitor 和控制**：展示成员状态、MCP phase、task/mailbox counts、permission blockers、cancel/retry/archive。
6. **Summary refs**：用户可编辑 summary，引用 member session、mailbox message 或 task。

**明确延后：** 模板、角色库完整 UI、自动总结、Git 变更矩阵、冲突检测、导出、完整时间线、跨 machine、多用户协作。

## 验收标准建议

| 场景 | 验收标准 |
|------|----------|
| 创建 leader team | 用户创建 team 后，看到 team run、leader member、leader session link、MCP readiness；Gateway 无需解密目标正文。 |
| MCP 注入成功 | Leader session 可以调用 `mobvibe_team_task_create` 和 `mobvibe_team_send_message`，CLI store 出现对应记录。 |
| MCP 注入失败 | Team detail 显示 degraded/error phase，不把成员标记为可自治 running。 |
| Leader spawn member | Leader 请求 spawn 后，系统校验 backend MCP-over-ACP/bridge capability 和用户确认，创建普通 member session 并只对该 session 注入 MCP。 |
| 普通 session 不受影响 | 创建普通非 team session 时，`session/new` 不包含 `mobvibe-team` MCP server，agent 不会看到 team tools。 |
| Mailbox delivery | 消息先持久化，再 wake 目标；wake 失败时 UI 显示 wake_failed，消息不会丢失。 |
| Task board | Leader/成员创建和更新任务后，WebUI 显示 task counts/status，详情不经 Gateway 明文泄露。 |
| 权限阻塞 | 某成员发出 permission request 后，team detail 显示 member/session 归属，并跳转原 session 决策。 |
| 恢复 | Gateway 重启或 WebUI 刷新后，team run、成员、task/mailbox counts、session links 仍可恢复。 |
| 归档 | Team 从默认列表隐藏；成员 session WAL、mailbox/task refs 默认保留。 |

## 来源与置信度

- `.planning/research/AIONUI-ACP-TEAM.md`：AionUI team MCP、mailbox、task board、capability gating 研究（高置信）。
- ACP RFD `https://agentclientprotocol.com/rfds/mcp-over-acp`：per-session MCP transport、`mcpCapabilities.acp`、server id routing 和 bridge fallback（高置信）。
- `.planning/PROJECT.md`：修正后的目标、active requirements、out of scope、架构约束（高置信）。
- `.planning/codebase/ARCHITECTURE.md`：WebUI → Gateway → CLI → ACP 分层、WAL/E2EE/socket/session router 模式（高置信）。
- `.planning/codebase/CONCERNS.md`：Gateway registry 非持久、WAL/permission/E2EE 风险、性能限制（高置信）。
- 当前 shared/session/socket/CLI/WebUI store 源码模式（高置信）。

## 仍需后续确认的问题

- Mobvibe ACP backend discovery 如何可靠暴露 native `mcpCapabilities.acp`，以及 stdio/HTTP bridge 是否可安全限制在单个 team session。
- Mailbox/task 正文在 v1 是 CLI-local plaintext、encrypted payload，还是只保存 source refs。
- `mobvibe_team_*` 最小工具集合和 leader-only/user-confirmation policy。
- Wake/idle/completed 状态是否由 explicit tool 上报、session events 推断，还是两者结合。
- Member spawn 的默认 workspace/worktree 策略和并发上限。
