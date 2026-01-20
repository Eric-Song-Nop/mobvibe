## 目标

- 在权限请求、会话错误、回复完成时向客户端发送通知。
- 通知形态包含 Toast 与系统级 Web Notification。
- 覆盖所有会话，不做通知持久化。

## 计划

1. 新增 Toast 组件与通知状态管理。
2. 封装通知工具，统一触发 Toast + Web Notification。
3. 在权限请求、会话错误、回复完成事件中接入通知。
4. 补充中英文文案并在 App 中挂载 Toaster。

## 方案与架构

- 使用 Zustand 维护 Toast 队列，Toaster 组件负责渲染与关闭。
- 新增通知工具函数，统一触发 UI Toast 与系统通知权限判断。
- `useSessionEventSources` 监听权限请求与 session_error 事件并发送通知。
- `useSessionMutations` 在消息完成（stopReason=completed）后发送通知。

## 实现记录

- 新增通知模块与 Toast 组件，Toast 由 Zustand 驱动并支持自动关闭。
- 引入通知工具封装 Toast + Web Notification，同时追加会话标题提示。
- 权限请求、会话错误、回复完成（stopReason 为 end_turn/max_tokens/max_turn_requests）时触发通知，覆盖所有会话。
- 补充中英文通知文案，并在 App 根节点挂载 Toaster。
