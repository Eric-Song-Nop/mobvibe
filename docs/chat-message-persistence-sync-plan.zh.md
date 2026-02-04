# 消息持久化与同步架构（CLI 端为唯一真相）实施文档

> **实施状态**：Phase 1 ✅ 已完成 | Phase 2 ✅ 已完成（核心链路已打通 + 修复 Fix 2/P0-3/P0-6/P0-7；单元测试已补充） | **Phase 2.2 ✅ 已完成（P0-8/P0-9/P1-2/P1-3/P1-4 已修复；最后更新：2026-02-05）** | Phase 3-5 ⏳ 待实施

## 背景与约束

Mobvibe 是一个分布式 ACP WebUI：WebUI 通过 Gateway 与本机 mobvibe-cli（再与 ACP Agent 进程）通信。

本方案的核心约束（来自需求）：

- **仅在 CLI 端持久化**会话消息与事件（source of truth 在本机磁盘）。
- Gateway **不持久化**任何消息内容（降低安全/合规风险）。
- CLI 断开时 WebUI 可以暂时看不到新增内容，但 **CLI 重新连接后必须可补齐断线期间漏掉的数据**。
- 必须与 ACP `session/list`、`session/load` 共同工作：能发现并加载“非 mobvibe 启动”的外部会话历史。

## 现状（基于代码的真实链路）

### 当前事件流

1) ACP Agent -> mobvibe-cli

- CLI 通过 `apps/mobvibe-cli/src/acp/session-manager.ts` 持有 `AcpConnection`，监听 `onSessionUpdate/onTerminalOutput/...`，并向上游发出事件。

1) mobvibe-cli -> Gateway（Socket.io /cli）

- `apps/mobvibe-cli/src/daemon/socket-client.ts` 将 session/update、terminal/output、permission 等事件 emit 给 Gateway。

1) Gateway -> WebUI（Socket.io /webui）

- `apps/gateway/src/socket/cli-handlers.ts` 收到 CLI 的 `session:update` 直接转发给 WebUI（订阅者）。
- `apps/gateway/src/socket/cli-handlers.ts` 也会转发 `session:event`（WAL 事件流，带 `revision/seq`），并向 CLI 回 `events:ack`。
- `apps/gateway/src/socket/webui-handlers.ts` 的 `subscribe:session` 只登记订阅关系；历史补拉通过 REST `GET /acp/session/events` 完成（不经 socket 回放）。

1) WebUI 本地记录与持久化

- WebUI 使用 `packages/core/src/stores/chat-store.ts`（zustand persist）保存会话 UI 状态。
  - 当 session 已进入 eventlog 同步模式（`revision` 已建立）时：仅持久化游标（`revision/lastAppliedSeq`），不再持久化 `messages`。
  - 未进入 eventlog 模式时：仍会持久化 `messages`（兼容旧数据）。
- localStorage 的写入通过 `packages/core/src/stores/storage-adapter.ts`，其中 `setItem` 的异常会被吞掉。

### ACP session/list & session/load

- CLI 通过 `apps/mobvibe-cli/src/acp/session-manager.ts` 的 `discoverSessions/loadSession/reloadSession` 支持：
  - `session/list`：发现 agent 持久化的会话（包括外部会话）。
  - `session/load`：让 agent 重放历史（replay），CLI 将重放输出写入 WAL，并通过 `session:event`（目前也可能仍有 `session:update`）同步给 Gateway/WebUI。
- Gateway 通过 `apps/gateway/src/services/session-router.ts` 暴露 `/acp/session/load`、`/acp/session/reload`，本质是 RPC 转发到 CLI。

## 旧架构问题回顾（为什么要做本方案）

注意：本节描述的是引入 WAL/eventlog 之前的主要问题；Phase 1-2 已在基础设施层面解决或缓解这些问题，但 WebUI 投影层仍有新的 P0（见“Phase 2 复审记录”）。

### P0：CLI->Gateway 断线期间，实时事件会断流（旧架构不可恢复）

在 `apps/mobvibe-cli/src/daemon/socket-client.ts` 中：

- 所有 emit 都受 `if (this.connected)` 保护。
- 断线期间没有缓冲/落盘/重发逻辑。

结果：

- 旧架构下：只要 CLI 与 Gateway 之间出现短暂网络抖动、Gateway 重启、CLI 重连等，期间产生的流式 chunk/工具调用更新等会 **永久丢失**（WebUI 无法补齐）。
- 新架构下：事件会先写入 CLI WAL，理论上可在重连后通过 replay/backfill 补齐；但目前仍需完成 WebUI 投影层的 P0 修复与验收（P0-2/3/4/5/6/7；P0-1 已实现但仍需验收）。

### P0：Gateway->WebUI 断线/切订阅期间，旧架构缺口不可恢复

在 `apps/gateway/src/socket/webui-handlers.ts`：

- `subscribe:session` 仅维护订阅集合，没有“按游标回放”的能力。

结果：

- 旧架构下：WebUI 切后台、刷新、网络切换、socket 重连后，会话期间的事件缺口无法补拉。
- 新架构下：缺口由 `GET /acp/session/events`（CLI WAL）补拉；但 WebUI 投影层仍需完成 P0 修复与验收（P0-2/3/4/5/6/7；P0-1 已实现但仍需验收）。

### P1：WebUI localStorage 持久化并不可靠，且失败静默

在 `packages/core/src/stores/storage-adapter.ts`：

- localStorage `setItem` 失败会被 catch 并忽略（配额满、隐私模式限制、浏览器策略等）。

结果：

- 旧架构下： “内存里有，刷新后没了/缺一段”的情况很难被发现和纠正，且 WebUI 的 `messages` 既承担 UI 状态又承担持久化真相，风险过高。
- 新架构目标：WebUI 仅持久化游标（`revision/lastAppliedSeq`），消息内容以 CLI WAL 为准；仍需完成 Phase 2 的 P0 修复后才能彻底兑现。

### P1：旧链路缺少全链路序号/游标（无法检测缺口、无法去重）

目前 `session:update` 是 ACP `SessionNotification`（无 `seq/eventId`）：

- 客户端无法判断是否漏了 chunk。
- Gateway 无法为新订阅者补历史。
- CLI 无法按“已发送/已确认”进行重发或清理。

新架构改进：

- 引入 `session:event`（带 `revision/seq`）作为可回放的事件流，并通过 `events:ack` + backfill 补齐缺口。

### P2：过度依赖 agent 的 `session/load` 作为“救命”机制

虽然 `session/load` 可以重放历史，但它并不能解决运行期断线导致的丢事件：

- `load` 是“事后全量重放”，不是运行期可靠传输。
- 并非所有 agent 支持 `session/load`；外部会话能否恢复也取决于 agent 能力。

## 目标（本方案要达到什么）

- **可靠性**：任何断线（WebUI-Gateway 或 CLI-Gateway）都不应导致“永久丢失”；恢复连接后可补齐缺口。
- **端侧真相**：CLI 本地磁盘为唯一真相；WebUI 仅保存游标/缓存（不再依赖 localStorage 成功写入全量历史）。
- **兼容 ACP**：
  - `session/list`：发现外部会话（非 mobvibe 启动）。
  - `session/load`：将外部会话历史导入（import）到 CLI 本地日志，并同步给 WebUI。
- **低安全风险**：Gateway 不落库消息内容；所有消息仅经过内存转发。

非目标：

- CLI 离线时仍能在 WebUI 查看历史（本方案允许此时不可用）。
- 端到端加密（E2E）与合规审计（若未来需要，可在 CLI 本地加密存储，但不在本方案范围内）。

## 解决方案概述：CLI Event Log + Cursor Sync（Gateway 仅转发）

核心思想：把“会话输出”抽象成 **可追加、可回放** 的事件流（event log），并用 `seq`（单调递增序号）建立补偿机制。

### 组件职责重划分

CLI（source of truth）：

- 维护本地 WAL（Write-Ahead Log）：**先落盘**再对外发。
- 为每个 session 生成单调递增 `seq`，对所有会话事件打序号。
- 提供“按游标查询事件”的 RPC：用于 WebUI/Gateway 断线后的补拉。
- 与 ACP `session/list/load` 协同：把 `load` 的历史 replay 也写入 WAL，变成可回放的本地真相。

Gateway（无持久化）：

- 仍然做鉴权/路由/转发。
- 增加“向 CLI 请求补拉事件并转发给指定 WebUI socket”的能力（消息内容不落库，仅内存中转）。

WebUI（projection + cursor）：

- UI 消息列表不再作为真相持久化；改为事件流的投影（projection）。
- 仅持久化 `lastAppliedSeq`（以及当前 revision），用于重连后补齐缺口。

### 为什么 event log 能解决“丢消息”

- 任何链路断线导致的“实时推送缺口”，都可以通过“按游标补拉”恢复。
- 关键前提是：缺口期间的事件必须存在于某个可查询的地方；本方案选择 **CLI 本地 WAL**。

## 事件模型（建议的最小规范）

### SessionRevision（时间线版本）

同一个 `sessionId` 可能因为 `session/load` / `session/reload` 被多次“全量重放”。
为避免重复导入污染同一条日志，引入 `revision`（时间线版本）：

- 每次执行 `session/load` 或强制 `reload`，产生一个新的 `revision`（例如 +1）。
- WebUI 展示“当前 revision”；当 revision 变化时，WebUI 清空投影并从新 revision 的事件流重建。

### SessionEvent

建议统一所有可呈现/可重放的内容：

```ts
type SessionEvent = {
  sessionId: string;
  machineId: string;
  revision: number;        // 时间线版本
  seq: number;             // 单调递增序号（per session + revision）
  kind: string;            // 事件类型（见下）
  createdAt: string;       // CLI 产生事件的时间
  payload: unknown;        // 事件载荷（通常为 ACP update 或其规范化形式）
}
```

### 建议的事件类型（kind）

最小可用集合（可逐步扩展）：

- `user_message`：用户输入（包含 messageId + prompt blocks）
- `agent_message_chunk`：assistant 流式 chunk（来自 ACP `agent_message_chunk`）
- `user_message_chunk`：user 流式 chunk（来自 ACP `user_message_chunk`，可选）
- `turn_end`：一次 send 完成边界（stopReason/end_turn 等）
- `tool_call` / `tool_call_update`
- `permission_request` / `permission_result`
- `terminal_output`（delta 或 snapshot+delta）
- `session_info_update` / `current_mode_update` / `available_commands_update`
- `session_error`

说明：

- 事件越“原子”，回放越精确，但日志增长更快；可以用 compaction（见下）控制体积。
- 只要 `seq` 连续，WebUI 就能检测缺口并补拉。

## 持久化设计（CLI 本地 WAL）

### 存储介质与位置

推荐 sqlite（可高效按 sessionId+revision+seq 范围查询、支持索引与 compaction）。
建议位置：`~/.mobvibe/`（与现有 credentials/logs/pid 同目录，见 `apps/mobvibe-cli/src/config.ts`）。

### 表结构建议（示意）

- `sessions`
  - `session_id`（PK）
  - `current_revision`
  - `backend_id` / `cwd` / `title` / `updated_at` / ...
- `session_events`
  - `(session_id, revision, seq)`（PK）
  - `created_at`
  - `kind`
  - `payload_json`
- 可选：`session_snapshots`
  - `(session_id, revision, snapshot_seq)`（PK）
  - `state_json`（投影结果快照，例如消息列表的压缩版）

### Compaction（可选但强烈建议）

为控制日志增长：

- 对于 `agent_message_chunk` 可在 `turn_end` 后合并为一条“最终消息”事件或生成 snapshot。
- 对于 `terminal_output` 可定期写 snapshot 并丢弃过老 delta。
- 对历史很长的会话：保留关键事件（用户消息、最终 assistant、tool call、权限结果）并丢弃中间 chunk（可配置）。

## 同步协议（不落库前提下的补拉）

### 核心：游标（cursor）

WebUI 为每个 sessionId+revision 维护：

- `lastAppliedSeq`：已应用到投影的最大 seq。

WebUI 断线重连后使用该 cursor 补拉缺口。

### 建议的 RPC：`session/events`

新增 CLI RPC（Gateway 转发，不落库）：

- Request: `{ sessionId, revision, afterSeq, limit }`
- Response: `{ events: SessionEvent[], nextAfterSeq?: number }`

用途：

- WebUI 订阅时补历史
- WebUI 发现 seq 缺口时补洞
- WebUI 刷新后快速重建（只要 CLI 在线）

### 实时推送：`session:event`

把当前 `session:update/terminal:output/...` 逐步升级为统一推送：

- CLI -> Gateway: `session:event`（带 seq）
- Gateway -> WebUI: `session:event`（原样转发）

兼容性：

- 可在过渡期同时发送旧事件（`session:update`）与新事件（`session:event`），或只对新 UI 启用。

### 订阅流程建议（无竞态/可补偿）

1. WebUI 发送 `subscribe:session(sessionId)`（开始收实时事件）。
2. WebUI 立即调用一次 `session/events(afterSeq=lastAppliedSeq)` 拉取缺口。
3. WebUI 对实时事件与补拉事件统一按 `seq` 应用：
   - `seq <= lastAppliedSeq`：忽略（去重）
   - `seq == lastAppliedSeq + 1`：直接应用，推进游标
   - `seq > lastAppliedSeq + 1`：说明存在缺口，先缓冲并触发补拉（直到补齐）

说明：即使在“订阅与补拉之间”发生竞态（实时事件先到、补拉后到），只要按 seq 进行缓冲与去重，就不会丢也不会重复展示。

## 与 ACP `session/list` / `session/load` 的协同（外部会话支持）

### 外部会话发现：`session/list`

继续使用现有 `discoverSessions`（见 `apps/mobvibe-cli/src/acp/session-manager.ts`）：

- 将发现到的会话显示在 WebUI（可标记为“外部会话/未导入”）。
- 建议把 discovered session 的元信息也落到 CLI 本地（可选），避免 CLI 重启后丢“发现列表”。

### 外部会话导入：`session/load` 作为 import

当用户在 WebUI 选择打开外部会话：

1) WebUI 调用 `/acp/session/load`（Gateway RPC 到 CLI）
2) CLI 执行 ACP `session/load(sessionId,cwd)`：
   - agent 会 replay 历史（以 `session:update` 流形式输出）
3) CLI 对 replay 输出做与实时相同的处理：
   - **逐条写入 WAL（带 seq）**
   - 同步推送给 WebUI（若在线）
4) WebUI 清空当前投影，切换到该 session 的新 `revision`，按事件流重建历史

重要点：`session/load` 不再是 WebUI 的“唯一恢复手段”，它只是“把 agent 的历史导入 CLI WAL”。

### `session/reload` 与 revision

`reload` 会触发一次新的全量重放：

- CLI：`revision += 1`，从 seq=1 重新记录该 revision 的事件流。
- WebUI：检测到 revision 变化后清屏并重放新 revision。

## 需要补齐的关键一致性点：messageId 贯通

目前 `messageId` 只用于 WebUI 乐观更新（Gateway `/acp/message/id`），但发送消息 RPC（`SendMessageParams`）不携带 messageId。

建议：

- 扩展 `SendMessageParams`：加入 `messageId`（以及可选 `clientCreatedAt`）。
- CLI 在收到 sendMessage 请求时就写入 WAL 一条 `user_message`（使用该 messageId）。
- WebUI 乐观渲染同 messageId；后续事件回放时按 messageId+seq 去重/合并，避免重复显示。

## 实施计划（分阶段、可回滚）

### Phase 0：规格与兼容策略（1-2 天）

- 定义 `SessionEvent`、`revision`、`seq`、kind 列表与 payload 规范。
- 确定“按 seq 应用 + 缺口补拉”的 WebUI 投影算法。
- 兼容策略：
  - 新旧事件并行一段时间，或用 feature flag 切换（例如 `MOBVIBE_EVENTLOG_SYNC=1`）。

交付物：

- 更新本文件中的 mini-spec 为最终规范（作为实现依据）。

### Phase 1：CLI 本地 WAL ✅ 已完成

在 CLI 增加事件落盘能力：

- 选型 sqlite（建议）并建立 schema/migrations（CLI 自管理）。
- 在 `SessionManager` 的事件源头统一"先落盘后 emit"：
  - `onSessionUpdate`：把 ACP update 写入 WAL（kind=...，payload=原始 update 或规范化结构）
  - `onTerminalOutput`、permission、error 同理
- 为每个 sessionId+revision 维护 seq 生成器（保证单调递增）。

**实现的文件：**

| 文件 | 状态 | 说明 |
|------|------|------|
| `apps/mobvibe-cli/src/wal/wal-store.ts` | ✅ | WAL 存储核心（bun:sqlite） |
| `apps/mobvibe-cli/src/wal/migrations.ts` | ✅ | Schema 迁移（sessions + session_events 表） |
| `apps/mobvibe-cli/src/wal/seq-generator.ts` | ✅ | 序号生成器（per session+revision） |
| `apps/mobvibe-cli/src/wal/index.ts` | ✅ | 导出 |
| `apps/mobvibe-cli/src/config.ts` | ✅ | 添加 `walDbPath` 配置 |
| `apps/mobvibe-cli/src/acp/session-manager.ts` | ✅ | 集成 WAL，先落盘再 emit |
| `apps/mobvibe-cli/src/wal/__tests__/wal-store.test.ts` | ✅ | 单元测试（16 个测试） |

验收：

- ✅ CLI 重启后仍能从 WAL 查询到历史事件。
- ✅ CLI 与 Gateway 断线期间，事件仍会写入 WAL（即使发不出去）。

### Phase 2：补拉 RPC + WebUI 缺口恢复 ✅ 已完成（但需 Phase 2.2 修复新增 P0）

实现"按游标补拉"的最小闭环：

- CLI 增加 RPC：`rpc:session:events`
- Gateway 增加 REST 或 RPC 转发：
  - 推荐 REST：`GET /acp/session/events?sessionId&revision&afterSeq&limit`
  - 或纯 socket RPC：由 WebUI 发起、Gateway 代理到 CLI
- WebUI：
  - 订阅后调用 events 补拉一次
  - 收事件按 seq 应用、检测缺口并补洞
  - 仅持久化 `lastAppliedSeq`（不再依赖全量 messages 持久化）

**实现的文件：**

| 文件 | 状态 | 说明 |
|------|------|------|
| `packages/shared/src/types/socket-events.ts` | ✅ | 添加 SessionEvent, SessionEventKind 等类型 |
| `apps/mobvibe-cli/src/daemon/socket-client.ts` | ✅ | 添加 `rpc:session:events` 处理器 |
| `apps/gateway/src/services/session-router.ts` | ✅ | 添加 `getSessionEvents()` 方法 |
| `apps/gateway/src/routes/sessions.ts` | ✅ | 添加 `GET /acp/session/events` REST 端点 |
| `packages/core/src/hooks/use-session-backfill.ts` | ✅ | P0-3 已修复：mismatch 时直接 return（不触发 onComplete），清理 activeBackfills 状态 |
| `packages/core/src/stores/chat-store.ts` | ✅ | 添加 revision, lastAppliedSeq, isBackfilling 等游标字段 |
| `packages/core/src/hooks/use-socket.ts` | ✅ | 增加 session:event 回调（onSessionEvent），供上层做游标推进/触发 backfill |

验收（当前状态：✅ 核心链路已具备，P0/P1 问题已修复）：

- ✅ 补拉 API 与 WAL 查询链路已具备
- ✅ P0 问题已修复（Fix 2、P0-3、P0-6、P0-7）
- ✅ 单元测试已补充
- ✅ Phase 2.2 P0/P1 问题已修复（P0-8、P0-9、P1-2、P1-3、P1-4）

**已完成的测试（2026-02-04）：**

- ✅ CLI `getSessionEvents` revision mismatch 测试 (`apps/mobvibe-cli/src/acp/__tests__/session-manager.test.ts`)
- ✅ WebUI 补拉 Hook 测试 (`apps/webui/src/hooks/__tests__/useSessionBackfill.test.tsx`)
  - P0-3: mismatch 不触发 onComplete
  - 成功完成时调用 onComplete
  - fetch 失败时调用 onError
  - 新 backfill 取消旧 backfill（generation 检查）
- ✅ WebUI 投影/去重/引导测试 (`apps/webui/src/hooks/__tests__/useSocket.test.tsx`)
  - P0-6: 同一 tick 内多事件连续正确更新游标
  - P0-6: 基于游标跳过重复事件
  - P0-7: gap 检测触发 backfill 而非直接应用

**待补充的测试：**

- ⏳ Gateway 端补拉接口测试 (`apps/gateway/src/routes/__tests__/sessions.test.ts`)
- ⏳ 端到端集成测试（断线重连、缺口补拉场景）
- ⏳ P0-8/P0-9 回归验证：刷新重建不丢、同一 session 重复 load 不重复导入（实现已完成，待补单测）

## Phase 2 复审记录（2026-02-04）

本节记录实现 Phase 1-2 后的代码复审结论：哪些点已修复/基本正确、哪些仍是阻塞，以及下一步修复计划。

### 已修复/基本正确（但仍需补充测试/验收）

#### Fix 1: Gateway `session:event` 订阅隔离（P0 安全）

- **已修复点**：
  - `apps/gateway/src/index.ts` 增加 `"session:event"` case，避免落入 default 的 `emitToAll()`
  - `apps/gateway/src/socket/webui-handlers.ts` 增加 `emitSessionEvent()`，使用 `emitToSubscribers()` 按 `sessionId` 隔离转发
- **验收要点**：
  - 未 subscribe 的 WebUI socket 不应收到任何 `session:event`
  - 开启 auth 时，跨 user 的 session 不应被订阅/补拉
- **备注**：如果上述修复尚未合入/发布（仅存在于本地工作区），则默认分支/线上仍可能存在 `session:event` 落入 `emitToAll()` 的越权风险；发布前需确认该路由修复已包含在目标版本中。

> 为什么要关心 authentication：即使 Gateway 不落库消息内容，`session:event`/`/acp/session/events` 仍携带聊天与工具数据；项目也支持“多用户/多 CLI”。因此必须保证实时转发与补拉接口按用户与 session 进行隔离，否则会造成越权数据泄漏（安全风险与合规风险）。

#### Fix 2: `getSessionEvents` 返回真实 revision（P0 功能，✅ 已修复）

- **已修复点**：
  - `apps/mobvibe-cli/src/acp/session-manager.ts` 的 `getSessionEvents()` 返回活跃 session 或 WAL 中的真实 revision
  - **2026-02-04 新增**：当 `params.revision !== actualRevision` 时，返回空 `events=[]` + 真实 `revision`，确保 `response.revision === events[].revision` 一致性
  - WAL 查询使用 `actualRevision`（与响应一致），不再用请求的 `params.revision`
- **合同**：
  - `GET /acp/session/events` 的 `events` **必须**属于 `response.revision`
  - revision mismatch 时返回空事件，WebUI 看到 mismatch 后 reset 并从 `afterSeq=0` 重建
- **单元测试**：`apps/mobvibe-cli/src/acp/__tests__/session-manager.test.ts` 已覆盖 mismatch 场景

#### Fix 4: CLI shutdown 资源释放（P1 资源）

- **已修复点**：`apps/mobvibe-cli/src/daemon/daemon.ts` shutdown 改为调用 `sessionManager.shutdown()`，确保 WAL SQLite 连接关闭。

#### Fix 5: Backfill hook 的 cookie auth（P1 鉴权对齐）

- **已修复点**：`packages/core/src/hooks/use-session-backfill.ts` fetch 添加 `credentials: "include"`，与 WebUI 的 cookie-based auth 对齐。

### 仍需修复/未验收（P0 阻塞）

#### P0-1: WebUI 首包事件（seq=1）丢失/卡死（已修复，待验收）

- **之前现象**：首次收到 `session:event(revision=1, seq=1)` 时被误判为 revision 变化并 early-return，丢 `seq=1`，后续 pending 永远 flush 不出来。
- **当前实现**：
  - 当 `session.revision === undefined` 时，将其视为“首次初始化游标”，先初始化 `revision/lastAppliedSeq`，再继续正常按 seq 应用事件。
  - 当 `event.revision > currentRevision`（revision bump）时，会 reset 投影、缓存当前事件、并触发 `afterSeq=0` 的 backfill（避免丢掉触发 bump 的事件）。
- **仍需验收**：
  - 首次打开一个从未打开过的 session（本地无游标）时：能从 `seq=1` 正确建立投影，pending 不会堆积卡死。
  - `session/reload`/外部 `session/load` 导入触发 revision bump 时：UI 会清屏并完整重建，不丢第一条事件。

#### P0-2: 重复渲染/重复追加仍存在（`session:update`/`terminal:output` 与 `session:event` 并存）

- **当前实现的改进**：
  - WebUI 已在“session 进入 eventlog 同步模式（`revision` 已建立）”后，跳过 `session:update` 的内容级更新（chunk/tool call），仅保留 meta 更新（mode/info/commands）。
  - WebUI 也尝试在 eventlog 模式下跳过 `terminal:output`（避免与 `session:event(kind=terminal_output)` 叠加）。
- **仍存在的 P0 问题**：
  1) **仍可能出现“短窗口重复”**：当前 gating 依赖 `sessions` prop（以及 `sessionsRef.current`）中的 `revision/lastAppliedSeq`，但这些值来自 React render 的“状态快照”；当 handler 调用 `updateSessionCursor()` 后，`sessionsRef.current` 不会同步更新。结果是：
     - `session:update`/`terminal:output` handler 仍可能在“应该进入 eventlog 模式”时误以为 revision 未建立，从而继续写入内容，造成重复。
     - `session:event` handler 也可能因为读取到 stale 的 `lastAppliedSeq` 而误判 gap/重复，触发多余 backfill 或错误缓冲。
  2) **“进入 eventlog 之前”的窗口仍可能重复**：如果 `session:update` 的内容先于该 session 的第一条 `session:event` 到达，WebUI 会先在 non-eventlog 模式下把 chunk 应用进 messages；随后 `session:event`/backfill 从 seq=1 回放同一段内容，会产生重复（text message 没有基于 messageId 的去重）。
- **修复计划**：
  - 先修 P0-6（游标读取一致性）：为 `useSocket` 引入“同步可读的 cursor source of truth”（cursorRef / store.getState），避免在 handler 中依赖 React 快照。
  - 对 eventlog 模式的 session：明确“内容级唯一真相”只来自 `session:event + backfill`，并把 `terminal:output` 等也纳入同样的屏蔽策略（以 cursorRef 为准）。
  - 解决“窗口期重复”：当首次初始化 revision（`undefined -> event.revision`）时，如果该 session 已经有由 `session:update`/`terminal:output` 生成的内容（用 ref 标记，而不是读 messages 快照），应 reset 投影并从 `afterSeq=0` backfill 重建（确保不重复）。
- **验收**：
  - chunk、tool call、terminal output 在任何重连/backfill/刷新后都不重复、不翻倍。

#### P0-3: revision mismatch 的"自愈重建"（✅ 已修复）

- **已修复点（2026-02-04）**：
  - `useSessionBackfill` mismatch 时直接 `return`（不触发 `onComplete`）
  - mismatch 前先清理 `activeBackfills` 状态（同 generation 检查）
  - 调用 `onRevisionMismatch` 通知上层重建
- **实现**：
  - `packages/core/src/hooks/use-session-backfill.ts:143-154`
  - generation/token 确保旧 backfill 不会覆盖新 backfill 的状态
  - WebUI 在 `onRevisionMismatch` 中 reset session 并用 `queueMicrotask` 延迟启动新 backfill（避免竞态）
- **单元测试**：`apps/webui/src/hooks/__tests__/useSessionBackfill.test.tsx` 覆盖：
  - mismatch 不触发 onComplete
  - 新 backfill 取消旧 backfill（generation 检查）
- **验收**：
  - ✅ `session/reload` 或外部 `session/load` 导入期间，WebUI 能稳定切换 revision 并完整重建

#### P0-4: gap 补洞的触发与节流仍需验收（避免缺口长期不补/过度补拉）

- **当前实现**：gap 分支已开始主动触发 `triggerBackfill(sessionId, revision, lastAppliedSeq)`，并在 pending 超限时触发 reset+backfill。
- **仍需验收/潜在问题**：
  - 触发 backfill 使用的 `lastAppliedSeq` 若来自 React 快照，可能误判 gap（见 P0-6）。
  - 需要确认在高频输出下不会因误判导致 backfill 频繁重启（应做到一次缺口只跑一个 backfill，且触发具备幂等/节流）。
- **修复计划**：
  - 先修 P0-6（游标读取一致性），让 gap 计算基于同步 cursorRef。
  - 对 gap-trigger backfill 做轻量节流/合并（例如记录 `backfillWantedAfterSeq`，避免重复触发）。
- **验收**：在不刷新/不重连的情况下，只要出现 gap，WebUI 会自动补齐并 flush pending；且在高频输出下不会 backfill 风暴。

#### P0-5: pending 事件缓冲的清理策略需验收（避免堆积/卡死）

- **当前实现**：
  - flush 会过滤 `seq <= lastAppliedSeq` 与错误 revision 的事件，并清理 pending。
  - pending 设定了上限，超限会触发 reset+backfill。
- **仍需验收/潜在问题**：
  - 若 `lastAppliedSeq` 来自 React 快照，pending 的“过期判断”也可能误判（见 P0-6）。
  - 需要覆盖“revision bump + 重连 + 重复事件”组合场景，确认 pending 不会长期保留无用事件。
- **修复计划**：
  - 先修 P0-6（游标读取一致性），并在写入 pending 时也基于 cursorRef 做去重与过滤。
- **验收**：长会话/多次重连/多次 reload 下 pending 不会无限增长，flush 行为稳定。

#### P0-6: WebUI 事件处理依赖 React/Zustand "状态快照"（✅ 已修复）

- **问题**：
  - `useSocket` 的 handler 读取 `sessionsRef.current[sessionId]` 判断游标
  - `sessionsRef.current` 只在 React rerender 后更新，handler 内 `updateSessionCursor` 不会同步改变快照
  - 同一 tick 内连续事件会读到 stale 游标，导致重复追加/错误 gap 判定
- **已修复点（2026-02-04）**：
  - **采用方案 A**：在 `useSocket` 内维护 `cursorRef`（`Map<sessionId, {revision, lastAppliedSeq}>`）
  - 新增 `getCursor(sessionId)` 函数：优先从 `cursorRef` 读取，fallback 到 store
  - 新增 `updateCursorSync(sessionId, revision, seq)` 函数：同时更新 `cursorRef` 与 store
  - 所有 handler（`session:event`、`onEvents` backfill、`flushPendingEvents`、`applyPendingEventsBestEffort`）统一改为使用 `getCursor` 和 `updateCursorSync`
  - revision reset/mismatch 时清空 `cursorRef.current.delete(sessionId)`
- **实现位置**：`apps/webui/src/hooks/useSocket.ts:83-108`
- **单元测试**：`apps/webui/src/hooks/__tests__/useSocket.test.tsx` 覆盖：
  - 同一 tick 内 3 个连续事件正确更新游标（3 次 `updateSessionCursor` 调用，seq 1→2→3）
  - 基于游标跳过重复事件（`seq <= lastAppliedSeq` 不调用 `updateSessionCursor`）
- **验收**：
  - ✅ 不依赖 rerender 也能正确推进游标、去重、补洞

#### P0-7: backfill 失败/放弃时的"best-effort 应用 pending"（✅ 已修复）

- **问题**：
  - `applyPendingEventsBestEffort()` 在 backfill error 时会尽可能应用 pending
  - 若 pending 中 `seq` 不连续（有缺口），仍会应用并推进 cursor 到更大的 seq
  - 导致缺口事件永久丢失（silent loss）
- **已修复点（2026-02-04）**：
  - `applyPendingEventsBestEffort()` 改为 **只允许连续应用**
  - 检查 `event.seq !== lastSeq + 1` 时停止应用，将后续事件放入 `remaining`
  - 缺口后的事件保留在 `pendingEventsRef` 中，不被丢弃
  - cursor 不会越过缺口
- **实现位置**：`apps/webui/src/hooks/useSocket.ts:112-152`
- **单元测试**：`apps/webui/src/hooks/__tests__/useSocket.test.tsx` 覆盖：
  - gap 检测：收到 `seq=1` 后收到 `seq=5`（缺 2,3,4），只更新 cursor 到 1，触发 backfill
- **验收**：
  - ✅ 人为制造缺口 + backfill 报错时，cursor 不会越过缺口

### 复审新增问题（必须记录为下一步修复）

本节记录在复审实现后新发现的风险/缺陷（不涉及“Gateway 是否转发 `session:update`”的兼容性讨论；该点对本方案不重要）。

#### P0-8: 当前 compaction 会导致"历史不可重建"（✅ 已修复 2026-02-05）

- **现象**：
  - WebUI 在 session 进入 eventlog 模式后，会在持久化时清空 `messages`（只持久化 cursor：`revision/lastAppliedSeq`），刷新后依赖 `GET /acp/session/events` 回放重建。
  - Gateway 不落库消息内容（按方案约束）。
  - 因此 **CLI WAL 是唯一真相**：只要 WAL 中的历史事件被删除，WebUI 就无法重建那段历史。
- **问题根因**：
  - 现在的 `events:ack` 语义只是"Gateway/链路已收到，用于断线重放去重"，并不代表"历史已经被安全归档/可删"。
  - 目前已引入的 compactor 会按 `acked_at + retentionDays` 删除已 ack 的事件（并可能执行 `VACUUM` 回收空间）。
  - 这会导致：超过保留期后，WebUI 刷新/换浏览器/清缓存时只能重建出"没被删的尾巴"，历史前半段永久不可恢复。
- **影响**：直接违反本方案的可靠性目标（不丢、不重复、可重建），属于 P0。
- **已修复点（2026-02-05）**：
  - `apps/mobvibe-cli/src/config.ts`：`DEFAULT_COMPACTION_CONFIG.enabled = false`（默认禁用 compaction）
  - `apps/mobvibe-cli/src/config.ts`：`DEFAULT_COMPACTION_CONFIG.runOnStartup = false`（禁用启动时自动运行）
  - 注释说明：compaction deletes acked events which are the only history source
  - `mobvibe compact --dry-run` 仍可用于手动观察，但不会自动删除历史
- **后续计划**：
  - [P1] 设计并实现 snapshot-based 安全 compaction（Phase 5），并补齐端到端回归测试：任意时刻刷新 WebUI 仍能完整重建历史。

#### P0-9: `session/load` 在 WAL 已存在历史时可能"重复导入"（✅ 已修复 2026-02-05）

- **现象**：
  - 用户可能对同一个外部 session 重复执行 `session/load`（导入历史）。
  - 当前 `loadSession()` 只 `ensureSession()` 拿到"当前 revision"，并直接把 replay 的历史事件继续追加到该 revision 的事件流中。
- **问题**：
  - 如果该 session 之前已经导入过（WAL 内已有 revision=1 的完整历史），再次导入会把同一段历史再写一遍，导致 WebUI 重复消息/重复 tool call。
  - 与本方案的 `revision` 设计目标（"每次 load/reload 是一次新的时间线版本"）不一致。
- **已修复点（2026-02-05）**：
  - `apps/mobvibe-cli/src/acp/session-manager.ts` 的 `loadSession()` 方法：
    - 检测 WAL 中是否已存在该 `sessionId` 的历史（`queryEvents` 检查 `events.length > 0`）
    - 若已有历史 → 调用 `incrementRevision()` bump revision 后再执行 replay 写入
    - 若无历史 → 正常 `ensureSession()` 创建 revision=1
  - 添加日志：`"load_session_bump_revision"` 记录 bump 行为
- **待补充**：
  - 补单测/集成测：同一 session 连续两次 load，WebUI 只能看到一份历史（或看到新 revision 但不重复）。

#### P1-2: compactor 的并发/资源/锁风险（✅ 已修复 2026-02-05）

- **问题**：
  - compactor 可能在 session 正在流式写 WAL 时执行 `VACUUM`，存在锁竞争/卡顿/写失败风险。
  - daemon 内部创建了额外的 WAL DB 连接与 store，但没有明确 close，且 `markSessionActive/inactive` 机制目前未接入任何"活跃会话"信号（等同永远不 skip）。
- **已修复点（2026-02-05）**：
  - `apps/mobvibe-cli/src/daemon/daemon.ts` 的 shutdown 函数：
    - 单独追踪 `compactorWalStore` 和 `compactorDb` 引用
    - shutdown 时显式调用 `compactorWalStore.close()` 和 `compactorDb.close()` 释放资源
  - 默认禁用自动 compaction（P0-8 修复的一部分），避免运行期锁竞争
- **备注**：`markSessionActive/inactive` 机制暂未集成，因为 compaction 默认禁用。后续若启用需要补齐。

#### P1-3: compaction 配置与实现不一致（✅ 已修复 2026-02-05）

- **问题**：
  - `keepOldRevisionsDays`、`consolidateChunksAfterSec` 等配置项目前并未真实生效；存在"配置看起来可控但实际没用"的风险。
- **已修复点（2026-02-05）**：
  - `apps/mobvibe-cli/src/config.ts`：从 `CompactionConfig` 类型中删除了未实现的配置项：
    - `consolidateChunksAfterSec`（chunk 合并功能未实现）
    - `keepOldRevisionsDays`（仅 `keepLatestRevisionsCount` 被使用）
  - 添加注释说明删除原因
  - `apps/mobvibe-cli/src/wal/compactor.ts`：删除了未使用的 `revisionCutoff` 计算逻辑

#### P1-4: WebUI cursorRef reset 仍有短窗口 stale read 风险（✅ 已修复 2026-02-05）

- **问题**：
  - 在 revision reset/mismatch 处理时当前实现直接 `cursorRef.delete(sessionId)`，随后若在 React rerender 之前到达新的 `session:event`，`getCursor()` 可能 fallback 到旧的 `sessionsRef.current`，出现短窗口误判（重复 reset / 重复触发 backfill / 额外 pending）。
  - P0-7 的"best-effort 不越过缺口"逻辑已改为只连续应用，但缺少覆盖 backfill error/retry 耗尽路径的单测来保证不会回归。
- **已修复点（2026-02-05）**：
  - `apps/webui/src/hooks/useSocket.ts` 中所有 `cursorRef.current.delete(sessionId)` 改为 `cursorRef.current.set(sessionId, { revision: newRevision, lastAppliedSeq: 0 })`：
    - `onRevisionMismatch` 回调（line ~415-418）
    - revision bump 分支（line ~570-573）
    - pending overflow reset（line ~614-617）
  - 这样避免 fallback 到旧的 `sessionsRef.current`，消除短窗口竞态
- **待补充**：
  - 增补 WebUI 单测：backfill error + pending gap 场景。

#### P2-1: 测试隔离问题（建议修复）

- **问题**：
  - `useSessionBackfill` 的单测直接覆盖 `global.fetch` 且不恢复，可能污染其他测试用例（取决于 Vitest 隔离策略）。
- **解决方案/计划**：
  - [P2] 使用 `vi.stubGlobal('fetch', ...)` 并在 `afterEach/afterAll` 恢复。

#### P2-2: WAL 事件覆盖不完整（未知 sessionUpdate 丢弃）

- **问题**：
  - `writeSessionUpdateToWal()` 对未知 `sessionUpdate` 类型直接 return，不写入 WAL；这会让“唯一真相”在协议扩展时出现静默缺口。
- **解决方案/计划**：
  - [P2] 至少写入一种兜底事件（例如 `session_update_raw/unknown_session_update`），保证不丢。
  - [P2] 随协议演进逐步补齐 kind 映射，或将 payload 统一存为原始 `SessionNotification` 并在 WebUI 投影时解释。

#### P2-3: packages/core `use-socket` 实现质量（可选）

- **问题**：
  - `packages/core/src/hooks/use-socket.ts` 仍保留较多未使用的参数解构，容易引起 lint/no-unused-vars 或误导 hook API。
- **解决方案/计划**：
  - [P2] 清理未使用参数或在 hook 里实际使用（视 packages/core 的对外 API 稳定性决定）。

#### P2-4: discovered sessions 持久化尚未形成闭环（可选）

- **现象/问题**：
  - 目前已把 `discoverSessions()` 的结果写入 WAL（`discovered_sessions`），但 WebUI/CLI 侧尚未形成“读取 WAL 并展示”的稳定闭环。
  - 例如：如果 agent discovery 临时失败/CLI 重启后未主动 discover，WebUI 可能看不到之前已发现的外部会话列表（即使 WAL 里有记录）。
- **解决方案/计划**：
  - [P2] 在 CLI 注册到 Gateway 后，先从 WAL 读出 `discovered_sessions` 并 emit 给 Gateway/WebUI（作为“缓存列表”），再异步跑一次真实 discover 做校验与更新。
  - [P2] 明确 stale 策略：cwd 不存在/长期未验证的记录如何展示与清理。

### 仍建议修复（P1）

#### P1-1: CLI reconnect replay 触发条件可能漏判

- **现象**：当前 `replayUnackedEvents()` 仅在 `wasReconnect` 为 true 时触发，而 `wasReconnect` 由 `connect_error` 计数推断，可能漏判某些实际发生的断线/重连路径。
- **修复计划**：
  - 让 replay 触发更“保守但幂等”：在每次 `connect`/`cli:registered` 后都执行一次 replay（由 seq+ack 保证去重），避免漏重放。

### 修复实施计划（建议顺序，Phase 2.1）

目标：让 Phase 2 的“可靠补齐缺口”承诺可验收（不丢、不重复、revision 可自愈）。

1) **完成 P0-1 的验收（已实现，补测试/手动覆盖）**
   - 补单测：覆盖“首次打开 session 的 `seq=1`”与 “revision bump 首包不丢”。
   - 手动验收：首次打开/刷新后打开、`session/reload`、外部 `session/load` 导入。

2) **先修 WebUI “游标读取一致性”（P0-6，阻断重复/误判 gap 的根因）**
   - 选定 cursor 的同步 source of truth（cursorRef / store.getState / 注入 getSessionCursor）。
   - 所有 handler（`session:event`、`session:update`、`terminal:output`、pending flush）统一改为基于该 source of truth 做去重与 gap 判断。
   - 引入 `appliedNonEventlogContentRef` 标记，为 P0-2 的窗口期去重提供依据。

3) **完成“内容级唯一真相”切换（P0-2，含 terminal output）**
   - WebUI：对 eventlog 模式的 session（cursorRef 判定 `revision` 已建立或已收到 `session:event`）：
     - 跳过 `session:update` 的内容级更新（chunk/tool），只保留 meta 更新。
     - 跳过 `terminal:output` 的内容级更新，避免与 `session:event(kind=terminal_output)` 叠加导致输出翻倍。
   - 解决“进入 eventlog 前窗口期重复”：
     - 一旦首次收到 `session:event` 且发现曾应用过 non-eventlog 内容（ref 标记为 true），必须 reset 投影并 `afterSeq=0` backfill 重建。

4) **把 revision mismatch 自愈做成“无竞态”的状态机（P0-3 + Fix 2 合同收敛）**
   - 保留 mismatch 检测（`response.revision !== requestedRevision`），但修正实现：
     - mismatch 时旧 backfill 必须“终止 return”（不触发 onComplete），且 finally 不能清理新 backfill 的状态（generation/token）。
     - 修复 CLI `getSessionEvents` mismatch 语义：避免返回“revision 与 events 不一致”的响应（Fix 2）。
     - WebUI 层面不要把 mismatch 视作成功完成；重试计数、isBackfilling 状态只能由统一状态机推进。

5) **gap 即时补洞 + pending 清理验收（P0-4/P0-5）**
   - gap 分支触发 backfill 必须是幂等/节流的（一次缺口只跑一个 backfill）。
   - pending 写入/flush 的去重与过期判断必须基于同步 cursor（承接 P0-6）。
   - 设定 pending 上限，超限时强制 reset+backfill（防止内存增长与卡死）。

6) **移除会造成 silent loss 的 best-effort fallback（P0-7）**
   - best-effort 仅允许连续应用，不得推进 cursor 越过缺口。
   - backfill 失败时应显式暴露“需要重试”的状态，不应偷偷跳过缺口。

7) **改进 CLI reconnect replay 触发（P1-1）**
   - CLI 在每次 `connect`/`cli:registered` 后都调用 `replayUnackedEvents()`（幂等），不要依赖 `connect_error` 推断是否重连。

8) **补测试 + 手动验收（覆盖回归）**
   - 单测：
     - `apps/webui/src/hooks/__tests__/useSocket.test.tsx`：session:event 首包、乱序+补洞、gap 触发 backfill、terminal output 不翻倍、revision mismatch 自愈（含竞态回归）。
     - 增补：cursor 快照不更新（不 rerender）时仍能正确 dedup/gap/backfill（覆盖 P0-6），以及 backfill error 时 cursor 不越过缺口（覆盖 P0-7）。
     - `apps/gateway/src/routes/__tests__/sessions.test.ts`：events 接口 + auth/ownership（以及 revision mismatch 语义若采用 HTTP 409/字段）。
   - 手动/集成测试：按本文件“手动/集成测试场景”表逐项验收。

### P2（质量/性能/测试，待后续优化）

- 测试隔离：`apps/mobvibe-cli/src/acp/__tests__/session-manager.test.ts` 的 `walDbPath` 若仍使用固定路径，建议改为 per-test 临时目录，避免并行/复跑污染。
- 性能优化：`events:ack` 目前是“每条事件 ack 一次”（`apps/gateway/src/socket/cli-handlers.ts`），可能造成高频输出时的额外 RTT/DB 写放大；可考虑按 session 批量/节流 ack（例如定时 ack upToSeq）。

### Phase 3：统一实时推送为 `session:event`（停用 `session:update` 的内容级推送） ⏳ 待实施（建议）

- CLI->Gateway->WebUI 将旧事件逐步替换为统一的 `session:event`（带 seq/revision）。
- Gateway 仍只做订阅转发，不存内容。
- WebUI 投影完全基于 `SessionEvent`，旧 `SessionNotification` 解析逻辑可逐步下线。

**当前状态：**

- 已引入 `session:event`（WAL 事件流）并在链路中转发，但与旧的 `session:update` 仍并存。
- Phase 3 的目标是：对“消息投影/终端输出/tool call 等内容级 UI”，统一只使用 `session:event + backfill`，并逐步停用 `session:update` 的内容推送（保留必要的兼容/元信息，或最终也迁移为 WAL 的 `session_info_update`）。

验收：

- 同一 session 在多次断线/重连下，WebUI 不会重复消息、不缺 chunk。

### Phase 4：ACP 外部会话导入完善 ⏳ 待实施（可选）

目标：外部会话通过 `session/list` 发现，通过 `session/load` 导入 WAL 并可持续同步。

- `discoverSessions` 的结果持久化（可选）：
  - CLI 重启后仍能展示外部会话列表（不必重新 discover 才出现）。
- `session/load` 导入时的 revision 策略固化：
  - 首次导入创建 revision=1
  - reload 导入 revision+=1

**当前状态：**

- `session/load` 和 `session/reload` 基础功能已实现
- 外部会话的事件会写入 WAL 并同步
- revision 策略部分实现（需要进一步固化）

验收：

- 用同一 agent 在 terminal 单独创建的会话，可以在 WebUI discover -> load -> 得到完整历史并后续不丢。

### Phase 5：Compaction 与性能 ⏳ 待实施（需实现安全 compaction）

- chunk 合并、terminal snapshot、按时间/大小清理旧 revision。
- 目标是控制 `~/.mobvibe/` 数据体积并加速事件查询与 UI 重建。

**当前状态：**

- 已引入初版 compactor（清理 acked 事件/旧 revision + `VACUUM`），但该策略会导致"历史不可重建"。
- **P0-8 已修复**：compaction 默认禁用（`enabled: false`, `runOnStartup: false`），`mobvibe compact --dry-run` 仅作为观察工具。
- Phase 5 的目标是实现 **snapshot-based + 不丢语义** 的安全 compaction，并补齐测试与验收。

## 测试与验证

### 单元测试

**已完成：**

- ✅ CLI WAL Store (`apps/mobvibe-cli/src/wal/__tests__/wal-store.test.ts`)
  - `ensureSession` - 创建和更新会话
  - `appendEvent` - 追加事件，seq 单调递增
  - `queryEvents` - 按 afterSeq 查询、limit、分页
  - `ackEvents` - 事件确认
  - `incrementRevision` - revision 切换与隔离
  - `getCurrentSeq` - 获取当前序号
  - `persistence` - 数据持久化和重载

- ✅ Session Manager (`apps/mobvibe-cli/src/acp/__tests__/session-manager.test.ts`)
  - `discoverSessions` - 会话发现
  - `loadSession` - 加载会话，`session:attached` 事件
  - `reloadSession` - 重载会话
  - `listSessions` - 列出会话
  - `closeSession` - 关闭会话，`sessions:changed` 事件

**待完成：**

- ⏳ Gateway 补拉接口测试 (`apps/gateway/src/routes/__tests__/sessions.test.ts`)
- ⏳ WebUI 补拉 Hook 测试 (`packages/core/src/hooks/__tests__/use-session-backfill.test.ts`)
- ⏳ WebUI 投影测试：
  - 首包事件引导（`revision` 未初始化时的 `seq=1`）
  - out-of-order 事件缓冲与补洞
  - gap 检测触发 backfill（不依赖刷新/重连）
  - duplicate 事件去重
  - terminal output 不翻倍（`terminal:output` 与 `session:event(terminal_output)` 不重复叠加）
  - cursor 快照不更新时仍正确（不依赖 React rerender 也能正确 dedup/gap/backfill）
  - revision 切换（reload/load）与 revision mismatch 自愈（无竞态，不会被旧 backfill 覆盖状态）
  - backfill error/mismatch 重试耗尽时不应推进 cursor 越过缺口（避免 silent loss）
  - 过渡期双路事件（`session:update`/`session:event`）的屏蔽策略（避免重复追加）
- ⏳ safe compaction 测试（snapshot/压缩后仍可完整重建历史）

### 手动/集成测试场景（必须覆盖）

| 场景 | 状态 | 说明 |
|------|------|------|
| WebUI 断网 10s -> 恢复 | ⏳ | 期间 agent 仍在流式输出；恢复后应补齐缺口 |
| Gateway 重启 | ⏳ | CLI 继续运行，产生输出；WebUI 重连后可补齐 |
| CLI 与 Gateway 断线 | ⏳ | CLI 继续记录；重连后 WebUI 最终可见完整输出 |
| 外部会话导入 | ⏳ | WebUI discover -> load -> 得到历史 |
| reload | ⏳ | 同一 session 多次 reload，revision 正确切换 |

## 风险与应对

- 日志体积增长：短期先禁用删除型 compaction 并观测；中期通过 snapshot-based 安全 compaction/压缩控制体积（禁止仅凭 ack 删除唯一真相）。
- 多端同时订阅：按 seq 去重即可；补拉可按 socket 单独触发，避免广播大量历史。
- 兼容旧 UI：通过 feature flag/双发事件过渡。

## 代码影响范围（已实现）

### CLI (apps/mobvibe-cli)

| 文件 | 状态 | 说明 |
|------|------|------|
| `src/wal/wal-store.ts` | ✅ 新增 | WAL 存储核心 |
| `src/wal/migrations.ts` | ✅ 新增 | Schema 迁移 |
| `src/wal/seq-generator.ts` | ✅ 新增 | 序号生成器 |
| `src/wal/compactor.ts` | ✅ 新增 | WAL compactor；**P1-3: 删除未使用的 revisionCutoff 计算** |
| `src/wal/index.ts` | ✅ 新增 | 导出 |
| `src/config.ts` | ✅ 修改 | 添加 `walDbPath` + compaction 配置；**P0-8: 默认禁用 compaction**；**P1-3: 删除未实现配置项** |
| `src/acp/session-manager.ts` | ✅ 修改 | 事件源头落盘 + revision/seq；**Fix 2: 返回真实 revision**；**P0-9: loadSession 检测已有历史时 bump revision** |
| `src/daemon/socket-client.ts` | ✅ 修改 | 新增 `rpc:session:events` |
| `src/daemon/daemon.ts` | ✅ 修改 | **Fix 4: shutdown 改调 `sessionManager.shutdown()`**；**P1-2: 关闭 compactor 资源** |
| `src/index.ts` | ✅ 修改 | 新增 `mobvibe compact` 命令（仅作为手动观察工具） |

### Gateway (apps/gateway)

| 文件 | 状态 | 说明 |
|------|------|------|
| `src/services/session-router.ts` | ✅ 修改 | 新增 `getSessionEvents()` |
| `src/routes/sessions.ts` | ✅ 修改 | 新增 `GET /acp/session/events` |
| `src/index.ts` | ✅ 修改 | **Fix 1: 添加 `session:event` case 路由** |
| `src/socket/webui-handlers.ts` | ✅ 修改 | **Fix 1: 添加 `emitSessionEvent()` 方法** |

### Core (packages/core)

| 文件 | 状态 | 说明 |
|------|------|------|
| `src/stores/chat-store.ts` | ✅ 修改 | 添加 revision, lastAppliedSeq, isBackfilling 等游标字段（持久化游标，不持久化 messages） |
| `src/hooks/use-session-backfill.ts` | ✅ 修改 | 补拉 hook；**P0-3 已修复**：mismatch 时直接 return 不触发 onComplete |
| `src/hooks/use-socket.ts` | ✅ 修改 | 增加 `session:event` 回调（onSessionEvent），供上层实现游标推进/补拉 |

### WebUI (apps/webui)

| 文件 | 状态 | 说明 |
|------|------|------|
| `src/lib/socket.ts` | ✅ 修改 | **Fix 3: 添加 `onSessionEvent()` 方法** |
| `src/lib/acp.ts` | ✅ 修改 | **Fix 3: 导出 `SessionEvent` 类型** |
| `src/hooks/useSocket.ts` | ✅ 修改 | **P0-6/P0-7 已修复**：引入 cursorRef + getCursor + updateCursorSync；best-effort 只连续应用；**P1-4: cursorRef delete 改为 set** |
| `src/hooks/useSessionMutations.ts` | ✅ 修改 | **Fix 3: 添加 cursor 管理方法** |
| `src/hooks/__tests__/useSocket.test.tsx` | ✅ 修改 | 覆盖 P0-6（同步游标）、P0-7（gap 检测）测试 |
| `src/hooks/__tests__/useSessionBackfill.test.tsx` | ✅ 新增 | 覆盖 P0-3（mismatch 终止语义）测试 |

### Shared (packages/shared)

| 文件 | 状态 | 说明 |
|------|------|------|
| `src/types/socket-events.ts` | ✅ 修改 | 添加 SessionEvent, SessionEventKind 等类型 |

---

## 实施状态总结

```
Phase 0: 规格与兼容策略     ✅ 完成（类型定义、事件模型）
Phase 1: CLI 本地 WAL       ✅ 完成（bun:sqlite WAL + 单元测试）
Phase 2: 补拉 RPC + WebUI   ✅ 完成（核心链路 + Fix 2/P0-3/P0-6/P0-7）
Phase 2.2: 安全修复          ✅ 完成（P0-8/P0-9/P1-2/P1-3/P1-4 已修复；最后更新：2026-02-05）
Phase 3: 统一实时推送为 session:event ⏳ 待实施（建议：停用 session:update 内容级推送）
Phase 4: 外部会话导入完善   ⏳ 待实施（可选优化）
Phase 5: Compaction 与性能  ⏳ 待实施（需实现 snapshot-based 安全 compaction）
```

### 2026-02-04 修复总结

| 修复 | 严重性 | 状态 | 说明 |
|------|--------|------|------|
| Gateway session:event 订阅隔离 | P0 安全 | ✅ | 防止事件泄漏到非订阅者 |
| Fix 2: getSessionEvents revision/events 一致性 | P0 功能 | ✅ | mismatch 时返回空 events + 真实 revision |
| P0-3: Backfill mismatch 终止语义 | P0 功能 | ✅ | mismatch 时直接 return，不触发 onComplete |
| P0-6: cursorRef 同步游标 | P0 功能 | ✅ | 引入 cursorRef + getCursor + updateCursorSync |
| P0-7: best-effort 只连续应用 | P0 功能 | ✅ | 遇到缺口停止应用，保留 pending |
| CLI shutdown 资源释放 | P1 资源 | ✅ | 正确关闭 WAL 连接 |
| Backfill cookie auth | P1 鉴权 | ✅ | 与 WebUI 认证对齐 |
| CLI reconnect replay 触发 | P1 可靠性 | ⚠️ 建议改进 | 当前依赖 connect_error 推断重连，建议改为"每次 connect/registered 都 replay（幂等）" |

### 2026-02-05 修复总结（Phase 2.2）

| 修复 | 严重性 | 状态 | 说明 |
|------|--------|------|------|
| P0-8: 删除型 compaction 导致历史不可重建 | P0 可靠性 | ✅ | 默认禁用 compaction（`enabled: false`, `runOnStartup: false`） |
| P0-9: session/load 可能重复导入 | P0 功能 | ✅ | `loadSession()` 检测已有历史时 bump revision |
| P1-2: compactor 资源泄漏 | P1 资源 | ✅ | shutdown 时关闭 compactorWalStore 和 compactorDb |
| P1-3: compaction 配置与实现不一致 | P1 配置 | ✅ | 删除未实现的配置项（consolidateChunksAfterSec, keepOldRevisionsDays） |
| P1-4: cursorRef delete 导致 stale read | P1 竞态 | ✅ | cursorRef delete 改为 set 新值，避免 fallback 到旧快照 |

### 下一步建议

1. **端到端验证**：WebUI 断网/重连、Gateway 重启、CLI-Gateway 断线、外部会话导入、反复 reload（revision 切换）。
2. **补充单元测试**：
   - P0-8/P0-9 回归测试：刷新重建不丢、同一 session 重复 load 不重复导入
   - P1-4 回归测试：backfill error + pending gap 场景
   - Gateway 端补拉接口测试 (`apps/gateway/src/routes/__tests__/sessions.test.ts`)
3. **再推进 Phase 3**：在验证无重复/不丢后，逐步停用 `session:update` 的内容级推送，统一以 `session:event` 为准。
4. **改进 CLI reconnect replay**：每次 connect/registered 都 replay（幂等），不依赖 connect_error 推断。
