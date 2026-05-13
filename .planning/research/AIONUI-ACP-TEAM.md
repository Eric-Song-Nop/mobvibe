# AionUI ACP Team 研究记录

**项目:** Mobvibe Agent Team  
**研究对象:** AionUI 的 ACP agent team 实现  
**研究日期:** 2026-05-12  
**结论置信度:** HIGH

## 研究结论

AionUI 的实现证明，真正可协作的 ACP agent team 不能只靠外部 orchestrator 给多个 session 分发 prompt。关键能力是：在本地进程为每个 team 启动一个 team MCP server，把该 MCP server 的 stdio 配置注入到成员 ACP session，让 agents 自己通过工具发送消息、维护任务板、创建或管理队友。

因此 Mobvibe Agent Team 的修正方向应是：

- Mobvibe CLI 本地拥有 team run、mailbox、task board、member session 映射和 MCP readiness 的持久化事实。
- Mobvibe 应优先使用 ACP 官方 MCP-over-ACP RFD 的 per-session MCP transport：只在 team leader/member 的 `session/new` 中声明 team MCP server，普通 agent session 不声明该 server，因此不受 team 功能影响。
- Gateway 只做认证、授权、RPC 路由和非内容 metadata 转发，不读取 prompt、mailbox、task 正文、summary 或 agent 输出明文。
- 每个 team member 仍然是普通 ACP session，继续复用现有 WAL、E2EE、permission、文件/Git、worktree 和 session UI。
- Leader agent 是协作脑；系统负责边界、确认、持久化、唤醒、恢复、权限和可观察性。
- 只有支持 native MCP-over-ACP 或安全 per-session bridge 的 ACP backend 才能作为自治 teammate；不支持的 backend 只能降级为普通 session 或非自治成员。

## AionUI 架构要点

### TeamSession 是轻协调器

AionUI 的 `TeamSession` 同时拥有：

- `Mailbox`：持久化 agent 间消息。
- `TaskManager`：持久化任务板和依赖关系。
- `TeammateManager`：管理 agent 状态、wake、rename、remove。
- `TeamMcpServer`：向 ACP agents 暴露团队协作工具。

它不是把所有 agent 输出聚合进一个主 session，而是让每个 agent 保持自己的 conversation/session，同时通过 mailbox 和 task board 协作。

### Team MCP server 是协作通道

AionUI 每个 team 拥有一个 `TeamMcpServer`。该 server 在本地监听 loopback TCP，并返回一个 stdio MCP 配置。ACP session 创建时注入这个配置，agent 就能调用 team tools。

关键实现点：

- MCP server 有 per-team token，stdio bridge 请求必须携带 token。
- stdio config 会带 `TEAM_AGENT_SLOT_ID`，server 能识别调用者身份。
- MCP readiness 有明确 phase，例如 `tcp_ready`、`session_injecting`、`mcp_tools_ready`、`degraded`。
- tool handler 失败会返回错误；wake 失败会记录，但不会把已经持久化的消息回滚成未送达。

### 工具集合定义了协作语义

AionUI 暴露的团队工具包括：

- `team_send_message`：向指定成员或广播发送消息。
- `team_spawn_agent`：创建新队友；实现中限制非 leader 不能 spawn。
- `team_task_create`：创建任务。
- `team_task_update`：更新任务状态、owner。
- `team_task_list`：查看任务板。
- `team_members`：查看团队成员和状态。
- `team_rename_agent`：重命名成员。
- `team_shutdown_agent`：请求成员下线，不能关闭 leader。
- `team_describe_assistant`：查看可 spawn 的 assistant/preset。
- `team_list_models`：查看可用模型。

Mobvibe 不必逐字照搬工具名，但 v1 文档需要覆盖同等能力：消息、任务、成员列表、受控 spawn、受控下线、MCP readiness 和能力校验。

### Mailbox 是 durable delivery，不是临时 prompt 拼接

AionUI 的 mailbox 写入包含 `teamId`、`toAgentId`、`fromAgentId`、`content`、`summary`、`files`、`read` 和时间戳。读取未读消息时会原子标记已读，避免并发重复读取。

对 Mobvibe 的启发：

- team message 应有 durable ID、发送者、接收者、状态和时间戳。
- Gateway 不应看到 mailbox 正文明文；正文需要留在 CLI/WebUI 可信域或以加密 payload 存储。
- “消息已持久化”和“目标 agent 已成功 wake”是两个状态，不能混为一个成功/失败布尔值。

### Task board 是团队事实来源的一部分

AionUI 的 task board 支持创建、更新、列出任务，并维护 `blockedBy` / `blocks` 双向依赖。任务状态至少包含 `pending`、`in_progress`、`completed`、`deleted`。

对 Mobvibe 的启发：

- v1 不应把任务拆解只放在 leader prompt 中；任务板本身需要持久化。
- WebUI team detail 应展示 task board 状态、owner、阻塞关系和最近更新时间。
- 任务正文如果包含用户需求或 agent 输出，不能进入 Gateway 明文字段。

### MCP-over-ACP 是隔离机制

ACP 官方 RFD `MCP-over-ACP: MCP Transport via ACP Channels` 提议在 `session/new` 的 `tools.mcpServers` 中添加 `transport: "acp"` 和 component-generated `id`。Agent 调用工具时通过同一 ACP channel 发回 `mcp/connect`、`mcp/message`、`mcp/disconnect`，由提供 MCP server 的 client/proxy/CLI 处理。

这正好解决 Mobvibe 的隔离要求：

- Team tools 只随 team leader/member session 注入，不写入全局 agent MCP 配置。
- 普通 Mobvibe session 不包含 `mobvibe-team` MCP server，因此普通 agent 使用路径不变。
- 每个 team/session 使用唯一 MCP server id，tool callbacks 能路由回正确 team run 和 member。
- 如果 agent 不支持 native `mcpCapabilities.acp`，可以用 per-session bridge 把 ACP transport 翻译成 stdio/HTTP；bridge 也只服务该 team session，不污染其他 agent 使用。

### Team-capable backend 必须看 MCP transport 能力

AionUI 判断 team-capable backend 的核心标准是 backend 的 initialize result 中 `capabilities.mcpCapabilities.stdio === true`，并保留一小组已知可用 backend 作为临时兼容。Mobvibe 应结合 ACP MCP-over-ACP RFD 更新这个标准：优先使用 native `mcpCapabilities.acp`；如果没有 native ACP transport，再使用只作用于 team session 的 stdio bridge；如果二者都不可用，则该 backend 不能作为自治 teammate。

对 Mobvibe 的启发：

- `AgentSessionCapabilities` 或 backend discovery 需要暴露 MCP-over-ACP 和 stdio bridge readiness。
- 创建/添加自治 teammate 前必须做 per-backend capability check。
- 不支持 native MCP-over-ACP 且无法 per-session bridge 的 backend 不应被静默加入自治 team，否则 leader 发出的 mailbox/task 工具调用无法到达成员。

## Mobvibe 设计修正

### 原误解

早期文档把 team run 主要描述成“跨 session metadata、生命周期和 UI 聚合”，并强调外部编排器把全局目标和成员 prompt 分发到多个普通 session。这个模型只能形成“多个相关 session”，不能形成 agents 主动通信和协作的 team。

### 修正模型

Mobvibe v1 应采用以下模型：

1. WebUI 创建 team run：选择 machine、workspace、目标任务、leader backend、workspace/worktree 策略和可选成员模板。
2. Gateway 认证并把 intent 路由到目标 CLI；Gateway 不读取内容明文。
3. CLI 持久化 team run，启动 team MCP server、mailbox、task board 和 leader 普通 ACP session。
4. CLI 优先通过 MCP-over-ACP 在 leader `session/new` 中声明 team MCP server；必要时使用 per-session stdio bridge，并在 MCP ready 后发送用户目标。
5. Leader agent 通过 `mobvibe_team_*` tools 拆分任务、创建/分配任务、请求 spawn 成员、发送消息和汇总进展。
6. CLI 对 spawn/shutdown/跨 workspace/高风险操作执行系统规则和用户确认，然后创建或停止普通 member ACP session。
7. WebUI 展示 team run、leader/member session、task board、mailbox 活动、MCP readiness、permission、错误和 summary refs。

## 对路线图的影响

- Phase 1 必须定义 shared team 类型、MCP-over-ACP/bridge readiness、mailbox/task board 类型、能力校验字段和内容边界。
- Phase 2 应优先实现 CLI team MCP server + durable mailbox/task board 的本地垂直切片，而不是只做多 session prompt fan-out。
- Phase 3 才把 WebUI/Gateway/CLI 串成最小 end-to-end team run。
- Phase 4 需要重点验证 wake/idle、权限归属、E2EE、MCP tool abuse 和恢复。
- Phase 5 再做移动端、任务板可视化、导出、Git/worktree polish 和规模化订阅。

## Sources

- AionUI `TeamSession`：team owns mailbox、task manager、teammate manager、MCP server。
- AionUI `TeamMcpServer`：team tools、stdio MCP config、loopback TCP bridge、token、readiness、leader-only spawn。
- AionUI `Mailbox`：durable write、read unread and mark read、history。
- AionUI `TaskManager`：task create/update/list、blockedBy/blocks dependency maintenance。
- AionUI `teamTypes`：team-capable backend check based on `mcpCapabilities.stdio`。
- AionUI agent-team guide flow：solo agent suggests team, user confirms, MCP creates team and navigates to team page。
- ACP RFD `MCP-over-ACP: MCP Transport via ACP Channels`：per-session MCP server injection over ACP channels, `mcpCapabilities.acp`, component-generated MCP server id, and bridge fallback.
