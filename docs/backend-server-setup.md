# 后端服务启动计划与架构（ACP）

## 实施前：目标与计划

目标：
- 建立后端服务工程（Express + TypeScript），作为 ACP 连接与会话管理入口。
- 先行接入本地 `opencode`，通过 `opencode acp` 启动 ACP 连接。
- 提供最小可用的健康检查与连接状态接口，便于前端/调试使用。

计划：
1. 新建 `apps/server` 工程，补齐 `package.json`、`tsconfig.json` 与基础脚本。
2. 编写 ACP 连接模块，使用 `opencode acp` 以 stdio 方式连接。
3. 初始化 Express 服务，提供 `/health` 与 `/acp/opencode` 状态接口。
4. 收尾整理：完善配置、连接状态与错误处理。

假设与边界：
- 仅连接 `opencode`，暂不引入多 Agent 路由与持久化存储。
- 仅做最小可用的 ACP 连接与状态展示，不做消息转发。

## 实施前：架构草图

目录结构（预期）：
- `apps/server/src/index.ts`：服务入口与启动流程
- `apps/server/src/config.ts`：环境变量与端口配置
- `apps/server/src/acp/opencode.ts`：`opencode acp` 连接管理

运行流程（预期）：
1. 启动服务，加载配置。
2. 创建并连接 ACP 客户端（`opencode acp`）。
3. Express 暴露健康检查与连接状态。

关键模块职责（预期）：
- ACP 连接模块：负责启动/重连、记录状态与错误信息。
- HTTP 服务：对外提供状态查询与后续扩展点。

## 实施后：实现记录

已完成内容：
- 新增 `apps/server` 工程，使用 Express + TypeScript 作为后端入口。
- 增加 ACP 连接模块，使用 `opencode acp` 通过 stdio 启动并连接。
- 提供 `/health` 与 `/acp/opencode` 状态接口，返回连接状态与错误信息。
- 配置项集中在 `config.ts`，支持端口与 `opencode` 命令参数覆盖。
- ACP SDK 切换为 `@agentclientprotocol/sdk`，使用 `ClientSideConnection` + `ndJsonStream` 完成初始化与会话创建。

关键实现点：
- 连接管理封装为 `OpencodeConnection`，记录 `state`、连接时间与错误信息。
- 服务启动后尝试连接 `opencode`，失败时不中断 HTTP 服务。
- 监听 `SIGINT/SIGTERM`，在退出时断开 ACP 连接并关闭服务。
- 使用 `initialize` + `newSession` 完成 ACP 握手，并记录 `sessionId` 供状态查询。

下一步建议：
- 引入 ACP 会话/消息转发 API，并与前端通信对接。
- 加入数据库层（Drizzle + sqlite3）用于会话与消息持久化。
