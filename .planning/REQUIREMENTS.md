# Requirements: Mobvibe Agent Team

**Defined:** 2026-05-12  
**Core Value:** 用户可以在一个 Mobvibe 团队任务中安全地协调多个不同 ACP agent，让它们围绕同一代码目标并行或顺序协作，并清楚看到每个 agent 的进展、产出和最终汇总。

## v1 Requirements

Requirements for the first agent team release. Each requirement must map to exactly one roadmap phase.

### Team Model

- [ ] **TEAM-01**: 用户可以拥有一个稳定的 team run 对象，包含 `teamRunId`、title、目标、machine、workspace、执行模式、状态和创建/更新时间。
- [ ] **TEAM-02**: 用户可以为一个 team run 配置至少两个成员，每个成员包含 `memberId`、`backendId`、角色、顺序、worktree 策略和状态。
- [ ] **TEAM-03**: 系统可以在 CLI 本地持久化 team run、成员配置和 member-to-session 映射，并在 CLI 重启后恢复。
- [ ] **TEAM-04**: WebUI、Gateway 和 CLI 使用 `packages/shared` 中的统一 team 类型、RPC payload、状态枚举和错误结构。

### Team Creation And Orchestration

- [ ] **ORCH-01**: 用户可以从 WebUI 创建 team run，并通过 Gateway 将创建请求路由到用户拥有的目标 CLI machine。
- [ ] **ORCH-02**: CLI 可以把 parallel team run 展开为多个普通 ACP session，每个成员绑定一个独立 `sessionId`。
- [ ] **ORCH-03**: CLI 可以按线性 sequential 模式运行 team member，只有当前成员达到完成/失败/取消状态后才进入下一个成员。
- [ ] **ORCH-04**: 每个成员收到由 team 目标和成员角色组合出的任务提示，并沿用现有 session 发送/E2EE 路径。
- [ ] **ORCH-05**: 如果目标 backend 不存在或能力不足，系统可以给出成员级错误并阻止或降级该成员，而不是让整个 team 静默失败。
- [ ] **ORCH-06**: 并行成员默认可以使用独立 worktree，系统可以记录并展示成员的 worktree source 和 branch。

### Lifecycle And Recovery

- [ ] **LIFE-01**: Team run 和 team member 有明确状态模型，覆盖 pending、starting、running、waiting_permission、completed、failed、cancelled、detached 和 archived。
- [ ] **LIFE-02**: 用户可以取消一个运行中的 team run，系统会对所有 running member 调用对应普通 session 的取消路径。
- [ ] **LIFE-03**: 用户可以只重试失败成员，重试会创建新的 member attempt/session，不会重跑已经成功的成员。
- [ ] **LIFE-04**: 用户可以归档 team run；默认只隐藏/归档 team metadata，不删除成员 session WAL 或普通 session 历史。
- [ ] **LIFE-05**: Team run 可以表达 partial failure，用户能看到哪些成员成功、失败、取消或等待权限。
- [ ] **LIFE-06**: WebUI 刷新、Gateway 重启或 CLI 重连后，team run 列表、成员状态和 member-to-session 映射可以恢复。

### WebUI Experience

- [ ] **UI-01**: WebUI 提供 team run 创建入口，用户可以选择 machine、workspace、执行模式、成员 backend、角色和 worktree 策略。
- [ ] **UI-02**: WebUI 提供 team run 列表或分组视图，普通 session 与 team run 的关系清晰可见。
- [ ] **UI-03**: Team detail 展示成员卡片，包括 backend、角色、状态、session 链接、worktree branch、错误和最后更新时间。
- [ ] **UI-04**: 用户可以从 team detail 点击成员并跳转到对应普通 session，继续使用现有聊天、文件、Git 和权限 UI。
- [ ] **UI-05**: Team detail 可以聚合显示成员权限等待状态，并引导用户跳转到原 session 完成权限决策。
- [ ] **UI-06**: Team UI 在桌面和移动端都能完成创建、观察、跳转、取消、重试和归档的基本流程。

### Security And Content Boundaries

- [ ] **SEC-01**: Gateway team routes 必须认证用户，并验证 machine/team/session 属于当前用户后才转发请求。
- [ ] **SEC-02**: Gateway 不解密、不存储、不生成成员 prompt、agent 输出或包含内容的 summary 明文。
- [ ] **SEC-03**: Team metadata 只包含非敏感结构字段；日志不得记录 provider token、master secret、DEK、明文 prompt 或 agent 输出。
- [ ] **SEC-04**: Summary v1 至少支持用户可编辑的结构化 summary 和成员 source refs；自动 summary 只有在不破坏 E2EE 边界时才能启用。

## v2 Requirements

Deferred to future releases. Tracked but not in current roadmap.

### Productivity

- **PROD-01**: 用户可以保存和复用 team 模板。
- **PROD-02**: 用户可以从预设角色库添加常见角色，如 planner、implementer、reviewer、tester、docs、security。
- **PROD-03**: 用户可以导出 team summary、成员状态和 session 链接为 Markdown。

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
| 完全自治 planner | 会引入任务拆解、动态调度、长期记忆和预算控制，超出 v1 的编排式团队目标。 |
| 自动代码合并 | 多 agent 变更自动合并风险高，v1 只提供 worktree、Git 预览和 summary 链接。 |
| Gateway 明文总结 | 违背现有 E2EE 承诺；Gateway 不能解密或理解 session 内容。 |
| 云端 agent 执行 | Mobvibe 当前价值是远程控制本地 ACP agent，云执行需要全新安全、沙箱和计费模型。 |
| 私有 agent 深度适配 | v1 保持 ACP 兼容，不为单一 agent 写不可移植的专有能力。 |
| 任意 DAG 编排 | v1 只支持 parallel 和线性 sequential，避免过早引入复杂调度 UI 和失败补偿。 |
| 批量自动授权 | 多 agent 并行下自动批准权限风险高，v1 只做权限聚合提示和跳转。 |
| 跨 machine team | 路径、worktree、密钥和恢复语义复杂，v1 限定同一 machine/workspace。 |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| TEAM-01 | TBD | Pending |
| TEAM-02 | TBD | Pending |
| TEAM-03 | TBD | Pending |
| TEAM-04 | TBD | Pending |
| ORCH-01 | TBD | Pending |
| ORCH-02 | TBD | Pending |
| ORCH-03 | TBD | Pending |
| ORCH-04 | TBD | Pending |
| ORCH-05 | TBD | Pending |
| ORCH-06 | TBD | Pending |
| LIFE-01 | TBD | Pending |
| LIFE-02 | TBD | Pending |
| LIFE-03 | TBD | Pending |
| LIFE-04 | TBD | Pending |
| LIFE-05 | TBD | Pending |
| LIFE-06 | TBD | Pending |
| UI-01 | TBD | Pending |
| UI-02 | TBD | Pending |
| UI-03 | TBD | Pending |
| UI-04 | TBD | Pending |
| UI-05 | TBD | Pending |
| UI-06 | TBD | Pending |
| SEC-01 | TBD | Pending |
| SEC-02 | TBD | Pending |
| SEC-03 | TBD | Pending |
| SEC-04 | TBD | Pending |

**Coverage:**
- v1 requirements: 26 total
- Mapped to phases: 0
- Unmapped: 26 ⚠️

---
*Requirements defined: 2026-05-12*  
*Last updated: 2026-05-12 after initial definition*
