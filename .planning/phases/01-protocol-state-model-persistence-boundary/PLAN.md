# Phase 1 实现计划：协议、状态模型与持久化边界

## 目标

把 `01-CONTEXT.md` 中锁定的 Agent Team 协议、状态模型、WebUI 展示边界、内容边界和 CLI durable truth 落到代码结构中。Phase 1 完成后，系统应具备可创建、列出、读取和恢复的 Agent Team metadata/projection，但不启动 leader/member agent，也不提供真实 team MCP tools。

## 实施原则

- 先实现 shared 类型与红线，再接 CLI store，再接 Gateway/WebUI projection。
- Team metadata 是新模型；成员 transcript 继续由普通 session WAL 拥有。
- Agent Team 是独立一级对象，不是 `Session(kind = "team")`；team-owned member sessions 仍是 ordinary sessions，但默认由 Team detail 组织展示。
- Gateway-facing payload 默认不允许正文，所有 `body/content/description/summaryText` 类字段必须被排除或显式声明为 encrypted/local-only。
- `idle`/`ready` 不进入 lifecycle；MCP readiness、permission、activity 和 health 独立表达。
- Phase 1 只做 metadata/projection 的垂直闭环，不实现 MCP runtime、mailbox delivery wake、task tools 或 UI polish。

## 切片 1：Shared Team 类型契约

目的：让 WebUI、Gateway 和 CLI 使用同一套 Agent Team 类型。

变更范围：

- 新增 shared team 类型文件。
- 从 shared 入口导出 team 类型。
- 扩展 backend/session capability model，表达 `mcpCapabilities.acp`、stdio 和 per-session bridge fallback。
- 增加 Gateway-facing projection 类型和 CLI-local 内容类型边界说明。

关键类型：

- `AgentTeamLifecycle`、`TeamMemberLifecycle`、`TeamMcpPhase`、`TeamMcpTransport`、`TeamMemberHealth`。
- `AgentTeamSummary`、`TeamMemberSummary`、`TeamMailboxCounts`、`TeamTaskCounts`、`TeamMcpStatusSummary`。
- `TeamSourceRef` union。
- `CreateAgentTeamParams`、`CreateAgentTeamResult`、`ListAgentTeamsResult`、`GetAgentTeamParams`、`GetAgentTeamResult`。
- `AgentTeamsChangedPayload` 与 socket/RPC payload 类型。

验收：

- shared 类型不包含 mailbox/task/summary 正文字段的 Gateway-facing shape。
- `AgentSessionCapabilities` 可以表达 native ACP MCP support 和 safe bridge fallback。
- shared 入口能导出新增类型。

测试：

- 如果只新增类型，使用 `pnpm -C packages/shared build` 验证。
- 如新增 redaction helper，则补最小单测并运行对应测试。

## 切片 2：CLI TeamStore 与 SQLite schema

目的：建立 Phase 1 的 durable truth。

变更范围：

- 在现有 CLI SQLite migration 体系中新增 team tables。
- 新增 `TeamStore`，负责 create/list/get/update projection。
- 新增 projection builder，输出 Gateway-facing `AgentTeamSummary`。
- 保持 CLI-local body 字段只存在于 store 层，不出现在 projection。

建议 tables：

- `agent_teams`。
- `agent_team_members`。
- `agent_team_mcp_status`。
- `agent_team_mailbox_messages`。
- `agent_team_tasks`。
- `agent_team_summary_refs`。

最小行为：

- 创建 Agent Team metadata 时生成 `agentTeamId`、leader `memberId`，记录 machine、workspace、title、leader backend、workspace mode。
- leader member 初始 lifecycle 为 `pending` 或 `creating_session`，但 Phase 1 不创建 ACP session。
- 列表和详情从 SQLite 重建 projection。
- CLI 重启后通过同一个 DB 文件恢复 team projection。

验收：

- CLI 可以本地创建并恢复 Agent Team metadata。
- Projection 不包含 `body_local_json` 或任何正文。
- SQLite migration 可以从空 DB 和已有 WAL DB 正常迁移。

测试：

- `pnpm -C apps/mobvibe-cli test -- src/team/__tests__/team-store.test.ts`
- 覆盖 create/list/get、restart recovery、projection redaction、source refs roundtrip。

## 切片 3：CLI RPC 与 snapshot 事件

目的：让 Gateway 能通过现有 CLI socket RPC 获取 team projection。

变更范围：

- 在 CLI daemon socket client 中注册 team RPC handlers。
- 在 daemon 启动时初始化 `TeamStore`。
- 发出 `agent-teams:changed` 或等价 typed event，payload 只含 projection。

最小 RPC：

- `rpc:agent-team:create`。
- `rpc:agent-teams:list`。
- `rpc:agent-team:get`。

验收：

- RPC response 使用 shared 类型。
- 错误使用现有 `ErrorDetail` shape 或 team 扩展错误。
- 日志只包含 IDs、status、counts、error code，不记录正文。

测试：

- `pnpm -C apps/mobvibe-cli test -- src/daemon/__tests__/socket-client.test.ts`
- 根据测试粒度可新增 team RPC 专项测试。

## 切片 4：Gateway TeamRouter 与 HTTP routes

目的：让 WebUI 能经 Gateway 认证、授权并路由 team metadata RPC。

变更范围：

- 新增 team router service，复用 session router 的 RPC pending/timeout 模式，但按 machine/team 归属路由。
- 新增 team HTTP routes。
- 在 Gateway 启动入口挂载 routes。
- Phase 1 采用混合方案：WebUI/Gateway 暴露 `/acp/agent-teams` 显式资源 API；Gateway 内部通过 typed CLI RPC 转发；Gateway 不保存 durable team registry，列表和详情请求实时路由到用户的 CLI 后由 CLI TeamStore 返回 projection。

建议 endpoint：

- `POST /acp/agent-teams` 创建 metadata-only Agent Team。
- `GET /acp/agent-teams?machineId=...` 列出指定 machine 的 team projections；未提供 `machineId` 时 fan out 到当前用户在线 CLIs 后合并 projection。
- `GET /acp/agent-teams/:agentTeamId?machineId=...` 获取详情。

验收：

- 所有 routes 需要 `requireAuth`。
- machine 归属校验失败返回 generic authorization/not found，不泄漏其他用户资源。
- 请求体校验拒绝明文内容字段；Phase 1 create payload 只允许 title、machine、workspace、leader backend、workspace mode/worktree metadata。
- Gateway 不持久化 team durable truth。
- `/acp/agent-teams` 是 Gateway-facing control API，不代表 Gateway owns Agent Team state。

测试：

- `pnpm -C apps/gateway test:run -- src/routes/__tests__/agent-teams.test.ts`
- `pnpm -C apps/gateway test:run -- src/services/__tests__/team-router.test.ts`
- 覆盖 auth、machine ownership、RPC forwarding、plaintext rejection、error shape。

## 切片 5：WebUI API/store projection

目的：让前端可以消费 team projection，但不做完整 UI。

变更范围：

- 在 WebUI API client 中添加 agent-teams fetch/create/get 方法。
- 新增轻量 team store，保存 `AgentTeamSummary` by id 和 active/selected ids。
- Socket client 增加 team changed handler 类型，后续 UI 可订阅。
- 不把 member transcript、mailbox/task 正文复制进 team store。
- 普通 session list/store 增加 team-owned session 标记处理：默认隐藏或折叠 `agentTeamId` 关联的 member sessions，避免把成员会话当成不相关普通会话展示。

验收：

- Team store 只存 projection 和 source refs。
- 普通 session store 不需要知道 mailbox/task board 内容。
- 从 team member 可通过 `sessionId` 跳普通 session 的信息足够。
- 用户能在列表层面区分 Agent Team 与普通 session；member sessions 的审计入口由 Agent Team detail 提供。

测试：

- `pnpm -C apps/webui test:run -- src/lib/__tests__/team-store.test.ts`
- `pnpm -C apps/webui test:run -- src/lib/__tests__/api.test.ts`
- 覆盖 projection merge、redaction invariant、API path 和 error handling。

## 切片 6：文档与状态同步

目的：让后续 Phase 2/3 不重新打开 Phase 1 决策。

变更范围：

- 更新 Phase 1 文档，记录实际类型名、store schema 和 routes。
- 更新 `STATE.md`，把 Phase 1 从 context locked 更新为 implementation complete 或 next slice ready。
- 若实现中调整字段名，回写 `01-CONTEXT.md` 的“实施细节”段落。

验收：

- 文档能说明实际实现细节和使用方法。
- 未新增密钥或 env var；如新增配置必须同步文档。

## 总体验证命令

实现完成后按范围运行：

```bash
pnpm -C packages/shared build
pnpm -C apps/mobvibe-cli test -- src/team/__tests__/team-store.test.ts
pnpm -C apps/gateway test:run -- src/services/__tests__/team-router.test.ts
pnpm -C apps/gateway test:run -- src/routes/__tests__/agent-teams.test.ts
pnpm -C apps/webui test:run -- src/lib/__tests__/team-store.test.ts
pnpm -C apps/webui test:run -- src/lib/__tests__/api.test.ts
pnpm format
pnpm lint
pnpm build
```

如果执行时间过长，至少先跑 touched package 的 build/test，再在提交前跑根目录 `pnpm format && pnpm lint && pnpm build`。

## 实现前确认点

默认建议如下，若无异议即可按此执行：

- Endpoint 命名使用 `/acp/agent-teams`，产品和 WebUI 语言使用 Agent Team。
- Phase 1 create team 只创建 metadata，不创建 leader ordinary session。
- `agentTeamId`、`memberId`、`messageId`、`taskId` 使用 `crypto.randomUUID()`，不加业务前缀。
- CLI team tables 复用当前 WAL SQLite DB 与 migration 体系，不新增第二个 DB 文件。
- WebUI Phase 1 只增加 API/store 和 team-owned session 标记处理，不做完整可视 UI 页面。

## 非目标

- 不实现 MCP server、MCP-over-ACP injection 或 bridge runtime。
- 不实现 leader/member ordinary session 创建。
- 不实现 mailbox delivery、wake、read/unread tool runtime。
- 不实现 task board UI 或远程正文详情。
- 不实现 summary editor。
- 不修改 agent 全局 MCP 配置。
