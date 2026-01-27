# pnpm test 修复计划

## 目标

- 运行 `pnpm test`，收集失败用例与错误日志。
- 仅在必要范围内修改代码，修复测试失败。
- 保持代码风格与既有结构一致，避免引入冗余逻辑。

## 范围

- 影响测试的最小修改集（优先修复类型与逻辑错误）。
- 涉及到的模块将以测试失败日志为准。

## 执行步骤

1. 运行 `pnpm test` 获取失败清单与日志。
2. 定位失败原因，逐条修复。
3. 如需新增或调整测试，遵循现有测试结构与命名。
4. 再次运行 `pnpm test` 验证通过。

## 验收标准

- `pnpm test` 全部通过。
- 无新增 lint/format 问题。
- 变更范围清晰、可回溯。

## 执行记录

- 失败原因：
  - `apps/gateway` 与 `apps/mobvibe-cli` 无测试文件，Vitest 以退出码 1 终止。
  - `apps/webui` 的 `src/__tests__/app-theme.test.tsx` 未提供 QueryClientProvider，导致 `useMachinesQuery` 抛错。
  - `MachinesSidebar` 内部使用 `useQueryClient`，在测试中触发同样的 QueryClientProvider 依赖。
- 修复措施：
  - `apps/gateway/package.json` 与 `apps/mobvibe-cli/package.json` 的 `test` 脚本增加 `--passWithNoTests`。
  - 在 `apps/webui/src/__tests__/app-theme.test.tsx` 中 mock `useMachinesQuery` 与 `useMachinesStream`，避免引入 QueryClient 依赖。
  - 在 `apps/webui/src/__tests__/app-theme.test.tsx` 中 mock `MachinesSidebar`，避免 `useQueryClient` 触发。

## 使用说明

- 直接运行 `pnpm test` 即可，未包含测试的包不会导致失败。
