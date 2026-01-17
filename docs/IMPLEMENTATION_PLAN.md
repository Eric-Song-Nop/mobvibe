# MVP 实施路线图

## 目标

- 交付一个可用的 ACP 聊天 WebUI MVP：支持通过后端连接本地 ACP CLI（`opencode`/`gemini-cli`），前端完成基础聊天体验与状态展示。
- 形成清晰的前后端边界与最小可扩展架构，为后续多 Agent/存储/插件化打基础。

## 已完成（来自现有记录）

- [x] 后端：已完成 `apps/server` 工程初始化、ACP CLI 连接、健康检查与状态接口（详见 `docs/backend-server-setup.md`）。
- [x] 前端：已修复初始化渲染问题（`class`/`for` 属性与 React 去重）（详见 `docs/frontend-init-fix.md`）。
- [x] ACP：补充协议实现跟踪文档（详见 `docs/acp-protocol-implementation.md`）。

## 本次调整（实现前计划）

- 将 M3「最小持久化」移出 MVP，归类到后续增强。
- 在 MVP 非目标中明确本地持久化不做。
- 移除 ACP CLI 断线重连/退出清理能力的计划。
- 更新里程碑结构，保持后续增强任务清晰。

## 本次调整（实现前计划 - 2026-01-15）

- 新增后端 `/acp/message/id`，用于生成消息 ID，解决前端 `crypto.randomUUID` 不可用问题。
- 前端发送消息改为：先请求 `messageId` → 插入用户消息 → 再调用 `/acp/message`。
- 修复流式消息合并：生成结束或取消时结束 streaming 消息。
- API 基础地址按 `window.location.protocol + hostname` 生成，避免移动端跨域失败。
- 在文档中补充 CORS 环境变量示例，便于局域网访问配置。

## 本次调整（实现后记录）

- 已将 M3 从 MVP 里程碑中移至“后续增强”，并在 MVP 非目标中注明不包含本地持久化。
- 已从 M1 任务中移除 ACP CLI 断线重连与退出清理。

## 本次调整（实现后记录 - 2026-01-15）

- 新增 `POST /acp/message/id`，由后端生成消息 ID，避免前端 `crypto.randomUUID` 依赖。
- 前端发送流程调整为“先取消息 ID → 写入消息 → 调用 `/acp/message`”。
- 流式回复结束/取消后强制收敛 streaming 消息，避免多轮合并。
- API 基础地址改为使用 `window.location.protocol + hostname`，避免移动端跨域失败。
- 文档补充局域网 CORS 配置示例。

## 本次调整（实现前计划 - 2026-01-15 UI 体验优化）

- 页面改为固定高度布局，侧边栏列表与聊天消息区各自独立滚动。
- 顶部状态栏在移动端精简徽章展示，移除“新对话”按钮。
- 输入区固定在底部，处理移动端安全区与滚动遮挡。
- 输出新增 UI 说明文档并在实现后补充细节。

## 本次调整（实现后记录 - 2026-01-15 UI 体验优化）

- Root 改为全高布局，侧边栏与聊天消息区各自独立滚动。
- 顶部状态栏移除“新对话”入口，移动端仅保留必要状态展示。
- 输入区固定在底部并加入安全区 padding，避免滚动遮挡。
- 新增 `docs/ui-layout-update.md` 记录 UI 调整说明。

## 本次调整（实现前计划 - 2026-01-15 选择器与滚动优化）

- 移动端 Model/Mode 触发器宽度扩大，确保图标与下拉指示被完整包裹。
- 消息流加入条件自动滚动，切换会话/消息更新时滚到底部。
- 用户上滑查看历史时暂停自动滚动，避免打断阅读。

## 本次调整（实现后记录 - 2026-01-15 选择器与滚动优化）

- 移动端 Model/Mode 触发器调整为居中布局，边框完整包裹图标与箭头。
- 消息流按阈值自动滚动，切换/更新时定位到底部。
- 引入滚动方向判断，仅向上滚动时暂停自动滚动。
- 上滑离底部超过 80px 时停用自动滚动。

## 本次调整（实现前计划 - 2026-01-15 移动端输入区单行）

- 移动端输入区收敛为单行布局，桌面端继续使用两行结构。
- Model/Mode 控件与发送/停止按钮各占一列，输入框居中占满剩余宽度。
- 输入框移动端高度压缩为单行，避免占用垂直空间。

## 本次调整（实现后记录 - 2026-01-15 移动端输入区单行）

- 移动端输入区调整为 Model/Mode | 输入框 | 发送/停止 的单行布局。
- Model/Mode 与发送/停止在移动端垂直排列，桌面端保持原布局。
- 输入框移动端限制单行高度，减少输入区纵向占用。

## MVP 范围

- 仅支持本地 ACP CLI（`opencode`/`gemini-cli`）连接，不包含多 Agent 路由。
- 具备最小聊天 UI、消息流展示与输入发送。
- 具备基础连接状态与错误提示。

## MVP 非目标

- 多用户/鉴权、云端部署、插件市场。
- 复杂的会话持久化与高级检索（本地持久化移出 MVP）。
- ACP CLI 断线重连与退出清理能力。
- 复杂的 UI 主题切换与高级配置页。

## 里程碑与任务拆解

### M1：后端 API 与 ACP 会话能力（基础可用）

- [x] 增加后端 API：创建会话、发送消息、拉取增量/流式响应。
- [x] 统一 ACP 连接状态与错误模型，前端可消费。
- [x] 支持会话级后端选择，新增 `/acp/backends` 列表接口。

#### M1 状态与错误模型统一（实现前计划）

- 定义统一错误结构：`{ code, message, retryable, scope, detail? }`。
- 规划错误码：`ACP_*` / `SESSION_*` / `REQUEST_*` / `STREAM_*`。
- 后端统一输出：`/acp/agent` 与所有会话接口返回 `error` 字段。
- SSE 增加 `session_error` 事件，传递会话级错误信息。
- 前端分别展示全局/会话/流式错误，并保留中文文案。

#### M1 状态与错误模型统一（实现后）

- 后端新增统一错误结构与错误码映射，服务/会话/请求统一输出 `error`。
- SSE 增加 `session_error` 事件，流式异常会独立提示。
- 前端统一 `ErrorDetail` 结构，错误分区显示（顶部/会话/流式）。

#### M1 访问与 CORS 配置（新增）

- 远程访问时需保证前端与后端同协议（`http`/`https`）一致。
- 推荐在 `.env` 中设置：`MOBVIBE_CORS_ORIGINS=http://192.168.5.72:5173`。
- 若使用自定义域名，需将对应 origin 追加到 `MOBVIBE_CORS_ORIGINS`。

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
  - Tanstack Query 负责 `GET /acp/agent` 轮询状态（默认 5s）。
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
- 架构：每个 session 对应一个 ACP CLI 进程与 ACP 连接，后端维护 `sessionId -> runner` 映射。
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

### M4：质量保障与测试

- [x] 添加基础 API/组件测试（Vitest）。

#### M4 测试实现记录（实现后）

- 已引入 Vitest 与基础测试，详情见 `docs/vitest-testing.md`。

## 风险与缓解

- React 多实例导致 Hook 错误：维持 `react`/`react-dom` 去重与依赖一致性。
- ACP 进程异常退出：增加重连策略与错误上报。
- 流式消息体验不稳定：先做轮询，后续再切流式。

## 验证清单（MVP 验收）

- [x] 后端服务启动后可成功连接 ACP CLI。
- [x] 前端能创建会话、发送消息、接收回复。

## M9 App.tsx 深度拆分（实现前计划 - 2026-01-16）

- 目标：让 `App.tsx` 专注布局与数据编排，抽离副作用与 UI 子区块。
- 拆分组件：`CreateSessionDialog`、`AppHeader`、`AppSidebar`、`ChatMessageList`、`ChatFooter`。
- 拆分 hooks：`useSessionEventSources`（SSE）、`useMessageAutoScroll`（滚动与 refs）。
- 依赖策略：保留现有 Zustand 状态与 Tanstack Query hooks，避免修改业务行为。
- 目录规划：`apps/web/src/components/app` 与 `apps/web/src/hooks`。

## 本次调整（实现前计划 - 2026-01-17 文件预览增强）

- 目标：文件预览支持代码高亮、行号、自动换行与图片预览。
- 前端：使用 `prism-react-renderer`，高亮主题采用 gruvboxMaterialLight/gruvboxMaterialDark。
- 后端：根据文件扩展名返回 `previewType: "code" | "image"`，图片返回 data URL。
- 样式：补充代码/图片预览布局样式，保证软换行时行号对齐。

## 本次调整（实现前计划 - 2026-01-17 预览标题显示文件名）

- 目标：文件预览标题显示选中文件名，替换无意义的“预览”字样。
- 范围：调整 `FileExplorerDialog` 预览栏标题文案与显示逻辑。
- 约束：文件未选中时保留空态提示与加载状态表现。

## 本次调整（实现后记录 - 2026-01-17 文件预览增强）

- 后端支持图片识别并返回 base64 data URL。
- 前端高亮替换为 `prism-react-renderer`，使用 gruvboxMaterialLight/gruvboxMaterialDark 主题。
- 代码预览使用软换行 + 固定宽度行号布局，确保多行对齐。
- 预览类型结构保持可扩展，便于后续补充更多类型。

## 本次调整（实现后记录 - 2026-01-17 预览标题显示文件名）

- 预览栏标题在选中文件后展示文件名，未选择时继续显示“预览”。
- 标题从完整路径中提取文件名，避免移动端视图过长。

## 本次调整（实现前计划 - 2026-01-17 预览系统单元测试）

- 目标：补齐文件预览相关单元测试，覆盖工具函数与预览组件核心渲染。
- 范围：`file-preview-utils`、`file-preview-renderers`、`CodePreview`、`ImagePreview`、`FileExplorerDialog` 预览标题展示。
- 测试位置：按就近风格放置在对应模块的 `__tests__` 目录。
- 依赖：继续使用 Vitest + Testing Library，必要时 mock 预览 API 与浏览器对象。

## 本次调整（实现后记录 - 2026-01-17 预览系统单元测试）

- 新增 `file-preview-utils` 测试，覆盖语言识别与文件名解析逻辑。
- 新增 `file-preview-renderers`、`CodePreview`、`ImagePreview` 的基础渲染测试。
- 新增 `FileExplorerDialog` 预览标题测试，验证选中文件名展示。
- 抽离 `resolveFileNameFromPath` 便于复用与测试。

## 本次调整（实现前计划 - 2026-01-17 Vitest React 实例一致性修复）

- 目标：修复 Vitest 报 `useState` 为空的 Hook 错误。
- 范围：统一测试环境中 `react`/`react-dom` 解析路径，避免多实例。
- 手段：调整 Vite/Vitest alias 指向根目录依赖并移除 `preserveSymlinks`。

## 本次调整（实现后记录 - 2026-01-17 Vitest React 实例一致性修复）

- `react`/`react-dom` alias 统一指向根目录 `node_modules`，避免测试加载多份 React。
- 移除 `preserveSymlinks`，确保 Vitest 与 Testing Library 使用同一份 React。

## 本次调整（实现前计划 - 2026-01-17 工具调用展示）

- 目标：展示 ACP `tool_call`/`tool_call_update` 事件，补齐会话内工具调用信息。
- 展示形式：消息流内独立卡片，默认折叠，仅显示摘要。
- 展示字段：`name`/`title`/`command`/`args`/`duration`/`error`/`status`。
- 文件预览：若工具调用包含路径（`locations`/`content`/`rawInput`），显示可点击文件名并打开预览。

## 本次调整（实现前计划 - 2026-01-17 终端输出）

- 目标：按 ACP 终端规范展示工具调用输出。
- 服务端实现 terminal 能力并通过现有 SSE 推送 `terminal_output`。
- 前端在 tool call 详情展示终端输出增量与退出状态。
- 输出区域默认折叠，超出限制标记截断。

## 本次调整（实现后记录 - 2026-01-17 终端输出）

- 服务端实现 ACP terminal 生命周期管理，缓存输出并推送 `terminal_output` SSE。
- 前端 SSE 接收增量输出，详情区展示终端输出与退出状态。
- 输出截断遵循 byte limit 并保持字符边界。

## 本次调整（实现后记录 - 2026-01-17 工具调用展示）

- 新增 tool call 类型解析与状态管理，流式更新支持增量合并。
- 消息流新增工具调用卡片，默认折叠展示摘要与状态徽章。
- 命令/参数/错误信息在折叠区展示，支持展示执行时长。
- 摘要区支持展示多路径文件名（超出显示 +N）。
- 路径信息渲染为摘要内可点击文件名，直连会话文件预览。

## M9 App.tsx 深度拆分（实现后记录 - 2026-01-16）

- 新增 `components/app` 下的布局组件：`CreateSessionDialog`、`AppHeader`、`AppSidebar`、`ChatMessageList`、`ChatFooter`。
- 新增 hooks：`useSessionEventSources` 负责 SSE 订阅，`useMessageAutoScroll` 负责滚动与 refs。
- `App.tsx` 改为组合式布局，只保留状态编排与事件处理。
- 会话流错误解析由 hook 统一处理并保留原有提示文案。
