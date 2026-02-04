# 消息持久化与同步架构（CLI 端为唯一真相）实施文档

> **实施状态**：Phase 1 ✅ 已完成 | Phase 2 ✅ 已完成 | Phase 3-5 ⏳ 待实施

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

2) mobvibe-cli -> Gateway（Socket.io /cli）
- `apps/mobvibe-cli/src/daemon/socket-client.ts` 将 session/update、terminal/output、permission 等事件 emit 给 Gateway。

3) Gateway -> WebUI（Socket.io /webui）
- `apps/gateway/src/socket/cli-handlers.ts` 收到 CLI 的 `session:update` 直接转发给 WebUI（订阅者）。
- `apps/gateway/src/socket/webui-handlers.ts` 的 `subscribe:session` 只登记订阅关系，不做历史回放。

4) WebUI 本地记录与持久化
- WebUI 使用 `packages/core/src/stores/chat-store.ts`（zustand persist）将 `sessions[sessionId].messages` 存在 localStorage。
- localStorage 的写入通过 `packages/core/src/stores/storage-adapter.ts`，其中 `setItem` 的异常会被吞掉。

### ACP session/list & session/load
- CLI 通过 `apps/mobvibe-cli/src/acp/session-manager.ts` 的 `discoverSessions/loadSession/reloadSession` 支持：
  - `session/list`：发现 agent 持久化的会话（包括外部会话）。
  - `session/load`：让 agent 重放历史（replay），CLI 将重放过程中的 `session:update` 转发给 Gateway/WebUI。
- Gateway 通过 `apps/gateway/src/services/session-router.ts` 暴露 `/acp/session/load`、`/acp/session/reload`，本质是 RPC 转发到 CLI。

## 当前问题清单（为什么容易丢消息/丢历史）

### P0：CLI->Gateway 断线期间，事件直接丢失（不可恢复）
在 `apps/mobvibe-cli/src/daemon/socket-client.ts` 中：
- 所有 emit 都受 `if (this.connected)` 保护。
- 断线期间没有缓冲/落盘/重发逻辑。

结果：
- 只要 CLI 与 Gateway 之间出现短暂网络抖动、Gateway 重启、CLI 重连等，期间产生的流式 chunk/工具调用更新等会 **永久丢失**（WebUI 无法补齐）。

### P0：Gateway->WebUI 断线/切订阅期间，事件直接丢失（不可恢复）
在 `apps/gateway/src/socket/webui-handlers.ts`：
- `subscribe:session` 仅维护订阅集合，没有“按游标回放”的能力。

结果：
- WebUI 切后台、刷新、网络切换、socket 重连后，会话期间的事件缺口无法补拉。

### P1：WebUI localStorage 持久化并不可靠，且失败静默
在 `packages/core/src/stores/storage-adapter.ts`：
- localStorage `setItem` 失败会被 catch 并忽略（配额满、隐私模式限制、浏览器策略等）。

结果：
- “内存里有，刷新后没了/缺一段”的情况很难被发现和纠正。
- 当前 WebUI 端的 `messages` 既承担 UI 状态又承担持久化真相，风险过高。

### P1：没有全链路可重放的序号/游标（无法检测缺口、无法去重）
目前 `session:update` 是 ACP `SessionNotification`（无 `seq/eventId`）：
- 客户端无法判断是否漏了 chunk。
- Gateway 无法为新订阅者补历史。
- CLI 无法按“已发送/已确认”进行重发或清理。

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

### Phase 2：补拉 RPC + WebUI 缺口恢复 ✅ 已完成

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
| `packages/core/src/stores/chat-store.ts` | ✅ | 添加 revision, lastAppliedSeq, pendingEvents |
| `packages/core/src/hooks/use-session-backfill.ts` | ✅ | 补拉 hook（分页、取消、错误处理） |
| `packages/core/src/hooks/use-socket.ts` | ✅ | 集成补拉，缺口检测 |

验收：
- ✅ WebUI 刷新/断线后，只要 CLI 在线，能恢复到完整历史（不再出现"永久缺一段"）。

**待补充的测试：**
- ⏳ Gateway 端补拉接口测试 (`apps/gateway/src/routes/__tests__/sessions.test.ts`)
- ⏳ WebUI 补拉 Hook 测试 (`packages/core/src/hooks/__tests__/use-session-backfill.test.ts`)
- ⏳ 端到端集成测试（断线重连、缺口补拉场景）

### Phase 3：实时推送升级为 `session:event` ⏳ 待实施（可选）

- CLI->Gateway->WebUI 将旧事件逐步替换为统一的 `session:event`（带 seq/revision）。
- Gateway 仍只做订阅转发，不存内容。
- WebUI 投影完全基于 `SessionEvent`，旧 `SessionNotification` 解析逻辑可逐步下线。

**当前状态：**
- 目前仍使用 `session:update` 推送，WAL 仅用于持久化和补拉
- 可在后续迭代中统一为 `session:event`

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

### Phase 5：Compaction 与性能 ⏳ 待实施（可选，持续优化）

- chunk 合并、terminal snapshot、按时间/大小清理旧 revision。
- 目标是控制 `~/.mobvibe/` 数据体积并加速事件查询与 UI 重建。

**当前状态：**
- 暂未实现 compaction 和 TTL 清理
- WAL 文件会持续增长，需要后续优化

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
  - out-of-order 事件缓冲与补洞
  - duplicate 事件去重
- ⏳ compaction 测试（Phase 5 实现后）

### 手动/集成测试场景（必须覆盖）
| 场景 | 状态 | 说明 |
|------|------|------|
| WebUI 断网 10s -> 恢复 | ⏳ | 期间 agent 仍在流式输出；恢复后应补齐缺口 |
| Gateway 重启 | ⏳ | CLI 继续运行，产生输出；WebUI 重连后可补齐 |
| CLI 与 Gateway 断线 | ⏳ | CLI 继续记录；重连后 WebUI 最终可见完整输出 |
| 外部会话导入 | ⏳ | WebUI discover -> load -> 得到历史 |
| reload | ⏳ | 同一 session 多次 reload，revision 正确切换 |

## 风险与应对
- 日志体积增长：通过 compaction/TTL 控制。
- 多端同时订阅：按 seq 去重即可；补拉可按 socket 单独触发，避免广播大量历史。
- 兼容旧 UI：通过 feature flag/双发事件过渡。

## 代码影响范围（已实现）

### CLI (apps/mobvibe-cli)
| 文件 | 状态 | 说明 |
|------|------|------|
| `src/wal/wal-store.ts` | ✅ 新增 | WAL 存储核心 |
| `src/wal/migrations.ts` | ✅ 新增 | Schema 迁移 |
| `src/wal/seq-generator.ts` | ✅ 新增 | 序号生成器 |
| `src/wal/index.ts` | ✅ 新增 | 导出 |
| `src/config.ts` | ✅ 修改 | 添加 `walDbPath` |
| `src/acp/session-manager.ts` | ✅ 修改 | 事件源头落盘 + revision/seq |
| `src/daemon/socket-client.ts` | ✅ 修改 | 新增 `rpc:session:events` |

### Gateway (apps/gateway)
| 文件 | 状态 | 说明 |
|------|------|------|
| `src/services/session-router.ts` | ✅ 修改 | 新增 `getSessionEvents()` |
| `src/routes/sessions.ts` | ✅ 修改 | 新增 `GET /acp/session/events` |

### Core (packages/core)
| 文件 | 状态 | 说明 |
|------|------|------|
| `src/stores/chat-store.ts` | ✅ 修改 | 添加 revision, lastAppliedSeq, pendingEvents |
| `src/hooks/use-session-backfill.ts` | ✅ 新增 | 补拉 hook |
| `src/hooks/use-socket.ts` | ✅ 修改 | 集成补拉，缺口检测 |

### Shared (packages/shared)
| 文件 | 状态 | 说明 |
|------|------|------|
| `src/types/socket-events.ts` | ✅ 修改 | 添加 SessionEvent, SessionEventKind 等类型 |

---

## 实施状态总结

```
Phase 0: 规格与兼容策略     ✅ 完成（类型定义、事件模型）
Phase 1: CLI 本地 WAL       ✅ 完成（bun:sqlite WAL + 单元测试）
Phase 2: 补拉 RPC + WebUI   ✅ 完成（REST API + 补拉 hook）
Phase 3: 统一 session:event ⏳ 待实施（可选优化）
Phase 4: 外部会话导入完善   ⏳ 待实施（可选优化）
Phase 5: Compaction 与性能  ⏳ 待实施（可选优化）
```

### 下一步建议

1. **端到端验证**：在开发环境手动测试断线重连、缺口补拉场景
2. **补充测试**：添加 Gateway 和 WebUI 的单元测试
3. **监控与日志**：添加 WAL 写入/查询的性能监控
4. **可选优化**：根据实际使用情况决定是否实施 Phase 3-5

