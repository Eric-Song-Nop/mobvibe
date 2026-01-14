# Vitest 测试方案

## 背景

- M4 聚焦质量保障与稳定性，目前仓库缺少基础测试与测试脚本。
- 需要覆盖前端状态/组件与后端纯逻辑，确保最小可运行的测试基线。

## 实现前计划

- 测试目标：为 `apps/web` 与 `apps/server` 建立 Vitest 基础设施并补充关键测试。
- 前端范围：`useChatStore` 等状态逻辑单元测试 + 关键组件渲染/交互测试。
- 后端范围：`errors.ts` 等纯函数单元测试，`SessionManager` 使用 mock 方式覆盖核心路径。
- 配置调整：
  - `apps/web` 使用 `jsdom` 环境，补充 `setupTests` 与 `@testing-library/jest-dom`。
  - `apps/server` 使用 `node` 环境。
  - 根目录新增 `test` 脚本与 `turbo test` 任务。
- 文档更新：完成后补充实现记录，并更新 `docs/IMPLEMENTATION_PLAN.md` 的 M4 记录与验收项。

## 实现后记录

- 根目录新增 `test` 脚本，`turbo` 增加 `test` 任务。
- `apps/web`：补充 Vitest + Testing Library + jsdom，新增 `setup-tests` 与组件/状态测试。
- `apps/server`：补充 Vitest 配置与单元测试，使用 mock 覆盖 `SessionManager` 核心路径。
- 新增测试用例覆盖：`useChatStore`、`SessionSidebar`、`MessageItem`、`errors`、`SessionManager`。
