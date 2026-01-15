# ACP 协议实现跟踪

## 背景与目标

- 记录当前 ACP 协议在 Mobvibe 中的实现范围与接口。
- 作为后续前端对接与扩展（会话、权限、持久化）的基线文档。

## 协议角色与边界

- Client：Mobvibe 后端作为 ACP Client，负责连接本地 ACP CLI（`opencode`/`gemini-cli`）并转发消息。
- Agent：ACP CLI 作为 ACP Agent，负责会话管理与回复生成。

## 当前实现范围

### 已实现

- `initialize`：连接建立时完成协议版本与 Client 信息握手。
- `newSession`：按需创建多个会话，每个会话独立进程。
- `prompt`：发送用户消息并等待响应完成。
- `sessionUpdate`：接收 Agent 推送更新，转发到 SSE，并同步 `current_mode_update`/`session_info_update` 元信息。

### 未实现

- `loadSession` / `resumeSession`：会话恢复能力尚未接入。
- `setSessionMode` / `setSessionModel`：会话模式与模型切换未接入。
- 权限请求交互：当前默认拒绝所有权限请求。

## 关键流程

1. 前端拉取 `/acp/backends`，选择目标后端并请求创建会话。
2. 后端启动对应 ACP CLI 进程，`initialize` 完成协议协商并记录 `agentInfo`。
3. 创建会话并返回 `sessionId` + 初始模型/模式元信息。
4. 前端调用 `/acp/message` 发送用户消息。
5. `sessionUpdate` 通过 SSE 推送给前端，`current_mode_update` 实时更新会话模式。
6. `prompt` 返回 `stopReason` 供前端判断完成状态。

## 后端 API 清单

- `GET /health`：健康检查。
- `GET /acp/agent`：服务级连接状态。
- `GET /acp/backends`：可用后端列表。
- `GET /acp/sessions`：会话列表。
- `POST /acp/session`：创建新会话（支持 `backendId`）。
- `PATCH /acp/session`：更新会话标题。
- `POST /acp/session/close`：关闭会话。
- `POST /acp/message`：发送消息。
- `GET /acp/session/stream`：SSE 推送 `sessionUpdate`。

## ACP SDK 对照矩阵（v0.13.0）

### Client 方法/通知

| 方法/通知 | 能力/条件 | 说明 | Mobvibe 状态 |
| --- | --- | --- | --- |
| `initialize` | 必备 | 协议版本协商 + capabilities | ✅ 已实现 |
| `authenticate` | 需要 `authMethods` | 认证流程 | ❌ 未接入 |
| `newSession` | 必备 | 创建会话 | ✅ 已实现 |
| `loadSession` | `agentCapabilities.loadSession` | 加载会话（含历史回放） | ⏸️ 本阶段不做 |
| `unstable_resumeSession` | `sessionCapabilities.resume` | 恢复会话（不回放） | ⏸️ 本阶段不做 |
| `unstable_listSessions` | `sessionCapabilities.list` | 列出会话 | ⏸️ 本阶段不做 |
| `unstable_forkSession` | `sessionCapabilities.fork` | 会话分叉 | ⏸️ 本阶段不做 |
| `setSessionMode` | `modes`/`current_mode_update` | 切换会话模式 | ❌ 未接入 |
| `unstable_setSessionModel` | `models` | 切换会话模型 | ❌ 未接入 |
| `unstable_setSessionConfigOption` | `configOptions` | 配置项切换 | ❌ 未接入 |
| `prompt` | 必备 | 发送消息 + 流式更新 | ✅ 已实现 |
| `cancel` | 必备 | 取消当前 prompt | ❌ 未接入 |
| `extMethod` / `extNotification` | 扩展 | 非规范扩展 | ⏸️ 不在范围 |
| `sessionUpdate` (notification) | 必备 | SSE 推送更新 | ✅ 已实现 |
| `requestPermission` (callback) | 权限请求 | 需要用户决策 | ❌ 未接入（默认 cancelled） |

### SessionUpdate 类型支持情况

| `sessionUpdate` | 说明 | Mobvibe 状态 |
| --- | --- | --- |
| `user_message_chunk` | 用户消息流 | ✅ 已渲染 |
| `agent_message_chunk` | 助手消息流 | ✅ 已渲染 |
| `agent_thought_chunk` | 内部思考片段 | ❌ 未展示 |
| `tool_call` / `tool_call_update` | 工具调用流 | ⏸️ 本阶段不做 |
| `plan` | 计划输出 | ❌ 未展示 |
| `available_commands_update` | 命令列表更新 | ❌ 未展示 |
| `current_mode_update` | 模式更新 | ✅ 会话元信息已更新 |
| `config_option_update` | 配置项更新 | ❌ 未展示 |
| `session_info_update` | 标题/时间更新 | ✅ 会话元信息已更新 |

### Capabilities 读取点

- `InitializeResponse.agentCapabilities`：决定 `loadSession`/`sessionCapabilities` 是否可用。
- `InitializeResponse.promptCapabilities`：决定是否支持 image/audio/embeddedContext。
- `NewSessionResponse.modes/models/configOptions`：驱动模式/模型/配置 UI。

### 缺口汇总（本阶段优先补齐）

- 权限请求闭环：`requestPermission` 事件 + 决策回传。
- 会话控制：`setSessionMode` / `unstable_setSessionModel`。
- 取消流程：`cancel` 通知。
- 能力映射：`agentCapabilities` 与 `promptCapabilities` 的 UI 表达。

## 后续计划

- 补充权限请求处理策略与用户确认入口。
- 接入会话恢复与持久化（SQLite + Drizzle）。
- 补齐 `setSessionMode` 等扩展能力。

## 下一阶段协议优先级路线图（Post-MVP）

### 目标与约束

- 目标：优先补齐 ACP 基础协议能力与 UI 支撑，确保对多数 ACP Agent 的兼容。
- 约束：
  - 不做会话持久化与恢复（`loadSession`/`resumeSession` 不在本阶段）。
  - 不做工具调用（`tool_call` 系列事件不在本阶段）。
  - 允许用户自定义 Agent 启动命令与环境变量（仅内存态）。

### 基础协议清单（多数 Agent 具备）

- `initialize`
- `newSession`
- `prompt`
- `sessionUpdate`
- `setSessionMode`
- `setSessionModel`
- `requestPermission`（权限请求/响应）

### 进度状态定义

- 未开始：尚未进入实现或设计。
- 进行中：已经开始推进或完成部分。
- 已完成：目标和验收点已达到。
- 阻塞：依赖外部条件或存在明显风险。

### 路线图总览（可追踪进度）

| 里程碑 | 任务 | 状态 | 备注 |
| --- | --- | --- | --- |
| P0：协议盘点与一致性基线 | 对照 ACP SDK/CLI 输出建立事件对照矩阵 | 已完成 | 已在本节补齐矩阵与缺口汇总 |
| P0：协议盘点与一致性基线 | 明确事件顺序与幂等规则 | 未开始 | 需补充前后端事件序列 |
| P0：协议盘点与一致性基线 | 产出前后端事件序列图 | 未开始 | |
| P0：权限请求全链路 | 后端接入 `requestPermission` 并透传 SSE | 已完成 | 新增 `permission_request` 事件 |
| P0：权限请求全链路 | 新增权限决策接口与结果回传 | 已完成 | `POST /acp/permission/decision` + `permission_result` |
| P0：权限请求全链路 | 前端权限卡片与结果展示 | 已完成 | 消息流内展示 + 当前会话处理 |
| P1：会话模型/模式切换 | 后端接入 `setSessionMode`/`setSessionModel` | 未开始 | |
| P1：会话模型/模式切换 | 前端模式/模型切换 UI | 未开始 | |
| P1：会话模型/模式切换 | 不支持能力的错误提示 | 未开始 | |
| P1：自定义 Agent 启动配置 | 新会话创建传入 `command`/`args`/`env` | 未开始 | |
| P1：自定义 Agent 启动配置 | 前端表单与校验 | 未开始 | |

### 里程碑优先级

#### P0：协议盘点与一致性基线

- 对照 ACP SDK/CLI 输出建立事件对照矩阵（已实现/缺口/兼容差异）。
- 明确事件顺序与幂等规则（避免前端乱序/重复渲染）。
- 产出：协议对照表 + 前后端事件序列图。

#### P0：权限请求全链路

- 后端：接入 `requestPermission` 回调并统一为 SSE 事件（`permission_request`）。
- 后端：新增权限决策接口（允许/拒绝/取消）并回传 `permission_result`。
- 前端：消息流权限卡片（靠近工具调用），仅当前会话可处理。
- 前端：在消息流中展示权限请求结果。

#### P1：会话模型/模式切换

- 后端：接入 `setSessionMode`/`setSessionModel` 并同步会话元信息。
- 前端：提供模式/模型切换 UI（下拉或 Sheet）。
- 兼容：若 Agent 不支持，返回标准错误并展示提示。

#### P1：自定义 Agent 启动配置

- 目标：允许用户传入 `command` + `args` + `env` 覆盖，用于新会话创建。
- 交互：新会话表单内填写（默认值来自当前后端配置）。
- 约束：不做持久化，仅对当前会话生效；关闭会话后失效。

### 权限请求实现计划（实现前）

- 目标：只处理当前会话的权限请求，但其他会话的请求需要保留，切换会话后仍可处理。
- 后端：
  - `SessionManager` 持有待处理队列，按 `sessionId + requestId` 记录。
  - `requestPermission` 回调写入队列并通过 SSE 发送 `permission_request`。
  - 新增 `POST /acp/permission/decision`，回传 `outcome` 并触发 `permission_result` SSE。
  - SSE 建连时补发该会话未处理的权限请求。
- 前端：
  - 监听 `permission_request`/`permission_result`，将请求存入对应会话消息流。
  - 在消息列表中渲染工具权限请求卡片，展示 toolCall 摘要与选项按钮。
  - 仅渲染当前会话的请求，其他会话待用户切换后处理。

### 后端实现设计（协议补齐）

#### 权限请求映射

- `AcpConnection` 接收 `requestPermission`，将请求推送到 `SessionManager` 队列。
- `requestId` 采用 `toolCall.toolCallId`，保证同一请求幂等。
- SSE 事件：`permission_request`，负载 `{ sessionId, requestId, options, toolCall }`。
- 权限决策接口：`POST /acp/permission/decision`，请求体 `{ sessionId, requestId, outcome }`。
  - `outcome.outcome = "selected"` 时带 `optionId`。
  - `outcome.outcome = "cancelled"` 表示拒绝。
- 决策后发送 `permission_result` SSE，便于前端展示处理结果。

#### 会话模式/模型切换

- API：`POST /acp/session/mode`，请求体 `{ sessionId, modeId }`。
- API：`POST /acp/session/model`，请求体 `{ sessionId, modelId }`。
- 调用 `setSessionMode` / `unstable_setSessionModel` 并刷新会话元信息。
- 若 Agent 未暴露 capability，返回统一错误码并提示用户。

#### 取消与中断

- API：`POST /acp/session/cancel`，请求体 `{ sessionId }`。
- 调用 `cancel` 通知中断当前 prompt；失败时输出 `session_error`。

#### 自定义 Agent 启动配置

- `POST /acp/session` 新增可选字段 `command`/`args`/`env`，仅覆盖本次会话启动。
- 校验：
  - `command` 为空时不允许覆盖；
  - `env` 仅允许 string key-value；
  - 控制 `env` 长度与字段数。

### 前端实现设计（协议 UI）

#### 权限请求卡片

- 监听 `permission_request`，写入对应会话的消息流，仅当前会话可处理。
- 卡片内容：工具标题/类型/位置（来自 `toolCall`），附选项按钮。
- 选项按钮基于 `PermissionOption` 渲染，直接回传 `optionId`。
- 提交后调用 `permission_decision`，并在消息流展示结果。

#### 会话模式/模型切换

- 根据 `modes/models` 数据展示下拉选择器；为空时隐藏。
- 切换时显示 loading 状态，失败用统一错误提示。

#### 取消与状态

- 当会话处于流式输出时显示“停止”按钮，触发 `session/cancel`。
- 停止成功后提示 `stopReason=Cancelled`。

#### 其他 SessionUpdate 可视化

- `agent_thought_chunk`：折叠展示为“思考”块，可手动展开。
- `plan`：渲染为分段列表卡片。
- `available_commands_update`：展示为只读命令列表（放在状态区）。
- `config_option_update`：展示为配置变更日志（不提供编辑入口）。
- `session_info_update`/`current_mode_update`：保持当前逻辑。

#### 自定义启动配置

- 新会话弹层支持输入命令、参数、环境变量；默认值来自当前后端配置。
- `env` 使用 key-value 行编辑器，支持增删。
- 不做持久化，关闭弹层即丢失。

### API 变更草案

- `POST /acp/session`：新增可选字段 `command`/`args`/`env`。
- `POST /acp/session/mode`：设置会话模式。
- `POST /acp/session/model`：设置会话模型（unstable）。
- `POST /acp/session/cancel`：取消会话当前 prompt。
- `POST /acp/permission/decision`：权限决策 `{ sessionId, requestId, outcome }`。
- `GET /acp/session/stream`：新增 `permission_request`/`permission_result` SSE 事件。

### 权限请求实现记录（实现后）

- 后端：`SessionManager` 缓存待处理权限请求，API 接收决策并回传 `permission_result`。
- SSE：会话建立时补发未处理请求，保证切换会话不丢失。
- 前端：消息流内渲染权限卡片，按钮提交决策并显示结果。

### 验证与测试

- 契约测试：ACP SDK mock 触发 `permission_request`/`session_update` 顺序校验。
- API 测试：`session/mode`、`session/model`、`session/cancel` 的成功/失败路径。
- UI 测试：权限弹窗、取消按钮、模式/模型切换组件（Vitest）。
