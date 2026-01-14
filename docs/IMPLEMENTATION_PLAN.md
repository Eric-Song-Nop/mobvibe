# MVP 实施路线图

## 目标

- 交付一个可用的 ACP 聊天 WebUI MVP：支持通过后端连接本地 `opencode acp`，前端完成基础聊天体验与状态展示。
- 形成清晰的前后端边界与最小可扩展架构，为后续多 Agent/存储/插件化打基础。

## 已完成（来自现有记录）

- [x] 后端：已完成 `apps/server` 工程初始化、`opencode acp` 连接、健康检查与状态接口（详见 `docs/backend-server-setup.md`）。
- [x] 前端：已修复初始化渲染问题（`class`/`for` 属性与 React 去重）（详见 `docs/frontend-init-fix.md`）。
- [x] ACP：补充协议实现跟踪文档（详见 `docs/acp-protocol-implementation.md`）。

## MVP 范围

- 仅支持本地 `opencode acp` 连接，不包含多 Agent 路由。
- 具备最小聊天 UI、消息流展示与输入发送。
- 具备基础连接状态与错误提示。

## MVP 非目标

- 多用户/鉴权、云端部署、插件市场。
- 复杂的会话持久化与高级检索（可做简单本地存储）。
- 复杂的 UI 主题切换与高级配置页。

## 里程碑与任务拆解

### M1：后端 API 与 ACP 会话能力（基础可用）

- [x] 增加后端 API：创建会话、发送消息、拉取增量/流式响应。
- [x] 统一 ACP 连接状态与错误模型，前端可消费。
- [ ] 确保 `opencode acp` 进程生命周期可控（断线重连、退出清理）。

#### M1 状态与错误模型统一（实现前计划）

- 定义统一错误结构：`{ code, message, retryable, scope, detail? }`。
- 规划错误码：`ACP_*` / `SESSION_*` / `REQUEST_*` / `STREAM_*`。
- 后端统一输出：`/acp/opencode` 与所有会话接口返回 `error` 字段。
- SSE 增加 `session_error` 事件，传递会话级错误信息。
- 前端分别展示全局/会话/流式错误，并保留中文文案。

#### M1 状态与错误模型统一（实现后）

- 后端新增统一错误结构与错误码映射，服务/会话/请求统一输出 `error`。
- SSE 增加 `session_error` 事件，流式异常会独立提示。
- 前端统一 `ErrorDetail` 结构，错误分区显示（顶部/会话/流式）。

### M2：前端聊天体验（可交互）

- [x] 采用 Shadcn UI 组件搭建聊天布局与输入框。
- [x] 使用 Streamdown 渲染消息内容。
- [x] 集成 Tanstack Query + Zustand 管理消息与状态。
- [x] 展示 ACP 连接状态、错误提示与重试入口。

#### M2 前端聊天实现计划（实现前）

- 目标：完成最小可用聊天页，可创建会话、发送消息、接收 SSE 流式更新。
- 页面结构：顶部状态栏（连接状态 + 会话 ID）、中部消息流、底部输入区。
- 状态模型：
  - Zustand 维护 `sessionId`、消息列表、输入状态、连接状态。
  - Tanstack Query 负责 `GET /acp/opencode` 轮询状态（默认 5s）。
- API 调用：
  - `POST /acp/session` 创建会话，返回 `sessionId`。
  - `POST /acp/message` 发送消息，返回 `stopReason`。
  - `GET /acp/session/stream` 使用 `EventSource` 订阅 `session_update`。
- 流式渲染：
  - 按 `sessionUpdate` 类型累计消息内容（用户/助手）。
  - 使用 Streamdown 渲染消息正文。
- 错误提示：统一展示请求失败与连接异常文案，并允许重试。

#### M2 前端聊天实现记录（实现后）

- 前端依赖：引入 `@tanstack/react-query`、`zustand`、`streamdown` 支撑状态与流式渲染。
- API 接入：新增 `apps/web/src/lib/api.ts`，默认使用 `http://localhost:3757` 连接后端接口。
- 状态管理：新增 `apps/web/src/lib/chat-store.ts`，维护会话、消息列表、输入与错误状态。
- SSE 订阅：在聊天页创建 `EventSource` 监听 `session_update`，增量拼接助手消息。
- 连接保护：仅在 ACP 状态为 `ready` 时创建会话与发送消息。
- UI 落地：`apps/web/src/App.tsx` 完成最小聊天页布局与状态栏展示。

### M5：多会话并发（实现前计划）

- 目标：后端支持多进程多会话并行，前端支持会话列表与切换，切换不丢消息。
- 架构：每个 session 对应一个 `opencode acp` 进程与 ACP 连接，后端维护 `sessionId -> runner` 映射。
- 会话生命周期：支持创建、关闭、错误状态记录；不做自动过期关闭。
- SSE 方案：单 session 单 SSE；前端仅为当前激活会话建立连接并按 `sessionId` 路由更新。
- API 调整：新增 `GET /acp/sessions` 列表与 `POST /acp/session/close` 关闭接口，保留 `POST /acp/session`、`POST /acp/message`、`GET /acp/session/stream`。
- 前端 UI：左侧会话列表（移动端抽屉/折叠），支持新建、切换、重命名、关闭。

#### M5 多会话并发实现记录（实现后）

- 后端：新增 `SessionManager` 管理多进程会话，按 `sessionId` 管理连接、状态与更新时间。
- 接口：新增会话列表与关闭接口，并支持会话重命名。
- SSE：切换会话时按 `sessionId` 建立单会话 SSE 订阅。
- 前端：引入会话侧边栏 + 移动端抽屉，切换不丢消息，支持重命名与关闭。

### M6：会话元信息展示（实现前计划）

- 目标：在输入框下方展示 Agent 名称、模型与会话模式（Badge 形式）。
- 数据来源：
  - Agent 名称来自 `initialize` 的 `agentInfo`。
  - 模型信息来自 `newSession` 的 `models`（`currentModelId` + `availableModels`）。
  - 会话模式来自 `newSession` 的 `modes` 与后续 `current_mode_update` 更新。
- 后端：在会话摘要中附带 `agentName`、`modelName/modelId`、`modeName/modeId`。
- 前端：Zustand 状态存储元信息，SSE 监听 `current_mode_update` 实时更新模式。

#### M6 会话元信息展示（实现后）

- 后端：会话摘要返回 Agent/模型/模式字段，`current_mode_update` 更新会话模式。
- 前端：Zustand 同步会话元信息，`session_info_update` 更新标题与时间戳。
- UI：输入框下方使用三个 Badge 显示 Agent/Model/Mode，空值时隐藏。

### M7：多会话全量 SSE 订阅（实现前计划）

- 目标：会话切换不影响正在流式回复的消息展示。
- SSE 策略：为所有处于 `ready` 状态的会话保持 `EventSource` 连接。
- 前端状态：每个 `sessionId` 独立接收 `session_update` 并更新对应消息。
- 清理机制：会话关闭或状态变为 `stopped` 时释放对应 SSE。

#### M7 多会话全量 SSE 订阅（实现后）

- 前端：维护会话级 SSE 映射，对所有 `ready` 会话保持订阅。
- 路由更新：`session_update` 按 `sessionId` 写入对应消息与元信息。
- 生命周期：会话离开 `ready` 或关闭时关闭对应 SSE。

### M8：App 组件拆分（实现前计划）

- 目标：降低 `App.tsx` 复杂度，拆分侧边栏与消息组件。
- 拆分范围：`SessionSidebar`/`SessionListItem`/`MessageItem` 独立组件文件。
- 依赖约束：保持现有 props 结构与行为不变。
- 目录规划：`apps/web/src/components/session` 与 `apps/web/src/components/chat`。

#### M8 App 组件拆分（实现后）

- 结构调整：`SessionSidebar`/`SessionListItem` 移至 `apps/web/src/components/session/SessionSidebar.tsx`。
- 消息渲染：`MessageItem` 移至 `apps/web/src/components/chat/MessageItem.tsx`。
- 主入口：`App.tsx` 保留容器逻辑与状态管理。

### M3：最小持久化（增强）

- [ ] 引入 SQLite + Drizzle 保存会话与消息（仅必要字段）。
- [ ] 前端支持恢复最近会话与消息列表。

### M4：质量保障与稳定性

- [ ] 添加基础 API/组件测试（Vitest）。
- [ ] 关键路径验证：启动、连接、发送、断线重连。
- [ ] 统一错误码/错误提示文案。

## 关键接口草案（方向）

- [ ] `GET /health`：服务健康状态。
- [ ] `GET /acp/opencode`：服务级连接状态。
- [ ] `GET /acp/sessions`：列出当前会话列表。
- [ ] `POST /acp/session`：创建新会话。
- [ ] `PATCH /acp/session`：更新会话标题。
- [ ] `POST /acp/session/close`：关闭指定会话。
- [ ] `POST /acp/message`：发送消息（支持流式或轮询）。
- [ ] `GET /acp/session/stream`：订阅指定会话 SSE。

## 风险与缓解

- React 多实例导致 Hook 错误：维持 `react`/`react-dom` 去重与依赖一致性。
- ACP 进程异常退出：增加重连策略与错误上报。
- 流式消息体验不稳定：先做轮询，后续再切流式。

## 验证清单（MVP 验收）

- [ ] 后端服务启动后可成功连接 `opencode acp`。
- [ ] 前端能创建会话、发送消息、接收回复。
- [ ] 断线后能提示并允许重连。
