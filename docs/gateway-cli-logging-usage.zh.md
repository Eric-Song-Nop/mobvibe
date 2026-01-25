# Gateway + CLI 日志系统使用说明

## 概览
- 日志库：`pino`
- 默认级别：`info`
- 开发环境：pretty 输出
- 生产环境：JSON 输出

## 配置
- `LOG_LEVEL`：覆盖默认日志级别（如 `debug`、`info`、`warn`、`error`）。
- `NODE_ENV=production`：输出 JSON，便于采集与检索。

## 网关日志
- 入口：`apps/gateway/src/lib/logger.ts`
- 自动记录：HTTP 请求（方法、路径、状态码、耗时、requestId、userAgent）。
- 关键链路：会话创建/关闭/消息发送、RPC 请求/响应、Socket 连接与权限流。
- RPC 发送链路增加 `rpc_response_resolved/rpc_response_rejected/rpc_timeout` 耗时信息。

### 消息发送调试字段
- `message_send_request`：`sessionId`、`userId`、`requestId`、`promptBlocks`。
- `message_send_http_context`：`route`、`requestHasAuth`、`requestId`。
- `message_send_rpc_complete`：`stopReason`、`requestId`。
- `message_send_error`：`err`（包含 stack）、`requestId`、`promptBlocks`。

## 错误序列化
- 所有错误日志使用 `err` 字段，输出 `message/stack/name`。
- 响应层 RPC 错误附带 `detail` 字段（来自 Error stack）。

## CLI 日志
- 入口：`apps/mobvibe-cli/src/lib/logger.ts`
- 自动记录：连接/断开、RPC 调用、会话操作。
- `mobvibe start` 仍保留必要的终端输出（如日志文件位置）。

## 安全与脱敏
- 自动脱敏字段：`authorization`、`cookie`、`x-api-key`、`apiKey`、`token`。
- 不记录 `prompt` 内容，仅记录 `promptBlocks` 数量。

## 调试建议
- 排查 500 错误时，关注 `message_send_request`、`rpc_message_send`、`rpc_response_error` 与 `rpc_timeout` 日志。
- 如果 CLI 未连接，关注 `cli_rejected_*` 或 `gateway_connect_error`。
