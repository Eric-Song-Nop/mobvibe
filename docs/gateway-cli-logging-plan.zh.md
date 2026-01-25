# Gateway + CLI 日志系统改造计划

## 背景
当前 gateway 出现 500 错误但缺少可定位的日志信息。CLI 与 gateway 使用 `console` 分散输出，难以统一分析与检索。

## 目标
- 引入精简日志库 `pino`，统一 gateway 与 CLI 的结构化日志输出。
- 默认日志级别 `info`，通过 `LOG_LEVEL` 覆盖。
- 开发态使用 pretty 输出，生产环境输出 JSON。
- 关键链路（请求、RPC、Socket 事件、错误）补充结构化日志。
- 避免记录敏感信息（API key、cookie、authorization）。

## 方案
1. Gateway 新增 `logger` 模块，统一日志配置（level、pretty、redact）。
2. Gateway 增加请求日志中间件，记录方法、路径、状态码、耗时与 `requestId`。
3. Gateway 在 Session/RPC/Socket/DB 关键节点补充日志（不打印 prompt 内容）。
4. CLI 新增 `logger` 模块，替换核心流程 `console`，补充连接、RPC、会话操作日志。
5. CLI 保留交互命令输出（login/status）为人类可读信息。

## 影响面
- `apps/gateway/src`：新增 logger，替换 `console`，补充请求与 RPC 日志。
- `apps/mobvibe-cli/src`：新增 logger，替换核心 `console`。
- `apps/gateway/package.json` 与 `apps/mobvibe-cli/package.json`：新增 `pino`、`pino-pretty`。

## 风险与回滚
- 若日志过多导致噪音，可调高 `LOG_LEVEL` 或减少日志点。
- 回滚可移除 logger 模块并恢复 `console` 输出。

## 2026-01-26 日志增强计划

### 背景
- 现有 `message_send_error` 日志输出 `error: {}`，无法定位具体错误原因。

### 目标
- 让错误日志包含 `message/stack/name/code/cause` 等关键字段。
- 为消息发送链路补充更多上下文字段（requestId、RPC 事件、超时、重试）。
- 保持敏感字段脱敏与 redaction 规则一致。

### 方案
1. 定位 `message_send_error` 来源与错误对象形态。
2. 统一错误日志使用 `err` 字段与显式结构化字段输出。
3. 在发送链路增加调试级别日志（请求、RPC、响应耗时）。
4. 更新中文使用文档，说明新增字段与调试方式。
