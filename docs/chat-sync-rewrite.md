# WebUI Chat Sync 重写方案

## 一、WebUI 完整功能总结

### 1. Session 管理

| 功能 | REST API | Socket 事件 | 说明 |
|------|----------|-------------|------|
| 创建 Session | `POST /acp/session` | - | 参数: cwd, title, backendId, machineId |
| 列出 Sessions | `GET /acp/sessions` | `sessions:changed` | 实时更新列表 |
| 激活/加载 Session | `POST /acp/session/load` | `session:attached` | 加载历史 session |
| 重新加载 Session | `POST /acp/session/reload` | - | 强制重新加载 |
| 关闭 Session | `POST /acp/session/close` | `session:detached` | - |
| 重命名 Session | `PATCH /acp/session` | - | - |
| 发现历史 Session | `GET /acp/sessions/discover` | `sessions:discovered` | 分页发现 |

### 2. 消息/聊天

| 功能 | REST API | Socket 事件 | 说明 |
|------|----------|-------------|------|
| 发送消息 | `POST /acp/message` | - | 发送 ContentBlock[] |
| 生成消息 ID | `POST /acp/message/id` | - | 乐观 UI 更新用 |
| 接收消息流 | - | `session:event` | kind: user_message, agent_message_chunk |
| 取消操作 | `POST /acp/session/cancel` | - | - |

**消息类型**:

- `text`: 文本消息 (user/assistant)
- `tool_call`: 工具调用
- `permission`: 权限请求
- `status`: 状态消息

### 3. 权限系统

| 功能 | REST API | Socket 事件 | 说明 |
|------|----------|-------------|------|
| 接收权限请求 | - | `permission:request` | 显示审批 UI |
| 发送决定 | `POST /acp/permission/decision` | `permission:decision` | approve/deny |
| 接收结果 | - | `permission:result` | 更新 UI 状态 |

### 4. 文件系统

| 功能 | REST API | 说明 |
|------|----------|------|
| 获取 Session 根目录 | `GET /fs/session/roots` | cwd 作为根 |
| 列出目录内容 | `GET /fs/session/entries` | 支持 .gitignore |
| 预览文件 | `GET /fs/session/file` | 代码/图片预览 |
| 获取资源列表 | `GET /fs/session/resources` | 文件 token 列表 |
| 获取 Host 根目录 | `GET /fs/roots` | 主机文件系统 |
| 列出 Host 目录 | `GET /fs/entries` | 主机文件系统 |

### 5. Git 集成

| 功能 | REST API | 说明 |
|------|----------|------|
| 获取 Git 状态 | `GET /fs/session/git/status` | branch, files 状态 |
| 获取文件 Diff | `GET /fs/session/git/diff` | 行级 diff |

### 6. 设置/配置

| 功能 | REST API | 说明 |
|------|----------|------|
| 切换 Mode | `POST /acp/session/mode` | agent/chat 等 |
| 切换 Model | `POST /acp/session/model` | claude-3-5-sonnet 等 |

### 7. 后端/机器管理

| 功能 | REST API | Socket 事件 | 说明 |
|------|----------|-------------|------|
| 列出 Backends | `GET /acp/backends` | - | 可用 ACP 后端 |
| 列出机器 | `GET /api/machines` | `cli:status` | 已连接机器 |
| 机器状态流 | `GET /api/machines/stream` | - | SSE 实时状态 |

### 8. 历史/Backfill

| 功能 | REST API | 说明 |
|------|----------|------|
| 获取事件历史 | `GET /acp/session/events` | revision/seq 分页 |

---

## 二、当前架构问题

### 消息流现状

```
CLI (ACP) ─> session-manager.ts ─┬─> session:event (WAL, 主要)
                                 ├─> permission:request (直接)
                                 ├─> permission:result (直接)
                                 └─> terminal:output (废弃，仍存在)
                                      │
                                      ▼
Gateway ─┬─> webui-handlers.ts ──> 多个 emitter
         │   ├─> emitSessionUpdate (废弃)
         │   ├─> emitSessionEvent
         │   ├─> emitTerminalOutput (废弃)
         │   └─> emitPermissionRequest/Result
         │
         └─> cli-handlers.ts ──> events:ack
                                      │
                                      ▼
WebUI ─┬─> useSocket.ts ─┬─> handleSessionEventRef (主要)
       │                 ├─> handleSessionUpdateRef (废弃，仍监听)
       │                 └─> handleTerminalOutputRef (废弃，仍监听)
       │
       └─> use-session-backfill.ts ─> REST backfill
```

### 核心问题

1. **双事件流**: `session:update` + `session:event` 同时存在
2. **游标重复**: `cursorRef` + store state 需要手动同步
3. **Backfill 复杂**: generation 跟踪、重试限制、pending buffer
4. **Gateway 冗余**: 多个独立 emitter 函数
5. **终端输出分散**: `terminal:output` 独立事件 + `session:event` 中也有

---

## 三、新架构设计

### 简化消息流

```
CLI (ACP) ─> session-manager.ts ──> session:event (统一通道，含 terminal_output / session_error)
                                          │
                                          ▼
Gateway ─> cli-handlers.ts ─> 统一 relay
           ├─> emitSessionEvent (内容事件)
           ├─> emitPermissionRequest/Result (权限事件)
           └─> emitSessionAttached/Detached (状态事件)
                                          │
                                          ▼
WebUI ─> useSocket.ts ─> handleSessionEvent() ─> chat-store
                     │
                     └─> BackfillManager (简化)
```

### 核心原则

1. **单一内容通道**: 所有内容/流式增量只通过 `session:event`
2. **状态/权限独立**: `session:attached/detached` 与 `permission:*` 继续保持独立事件
3. **统一游标**: 用 `useChatStore.getState()` 直接读取，无需 ref
4. **简化 Backfill**: AbortController 替代 generation
5. **清理废弃代码**: 删除 `session:update`, `terminal:output`, `session:error` 独立事件

### 事件合并规则

- `revision` 变化时，立即重置 session 状态并触发 backfill；旧 revision 的缓冲事件直接丢弃。
- `seq` 只允许单调递增应用，`seq <= lastAppliedSeq` 直接忽略。
- 遇到 `seq` 跳跃时，先缓冲事件并触发 backfill；backfill 完成后按序冲刷缓冲事件。
- backfill 返回的事件也需要去重（过滤 `seq <= lastAppliedSeq`）。

---

## 四、CLI 需要支持的方法

### RPC 处理器 (Gateway → CLI)

| RPC 方法 | 参数 | 返回 | 说明 |
|----------|------|------|------|
| `rpc:session:create` | cwd?, title?, backendId? | SessionSummary | 创建 session |
| `rpc:session:close` | sessionId | { ok: true } | 关闭 session |
| `rpc:session:cancel` | sessionId | { ok: true } | 取消操作 |
| `rpc:session:mode` | sessionId, modeId | SessionSummary | 切换 mode |
| `rpc:session:model` | sessionId, modelId | SessionSummary | 切换 model |
| `rpc:message:send` | sessionId, prompt[] | { stopReason } | 发送消息 |
| `rpc:permission:decision` | sessionId, requestId, outcome | { ok: true } | 权限决定 |
| `rpc:fs:roots` | sessionId | { root } | Session 根目录 |
| `rpc:fs:entries` | sessionId, path? | { entries[] } | 目录内容 |
| `rpc:fs:file` | sessionId, path | { content, previewType } | 文件预览 |
| `rpc:fs:resources` | sessionId | { entries[] } | 资源列表 |
| `rpc:hostfs:roots` | machineId | { homePath, roots[] } | Host 根 |
| `rpc:hostfs:entries` | machineId, path | { entries[] } | Host 目录 |
| `rpc:git:status` | sessionId | { isGitRepo, branch, files[] } | Git 状态 |
| `rpc:git:fileDiff` | sessionId, path | { addedLines[], ... } | Git diff |
| `rpc:sessions:discover` | cwd?, cursor? | { sessions[], nextCursor? } | 发现历史 |
| `rpc:session:load` | sessionId, cwd? | SessionSummary | 加载历史（cwd 可选） |
| `rpc:session:reload` | sessionId, cwd? | SessionSummary | 重新加载（cwd 可选） |
| `rpc:session:events` | sessionId, revision, afterSeq, limit? | { events[], hasMore } | Backfill |

### Socket 事件 (CLI → Gateway)

| 事件 | Payload | 说明 |
|------|---------|------|
| `cli:register` | machineId, hostname, backends[] | 注册 CLI |
| `cli:heartbeat` | - | 心跳 (30s) |
| `sessions:list` | SessionSummary[] | 完整 session 列表 |
| `sessions:changed` | added[], updated[], removed[] | 增量更新 |
| `sessions:discovered` | sessions[], nextCursor? | 发现的历史 session |
| `session:event` | sessionId, revision, seq, kind, payload | **统一事件通道**（kind 包含 terminal_output / session_error） |
| `session:attached` | sessionId, attachedAt | 连接状态 |
| `session:detached` | sessionId, detachedAt, reason | 断开状态 |
| `permission:request` | sessionId, requestId, options, toolCall? | 权限请求 |
| `permission:result` | sessionId, requestId, outcome | 权限结果 |
| `rpc:response` | requestId, result?, error? | RPC 响应 |

### RPC/REST 参数说明

- REST `POST /acp/session` 接受 `machineId` 用于 Gateway 选择目标 CLI；该字段**不**透传到 `rpc:session:create`。
- `rpc:session:load` / `rpc:session:reload` 的 `cwd` 为可选参数，不传时沿用已有 session 的 cwd。

### 废弃事件 (需删除)

- ~~`session:update`~~ → 用 `session:event`
- ~~`terminal:output`~~ → 用 `session:event` kind="terminal_output"
- ~~`session:error`~~ → 用 `session:event` kind="session_error"

---

## 五、Gateway 需要支持的方法

### REST API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/acp/backends` | 列出 backends |
| GET | `/acp/sessions` | 列出 sessions |
| POST | `/acp/session` | 创建 session |
| PATCH | `/acp/session` | 重命名 session |
| POST | `/acp/session/close` | 关闭 session |
| POST | `/acp/session/cancel` | 取消操作 |
| POST | `/acp/session/mode` | 切换 mode |
| POST | `/acp/session/model` | 切换 model |
| POST | `/acp/message/id` | 生成消息 ID |
| POST | `/acp/message` | 发送消息 |
| POST | `/acp/permission/decision` | 权限决定 |
| GET | `/acp/sessions/discover` | 发现历史 |
| POST | `/acp/session/load` | 加载历史 |
| POST | `/acp/session/reload` | 重新加载 |
| GET | `/acp/session/events` | Backfill 事件 |
| GET | `/fs/roots` | Host 根目录 |
| GET | `/fs/entries` | Host 目录内容 |
| GET | `/fs/session/roots` | Session 根目录 |
| GET | `/fs/session/entries` | Session 目录内容 |
| GET | `/fs/session/file` | 文件预览 |
| GET | `/fs/session/resources` | 资源列表 |
| GET | `/fs/session/git/status` | Git 状态 |
| GET | `/fs/session/git/diff` | Git diff |
| GET | `/api/machines` | 机器列表 |
| GET | `/api/machines/stream` | 机器状态 SSE |
| DELETE | `/api/machines/:id` | 删除机器 |

### Socket /webui 事件

**接收 (WebUI → Gateway)**:

- `subscribe:session` - 订阅 session
- `unsubscribe:session` - 取消订阅
- `permission:decision` - 权限决定

**发送 (Gateway → WebUI)**:

- `session:event` - 统一内容事件（包含 terminal_output / session_error）
- `permission:request` - 权限请求
- `permission:result` - 权限结果
- `session:attached` - 连接状态
- `session:detached` - 断开状态
- `sessions:changed` - session 列表变更
- `cli:status` - CLI 状态

### Socket /cli 事件

**接收 (CLI → Gateway)**:

- 见上述 "CLI → Gateway" 事件列表

**发送 (Gateway → CLI)**:

- `events:ack` - 确认事件接收
- RPC 请求 (通过 `sendRpc()`)

### 废弃 Emitter (需删除)

- ~~`emitSessionUpdate`~~ → 删除
- ~~`emitTerminalOutput`~~ → 删除

---

## 六、实施阶段

### 阶段 1: 清理 Gateway ✅ 已完成

**目标**: 移除废弃 emitter 和 handler，并保证统一通道覆盖错误与终端输出

**已删除** (`webui-handlers.ts`):

- `emitSessionUpdate` 函数
- `emitTerminalOutput` 函数
- `emitSessionError` 函数
- 相关未使用的导入 (`SessionNotification`, `StreamErrorPayload`, `TerminalOutputEvent`)

**已删除** (`cli-handlers.ts`):

- `terminal:output` socket handler
- `session:error` socket handler
- 相关未使用的导入 (`StreamErrorPayload`, `TerminalOutputEvent`)

**已更新** (`index.ts`):

- 移除 relay 中的 `session:error` 处理
- 移除 relay 中的 `terminal:output` 处理
- `session:event` relay 已覆盖 `terminal_output` / `session_error` kind

**文件**:

- `/apps/gateway/src/socket/webui-handlers.ts`
- `/apps/gateway/src/socket/cli-handlers.ts`
- `/apps/gateway/src/index.ts`

---

### 阶段 2: 清理 WebUI Socket 处理 ✅ 已完成

**目标**: 移除废弃监听，简化游标

**已删除** (`useSocket.ts`):

- `cursorRef` - 用 `getCursor()` 从 store 直接读取替代
- `handleSessionUpdateRef` - 废弃事件处理器
- `handleSessionErrorRef` - 废弃事件处理器
- `handleTerminalOutputRef` - 废弃事件处理器

**已实现游标读取**:

```typescript
const getCursor = (sessionId: string) => {
  const session = useChatStore.getState().sessions[sessionId];
  return {
    revision: session?.revision,
    lastAppliedSeq: session?.lastAppliedSeq ?? 0,
  };
};
```

**已实现事件处理** (见 `handleSessionEventRef.current`):

- Revision 变化检测和处理
- Seq 单调递增验证
- Gap 检测和 backfill 触发
- Pending events 缓冲和 flush

**已删除** (`lib/socket.ts`):

- `onSessionUpdate` 方法
- `onSessionError` 方法
- `onTerminalOutput` 方法
- 相关未使用的导入

**已更新** (`packages/core/src/socket/gateway-socket.ts`):

- 添加 `getGatewayUrl()` 方法
- 添加 `getSubscribedSessions()` 方法
- 添加 `onConnect()` 方法
- 添加 `onDisconnect()` 方法
- 删除 `onSessionUpdate` 方法
- 删除 `onSessionError` 方法
- 删除 `onTerminalOutput` 方法

**文件**:

- `/apps/webui/src/hooks/useSocket.ts` (762行 → ~560行)
- `/apps/webui/src/lib/socket.ts`
- `/packages/core/src/socket/gateway-socket.ts`
- `/packages/core/src/hooks/use-socket.ts` (mobile 版本)

---

### 阶段 3: 简化 Backfill ✅ 已完成

**目标**: 用 AbortController 替代 generation

**已删除**:

- `generation` 跟踪逻辑
- 相关 `generationRef` 引用

**已简化**:

- 使用 `AbortController.signal.aborted` 检查取消状态
- `startBackfill` 自动取消同一 session 的前一个 backfill
- `cancelBackfill` 通过 abort() 清理进行中的请求

**关键实现**:

```typescript
// 取消检查现在只用 signal.aborted
if (controller.signal.aborted) break;

// 事件过滤仍然保留去重逻辑
if (event.seq <= cursor.lastAppliedSeq) continue;
```

**文件**:

- `/packages/core/src/hooks/use-session-backfill.ts`

---

### 阶段 4: 简化 Chat Store ✅ 已完成

**目标**: 移除不需要的状态

**已删除**:

- `isBackfilling` 从 `ChatSession` 类型中移除
- `setSessionBackfilling` action 从 store 中移除

**已更新**:

- `ChatStoreActions` 接口移除 `setSessionBackfilling`
- `useSessionMutations.ts` 移除 `setSessionBackfilling` 导出

**保留**:

- `revision`, `lastAppliedSeq` (backfill 需要)

**补充**:

- `pendingEvents` 仅在 `useSocket` hook 本地维护（`pendingEventsRef`）

**文件**:

- `/packages/core/src/stores/chat-store.ts`
- `/apps/webui/src/hooks/useSessionMutations.ts`
- `/apps/webui/src/App.tsx` (移除 4 处 `setSessionBackfilling` 引用)

---

### 阶段 5: 清理类型定义 ✅ 已完成

**已删除** (`socket-events.ts`):

- `CliToGatewayEvents` 中的 `session:update` 类型
- `CliToGatewayEvents` 中的 `session:error` 类型
- `CliToGatewayEvents` 中的 `terminal:output` 类型
- `GatewayToWebuiEvents` 中的 `session:update` 类型
- `GatewayToWebuiEvents` 中的 `session:error` 类型
- `GatewayToWebuiEvents` 中的 `terminal:output` 类型
- 未使用的导入 (`SessionNotification`, `TerminalOutputEvent`)

**已保留**:

- `SessionEventKind` 包含 `terminal_output` / `session_error`
- `session:event` 在两个接口中保留

**文件**:

- `/packages/shared/src/types/socket-events.ts`
- `/packages/core/src/api/types.ts` (移除未使用的 `FsEntry` 导入)

---

### 阶段 6: 审查 gateway-socket.ts ✅ 已完成

**目标**: 审查并清理 gateway-socket.ts

**已验证**:

- `gateway-socket.ts` 已在阶段 2 中清理完成
- 废弃方法已删除
- 新增必要的辅助方法

**REST API 审查** (未修改，保持现状):

- `/acp/session` 的 `machineId` 仅用于 Gateway 选择 CLI
- `/session/load` 与 `/session/reload` 的 `cwd` 为可选参数

**文件**:

- `/packages/core/src/socket/gateway-socket.ts`

---

## 七、关键文件汇总

| 组件 | 文件 | 变更 | 状态 |
|------|------|------|------|
| WebUI Socket | `/apps/webui/src/hooks/useSocket.ts` | 重构 762→~560行，删除废弃处理器 | ✅ |
| WebUI Socket (lib) | `/apps/webui/src/lib/socket.ts` | 删除废弃方法 | ✅ |
| WebUI App | `/apps/webui/src/App.tsx` | 删除 setSessionBackfilling 引用 | ✅ |
| Backfill | `/packages/core/src/hooks/use-session-backfill.ts` | 简化，移除 generation | ✅ |
| Chat Store | `/packages/core/src/stores/chat-store.ts` | 删除 isBackfilling | ✅ |
| Session Mutations | `/apps/webui/src/hooks/useSessionMutations.ts` | 删除 setSessionBackfilling | ✅ |
| Gateway WebUI | `/apps/gateway/src/socket/webui-handlers.ts` | 删除废弃 emitter | ✅ |
| Gateway CLI | `/apps/gateway/src/socket/cli-handlers.ts` | 删除废弃 handler | ✅ |
| Gateway Relay | `/apps/gateway/src/index.ts` | 更新 relay | ✅ |
| Socket Types | `/packages/shared/src/types/socket-events.ts` | 删除废弃事件类型 | ✅ |
| Core Socket | `/packages/core/src/socket/gateway-socket.ts` | 删除废弃方法，添加辅助方法 | ✅ |
| Core Socket (mobile) | `/packages/core/src/hooks/use-socket.ts` | 删除废弃处理器 | ✅ |
| Core Types | `/packages/core/src/api/types.ts` | 删除未使用导入 | ✅ |

---

## 八、验证方案

```bash
pnpm dev
pnpm test:run
pnpm lint
```

### 功能检查清单

1. **Session 管理**
   - [ ] 创建 session
   - [ ] 列出 sessions
   - [ ] 激活/加载 session
   - [ ] 关闭 session
   - [ ] 发现历史 session

2. **消息/聊天**
   - [ ] 发送消息
   - [ ] 接收流式响应
   - [ ] 刷新页面后历史加载
   - [ ] 断网恢复后消息不丢失
   - [ ] 乱序/缺口 seq 触发 backfill
   - [ ] backfill 完成后缓冲合并正确

3. **权限系统**
   - [ ] 显示权限请求
   - [ ] 审批/拒绝
   - [ ] 结果反馈

4. **文件系统**
   - [ ] 浏览目录
   - [ ] 预览文件
   - [ ] Git 状态显示
   - [ ] Git diff 显示

5. **设置**
   - [ ] 切换 mode
   - [ ] 切换 model

6. **终端输出**
   - [ ] 通过 session:event 显示

7. **一致性/异常**
   - [ ] backfill 过程中 revision 变化会重置并丢弃旧缓冲
   - [ ] backfill 取消/重启不会产生重复事件
