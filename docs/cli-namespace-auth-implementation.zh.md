# CLI 命名空间鉴权与注册时序修复说明

## 实现要点
- 将 `/cli` 命名空间的 API key 校验移动到 namespace middleware，确保在 `connection` 触发前完成鉴权。
- 通过 `socket.data` 写入 `userId`、`apiKey`，在连接回调中直接使用。
- 连接回调只处理注册与业务事件，避免异步鉴权导致的监听器滞后。

## 关键修改
- `apps/gateway/src/socket/cli-handlers.ts`
  - 新增 `cliNamespace.use` 鉴权流程。
  - `connection` 回调读取 `socket.data` 并注册 `cli:register` 事件。

## 使用与验证
1. 启动 gateway 与 CLI：
   - `pnpm dev` 或 `pnpm build && pnpm start --foreground --gateway http://localhost:3005`
2. 观察 gateway 日志应出现：
   - `[gateway] Registering CLI for machine ...`
   - `[gateway] CLI registered: ...`
3. 数据库 `machines` 表应新增/更新对应机器记录。

## 效果
- 避免 `cli:register` 在监听建立前发送而被丢弃。
- 注册流程稳定触发，机器状态可正常写入数据库。
