# CLI 命名空间鉴权与注册时序修复计划

## 背景
当前 CLI 在连接后立即发送 `cli:register`，而网关在 `connection` 里先 `await` API key 校验，再注册事件监听，导致注册事件可能在监听建立前发送，从而丢失。

## 目标
- 确保 `/cli` 命名空间在触发 `connection` 前完成鉴权。
- 避免 `cli:register` 事件丢失。
- 保持 CLI 端行为不变。

## 实施方案
1. 在 `apps/gateway/src/socket/cli-handlers.ts` 中为 `/cli` namespace 增加 `use` middleware，完成 API key 校验并将 `userId`、`apiKey` 写入 `socket.data`。
2. `connection` 回调中不再执行异步鉴权，仅使用 `socket.data` 中的授权信息。
3. 确保 `cli:register` 监听器在连接回调执行时已可用。

## 影响范围
- 仅影响 gateway 的 `/cli` 鉴权与注册流程。
- CLI 端代码无需变更。

## 验证方式
- 启动 gateway 与 CLI，观察日志中出现 `[gateway] Registering CLI for machine ...`。
- 确认数据库中新增或更新 `machines` 记录。
