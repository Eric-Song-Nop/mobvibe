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

## 后续计划

- 补充权限请求处理策略与用户确认入口。
- 接入会话恢复与持久化（SQLite + Drizzle）。
- 补齐 `setSessionMode` 等扩展能力。
