# Mobvibe Agent Team：领域陷阱与失败模式

**领域:** 分布式 ACP 多 agent 团队编排  
**项目:** Mobvibe Agent Team  
**研究日期:** 2026-05-12  
**总体置信度:** HIGH（基于当前仓库规划文档与关键源码阅读）

## 结论摘要

Agent Team v1 最大风险不是“能否启动多个 session”，而是跨 WebUI → Gateway → CLI → ACP 的状态一致性。现有系统已经有单 session 的 WAL、E2EE、permission、socket subscription、Gateway registry、worktree 等完整链路；团队编排应当复用这些链路，而不是新建一套并行状态机。

最容易造成返工的错误有三类：把 team run 元数据放进 Gateway 内存、把 team event 混入成员 session WAL 导致 cursor/revision 失真、以及在权限/E2EE/取消/重试生命周期中只处理“成功路径”。路线图应先做共享协议与持久化边界，再做最薄端到端 team run，随后补齐权限、恢复、UI 聚合和可观测性。

以下每个陷阱都包含：预警信号、预防策略、应处理阶段、验证证据。

## 推荐阶段映射

| 阶段 | 名称 | 主要防线 |
|------|------|----------|
| Phase 1 | 协议与持久化边界 | shared team 类型、team 元数据存储位置、成员 session 关联模型、基础迁移/测试 |
| Phase 2 | 最小端到端 team run | Gateway RPC 路由、CLI 展开普通 ACP session、WebUI 基础总览、单机多 backend happy path |
| Phase 3 | 生命周期与恢复 | cancel/retry/archive、WAL replay/backfill、Gateway/CLI 重连、部分失败处理 |
| Phase 4 | 权限与 E2EE 加固 | permission request 聚合、DEK bootstrap、密钥缺失/旋转、敏感元数据红线 |
| Phase 5 | UI/状态规模化 | team store、订阅策略、移动端可用性、并发 team 负载与可观测性 |

## Critical Pitfalls

### Pitfall 1: 把 team run 当成 Gateway 内存对象

**What goes wrong:**  
Team run 的成员列表、角色、顺序、状态和 summary 只保存在 `CliRegistry` 或 `SessionRouter` 的内存 map 中。Gateway 重启、Fly 多实例切换、CLI 重连后，WebUI 看不到 team run，底层成员 session 仍在 WAL 中但团队关系丢失。

**Why it happens:**  
现有 `CliRegistry` 明确是 process-local 连接/session 索引，`SessionRouter` 也只维护 pending RPC。单 session 历史由 CLI WAL 持久化，但 team run 是跨 session 聚合模型，不能天然依赖任何一个成员 session 的 WAL。

**Warning signs:**
- 新增 `teamRuns = new Map(...)` 出现在 Gateway service 中，但没有 DB/CLI WAL 持久化设计。
- WebUI 刷新后 team 总览消失，但单个 session 还在侧边栏。
- Gateway `sessions:list` 可以重建 session，却无法重建 team membership。
- 测试只覆盖同进程创建和展示，没有覆盖 Gateway 重启/CLI 重连。

**Prevention strategy:**
- Phase 1 明确 team 元数据的 durable owner：推荐把 team run 元数据持久化在 CLI 本地 WAL/SQLite（贴近成员 session 与本地机器），Gateway 只路由和缓存 presence；如果要跨设备查看 team 历史，再另行设计 Gateway DB 的非内容元数据表。
- team run 记录至少包含 `teamRunId`、`machineId`、`workspaceRootCwd`、成员 `sessionId/backendId/role/order/worktree`、状态、创建/更新时间、summary 引用。
- Gateway registry 只保存在线状态和快速路由索引，不作为 truth source。
- WebUI 启动时通过 typed RPC 拉取 team run snapshots，而不是从当前 session list 推断所有团队关系。

**Phase should address:** Phase 1（协议与持久化边界），Phase 3（恢复验证）。

**Tests / verification evidence:**
- CLI Bun test：创建 team run → 关闭 `SessionManager/WalStore` → 重新打开 → team membership 和成员 sessionId 可恢复。
- Gateway Vitest：registry 清空后，通过 CLI RPC 返回 team snapshots，WebUI/API 仍能拿到 team run。
- E2E/集成：模拟 Gateway restart 或 socket reconnect 后，team 总览仍存在，成员 session 可点击进入。

### Pitfall 2: 破坏 WAL revision/seq 语义，把 team 事件塞进成员 session 流

**What goes wrong:**  
为了省事把 `team_started`、`member_scheduled`、`team_summary` 等团队事件写成普通 `SessionEvent`，或复用成员 session 的 `seq/revision`。WebUI 的 `useSocket` 会按单 session cursor、pending queue、revision reset 和 backfill 逻辑处理，导致消息重复、顺序错乱、history stale warning 或强制 reset。

**Why it happens:**  
现有实时通道统一为 `session:event`，而 `SessionEvent` 的 `sessionId/revision/seq` 是单 session WAL 语义。team run 是跨 session 聚合，不满足单 session 单调序列。

**Warning signs:**
- `SessionEventKind` 里新增 team 相关 kind，但 payload 需要引用多个 session。
- 一个 team summary 事件被写入某个“主 session”，其他成员无法独立重放。
- `useSocket` 中出现大量 `if (event.kind.startsWith("team"))` 特判。
- backfill 后 team UI 与成员 transcript 不一致。

**Prevention strategy:**
- Phase 1 定义独立 team protocol：例如 `TeamRunSummary`、`TeamMemberState`、`TeamRunChangedPayload`、`TeamRunEventsParams`，不要污染单 session `SessionEventKind`。
- 成员 session 内容继续走现有 WAL 和 `session:event`；team 状态变更走独立 snapshot/change RPC 或 socket event，使用自己的 revision/version（如 `teamVersion`），不要复用成员 `seq`。
- team summary 如包含 agent 输出摘要，应只存加密/非敏感引用或由 WebUI/CLI 端生成；Gateway 不解密内容。
- WebUI reducer 分离：成员 transcript 仍由 `session-event-reducer` 处理，team store 只聚合成员状态和指针。

**Phase should address:** Phase 1（协议），Phase 2（最小事件流），Phase 3（backfill/replay）。

**Tests / verification evidence:**
- shared 类型测试/tsc：team payload 不依赖 app-local 类型，不扩展单 session event kind。
- WebUI hook test：成员 session gap/backfill 不会改变 team run version；team change 不会推进 `lastAppliedSeq`。
- CLI WAL test：成员 session event seq 连续；team 元数据变更不会插入成员 WAL event。

### Pitfall 3: 权限请求在 team 聚合 UI 中丢失或误投递

**What goes wrong:**  
多个 agent 同时请求权限时，WebUI 只显示一个“团队权限请求”，或用户对成员 A 的 decision 被发给成员 B。CLI 侧 `permissionRequests` 以 `sessionId:requestId` 为 key；一旦 UI/Gateway 只按 `requestId` 或 teamRunId 聚合，可能留下 unresolved promise，导致 agent 卡死。

**Why it happens:**  
权限链路横跨 ACP SDK、CLI `SessionManager`、Gateway RPC、WebUI store 和通知系统。当前 `PermissionDecisionPayload` 只包含 `sessionId/requestId/outcome`，没有 team member 语义；team UI 很容易为了简化展示而隐藏 session 维度。

**Warning signs:**
- UI 组件只使用 `requestId` 作为 React key 或 store key。
- 团队总览按钮直接调用 “approve all” 但没有逐成员确认和失败反馈。
- cancel team run 后仍有 permission request 卡在 pending。
- Gateway 日志出现 `Permission request not found` 或 RPC timeout。

**Prevention strategy:**
- Phase 2 起所有 team permission UI 必须显示 member role/backend/sessionId 短标识和 tool call 信息。
- Store key 和 RPC payload 始终使用 `{ teamRunId?, memberId, sessionId, requestId }`，发回 CLI 时只传现有 `sessionId/requestId/outcome`。
- Phase 3 为 team cancel/retry/archive 明确取消 pending permission：复用 CLI `cancelPermissionRequests(sessionId)`，并在 team store 清理对应请求。
- 禁止 v1 做无确认的 “approve all dangerous tools”；如支持批量操作，必须逐项发送并展示每项结果。

**Phase should address:** Phase 2（展示正确归属），Phase 3（取消/重试），Phase 4（权限安全加固）。

**Tests / verification evidence:**
- CLI Bun test：两个 session 使用相同 ACP `toolCallId` 时，decision 只 resolve 对应 `sessionId:requestId`。
- Gateway Vitest：permission decision 对非本用户或错误 session 返回 generic not found，不泄露存在性。
- WebUI test：team 总览同时显示两个成员权限请求，点击成员 A approve 不改变成员 B 状态。
- 断连测试：permission pending 时 cancel team run，UI 状态变为 cancelled，CLI promise 被 resolve 为 cancelled。

### Pitfall 4: E2EE bootstrap 顺序导致团队成员输出“不可解密”或明文降级

**What goes wrong:**  
团队一次创建多个 session，WebUI 先收到加密 `session:event`，但对应 member session 的 `wrappedDek` 尚未通过 `sessions:changed` 到达；事件被缓冲。如果 team UI 不触发 bootstrap 或缓冲未按 member session flush，成员输出长期不可见。更糟的是，新增 team metadata 或 summary 直接携带明文 agent 输出经过 Gateway。

**Why it happens:**  
当前 WebUI `useSocket` 依赖 `bootstrapSessionE2EE(sessionId, wrappedDek)` 和 `e2ee.onDekReady` flush encrypted buffer。这个逻辑以单 session summary 为触发点。team run 让多个 session 并发创建，事件到达顺序更不稳定。

**Warning signs:**
- team summary payload 包含 prompt/assistant content 明文，并由 Gateway 路由/记录。
- 成员 session 已 streaming，但 team card 一直显示 encrypted payload 或 missing_key。
- 新增 team store 没有调用 `bootstrapSessionE2EE` 或没有保存 member `wrappedDek`。
- E2EE 缺失时发送消息仍静默明文降级，UI 没有风险提示。

**Prevention strategy:**
- Phase 1 明确 E2EE 边界：Gateway 只看 team metadata（角色、状态、sessionId、backendId），不看 prompt/response 明文。
- Phase 2 创建成员 session 后，必须让每个成员 summary 经现有 `sessions:changed` 进入 WebUI，以复用 DEK bootstrap。
- Phase 4 对 team summary 采用“引用成员 session + 客户端/CLI 端加密摘要”策略；如果 summary 明文必须存储，只能留在 WebUI/CLI trusted boundary，不能进入 Gateway DB/log。
- E2EE missing_key 应在 team member card 显示明确状态，并允许用户补配 secret 后重试 flush/backfill。

**Phase should address:** Phase 1（边界），Phase 2（bootstrap happy path），Phase 4（密钥缺失/旋转）。

**Tests / verification evidence:**
- WebUI unit test：先收到 encrypted member event，再收到 `wrappedDek`，buffer drain 后 member card/transcript 更新。
- WebUI test：missing_key 成员在 team 总览显示可理解提示，不把 encrypted payload 渲染成正文。
- Gateway test/静态检查：team payload 类型不包含明文 prompt/assistant output 字段。
- 手动验证：移除 paired secret 后打开 team run，所有成员显示 missing_key；重新添加 secret 后历史可恢复。

### Pitfall 5: 团队取消/重试/归档只改聚合状态，不处理成员 session 生命周期

**What goes wrong:**  
用户取消 team run 后，team card 显示 cancelled，但某些 ACP agent 仍在运行、权限 promise 仍 pending、WAL 仍继续追加事件。重试时复用旧 session 导致 revision/seq 混入新尝试，归档 team 时误删底层 session 或反过来留下孤儿 team metadata。

**Why it happens:**  
现有单 session `cancelSession`、`closeSession`、`archiveSession` 语义不同：cancel 当前操作、close 断开 active connection、archive 删除 WAL messages 并标记 archived。team lifecycle 是多个成员操作的组合，不能只用一个 boolean 状态表示。

**Warning signs:**
- `team.status = "cancelled"` 后没有对每个 active member 调用 cancel RPC。
- retry team run 复用原 `sessionId`，但没有 revision bump 或新 attemptId。
- archive team run 调用 bulk archive 删除所有成员 WAL，用户无法从 summary 跳回原始上下文。
- 部分成员 cancel 失败时 UI 仍显示整体成功。

**Prevention strategy:**
- Phase 1 定义 member lifecycle：`pending | creating | running | needs_permission | completed | failed | canceling | cancelled | retrying | archived`，team status 由 member states 派生。
- Phase 3 实现 team cancel 为逐成员 best-effort：对 running/needs_permission 成员发送现有 `rpc:session:cancel`，记录每个结果；permission 自动 cancelled。
- Retry 默认创建新的 member session/attempt，而不是复用旧 session；如果确需 reload，必须走现有 revision bump 语义。
- Archive v1 应优先归档 team metadata，不自动删除成员 WAL；提供单独“同时归档成员 session”的显式选项。

**Phase should address:** Phase 1（状态模型），Phase 3（生命周期操作）。

**Tests / verification evidence:**
- Gateway Vitest：team cancel 对 N 个成员发出 N 个 cancel RPC，Promise.allSettled 后返回 per-member 结果。
- CLI Bun test：cancel session 会取消 pending permission 并停止 active operation。
- WebUI test：部分 cancel 失败时 team card 显示 partial failure 和失败成员。
- WAL test：retry 产生新 session/attempt，不污染旧 revision；archive team 不删除成员 WAL，除非显式选择。

### Pitfall 6: 多 backend 能力差异被忽略，导致 team 创建半成功半失败

**What goes wrong:**  
用户选择多个 ACP backend，但某些 backend 不支持 list/load、mode/model 切换、图片输入或特定 prompt 结构。Team 创建流程假设能力一致，结果部分成员创建成功、部分失败，UI/Gateway 没有补偿逻辑。

**Why it happens:**  
当前 backend capabilities 是 per backend cache，`SessionManager` 已有 `createCapabilityNotSupportedError`。团队编排跨不同 ACP agent，能力差异是常态，不是异常。

**Warning signs:**
- Team create request 只有全局 `modelId/modeId/images`，没有 per-member capability check。
- UI 允许给所有 backend 配同一个 mode/model。
- CLI 在创建到第 3 个成员失败后，前 2 个成员无人管理。
- 错误信息只有 “team create failed”，不指出哪个 backend 不支持。

**Prevention strategy:**
- Phase 1 shared 类型把 member config 设计为 per-member，而非 team 全局强约束。
- Phase 2 创建前从 `backendCapabilities` 做预检：不支持的配置在 UI 禁用或在 Gateway/CLI 返回 member-level validation error。
- Team create 必须是可部分失败的事务模型：已创建成员记录为 running/created，失败成员记录为 failed，可单独 retry/skip。
- v1 不做跨 agent 能力抽象层；只暴露每个 backend 实际能力。

**Phase should address:** Phase 1（类型），Phase 2（创建预检），Phase 3（部分失败恢复）。

**Tests / verification evidence:**
- shared/WebUI test：不同 backend capabilities 下，成员配置表单正确禁用不支持项。
- CLI Bun test：backend 不支持 load/list 时返回 `CAPABILITY_NOT_SUPPORTED`，team runner 标记单个 member failed。
- Gateway test：team create 返回 per-member result，不因一个 backend 失败丢失已创建成员信息。

### Pitfall 7: worktree 隔离策略不清，多个 agent 写同一目录造成冲突

**What goes wrong:**  
多个 agent team member 在同一 `cwd` 并发修改同一仓库，产生未预期冲突、工具输出交错、Git 状态难以归因。反过来，如果默认给每个成员创建 worktree，但 branch/path 命名不稳定，会失败或留下垃圾 worktree。

**Why it happens:**  
现有 `createSession` 支持 worktree，并包含 path normalization、branch sanitize 和 source cwd 记录；team 编排需要在“共享上下文”和“隔离执行”之间做显式选择。

**Warning signs:**
- Team create 默认所有成员使用同一个 `cwd`，UI 没有冲突提示。
- 自动生成 worktree branch 没有包含 team/member/attempt 标识，重试时路径冲突。
- session creation 失败后日志出现 `session_creation_failed_after_worktree_created`，但没有清理或 UI 提醒。
- summary 无法说明哪个成员改了哪个 worktree。

**Prevention strategy:**
- Phase 1 member config 明确 `executionMode: shared_cwd | isolated_worktree`，默认推荐 isolated worktree；若选择 shared_cwd，UI 显示冲突风险。
- Worktree branch/path 命名包含 teamRunId/memberId/attempt，使用现有 `resolveWorktreeBranchName` 和 `sanitizeWorktreeBranchForPath`。
- Phase 2 team create 只在同一 machine/workspace 内启动，避免跨机器 filesystem 语义复杂化。
- Phase 3 增加失败补偿和清理提示：创建 worktree 成功但 ACP session 创建失败时记录 orphan worktree path，供 UI/CLI health 展示。

**Phase should address:** Phase 1（配置模型），Phase 2（创建），Phase 3（清理/重试）。

**Tests / verification evidence:**
- CLI Bun test：team member worktree branch/path 不允许绝对/`..`，重试生成不同 attempt path。
- 集成测试：两个成员 isolated worktree 创建后 `workspaceRootCwd` 仍指向源 repo，成员 `cwd` 指向各自 worktree。
- 手动验证：shared_cwd 模式 UI 出现风险提示；isolated 模式 summary 能跳到成员 worktree Git 状态。

## Moderate Pitfalls

### Pitfall 8: Gateway session lookup 仍按 sessionId 扫描，team 场景下碰撞和性能风险放大

**What goes wrong:**  
多成员、多机器、多 team 并发后，Gateway 频繁通过 `getCliForSessionByUser` 扫描用户机器和 session arrays。当前做了用户作用域保护，但没有 `sessionId -> machineId/userId` 显式索引；team 操作批量查找成员时性能和一致性风险增加。

**Warning signs:**
- team cancel/retry/archive 对每个成员单独扫描 registry。
- 大量成员时 Gateway CPU 增高或 RPC 路由偶发 “Session not found”。
- registry update incremental 与 team member cache 不一致。

**Prevention strategy:**
- Phase 2 可以先复用现有查找，但 team runner 内部应缓存本次创建得到的 `sessionId -> machineId/backendId`。
- Phase 3 为 registry 增加显式 `sessionId -> machineId` 用户作用域索引，并在 sessions:list/sessions:changed 时维护。
- 所有 lookup 继续保持 user-scoped，未授权和不存在统一返回 generic not found。

**Phase should address:** Phase 3。

**Tests / verification evidence:**
- Gateway Vitest：sessions changed add/update/remove 后 session index 正确更新。
- 批量 team cancel 测试：N 个 session 只路由到其 owner CLI，remove 后不可路由。

### Pitfall 9: WebUI 把 team state 塞进现有 chat-store，导致持久化膨胀和渲染耦合

**What goes wrong:**  
直接在 `chat-store` 中加入大量 team run、member transcript snapshot、summary 内容和 UI 展开状态，使已经很大的 store 更难维护；localStorage hydration 变慢，跨 tab cursor sync 与 team 状态互相影响。

**Warning signs:**
- `ChatSession` 被扩展出 `teamRunId/teamMembers/teamSummary` 等大字段。
- team UI 为了显示摘要复制成员 messages，而不是引用 sessionId。
- localStorage 中保存完整 team transcripts。
- `useSocket` 继续增大，处理 team socket event 和 session backfill 混在一起。

**Prevention strategy:**
- Phase 2 新建独立 `team-store` 或 domain hook，只保存 team metadata、member sessionId、状态、UI 展开状态；成员内容仍从 chat-store/session WAL 读取。
- team socket/reducer 与 `useSocket` 解耦，至少放到独立 hook/helper；不要让 `useSocket` 再承担 team 编排。
- 持久化只保存 team summary/cursors/selection，不保存大段 transcript。

**Phase should address:** Phase 2（基础 store），Phase 5（规模化和性能）。

**Tests / verification evidence:**
- WebUI store test：team run 引用成员 sessionId，不复制 messages。
- E2E：刷新后 team selection 恢复，成员 transcript 通过 backfill 恢复。
- 性能检查：创建多成员 team 后 localStorage payload 不随 transcript 线性增长。

### Pitfall 10: 部分失败没有产品语义，用户不知道团队是否可继续

**What goes wrong:**  
team 中一个成员失败，整个 team 被标记 failed；或者整体仍 running，但用户看不到失败成员、可重试操作和对 summary 的影响。

**Warning signs:**
- team status enum 只有 `running/completed/failed`。
- UI 只有一个 error string，没有 member-level error。
- summary 在成员失败时仍显示“完成”，没有来源标记。

**Prevention strategy:**
- Phase 1 定义 team status 派生规则：例如任一 running → running；全部 terminal 且至少一个 failed → completed_with_errors；全部 completed → completed。
- Phase 2 UI member card 必须展示 error、backend、role、retry action。
- Summary 记录参与成员和排除/失败成员，允许用户跳转查看原始失败上下文。

**Phase should address:** Phase 1（状态语义），Phase 2（UI），Phase 3（retry）。

**Tests / verification evidence:**
- shared pure test：member states 到 team status 的派生表。
- WebUI test：一个 member failed、一个 completed 时显示 partial result 而非整体成功。

### Pitfall 11: 并行启动过多 ACP 进程，耗尽本机资源或触发 provider 限流

**What goes wrong:**  
用户配置 8 个成员并行启动，CLI 同时创建多个 ACP stdio 进程、Git worktree、资源扫描、模型调用，本机 CPU/内存、API quota 或 git buffer 迅速达到瓶颈。

**Warning signs:**
- team create 对所有成员 `Promise.all` 无并发限制。
- 没有 per-machine active member limit。
- 大量 session 同时触发 fs resources/git status/backfill。

**Prevention strategy:**
- Phase 1 team config 支持 execution order/concurrency limit，默认小并发（如 2）。
- Phase 2 CLI team runner 使用队列启动成员，不直接无界 `Promise.all`。
- Phase 5 增加 per-machine health/queue 状态，UI 展示排队中成员。

**Phase should address:** Phase 1（模型），Phase 2（队列），Phase 5（规模化）。

**Tests / verification evidence:**
- CLI Bun test：设置 concurrency=2，5 个成员最多 2 个同时进入 creating/running。
- WebUI test：queued member 显示等待状态，可取消。

### Pitfall 12: summary 生成越过 E2EE 或丢失可追溯性

**What goes wrong:**  
为了生成 team summary，Gateway 收集成员输出明文，或 WebUI 只保存一段不可追溯文本，用户无法回到每个成员原始上下文验证结论。

**Warning signs:**
- Gateway route 名为 `generateTeamSummary` 且 payload 包含 messages。
- summary 没有 member/session 引用和时间/seq 范围。
- summary 失败导致 team run 无法完成。

**Prevention strategy:**
- Phase 4 之前不要做自动总结；Phase 2/3 先做人工/简单结构化 summary placeholder。
- summary 生成应在 WebUI 或 CLI trusted boundary 进行；如果调用 agent，总结也应作为普通 ACP session 或本地加密内容处理。
- summary 数据结构包含 source refs：memberId、sessionId、revision、seq range/createdAt range。

**Phase should address:** Phase 4。

**Tests / verification evidence:**
- shared type check：summary source refs 必填。
- Gateway test：summary API 不接受明文 transcript 字段。
- UI test：点击 summary 引用能跳到对应 member session。

## Minor Pitfalls

### Pitfall 13: 日志和错误详情泄露任务/路径/密钥线索

**What goes wrong:**  
team metadata 比单 session 更容易包含用户任务描述、角色 prompt、路径、branch 名。Gateway/CLI/WebUI 日志若直接记录完整 payload，会泄露敏感上下文。

**Warning signs:**
- logger 记录完整 team create params，包括 prompt/role instructions。
- WebUI console 输出 encrypted/decrypted payload 或 secret fingerprint 以外的信息。

**Prevention strategy:**
- Phase 1 规定 team metadata 字段分级：可路由字段、敏感字段、禁止进入 Gateway 字段。
- Phase 4 引入集中 redaction helper，日志只记录 ids/count/status/backendId，不记录 prompts/output/secrets。

**Phase should address:** Phase 1、Phase 4。

**Tests / verification evidence:**
- 单元测试 redaction helper 对 prompt/secret/path 进行裁剪或移除。
- 代码审查清单：新增 logger 不包含 team prompt/output。

### Pitfall 14: 订阅策略不随 team membership 更新，导致成员事件不显示

**What goes wrong:**  
WebUI 打开 team run，但没有订阅所有 active member session；或者成员完成后过早 unsubscribe，后续 backfill/reconnect 丢事件。

**Warning signs:**
- team view 只订阅当前选中的 member。
- member session `isAttached/sending/isLoading` 状态与 team card 状态不一致。

**Prevention strategy:**
- Phase 2 team view 激活时订阅所有 running/needs_permission/canceling 成员；完成成员可按需 backfill。
- 复用 `gatewaySocket.subscribeToSession`，不要创建新 socket。
- Phase 3 reconnect 后根据 team store 和 chat-store 合并恢复订阅。

**Phase should address:** Phase 2、Phase 3。

**Tests / verification evidence:**
- WebUI hook test：新增 team member 后调用 subscribe；移除/归档后 unsubscribe。
- E2E：刷新 team 页面后所有 running members 继续流式更新。

### Pitfall 15: 大文件/Git RPC 在多成员 UI 中被放大

**What goes wrong:**  
team summary 页面同时展示每个成员 Git diff、文件预览或资源列表，触发现有大文件读取、固定 10MB git buffer 和 resource scan 瓶颈。

**Warning signs:**
- team overview 自动对每个 member 调用 git status/diff/resources。
- 页面打开即读取文件预览或全量 diff。

**Prevention strategy:**
- Phase 5 前 team overview 只显示状态和轻量 summary，不自动拉取重型 RPC。
- Git/file 详情按 member 展开后懒加载，并继承未来的 size cap/pagination。

**Phase should address:** Phase 5。

**Tests / verification evidence:**
- WebUI test：team overview 初始渲染不调用 file preview/diff API。
- 性能验证：多成员 team 页面首屏只请求 team snapshot 和必要 session summaries。

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation | Verification |
|-------------|----------------|------------|--------------|
| Phase 1 协议设计 | shared 类型缺少 member/session 关联，后续靠字符串约定 | `teamRunId/memberId/sessionId/backendId/machineId` 明确建模；导出自 `packages/shared/src/index.ts` | tsc + shared 类型用例 |
| Phase 1 持久化 | team 元数据误放 Gateway 内存 | 选定 durable owner；Gateway 只缓存 presence | 重启恢复测试 |
| Phase 2 创建链路 | 部分成员失败丢失已创建 session | per-member result + partial team state | Gateway/CLI partial failure test |
| Phase 2 WebUI | team state 与 chat-store 混杂 | 独立 team store/hook，成员内容用 sessionId 引用 | store test + E2E refresh |
| Phase 3 恢复 | WAL/backfill revision 被 team event 干扰 | team event 独立版本；成员 WAL 不混入 team event | backfill/revision mismatch tests |
| Phase 3 生命周期 | cancel/retry/archive 语义过粗 | 逐成员状态机和 allSettled 结果 | cancel/retry/archive integration |
| Phase 4 权限 | requestId 冲突或 approve 误投递 | 始终按 `sessionId:requestId` 决策；UI 显示成员归属 | 双权限请求 UI/CLI tests |
| Phase 4 E2EE | summary 或 prompt 明文经过 Gateway | Gateway payload 禁止 transcript；summary 在 WebUI/CLI 加密处理 | payload type/review test |
| Phase 5 性能 | 多成员自动拉重型 RPC | 懒加载 Git/file/resource；并发限制 | network/API call assertions |

## Verification Checklist for Roadmap

- [ ] 每个新增 cross-process payload 先进入 `packages/shared`，不在 app 内临时定义。
- [ ] Team metadata 有 durable owner，并覆盖 Gateway restart/CLI reconnect 恢复。
- [ ] 成员 session 继续使用现有 WAL、revision、seq、E2EE、permission 语义。
- [ ] Team 状态和成员状态分离，team status 由成员 terminal/running 状态派生。
- [ ] Permission UI/RPC 永远携带并展示 session/member 归属。
- [ ] Gateway 不解密、不记录、不存储 prompt/assistant 明文。
- [ ] Team cancel/retry/archive 有 per-member 结果和补偿策略。
- [ ] WebUI 不复制成员 transcript 到 team store 或 localStorage。
- [ ] 多 backend 能力差异被预检和展示，部分失败可恢复。
- [ ] 多成员并发受限，重型 Git/file/resource RPC 懒加载。

## Sources

- `.planning/PROJECT.md` — 项目目标、约束、active requirements。
- `.planning/codebase/ARCHITECTURE.md` — WebUI/Gateway/CLI/ACP 分层、关键抽象和反模式。
- `.planning/codebase/CONCERNS.md` — WAL/backfill、permission、E2EE、Gateway registry 等已知脆弱点。
- `.planning/codebase/TESTING.md` — Vitest/Bun/Playwright 测试组织和推荐模式。
- `packages/shared/src/types/socket-events.ts` — 当前 socket/RPC/session event 协议边界。
- `apps/gateway/src/services/cli-registry.ts` — process-local CLI/session registry 与 user-scoped lookup。
- `apps/gateway/src/services/session-router.ts` — RPC request/response、timeout、authorization routing。
- `apps/mobvibe-cli/src/acp/session-manager.ts` — ACP session lifecycle、permission、WAL、worktree、E2EE DEK 初始化。
- `apps/mobvibe-cli/src/wal/wal-store.ts` — SQLite WAL session/event/revision/discovered/archive 持久化。
- `apps/webui/src/hooks/useSocket.ts` — session event ingestion、pending/backfill、permission、E2EE buffer、subscription 恢复。
- `apps/webui/src/lib/e2ee.ts` — paired secret、DEK unwrap、encrypted event decrypt/bootstrap。
