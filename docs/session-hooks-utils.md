# 会话 Hooks 与工具抽离整理

## 目标

- 抽离错误处理与状态徽章逻辑到独立工具，减少 UI 重复代码。
- 引入会话相关的 Query/Mutation hooks，方便后续拆分 App 逻辑。
- 补齐工具与 hooks 的单元测试，保证错误与状态行为一致。
- 清理前端临时产物与默认后端选择逻辑的边界问题。

## 实现前计划（2026-01-16）

- 修复 `error-utils`、hooks 测试中的导入与类型错误。
- 调整 `useSessionMutations` 的参数类型，避免自引用导致的类型退化。
- 统一 `defaultBackendId` 的回退策略，避免空字符串导致的默认值偏差。
- 复用 `ui-utils` 中的状态徽章映射，移除重复实现。
- 增加前端临时构建文件的忽略规则，保持工作区整洁。

## 结构与架构说明

- `lib/error-utils.ts` 聚合错误创建与归一化逻辑，供 App 与 hooks 复用。
- `lib/ui-utils.ts` 提供 UI 层纯函数（会话标题、状态徽章），组件按需引用。
- `hooks/useSessionMutations.ts` 与 `hooks/useSessionQueries.ts` 封装请求 + store 协调，App 层只保留流程编排。
- 测试集中在 `lib/__tests__` 与 `hooks/__tests__`，保证工具函数与 hooks 行为稳定。

## 实现后记录（2026-01-16）

- `useSessionMutations` 的 store 类型改为显式字段，移除自引用类型与冗余返回类型声明。
- hooks 与 utils 测试补齐类型导入，mock 数据与错误码对齐 `SessionSummary`/`PermissionDecisionResponse`。
- `SessionSidebar` 复用 `ui-utils` 的状态徽章映射，App 与 hooks 的默认后端逻辑保持一致。
- 新增 `apps/web/.gitignore` 规则忽略 Vite 时间戳产物，避免污染工作区。

## 使用说明

- 需要状态徽章/默认标题时，从 `apps/web/src/lib/ui-utils.ts` 导入 `getStatusVariant`、`buildSessionTitle`。
- 需要统一错误结构时，从 `apps/web/src/lib/error-utils.ts` 导入 `createFallbackError`、`normalizeError`。
- 组件可通过 `apps/web/src/hooks/useSessionQueries.ts` 与 `apps/web/src/hooks/useSessionMutations.ts` 获取会话查询/操作方法。
