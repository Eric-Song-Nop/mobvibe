# 主题切换重构方案（ThemeProvider）

## 背景与问题

当前主题切换依赖在多个组件间层层传递 `themePreference` 与 `onThemePreferenceChange`，导致 `App` → `AppSidebar` → `SessionSidebar` 的 props 过深，增加维护成本与测试复杂度。

## 目标

- 使用 Shadcn UI 在 Vite 的推荐方式集中管理主题状态。
- 通过 `ThemeProvider` 与 `useTheme` 避免深层 props 传递。
- 维持现有的主题切换行为与样式（light/dark/system）。
- 确保测试与类型定义更新到位。

## 方案概述

1. 新增 `ThemeProvider` 与 `useTheme`：
   - 在 `apps/web/src/components/theme-provider.tsx` 提供主题上下文与 `setTheme`。
   - 在 `useEffect` 中处理 `document.documentElement` 的 class。
   - 使用 `localStorage` 持久化偏好，key 使用 `mobvibe-theme`。

2. 入口包裹：
   - 在 `apps/web/src/App.tsx` 使用 `ThemeProvider` 包裹应用。

3. 组件改造：
   - `SessionSidebar` 直接使用 `useTheme` 获取 `theme` 与 `setTheme`。
   - `AppSidebar` 移除主题相关 props。
   - 相关调用链中的类型与测试同步更新。

## 实现记录

- 新增 `ThemeProvider`：提供 `theme` 状态、`setTheme` 更新以及根节点 class 切换。
- 调整 `App`：移除本地主题 state，改为在根部包裹 Provider。
- 更新 `SessionSidebar`：Dropdown 使用 `useTheme` 写入主题偏好。
- 更新测试：`app-theme.test.tsx` 通过 Provider 验证主题持久化；`session-sidebar.test.tsx` 增加 Provider 包裹。

## 使用说明

- 默认主题为 `system`，写入 `localStorage` 的 key 为 `mobvibe-theme`。
- 主题切换入口仍在侧边栏顶部的主题菜单中。

## 影响范围

- 新增文件：`apps/web/src/components/theme-provider.tsx`。
- 修改文件：`apps/web/src/App.tsx`、`apps/web/src/components/app/AppSidebar.tsx`、`apps/web/src/components/session/SessionSidebar.tsx` 及相关测试。

## 风险与回滚

- 风险：测试中 ThemeProvider 未包裹可能导致 `useTheme` 抛错。
- 回滚方式：保留原 props 方案并移除 ThemeProvider 的使用。
