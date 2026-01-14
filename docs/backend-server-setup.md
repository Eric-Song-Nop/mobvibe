# 后端服务启动计划与架构（ACP）

## 实施前：目标与计划

目标：
- 建立后端服务工程（Express + TypeScript），作为 ACP 连接与会话管理入口。
- 先行接入本地 ACP CLI（`opencode`/`gemini-cli`），通过 CLI 启动 ACP 连接。
- 提供最小可用的健康检查与连接状态接口，便于前端/调试使用。

计划：
1. 新建 `apps/server` 工程，补齐 `package.json`、`tsconfig.json` 与基础脚本。
2. 编写 ACP 连接模块，使用 ACP CLI 以 stdio 方式连接。
3. 初始化 Express 服务，提供 `/health` 与 `/acp/agent` 状态接口。
4. 收尾整理：完善配置、连接状态与错误处理。

假设与边界：
- 仅连接本地 ACP CLI，暂不引入多 Agent 路由与持久化存储。
- 仅做最小可用的 ACP 连接与状态展示，不做消息转发。

## 实施前：架构草图

目录结构（预期）：
- `apps/server/src/index.ts`：服务入口与启动流程
- `apps/server/src/config.ts`：环境变量与端口配置
- `apps/server/src/acp/opencode.ts`：ACP CLI 连接管理

运行流程（预期）：
1. 启动服务，加载配置。
2. 创建并连接 ACP 客户端（ACP CLI）。
3. Express 暴露健康检查与连接状态。

关键模块职责（预期）：
- ACP 连接模块：负责启动/重连、记录状态与错误信息。
- HTTP 服务：对外提供状态查询与后续扩展点。

## 实施后：实现记录

已完成内容：
- 新增 `apps/server` 工程，使用 Express + TypeScript 作为后端入口。
- 增加 ACP 连接模块，使用 ACP CLI 通过 stdio 启动并连接。
- 提供 `/health` 与 `/acp/agent` 状态接口，返回连接状态与错误信息。
- 配置项集中在 `config.ts`，支持端口与 ACP 后端配置覆盖。
- ACP SDK 切换为 `@agentclientprotocol/sdk`，使用 `ClientSideConnection` + `ndJsonStream` 完成初始化与会话创建。

关键实现点：
- 连接管理封装为 `AcpConnection`，记录 `state`、连接时间与错误信息。
- 服务启动后尝试连接 ACP CLI，失败时不中断 HTTP 服务。
- 监听 `SIGINT/SIGTERM`，在退出时断开 ACP 连接并关闭服务。
- 使用 `initialize` + `newSession` 完成 ACP 握手，并记录 `sessionId` 供状态查询。

下一步建议：
- 引入 ACP 会话/消息转发 API，并与前端通信对接。
- 加入数据库层（Drizzle + sqlite3）用于会话与消息持久化。

## 会话与消息 API（SSE）

### 实施前：目标与计划

目标：
- 提供创建会话、发送消息与 SSE 推送的 API，前端可直接消费。
- 统一 ACP 会话与消息生命周期，确保连接失败可感知。

计划：
1. 扩展 `AcpConnection`，增加会话创建与消息发送封装。
2. 增加 SSE 推送通道，转发 ACP `sessionUpdate` 通知。
3. Express 新增会话/消息相关接口，支持前端接入。

### 实施前：接口草案

- `POST /acp/session`：创建新会话，返回 `sessionId`。
- `POST /acp/message`：发送用户消息，返回 `stopReason` 等结果。
- `GET /acp/session/stream`：SSE 推送 `sessionUpdate`，按 `sessionId` 过滤。

### 实施后：实现记录

已完成内容：
- 扩展 `AcpConnection`，新增会话创建、消息发送与更新订阅能力。
- 连接 ACP CLI 时改为 `stderr` 管道输出，便于后续日志追踪。
- 新增会话/消息 API 与 SSE 通道，对外提供最小交互能力。

关键实现点：
- SSE 接口使用 `sessionId` 过滤通知并周期性发送 `ping`。
- 消息发送使用 ACP `prompt` 接口，正文封装为 `text` 类型 `ContentBlock`。
- 统一错误返回结构，便于前端处理失败提示。

## 跨域访问支持（CORS）

### 实施前：目标与计划

目标：
- 允许前端 WebUI 通过浏览器调用后端接口，解决开发阶段 CORS 报错。
- 覆盖 REST API 与 SSE 接口的跨域请求。

计划：
1. 在 Express 中增加轻量 CORS 中间件，统一写入响应头。
2. 允许来源默认包含 `http://localhost:5173`，并支持环境变量扩展。
3. 处理 `OPTIONS` 预检请求，返回 204。

### 实施后：实现记录

已完成内容：
- 增加 CORS 中间件，允许 `Origin` 在白名单内时放行。
- 默认允许 `http://localhost:5173`，可通过 `MOBVIBE_CORS_ORIGINS` 追加来源。
- 预检请求统一返回 204，SSE 也能复用同一套跨域头。

## ACP 后端抽象与多 CLI 支持

### 实施前：目标与计划

目标：
- 从单一 ACP CLI 抽象为可切换的 ACP 后端。
- 首先支持 `gemini --experimental-acp`，并保留统一的会话/消息接口。
- 前端展示当前 ACP 后端类型。

计划：
1. 在服务配置中增加 `MOBVIBE_ACP_BACKENDS`（逗号分隔），默认启用全部内置后端。
2. 抽象连接状态返回结构为通用 ACP 后端状态（`backendId/command/args`）。
3. 将状态接口调整为 `/acp/agent`，前端改用新接口并展示后端类型。

### 实施前：架构草图

- 配置层：`config.ts` 解析 `MOBVIBE_ACP_BACKENDS`，生成可用后端列表与默认后端。
- 会话管理：`SessionManager` 使用 ACP 后端配置启动 ACP 进程。
- 状态接口：`/acp/agent` 返回后端标识、命令与进程状态，前端据此展示当前后端。

### 实施后：实现记录

已完成内容：
- 新增 `MOBVIBE_ACP_BACKENDS`，内置 `opencode` 与 `gemini-cli` 命令映射。
- ACP 连接抽象为通用后端配置，状态结构增加 `backendId/backendLabel`。
- 状态接口调整为 `/acp/agent`，前端展示当前后端类型。

## 会话级 ACP 后端选择与多后端并行

### 实施前：目标与计划

目标：
- 支持同时启用多个 ACP CLI 后端，并在创建会话时选择使用的后端。
- 后端会话记录持久保留 `backendId`，前端侧边栏显示会话后端标签。
- 新增后端列表接口，前端据此渲染可选后端。

计划：
1. 配置层增加 `MOBVIBE_ACP_BACKENDS`（逗号分隔），默认启用全部内置后端。
2. `SessionManager` 支持按 `backendId` 创建连接，`SessionSummary` 附带后端字段。
3. 新增 `GET /acp/backends` 返回可用后端列表，`POST /acp/session` 支持 `backendId` 参数。
4. 前端新建会话弹窗包含后端选择，下拉列表来自 `/acp/backends`。

### 实施前：架构草图

- 配置层：解析 `MOBVIBE_ACP_BACKENDS` 生成可用后端列表与默认后端。
- 会话创建：前端传入 `backendId`，后端根据后端配置启动对应 ACP CLI。
- 会话展示：会话列表与顶部栏展示会话后端标签，便于区分并行会话。

### 实施后：实现记录

已完成内容：
- 配置改为 `MOBVIBE_ACP_BACKENDS`，后端维护可用后端列表与默认后端。
- 会话创建支持 `backendId`，会话摘要包含 `backendId/backendLabel`。
- 新增 `GET /acp/backends`，前端新建对话弹窗支持后端选择。

## Claude Code ACP 适配器接入

### 实施前：目标与计划

目标：
- 新增 `claude-code-acp` 作为可选 ACP 后端。
- 支持从环境变量读取 `ANTHROPIC_AUTH_TOKEN` 与 `ANTHROPIC_BASE_URL`。
- 若仅提供 `ANTHROPIC_AUTH_TOKEN`，自动映射为 `ANTHROPIC_API_KEY` 传给子进程。

计划：
1. 配置层注册 `claude-code` 后端（命令 `claude-code-acp`）。
2. 连接启动时合并环境变量，补齐 `ANTHROPIC_API_KEY`。
3. 文档说明 Claude Code 的环境变量要求。

### 实施前：架构草图

- 后端配置：`ACP_BACKENDS` 增加 `claude-code`。
- 进程启动：子进程继承服务端环境并注入 token/base url。
- 前端 UI：后端列表自动新增 `claude-code`。

### 实施后：实现记录

已完成内容：
- 新增 `claude-code` 后端，命令为 `claude-code-acp`。
- 支持 `ANTHROPIC_AUTH_TOKEN` 自动映射到 `ANTHROPIC_API_KEY`。
- 透传 `ANTHROPIC_BASE_URL` 到 Claude Code 子进程。
