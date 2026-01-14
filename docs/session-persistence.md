# 会话本地持久化（刷新恢复）

## 背景

- 目标：刷新/重启页面后仍可看到正在运行的会话内容。
- 约束：仅本机浏览器恢复，不做跨设备同步与历史检索。

## 实现前计划

- 使用 `zustand` 的 `persist` 中间件写入 `localStorage`。
- 持久化字段：`sessions`、`activeSessionId`。
- 过滤临时字段：`sending`、`streamingMessageId`、`error`、`streamError`、`input`。
- 消息持久化时统一将 `isStreaming` 置为 `false`。
- 保持 `syncSessions` 逻辑，由后端会话列表纠正已结束会话。
- 涉及文件：`apps/web/src/lib/chat-store.ts`。
- 验证要点：刷新后可看到消息历史，发送/错误状态清空。

## 实现后记录

- `chat-store` 引入 `persist`，使用 `localStorage` 存储会话。
- 仅持久化 `sessions` 与 `activeSessionId`，并过滤临时字段。
- 重置 `input`/`sending`/`streamingMessageId`，消息 `isStreaming` 统一置为 `false`。
- 保留原有 `syncSessions` 校正逻辑，刷新后仍可同步后端会话状态。
