# Phase 4: 生命周期、权限、E2EE 与恢复 - Context

**Gathered:** 2026-05-14T00:00:00Z
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 4 在 Phase 3 的最小端到端 Agent Team run 之上补齐安全可控的运行生命周期：取消、失败成员重试、归档、权限等待聚合、刷新/重连恢复、E2EE 内容边界强化，以及用户可编辑的结构化 team summary/source refs。

本阶段的目标是让用户在 team run 出错、被取消、部分成员 degraded、权限等待、Gateway/CLI 重连或 WebUI 刷新后仍能理解当前事实并采取操作。它不交付复杂移动端 polish、多团队规模化浏览、完整活动时间线、自动代码合并、跨 machine team、多用户审计或自动 summary agent 编排。这些保持在 Phase 5 或 v2。

</domain>

<decisions>
## Implementation Decisions

### 取消语义
- **D-01:** Cancel team run 是用户显式操作，作用于 team coordination lifecycle，而不是删除或硬重置底层 ordinary sessions。
- **D-02:** Cancel 应尝试逐个处理 running/starting members：取消普通 ACP session、停止或降级该成员的 MCP readiness、清理 pending wake，并把 pending permission 标记为取消后的不可继续状态。
- **D-03:** Cancel 结果必须是 per-member 可见结果：cancelled、already_completed、already_failed、not_started、detach_failed、session_cancel_failed 或 mcp_cleanup_failed 等可解释状态；不要只给 team-level success/fail。
- **D-04:** 已完成成员不因 team cancel 被改写为 cancelled；team run 可以进入 cancelled_with_results 或等价的 partial terminal 表达。
- **D-05:** 若普通 session cancel 不可用或失败，team member 应进入 degraded/detached，而不是假装已取消。

### 重试语义
- **D-06:** Retry 只允许针对 failed、degraded、detached、cancelled 或 missing-session 的非成功成员；默认不重跑 completed members。
- **D-07:** Retry 创建新的 attempt 和新的 ordinary sessionId，并重新经历 MCP injection/readiness；旧 attempt/session 保留为历史 source ref，不覆盖。
- **D-08:** Phase 4 不引入 per-member 独立 worktree；重试默认复用 team shared checkout/worktree 语义。若 shared checkout 不可恢复，重试成员应 degraded 并解释原因。
- **D-09:** Retry 的目标上下文不通过 Gateway 明文传输。成员重试 prompt/上下文应来自 CLI-local facts、ordinary session refs、用户在 WebUI 通过既有 E2EE session path 补充的内容，或 metadata-only retry intent。
- **D-10:** 重试成功不自动清除旧失败事实；overview 应展示当前 attempt 和最近失败摘要，同时保留 source refs。

### 归档语义
- **D-11:** Archive 只归档 team metadata/projection 默认可见性，不删除 leader/member ordinary session WAL、mailbox、task board 或 summary refs。
- **D-12:** Archived team run 默认从 active sidebar/list 隐藏或折叠，但仍可通过 archived filter 或直接链接访问。
- **D-13:** 已归档 team 不允许新的 spawn/retry/cancel 等运行时变更；若用户需要继续，应先 unarchive 或后续阶段提供 clone/new run，不在 Phase 4 自动恢复运行。
- **D-14:** Archive 操作应保持 Gateway-facing projection metadata-only，不携带 archive reason 的长文本内容，除非该字段被明确限制为短 metadata。

### 权限聚合
- **D-15:** 权限事实仍归 ordinary session 拥有；Agent Team projection 只聚合 permission waiting metadata：memberId、sessionId、count、oldestRequestedAt、permission kind/summary-safe label、lastUpdatedAt。
- **D-16:** Team detail 只提供等待权限的聚合提示和跳转入口；实际批准/拒绝仍在对应 ordinary session 的现有权限 UI 完成。
- **D-17:** 不做批量自动授权或跨成员一键批准。Phase 4 可以提供逐成员跳转，不引入会放大权限风险的 team-level approve-all。
- **D-18:** 当 team 被取消或成员 detached 后，仍可显示遗留 pending permission，但要标注该 team/member lifecycle 已不再运行，避免用户误判。

### 恢复与降级
- **D-19:** CLI durable store 是 team truth。Gateway 重启后只恢复 connected CLI 的 snapshot；Gateway 不补建 durable team truth。
- **D-20:** WebUI 刷新后通过 list/get 重新拉取 team projection，并通过 `agent-teams:changed` 增量更新；本地 persisted team-store 只能作为临时 UI 缓存，不能胜过 CLI projection。
- **D-21:** CLI 重连时应重新发布当前 team snapshots，并把无法恢复 MCP server/bridge、missing ordinary session、missing worktree、unknown member session 映射表达为 degraded，而不是丢弃 team。
- **D-22:** Recovery 不自动重启 agents 或重新发送用户目标。自动恢复只恢复 metadata、MCP readiness 能力检查、mailbox/task counts、member-to-session 映射和可解释 degraded 状态。
- **D-23:** mailbox wake retry 的既有 carry-forward 问题在 Phase 4 处理：不要在成功注入前把 unread mailbox 行永久标记为已读；需要把 read/unread 与 wake/injection success 分离清楚。

### E2EE、日志与内容边界
- **D-24:** Gateway routes、socket relay 和 logs 只能处理 metadata-only Agent Team payload；禁止 provider token、master secret、DEK、plaintext target、mailbox body、task body、summary body、agent output 进入 Gateway 明文日志或持久化。
- **D-25:** 新增 cancel/retry/archive/summary routes 必须沿用 user/machine/team/session ownership 校验；不能只凭 teamRunId 转发。
- **D-26:** Summary v1 是用户可编辑的结构化 summary，内容存放在 CLI-local 或 E2EE ordinary-session-owned 路径；Gateway-facing projection 只暴露 summary metadata 和 source refs。
- **D-27:** Source refs 必须足够让用户跳转回 member session、mailbox message 或 task，但不能把正文塞进 ref label。
- **D-28:** 日志安全不是只靠禁止字段名；需要在 route boundary、projection builder 和 error serialization 三处避免把 request body、tool args、provider errors 原样记录到 Gateway/WebUI-facing errors。

### UI 形态
- **D-29:** Phase 4 延续 Phase 3 的 overview + jump model，不构建 AionUI 式多列嵌入聊天。
- **D-30:** Team detail 增加最小控制区：cancel、retry failed/degraded、archive，以及 permission waiting 聚合入口。
- **D-31:** 操作按钮应按 lifecycle/archived/permission/degraded 状态禁用并解释原因；不要展示会失败但无说明的按钮。
- **D-32:** UI-07 的完整桌面/移动端 polish 留到 Phase 5；Phase 4 只保证新增控制在现有 desktop/mobile layout 中不阻塞关键路径。

### the agent's Discretion
- 下游 planning agents 可以决定具体 enum 命名、RPC 路由拆分、attempt 表结构和 UI 组件边界，但必须保留上面的用户可见语义与内容边界。
- 如果现有 shared 类型已能表达某些状态，优先扩展最小字段；不要引入并行状态机。
- 如果 cancel/retry/archive 计划拆分过大，优先按 CLI truth + shared contract + Gateway route + WebUI controls 的垂直切片切分。

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Scope And Prior Phase Decisions
- `.planning/PROJECT.md` — 产品模型、Gateway 内容边界、CLI durable truth、当前 Phase 4 active requirements。
- `.planning/REQUIREMENTS.md` — Phase 4 requirement mapping: LIFE-02 through LIFE-06, UI-06, SEC-01 through SEC-04。
- `.planning/ROADMAP.md` — Phase 4 goal/success criteria and Phase 5 boundary。
- `.planning/STATE.md` — Phase 1/2/3 implementation decisions and carry-forward blockers。
- `.planning/phases/01-protocol-state-model-persistence-boundary/01-CONTEXT.md` — 状态模型、source refs、projection safety、lifecycle 拆分维度。
- `.planning/phases/02-cli-team-mcp-mailbox-task-board/02-CONTEXT.md` — Team MCP runtime、mailbox/task durable facts、caller binding、wake semantics。
- `.planning/phases/03-team-run/03-CONTEXT.md` — 创建即启动、ordinary session ownership、team shared checkout、overview + jump UI。

### Current Mobvibe Code
- `packages/shared/src/types/agent-team.ts` — Agent Team projection/member/MCP/source ref/RPC 类型，Phase 4 应在这里补 cancel/retry/archive/summary/attempt payload。
- `apps/gateway/src/routes/agent-teams.ts` — Gateway Agent Team REST routes，新增 lifecycle routes 时必须保持认证、ownership 和 forbidden content checks。
- `apps/gateway/src/services/team-router.ts` — Gateway-to-CLI typed Agent Team RPC forwarding。
- `apps/gateway/src/socket/cli-handlers.ts` — CLI team RPC responses and `agent-teams:changed` relay。
- `apps/gateway/src/socket/webui-handlers.ts` — user-scoped socket event forwarding。
- `apps/mobvibe-cli/src/team/agent-team-store.ts` — CLI durable Agent Team truth、member rows、mailbox/task/summary metadata and projection source。
- `apps/mobvibe-cli/src/team/projection-builder.ts` — Gateway-facing projection and plaintext/secret boundary enforcement。
- `apps/mobvibe-cli/src/team/team-runtime.ts` — Mailbox wake/injection runtime, member completion notification, pending wake semantics。
- `apps/mobvibe-cli/src/team/team-mcp-router.ts` — Team MCP readiness/caller binding; cancel/retry must preserve per-session isolation。
- `apps/mobvibe-cli/src/team/team-tool-handlers.ts` — Team tool policy and lifecycle tool request handling。
- `apps/mobvibe-cli/src/acp/session-manager.ts` — Ordinary session lifecycle, cancellation, WAL, E2EE, permission handling, team session creation。
- `apps/mobvibe-cli/src/daemon/socket-client.ts` — CLI-side Agent Team RPC handling and snapshot publication。
- `apps/webui/src/lib/api.ts` — Agent Team API client additions for lifecycle operations。
- `apps/webui/src/lib/team-store.ts` — projection-only Agent Team Zustand store and forbidden content stripping。
- `apps/webui/src/components/session/SessionSidebar.tsx` — Team parent/member placement and archived visibility implications。
- `apps/webui/src/components/team/AgentTeamOverview.tsx` — Minimal overview surface for controls, permission aggregation and summary metadata.

### AionUI Reference Implementation
- `../AionUi/src/process/team/TeamSessionService.ts` — Reference team shutdown/repair lifecycle and teammate management.
- `../AionUi/src/process/team/TeamSession.ts` — Reference coordinator-owned team facts and MCP server lifecycle.
- `../AionUi/src/process/team/TeammateManager.ts` — Reference wake guards, member lifecycle updates, crash handling, and repair cues.
- `../AionUi/src/process/team/mcp/team/TeamMcpServer.ts` — Reference team tool lifecycle operations and member resolution.
- `../AionUi/src/renderer/pages/team/TeamPage.tsx` — Reference status/permission affordances; use as inspiration only, not as UI scope expansion.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Phase 3 已经把 Agent Team leader/member 绑定到 ordinary ACP sessions；Phase 4 的 cancel/retry/permission jump 应复用 ordinary session lifecycle 和 permission UI。
- AgentTeamStore 已经是 durable truth；新增 attempt、archive、summary metadata 和 per-member operation result 应优先扩展这里。
- Projection builder 已经承担 plaintext/secret boundary；Phase 4 应继续让所有 Gateway/WebUI-facing payload 走同一投影路径。
- WebUI `team-store` 已经 strip forbidden content keys；新增 summary/permission fields 必须保持 metadata-only。
- Gateway `agent-teams:changed` 已经 user-scoped relay；恢复和重连应复用 snapshot/list/get，而不是创建新事件通道。

### Established Patterns
- Gateway 认证和路由 typed RPC，不拥有 durable team facts。
- Ordinary sessions 拥有 WAL、E2EE、权限、agent 输出和具体会话历史。
- Agent Team projection 只表达 coordination metadata、counts、safe errors 和 source refs。
- Team lifecycle 与 member lifecycle 分离；MCP readiness、permission waiting、health/degraded 和 activity counts 是独立维度。

### Integration Points
- Shared: 定义 lifecycle operation RPC、member attempt、archive flag、permission waiting projection、summary metadata/source refs。
- Gateway: 增加 authenticated lifecycle routes，校验 user/machine/team/session ownership，禁止内容字段，转发到 CLI。
- CLI: 实现 cancel/retry/archive/restore/summary metadata mutations，调用 ordinary session cancel/create，并发布 projection。
- WebUI: 增加 overview controls、permission waiting badges/jumps、archived filtering、retry failed/degraded action and summary editor metadata surface。
- Tests: 覆盖 shared type contract、Gateway forbidden content/ownership、CLI lifecycle operation result、WebUI projection-only rendering and disabled states。

</code_context>

<specifics>
## Specific Ideas

- Cancel route 可以先做 `POST /acp/agent-teams/:teamRunId/cancel`，返回 updated projection + per-member operation result。
- Retry route 可以先做 `POST /acp/agent-teams/:teamRunId/members/:memberId/retry` 或 batch retry failed/degraded；保持 metadata-only，不携带 prompt 明文。
- Archive route 可以是 `POST /archive` / `POST /unarchive`，但 Phase 4 只要求 archive；unarchive 可作为小范围补充而非必须。
- Permission projection 可以从 ordinary session pending permission store/event 中派生，不复制权限正文。
- Summary v1 优先做用户编辑的结构化字段加 source refs；自动 summary 留到不破坏 E2EE 时再做。
- Recovery verification 应模拟 WebUI refresh、Gateway restart-like list/get、CLI reconnect snapshot，以及 missing session/degraded projection。

</specifics>

<deferred>
## Deferred Ideas

- Full mobile/desktop polish and scaled team browsing remain Phase 5。
- Per-member worktree isolation, merge/conflict matrix and automatic code merge remain v2/future。
- Batch approve-all permissions remain out of scope for v1。
- Automatic summary agent or cloud-side summary remains deferred until E2EE-safe design is explicit。
- Cross-machine team and multi-user team management remain out of scope for v1。

</deferred>

---

*Phase: 4-生命周期、权限、E2EE 与恢复*
*Context gathered: 2026-05-14T00:00:00Z*
