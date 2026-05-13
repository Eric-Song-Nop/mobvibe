# Phase 1 讨论记录

## 范围

本记录保存 Phase 1 进入实现前已确认的产品和架构决策。它不是实现说明；实现入口以 `01-CONTEXT.md` 为准。

## 已确认决策

| 领域 | 问题 | 结论 | 被拒绝或推迟的选项 |
|------|------|------|--------------------|
| 产品概念 | Mobvibe v1 的用户概念是什么？ | 使用 **Agent Team**，采用 AionUI 模型：leader、members、workspace、mailbox、task board、per-agent session links。 | 不把 “team run” 作为主要用户语言。 |
| 成员模型 | Team member 是否是特殊 session？ | 不是。每个 member 都是普通 ACP session，继续复用 WAL、E2EE、permission、文件、Git 和 session UI。 | 不建立并行 transcript 协议。 |
| WebUI 展示 | Agent Team 是否显示为普通 session 的一种？ | 不。按 AionUI 方向，Agent Team 是独立一级对象；team-owned member sessions 默认从普通 session 列表隐藏或折叠，只通过 Team detail 组织进入。 | 不采用 `Session(kind = "team")` 作为主模型。 |
| Gateway API | Agent Team 应暴露为资源 API 还是 generic machine RPC？ | 采用混合方案：WebUI/Gateway 使用 `/acp/agent-teams` 显式资源 API；Gateway 内部通过 typed CLI RPC 转发；CLI 仍是 durable truth。 | 不把 generic machine RPC 直接暴露给 WebUI；不让 Gateway 持久化 Agent Team truth。 |
| Spawn 边界 | Leader 是否可以直接创建成员？ | Leader 可以建议，但 `team_spawn_member` 必须经过 system policy 和用户确认。 | 不允许不受约束的自治 spawn。 |
| 内容边界 | mailbox/task 正文放哪里？ | CLI 本地可保存；Gateway/WebUI team snapshot 只传 ids/status/counts/refs/projection。 | 不在 Gateway 传明文；Phase 1 不要求 encrypted detail payload。 |
| 远程查看 | 用户如何查看 mailbox/task 相关内容？ | 用户可切换到任意 member ordinary session 查看完整 E2EE history；team projection 不复制正文。 | 不做 Gateway 明文详情。 |
| mailbox 审计 | agent 间 mailbox 是否进入普通 session history？ | 投递给目标 agent 后，应在目标 ordinary session history 中可见。 | 不做 mailbox-only hidden history。 |
| 状态模型 | 是否保留 `idle`/`ready`？ | 不保留。lifecycle 只表达创建/运行/完成/失败/取消/分离/归档；MCP、permission、activity 独立表达。 | 不把 idle/ready 写入 lifecycle。 |
| Source refs | refs 是否可以携带正文？ | 不可以。refs 只携带 `agentTeamId`、`memberId`、`sessionId`、`revision/seq`、`messageId`、`taskId` 等定位字段。 | 不通过 refs 传 mailbox/task/summary 正文。 |
| 恢复模型 | durable truth 在哪里？ | CLI SQLite 当前事实表是 truth；projection 可重建；Gateway 只做 presence 和转发。 | Phase 1 不新增 team append-only WAL。 |

## 状态模型确认

用户明确拒绝把 `idle` 或 `ready` 作为 member lifecycle 状态。最终模型拆为：

- Team lifecycle：`pending`、`starting`、`running`、`completed`、`failed`、`cancelled`、`archived`。
- Member lifecycle：`pending`、`creating_session`、`running`、`completed`、`failed`、`cancelled`、`detached`、`archived`。
- MCP readiness：`not_started`、`server_starting`、`server_ready`、`session_injecting`、`tools_waiting`、`tools_ready`、`degraded`、`error`。
- Permission/activity：通过 pending permission refs、mailbox counts、task counts、wake status 和 timestamps 表达。

## Source refs 确认

已确认 source refs 是强类型定位引用，不是内容容器。

允许引用：

- ordinary session：`sessionId`。
- ordinary session event：`sessionId` + `revision` + `seq`。
- mailbox message：`messageId` + sender/recipient member ids。
- task：`taskId` + owner member id。
- summary refs：上述 refs 的集合。

跳转优先级：优先跳 member ordinary session history；只有 metadata 的 mailbox/task ref 不尝试从 Gateway 拉正文。

## 恢复事实来源确认

已确认 Phase 1 使用 CLI SQLite 当前事实表作为 durable truth：

- `agent_teams` 保存 team identity、workspace、lifecycle、leader 和归档时间。
- `agent_team_members` 保存 member identity、role、backend、ordinary `sessionId`、lifecycle、health 和 worktree 信息。
- `agent_team_mcp_status` 保存 transport、server id、phase 和错误。
- `agent_team_mailbox_messages` 保存 CLI-local 正文、read/wake 状态和 source refs。
- `agent_team_tasks` 保存 CLI-local 正文、owner、status、依赖和 source refs。
- `agent_team_summary_refs` 保存 summary refs 和状态，不保存 summary 正文明文到 Gateway projection。

普通 session transcript 继续由现有 WAL 负责。Gateway 不成为 durable team store。

## 推迟事项

- 完整 Agent Team UI/UX 视觉和移动端 polish 属于 Phase 3/5。
- 真实 `mobvibe_team_*` tools、mailbox/task runtime 和 wake 行为属于 Phase 2。
- 用户取消、重试、归档的完整控制流属于 Phase 4。
- 自动 summary 只有在不破坏 E2EE 边界时才进入后续阶段。
