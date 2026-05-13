# Mobvibe Agent Team 研究综合摘要

**项目：** Mobvibe Agent Team  
**领域：** 分布式 ACP WebUI 上的本地多 agent 团队协作
**研究日期：** 2026-05-12  
**总体置信度：** HIGH

## 执行摘要

Mobvibe Agent Team v1 的正确模型不是“多个 session 的 prompt fan-out + UI 聚合”。修正后的核心是：**Mobvibe CLI 本地为每个 team run 启动 team MCP server，并只把 `mobvibe_team_*` 工具注入到 leader/member ACP session；agents 通过 durable mailbox 和 task board 协作；每个成员仍然是普通 ACP session**。

这个设计同时保留 Mobvibe 现有价值：WebUI → Gateway → CLI daemon → ACP agent 分层不变，成员 session 继续复用 WAL、E2EE、permission、worktree、文件/Git、Socket.io 与历史恢复。新增的是 team 事实来源：team run、leader/member 映射、MCP readiness、mailbox、task board、wake/idle 状态和 summary refs 必须由 CLI 本地持久化，Gateway 只做认证、授权和路由。

AionUI 的实现给出明确证据：ACP agent team 需要本地 team MCP server、mailbox、task manager、teammate manager 和 MCP capability gating。ACP 官方 MCP-over-ACP RFD 进一步给出隔离机制：client/proxy 可以在单个 `session/new` 中声明 `transport: "acp"` 的 MCP server，tool callbacks 通过同一 ACP channel 回到提供方。Mobvibe 因此可以只给 team session 注入 team tools，普通 agent session 不声明该 server、不受影响。只靠 supervisor 把 prompt 分发给多个 session，无法让 agents 主动互相发送消息、领取任务、创建队友、更新进展或处理下线。

## 最高优先级建议

1. **Team MCP server 是 v1 核心，不是后续增强。** 没有工具注入，team 只是多个相关 session。
2. **成员仍必须是普通 ACP session。** 不重写 ACP、不复制成员 WAL、不做 team 专属 chat runtime。
3. **CLI 是 v1 durable owner。** Team run、mailbox、task board、MCP readiness、member-to-session 映射贴近本地 ACP processes，应在 CLI SQLite/WAL 域恢复。
4. **Gateway 永远不接触内容明文。** Prompt、mailbox 正文、task 正文、summary 正文和 agent 输出都不能进入 Gateway DB/log/route 明文字段。
5. **MCP-over-ACP 是首选隔离机制。** Team tools 应通过 per-session ACP transport 注入；没有 native 支持时只能用 per-team-session bridge，不能修改全局 agent MCP 配置。
6. **只允许 team-capable backend 自治协作。** 能作为 leader/member 的 backend 必须支持 native MCP-over-ACP，或支持仅作用于 team session 的 bridge；否则降级为普通 session 或非自治成员。
7. **Leader agent 是协作脑，Mobvibe 是边界和事实来源。** Leader 拆分任务和协调成员；系统控制 spawn/shutdown、权限、恢复、workspace、持久化和用户确认。

## v1 Table Stakes

- **Team run 创建入口：** 用户选择同一 machine/workspace、目标任务、leader backend、worktree 策略和可选成员模板。
- **Leader 普通 session：** CLI 创建 leader ACP session，并在发送目标任务前注入 team MCP server 配置。
- **Team MCP readiness：** WebUI 能看到 MCP-over-ACP 或 bridge 的 `server_ready`、`session_injecting`、`mcp_tools_ready`、`degraded`、`session_error` 等状态。
- **Durable mailbox：** Agents 可以通过工具给 leader、成员或全体发送消息；消息有发送者、接收者、时间戳、read 状态和 wake 结果。
- **Durable task board：** Agents 可以创建、领取、更新、完成任务；任务至少有 status、owner、blockedBy/blocks 和更新时间。
- **受控成员创建：** Leader 可以请求 spawn/rename/shutdown 成员；系统执行 capability check、用户确认和权限边界。
- **成员普通 session 映射：** 每个 leader/member 都有可跳转的普通 `sessionId`，保留完整聊天、权限、文件/Git 与历史。
- **Team 总览：** WebUI 展示 leader/member、session 链接、MCP readiness、task board、mailbox 活动、错误、permission 等待和 summary refs。
- **生命周期与恢复：** 刷新、Gateway 重启、CLI 重连后，team run、member mapping、mailbox、task board 和 MCP readiness 可恢复或显示可解释的 degraded 状态。
- **Summary v1：** Summary 只保存 source refs 或可信域/加密内容；用户能从 summary 跳回成员 session、mailbox message 或 task。

## 架构决策

| 层 | 决策 | 责任 |
|---|---|---|
| `packages/shared` | 新增 team、MCP readiness、mailbox、task board、tool policy 类型 | 保证 WebUI/Gateway/CLI payload 不漂移 |
| WebUI | Team 创建、监控、task/mailbox projection、权限定位 | 不复制成员 transcript，不保存大量明文输出 |
| Gateway | Team routes/RPC router、auth、machine/user 授权、presence 转发 | 不持久化内容明文，不作为 durable truth |
| CLI | TeamStore、TeamMcpServer、MailboxStore、TaskBoardStore、TeamSessionManager | 持久化事实来源，创建普通 ACP session，注入 MCP，wake agents |
| ACP backend | 普通 session + MCP tools | 只有支持 native MCP-over-ACP 或 per-session bridge 的 backend 才能自治协作 |

## 推荐数据所有权

- **成员 session 内容/事件：** 继续由 CLI WAL `session_events` 拥有。
- **Team run metadata：** CLI 本地 SQLite/WAL 域拥有；Gateway 可缓存在线 snapshot。
- **Mailbox/task board：** CLI 本地持久化；正文若含用户或 agent 内容，不进入 Gateway 明文。
- **MCP readiness：** CLI 持久化最新状态，并通过 socket/RPC 投影到 Gateway/WebUI。
- **Member ↔ session 映射：** CLI 本地持久化；WebUI/Gateway 只消费 snapshot。
- **Summary：** 保存 source refs；如保存正文，必须在 WebUI/CLI 可信域或加密 payload 中。

## 主要风险与缓解

1. **遗漏 team MCP server，只做多 session prompt fan-out。**
   **缓解：** Phase 2 先做 CLI team MCP server + mailbox/task board 本地垂直切片，再做完整 UI。

2. **MCP 注入失败但 UI 仍显示 team running。**
   **缓解：** 明确定义 MCP readiness phase；未 `mcp_tools_ready` 的成员不能标记为可自治。

3. **Mailbox message 持久化和 wake 结果混淆。**
   **缓解：** `accepted`、`wake_pending`、`wake_failed`、`read` 分离；wake 失败不回滚已投递消息。

4. **Task board 正文或 mailbox 正文明文穿过 Gateway。**
   **缓解：** shared 类型禁止 Gateway-facing payload 携带 plaintext content；日志只记录 id/count/status。

5. **非 team-capable backend 被加入自治 team。**
   **缓解：** 创建 leader/member 前检查 `mcpCapabilities.acp`、per-session bridge 可用性或等价能力；不支持则降级或阻止。

6. **权限请求误归属。**
   **缓解：** UI 始终展示 `teamRunId/memberId/sessionId/requestId`；最终决策仍走普通 session permission path。

7. **取消/重试/归档只改 team 状态。**
   **缓解：** 对 MCP server、mailbox wake、member session、pending permission 和 task ownership 做 per-member allSettled 处理。

## 建议阶段顺序

### Phase 1：协议、状态模型与持久化边界

定义 shared team/MCP-over-ACP/bridge/mailbox/task 类型、状态机、内容边界和 CLI durable store；不启动 agent。

### Phase 2：CLI Team MCP + Mailbox + Task Board

在 CLI 本地实现 team MCP server、tool dispatch、mailbox、task board、MCP-over-ACP 或 per-session bridge readiness 和 backend capability gating；用测试验证 tool 到 store 的闭环。

### Phase 3：最小端到端 Team Run

WebUI 创建 team intent，Gateway 路由到 CLI，CLI 创建 leader 普通 ACP session 并注入 MCP；leader 可通过工具创建任务、发送消息并受控 spawn 成员。

### Phase 4：生命周期、权限、E2EE 与恢复加固

补 cancel/retry/archive、wake/idle、permission 聚合、missing key、Gateway/CLI 重连、MCP degraded 恢复和安全日志。

### Phase 5：UI 规模化与 v1 polish

完善移动端、team monitor、任务板可视化、mailbox 活动、Git/worktree 轻量提示、导出和订阅性能。

## Phase 1 必须解决的开放决策

1. **CLI store schema：** Team run、member、mailbox、task、MCP readiness 是否共用现有 WAL SQLite，还是新增 team store 模块。
2. **Gateway-facing payload 红线：** 哪些字段只允许 id/status/count，哪些必须是 encrypted payload 或 source ref。
3. **MCP tool 命名与权限策略：** `mobvibe_team_*` 工具最小集合、leader-only 工具、用户确认边界。
4. **Team-capable backend 检测：** Mobvibe 当前 ACP initialize/capabilities 如何暴露 `mcpCapabilities.acp`，以及 stdio/HTTP bridge 能否只作用于 team session。
5. **Wake/idle 模型：** mailbox 写入、agent wake、agent read、agent idle/completed 的状态如何定义和恢复。
6. **Summary 归属：** Summary v1 是 source refs + 用户编辑，还是普通 summarizer session；自动 summary 不进入 Phase 1/2。

## 来源

- `.planning/research/AIONUI-ACP-TEAM.md` — AionUI team MCP/mailbox/task board 研究记录。
- `.planning/PROJECT.md` — 修正后的项目目标、需求、约束和决策。
- `.planning/research/ARCHITECTURE.md` — 修正后的 Mobvibe team architecture。
- `.planning/research/FEATURES.md` — v1 table stakes、差异化和反功能。
- `.planning/research/PITFALLS.md` — 关键失败模式和验证清单。
- `.planning/research/STACK.md` — 技术栈和协议边界建议。
- ACP RFD `https://agentclientprotocol.com/rfds/mcp-over-acp` — per-session MCP-over-ACP transport and bridge compatibility model.

---
*Research synthesis updated: 2026-05-12 after AionUI ACP team correction*
*Ready for roadmap: yes*
