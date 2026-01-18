## 目标
## 目标

- 接入 ACP `available_commands_update`，在会话内同步 slash 命令列表。
- 输入框首字符为 `/` 时弹出模糊选择器，支持命令搜索与一键插入。
- 为后续 embedded resource 选择器提供可复用的搜索组件与数据结构。

## 实现前计划

### 需求与约束

- 仅当输入框首字符是 `/` 才展示命令选择器。
- 命令来源仅依赖 ACP 推送，不做本地 fallback。
- 选择命令后直接写入 `/name` 并关闭。
- 模糊匹配范围包含 `name`、`description`、`input.hint`。

### 数据流设计

- 后端：
  - 监听 ACP `available_commands_update`。
  - 将 `availableCommands` 写入会话记录并同步到 `SessionSummary`。
  - 保持 SSE 推送 `session_update` 事件给前端。
- 前端：
  - 在 SSE 处理 `available_commands_update`，写入 `ChatSession.availableCommands`。
  - 会话列表接口 `/acp/sessions` 也返回 `availableCommands`，用于刷新时恢复状态。
  - 本地持久化时移除 `availableCommands`，保证命令与会话实时同步。

### UI 与交互

- 新增可复用模糊选择器组件：
  - 使用自定义命令列表组件并复用 `command-utils` 进行过滤。
  - 默认展示 `/{name}` + `description` + `input.hint`。
- `ChatFooter`：
  - 监听输入变化，首字符 `/` 时打开选择器。
  - 选择后替换输入框内容并关闭。

### 兼容性与扩展

- 复用 `command-utils` 作为匹配入口，后续可支持 embedded resource 搜索。
- 仅展示当前会话的命令，避免跨会话混用。

## 实现后记录

- 后端 `SessionManager` 接入 `available_commands_update`，会话摘要同步 `availableCommands`。
- 前端 SSE 解析命令更新，写入 `ChatSession.availableCommands` 并随会话同步。
- 新增 `CommandCombobox` + `command-utils`，支持 `name/description/hint` 模糊匹配。
- 输入框首字符 `/` 时弹出命令列表，支持方向键选择、回车插入、Esc 关闭。
- 会话持久化时移除命令列表，保证命令实时更新。
