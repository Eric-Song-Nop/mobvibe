# Requirements: Mobvibe Agent Team

**Defined:** 2026-05-12  
**Core Value:** 用户可以在一个 Mobvibe 团队任务中安全地协调多个不同 ACP agent，让它们围绕同一代码目标并行或顺序协作，并清楚看到每个 agent 的进展、任务、消息、产出和最终汇总。

## v1 Requirements

Requirements for the first agent team release. Each requirement must map to exactly one roadmap phase.

### Team Model

- [x] **TEAM-01**: 用户可以拥有一个稳定的 team run 对象，包含 `teamRunId`、title、machine、workspace、leader、状态和创建/更新时间。
- [x] **TEAM-02**: Team run 可以包含 leader 和 member；每个成员包含 `memberId`、role、backendId、sessionId 关联、MCP phase、worktree 策略和状态。
- [x] **TEAM-03**: CLI 可以本地持久化 team run、member 映射、MCP readiness、mailbox、task board 和 summary source refs，并在 CLI 重启后恢复。
- [x] **TEAM-04**: WebUI、Gateway 和 CLI 使用 `packages/shared` 中统一的 team、MCP、mailbox、task、RPC payload、状态枚举和错误结构。
- [x] **TEAM-05**: Team metadata、mailbox metadata、task metadata 和 summary refs 明确区分 Gateway-facing 非内容字段、加密 payload、CLI-local 内容和 source refs。

### MCP Isolation And Capabilities

- [x] **MCP-01**: CLI 可以为每个 team run 启动或恢复一个 team MCP server，并暴露 `mobvibe_team_*` 工具给该 team 的 leader/member session。
- [x] **MCP-02**: Team tools 优先通过 ACP 官方 MCP-over-ACP per-session transport 注入：只在 team `session/new` 的 `tools.mcpServers` 中声明 team MCP server。
- [x] **MCP-03**: 普通非 team session 不包含 `mobvibe-team` MCP server declaration，不能看到或调用 team tools。
- [x] **MCP-04**: 如果 backend 不支持 native `mcpCapabilities.acp`，系统只能使用仅作用于该 team session 的 stdio/HTTP bridge；不得修改 agent 全局 MCP 配置。
- [x] **MCP-05**: 创建 leader/member 或 spawn member 前，系统必须校验 backend 支持 native MCP-over-ACP 或安全 per-session bridge；否则阻止或降级为非自治成员。
- [x] **MCP-06**: 系统持久化并展示 MCP readiness phase，例如 server_ready、session_injecting、tools_ready、degraded 和 error。
- [x] **MCP-07**: Team MCP tools 必须携带可验证的 team/member caller identity，并按 tool policy 执行 leader-only、用户确认和 workspace 限制。

### Coordination Runtime

- [x] **COORD-01**: Agent 可以通过 `mobvibe_team_send_message` 向 leader、指定 member 或全体发送 durable mailbox message。
- [x] **COORD-02**: Mailbox message 记录 sender、recipient、read/unread、createdAt、wake status 和 source refs；消息持久化与 wake 结果分离。
- [x] **COORD-03**: Agent 可以通过 task tools 创建、列出和更新 durable task board；任务包含 owner、status、blockedBy/blocks 和更新时间。
- [x] **COORD-04**: Mailbox 正文、task 正文和 agent 输出不得作为 Gateway-facing 明文字段传输或存储。

### Team Creation And Orchestration

- [x] **ORCH-01**: 用户可以从 WebUI 创建 team run，并通过 Gateway 将创建请求路由到用户拥有的目标 CLI machine。
- [x] **ORCH-02**: CLI 可以创建 leader 普通 ACP session，注入 team MCP server，并在 MCP ready 后把用户目标交给 leader。
- [x] **ORCH-03**: Leader 可以请求 spawn member；系统在 capability check 和 tool policy 后创建普通 member ACP session；用户确认/权限聚合由 Phase 4 覆盖。
- [x] **ORCH-04**: 每个 leader/member session 都绑定独立普通 `sessionId`，并保持现有 WAL、E2EE、permission、文件/Git 和历史语义。
- [x] **ORCH-05**: 并行或动态创建的成员可以继承 team-shared worktree，系统可以记录并展示成员的 worktree source 和 branch；per-member 独立 worktree 策略留给后续 lifecycle/retry 设计。
- [x] **ORCH-06**: 如果目标 backend 不存在、MCP transport 不可用或创建失败，系统可以给出成员级错误并保留已创建成员的可恢复状态。

### Lifecycle And Recovery

- [x] **LIFE-01**: Team run 和 member 有明确的拆分维度状态模型：lifecycle 覆盖 pending、starting/creating_session、running、completed、failed、cancelled、detached 和 archived；MCP phase、permission waiting、degraded health 和 activity projection 独立表达，不把 idle/ready 作为 lifecycle 状态。
- [ ] **LIFE-02**: 用户可以取消运行中的 team run，系统会处理 running members、MCP server/bridge、pending wake 和普通 session cancel。
- [ ] **LIFE-03**: 用户可以只重试失败或 degraded member，重试会创建新的 member attempt/session 并重新注入 MCP，不会重跑已经成功的成员。
- [ ] **LIFE-04**: 用户可以归档 team run；默认只隐藏/归档 team metadata，不删除成员 session WAL、mailbox 或 task history。
- [ ] **LIFE-05**: Team run 可以表达 partial failure，用户能看到哪些成员成功、失败、取消、degraded 或等待权限。
- [ ] **LIFE-06**: WebUI 刷新、Gateway 重启或 CLI 重连后，team run、成员状态、MCP phase、mailbox/task counts 和 member-to-session 映射可以恢复或显示可解释的 degraded 状态。

### WebUI Experience

- [x] **UI-01**: WebUI 提供 team run 创建入口，用户可以选择 machine、workspace、leader backend、目标任务和 workspace/worktree 策略。
- [x] **UI-02**: WebUI 提供 team run 列表或分组视图，普通 session 与 team run 的关系清晰可见。
- [x] **UI-03**: Team detail 展示 leader/member 卡片，包括 backend、role、status、MCP phase、session 链接、worktree branch、错误和最后更新时间。
- [x] **UI-04**: Team detail 展示 task board 与 mailbox 活动的非内容 projection，例如 counts、owners、status、unread、wake_failed。
- [x] **UI-05**: 用户可以从 team detail 点击成员并跳转到对应普通 session，继续使用现有聊天、文件、Git 和权限 UI。
- [ ] **UI-06**: Team detail 可以聚合显示成员权限等待状态，并引导用户跳转到原 session 完成权限决策。
- [ ] **UI-07**: Team UI 在桌面和移动端都能完成创建、观察、跳转、取消、重试和归档的基本流程。

### Security And Content Boundaries

- [ ] **SEC-01**: Gateway team routes 必须认证用户，并验证 machine/team/session 属于当前用户后才转发请求。
- [ ] **SEC-02**: Gateway 不解密、不存储、不生成成员 prompt、mailbox 正文、task 正文、agent 输出或包含内容的 summary 明文。
- [ ] **SEC-03**: 日志不得记录 provider token、master secret、DEK、明文 prompt、mailbox、task、summary 或 agent 输出。
- [ ] **SEC-04**: Summary v1 至少支持用户可编辑的结构化 summary 和成员 session/mailbox/task source refs；自动 summary 只有在不破坏 E2EE 边界时才能启用。

## v2 Requirements

Deferred to future releases. Tracked but not in current roadmap.

### Productivity

- **PROD-01**: 用户可以保存和复用 team 模板。
- **PROD-02**: 用户可以从预设角色库添加常见角色，如 planner、implementer、reviewer、tester、docs、security。
- **PROD-03**: 用户可以导出 team summary、成员状态、task board、mailbox refs 和 session 链接为 Markdown。

### Advanced Coordination

- **ADV-01**: 用户可以指定 reviewer/summarizer 成员在其他成员完成后自动运行。
- **ADV-02**: Team detail 可以显示成员 attempt 历史并对比多次重试。
- **ADV-03**: Team detail 可以显示 Git 变更矩阵、变更文件交集和轻量冲突提示。
- **ADV-04**: Team detail 可以显示完整活动时间线。

### Scale

- **SCAL-01**: Team run 可以跨多个 machine 协作。
- **SCAL-02**: 多用户可以共同管理同一个 team run，并具备组织权限和审计记录。

## Out of Scope

Explicitly excluded from v1 to keep the first release safe and shippable.

| Feature | Reason |
|---------|--------|
| 只做 prompt fan-out 的假 team | 无法提供 agent 间 durable communication、task board、MCP tools 或可恢复协作。 |
| 不受约束的长期自治 planner | 会引入预算、长期记忆、无限 spawn 和项目管理平台复杂度；v1 只允许 leader 使用受限 team tools。 |
| 自动代码合并 | 多 agent 变更自动合并风险高，v1 只提供 worktree、Git 预览和 summary refs。 |
| Gateway 明文总结 | 违背现有 E2EE 承诺；Gateway 不能解密或理解 session、mailbox、task 内容。 |
| 云端 agent 执行 | Mobvibe 当前价值是远程控制本地 ACP agent，云执行需要全新安全、沙箱和计费模型。 |
| 私有 agent 深度适配 | v1 保持 ACP 兼容，不为单一 agent 写不可移植的专有能力。 |
| 修改 agent 全局 MCP 配置 | 会让普通 session 也暴露 team tools，破坏 MCP-over-ACP per-session 隔离。 |
| 复杂自动 DAG 调度 | v1 可以有 task blockedBy/blocks，但不做完整 DAG UI、自动调度和失败补偿系统。 |
| 批量自动授权 | 多 agent 并行下自动批准权限风险高，v1 只做权限聚合提示和跳转。 |
| 跨 machine team | 路径、worktree、密钥和恢复语义复杂，v1 限定同一 machine/workspace。 |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| TEAM-01 | Phase 1 | Complete |
| TEAM-02 | Phase 1 | Complete |
| TEAM-03 | Phase 1 | Complete |
| TEAM-04 | Phase 1 | Complete |
| TEAM-05 | Phase 1 | Complete |
| MCP-01 | Phase 2 | Complete |
| MCP-02 | Phase 2 | Complete |
| MCP-03 | Phase 2 | Complete |
| MCP-04 | Phase 2 | Complete |
| MCP-05 | Phase 2 | Complete |
| MCP-06 | Phase 2 | Complete |
| MCP-07 | Phase 2 | Complete |
| COORD-01 | Phase 2 | Complete |
| COORD-02 | Phase 2 | Complete |
| COORD-03 | Phase 2 | Complete |
| COORD-04 | Phase 2 | Complete |
| ORCH-01 | Phase 3 | Complete |
| ORCH-02 | Phase 3 | Complete |
| ORCH-03 | Phase 3 | Complete |
| ORCH-04 | Phase 3 | Complete |
| ORCH-05 | Phase 3 | Complete |
| ORCH-06 | Phase 3 | Complete |
| LIFE-01 | Phase 1 | Complete |
| LIFE-02 | Phase 4 | Pending |
| LIFE-03 | Phase 4 | Pending |
| LIFE-04 | Phase 4 | Pending |
| LIFE-05 | Phase 4 | Pending |
| LIFE-06 | Phase 4 | Pending |
| UI-01 | Phase 3 | Complete |
| UI-02 | Phase 3 | Complete |
| UI-03 | Phase 3 | Complete |
| UI-04 | Phase 3 | Complete |
| UI-05 | Phase 3 | Complete |
| UI-06 | Phase 4 | Pending |
| UI-07 | Phase 5 | Pending |
| SEC-01 | Phase 4 | Pending |
| SEC-02 | Phase 4 | Pending |
| SEC-03 | Phase 4 | Pending |
| SEC-04 | Phase 4 | Pending |

**Coverage:**
- v1 requirements: 39 total
- Mapped to phases: 39
- Unmapped: 0 ✓

---
*Requirements updated: 2026-05-14 after Phase 3 verification*
