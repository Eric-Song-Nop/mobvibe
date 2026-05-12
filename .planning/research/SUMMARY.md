# Mobvibe Agent Team 研究综合摘要

**项目：** Mobvibe Agent Team  
**领域：** 分布式 ACP WebUI 上的本地多 agent 编排  
**研究日期：** 2026-05-12  
**总体置信度：** HIGH

## 执行摘要

Mobvibe Agent Team v1 应被设计为“用户配置的编排式 team run”，而不是自治 planner、云端 agent 平台或新的 agent runtime。正确模型是：team run 只是一层跨 session 的元数据、生命周期与 UI 聚合；每个 team member 仍展开为普通 ACP session，从而继续复用现有 WebUI → Gateway → CLI daemon → ACP agent 分层，以及 WAL、E2EE、权限、worktree、文件/Git、Socket.io 与会话历史能力。

v1 的首要目标是做出可恢复、可观察、可控制的最小闭环：用户在同一 machine/workspace 下选择多个不同 ACP backend，配置角色、执行模式与 worktree 策略；系统创建多个普通成员 session；WebUI 聚合展示成员状态、错误、权限等待和跳转链接；用户可取消、重试、归档，并生成可追溯 summary。不要先做模板、角色库、自动合并、复杂 DAG、跨机器运行或 Gateway 明文总结。

最大风险不是启动多个 session，而是状态一致性与安全边界：team 元数据不能只放 Gateway 内存，team event 不能污染单 session WAL/revision/seq，权限/E2EE/取消/重试必须始终保留 member/session 归属。路线图应先锁定 shared 协议与 durable owner，再做最薄端到端创建链路，然后补生命周期、权限/E2EE 加固和 UI 规模化。

## 最高优先级建议

1. **Team member 必须是普通 ACP session。** 不重写 ACP、不复制 WAL、不做 team 专属 chat runtime。
2. **v1 durable owner 推荐放在 CLI 本地 SQLite/WAL 域。** Gateway 只做鉴权、RPC 路由和在线 presence；如未来需要 CLI 离线也能跨设备浏览历史，再设计 Gateway 非内容元数据投影。
3. **所有跨进程 payload 先进入 `packages/shared`。** 避免 WebUI/Gateway/CLI 对状态枚举、错误 shape、成员映射产生漂移。
4. **内容和元数据严格分界。** Gateway 可见 `teamRunId/memberId/backendId/status/sessionId/role` 等非敏感结构；任务正文、成员 prompt、agent 输出、summary 正文必须沿用 E2EE 或停留在 WebUI/CLI 解密域。
5. **先做端到端闭环，再补高级体验。** Phase 1/2 不做自动 summary、模板、Git 矩阵、冲突检测或复杂 planner。

## v1 Table Stakes

- **Team run 创建入口：** 选择同一 machine/workspace、title、目标任务、2+ 成员 backend。
- **成员角色与提示词配置：** 每个成员有 `backendId`、role、order、执行策略、worktree 设置；能力差异按 member 预检。
- **并行/顺序执行：** v1 只支持 `parallel` 与线性 `sequential`，不做 DAG。
- **成员 session 映射：** 每个 member 有普通 `sessionId`，可跳转到完整聊天、权限、文件/Git 与历史。
- **Team 总览：** 显示 team 状态、成员状态、backend、role、worktree branch、错误、权限等待和 session 链接。
- **控制能力：** 启动、取消、重试失败成员、归档 team；归档默认不删除成员 session WAL。
- **恢复能力：** 刷新、Gateway 重启、CLI 重连后 team 元数据和 member↔session 映射可恢复。
- **Summary v1：** 先做可编辑/结构化 summary 与成员链接；自动总结必须等 E2EE 归属明确后再做。

## 架构决策

### 核心边界

| 层 | 决策 | 责任 |
|---|---|---|
| `packages/shared` | 新增 team 类型与 RPC/socket payload | `TeamRunSummary`、`TeamMemberSummary`、status enum、create/cancel/retry/archive payload |
| WebUI | 新增 team hooks/store/page | React Query 管快照与 mutation，Zustand 管实时聚合；不把 team 塞进 chat-store |
| Gateway | 新增 team routes/router | Better Auth、user/machine 授权、RPC 转发、presence；不做 durable truth，不解密内容 |
| CLI | 新增 `TeamOrchestrator` + `TeamStore` | 持久化 team metadata，展开普通 ACP sessions，管理 sequential/parallel/cancel/retry |
| SessionManager/WalStore | 保持现有语义，小幅扩展 | SessionSummary 可选 team 引用；成员事件仍写普通 session WAL |

### 推荐数据所有权

- **成员 session 内容/事件：** 继续由 CLI WAL `session_events` 拥有。
- **成员 session metadata：** 继续由 CLI WAL/session store 拥有，可增加 `teamRunId/teamMemberId/teamRole` 可选关联。
- **Team run metadata：** v1 推荐 CLI SQLite `team_runs/team_members` 持久化，Gateway 只缓存在线快照。
- **WebUI state：** 只保存选择、展开、草稿等 UI 状态；不作为系统事实来源。
- **Summary 正文：** 若包含用户/agent 内容，必须在 WebUI/CLI 可信域或加密存储；Gateway 不接触明文 transcript。

### 建议接口形态

- REST：`GET/POST /acp/team-runs`，`POST /acp/team-runs/:id/cancel|archive`，`POST /acp/team-runs/:id/members/:memberId/retry`。
- Socket：独立 `team-runs:changed` / `team-run:changed` / `team-member:changed`，不要混入 `session:event`。
- CLI RPC：推荐 `rpc:team:create/list/cancel/retry/archive`；内部调用现有 `SessionManager.createSession/sendMessage/cancelSession`。

## 主要风险与缓解

1. **Team 状态只放 Gateway 内存** → Gateway 重启后团队关系丢失。  
   **缓解：** Phase 1 明确 durable owner；v1 推荐 CLI SQLite，Gateway registry 只做 presence。

2. **Team event 污染 session WAL/revision/seq** → backfill、cursor、history 失真。  
   **缓解：** team 使用独立 payload/version；成员内容继续走 `session:event`。

3. **权限请求误归属或丢失** → 多成员并行时 approve 发错 session，agent 卡死。  
   **缓解：** UI 始终显示 `memberId/sessionId/requestId`，决策仍按现有 `sessionId:requestId` 发送。

4. **E2EE bootstrap 竞态或明文降级** → 成员输出不可解密，或 Gateway 看到 prompt/output。  
   **缓解：** 成员 session 继续通过 `sessions:changed` 提供 `wrappedDek`；team metadata 禁止明文内容字段。

5. **取消/重试/归档只改 team 状态** → agent 仍运行、permission promise 悬挂、WAL 被误删。  
   **缓解：** 生命周期按 member allSettled 执行；retry 默认新建 session/attempt；archive 默认只归档 team metadata。

6. **并行 worktree 策略不清** → 多 agent 互相覆盖代码。  
   **缓解：** 并行默认 isolated worktree；shared cwd 必须显式选择并展示冲突风险。

## 建议阶段顺序

### Phase 1：协议、状态模型与持久化边界

**目标：** 定义 shared team 类型、member lifecycle、team status 派生规则、durable owner 与 SQLite 表；不启动 agent。  
**交付：** `packages/shared` team payload、CLI `TeamStore` create/list/update、重启恢复测试。  
**避免：** Gateway 内存 truth、状态枚举后期返工、team event 污染 session WAL。

### Phase 2：最小端到端 Team Run

**目标：** 从 WebUI 创建 team run，经 Gateway RPC 到 CLI，展开为多个普通 member session。先支持 parallel happy path，再补 sequential 基础。  
**交付：** REST/RPC 路由、CLI `TeamOrchestrator.createTeamRun`、WebUI team list/detail/member cards、成员 session 跳转。  
**避免：** WebUI 手动串多个普通 session、chat-store 膨胀、能力差异无反馈。

### Phase 3：生命周期、部分失败与恢复

**目标：** 补 cancel/retry/archive、partial failure、Gateway/CLI reconnect、team snapshot/backfill。  
**交付：** per-member allSettled 结果、retry 新 attempt/session、archive 保留成员 WAL、恢复测试。  
**避免：** 只改聚合状态不处理成员 session、失败成员无产品语义。

### Phase 4：权限与 E2EE 加固

**目标：** 多成员权限聚合、missing key 展示、summary 内容边界、日志 redaction。  
**交付：** `waiting_permission` 聚合提示、双权限请求测试、E2EE bootstrap 竞态测试、summary source refs 设计。  
**避免：** approve 误投递、Gateway 明文 summary/prompt、日志泄露。

### Phase 5：UI 规模化与 v1 polish

**目标：** 移动端可用、订阅策略、并发限制、worktree/Git 轻量提示、summary v1 可编辑体验。  
**交付：** Teams 分组、懒加载 Git/file RPC、并发队列、响应式 team monitor。  
**避免：** 多成员页面首屏拉重型 RPC、localStorage 随 transcript 膨胀。

## Phase 1 必须解决的开放决策

1. **Team metadata source of truth：** 是否确认 v1 放 CLI SQLite；Gateway DB 是否仅作为未来跨设备/离线投影，不进入 v1 基础路径。
2. **Prompt/任务正文传输：** member prompt 是否作为现有 `EncryptedPayload` 发送；metadata 中哪些字段允许明文展示和日志记录。
3. **Sequential 完成判定：** 是否只依赖 `turn_end/session_error/cancel`，还是需要用户显式确认后启动下一成员。
4. **Team status 派生规则：** 是否引入 `completed_with_errors` / `partial_failed`，以及 running、waiting_permission 的优先级。
5. **Retry attempt 模型：** 重试成员默认新建 session + 新 worktree branch，还是允许用户选择复用 worktree。
6. **Worktree 默认策略：** parallel 是否默认 isolated worktree；shared cwd 的风险提示和确认交互如何设计。
7. **Summary v1 归属：** 是仅做用户可编辑 summary + source refs，还是创建普通 summarizer session；自动 summary 不应进入 Phase 1/2。

## Research Flags

- **Phase 1 需要深入设计：** durable owner、状态机、E2EE metadata/content 分界会决定后续所有实现。
- **Phase 3 需要深入验证：** cancel/retry/archive 与重连恢复跨 Gateway、CLI、WAL，多失败路径必须测试。
- **Phase 4 需要安全专项检查：** 权限误投递、summary 明文、日志泄露属于高风险边界。
- **Phase 2 可按标准 brownfield 模式推进：** REST/RPC/React Query/Zustand/Socket.io 均有现有模式可复用。
- **Phase 5 可延后研究：** 性能、移动端、Git 矩阵属于规模化体验，不阻塞 v1 核心闭环。

## 置信度评估

| 领域 | 置信度 | 说明 |
|---|---|---|
| Stack | HIGH | 基于仓库现有 TypeScript/pnpm/Socket.io/React/CLI WAL/ACP SDK；结论是不引入新框架。 |
| Features | HIGH | 与 `.planning/PROJECT.md` active/out-of-scope 高度一致，v1 边界清晰。 |
| Architecture | HIGH | 基于当前分层、SessionManager、SessionRouter、WalStore、chat-store 的 brownfield 约束。 |
| Pitfalls | HIGH | 主要风险来自现有 WAL/E2EE/permission/registry 脆弱点，验证路径明确。 |

**总体：** HIGH。核心方向明确；主要不确定性集中在 Phase 1 的持久化 owner、prompt 加密边界和 retry/worktree 策略。

## 来源

- `.planning/PROJECT.md` — 项目目标、active requirements、out of scope、架构/安全/持久化约束。
- `.planning/research/STACK.md` — 现有技术栈、推荐扩展点、不应引入的新技术。
- `.planning/research/FEATURES.md` — v1 table stakes、differentiators、anti-features、验收标准。
- `.planning/research/ARCHITECTURE.md` — team run 架构、组件边界、数据流、持久化所有权。
- `.planning/research/PITFALLS.md` — critical/moderate/minor pitfalls、阶段警告、验证清单。

---
*Research synthesis completed: 2026-05-12*  
*Ready for roadmap: yes*
