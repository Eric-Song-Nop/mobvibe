# 前端初始化问题修复记录

## 实施前

### 问题概述
- React 控制台提示 `class`/`for` 非法 DOM 属性，影响渲染与样式生效。
- `@base-ui/react` 的 Combobox 在渲染时触发 `Invalid hook call`，导致页面崩溃。

### 实施计划
- 批量将 TSX 内的 `class` 与 `for` 修正为 `className` 与 `htmlFor`，确保 React 规范属性。
- 在 Vite 配置中对 `react`/`react-dom` 做去重，避免多实例导致的 hook dispatcher 异常。
- 保持示例组件结构不变，仅修复属性与运行时问题。

### 影响范围（架构/模块）
- `apps/web/src/components` 内的示例组件与 UI 组件。
- `apps/web/vite.config.ts` 的构建解析策略。

## 实施后

### 变更摘要
- 已将前端 TSX 内的 `class`/`for` 统一替换为 `className`/`htmlFor`，消除 React DOM 属性警告。
- Vite 配置增加 `react`/`react-dom` 去重，降低 `Invalid hook call` 风险。
- 已执行 `pnpm format` 统一格式化。

### 影响与验证
- 影响文件集中在 `apps/web/src/components` 及 `apps/web/vite.config.ts`。
- 需在浏览器中确认 Combobox 渲染不再触发 hook 错误。
