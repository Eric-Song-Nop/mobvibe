# WebUI React 性能优化（2026-02-09）

## 背景

基于对 `apps/webui` 的代码审查与构建结果，当前主要风险集中在：

1. 首屏主包体积偏大（重模块进入主包）。
2. 路由与页面未按需加载。
3. 部分上下文值未稳定，存在不必要重渲染风险。
4. React Query 默认策略导致窗口聚焦时批量重请求。
5. 流式消息更新路径每次 token 都对全量消息数组做 `.map()`，产生大量不必要的新对象。
6. `App.tsx` 无选择器订阅整个 Zustand store，每次 `set()` 都触发顶层重渲染。

## 优化总览

在不改变业务行为的前提下，分两批完成六项改造：

| # | 改造项 | 提交 | 收益类型 |
|---|--------|------|----------|
| 1 | CodePreview 按需加载 | `46d2fc4` | 首屏体积 |
| 2 | 路由级按需加载 | `46d2fc4` | 首屏体积 |
| 3 | AuthProvider context 稳定化 | `46d2fc4` | 减少重渲染 |
| 4 | React Query 全局调优 | 第二批 | 减少网络请求 |
| 5 | 流式消息 findIndex 优化 | 第二批 | 减少 GC / 对象分配 |
| 6 | Zustand useShallow 选择器 | 第二批 | 减少重渲染 |

---

## 第一批（已提交 `46d2fc4`）

### 1) 代码预览按需加载

- 修改文件：`apps/webui/src/components/app/file-preview-renderers.tsx`
- 调整内容：
  - `CodePreview` 改为 `React.lazy` 动态加载。
  - 使用 `Suspense` 包裹代码预览渲染。
  - 显式引入 `preview.css`，保证图片/代码预览样式不丢失。

效果：`CodePreview` 及其依赖（包括 Tree-sitter 相关逻辑）从主包拆出独立 chunk。

### 2) 路由级按需加载

- 修改文件：`apps/webui/src/App.tsx`
- 调整内容：
  - `ApiKeysPage`、`SettingsPage`、`LoginPage` 改为 `React.lazy`。
  - 路由元素使用 `Suspense` + 轻量 fallback。

效果：非首页路由代码不再进入首屏主包。

### 3) Auth Context 值稳定化

- 修改文件：`apps/webui/src/components/auth/AuthProvider.tsx`
- 调整内容：
  - `signOut` 处理函数用 `useCallback` 稳定引用。
  - context `value` 使用 `useMemo`。

效果：减少 `AuthContext` 消费组件的被动重渲染概率。

---

## 第二批

### 4) React Query 全局调优

- 修改文件：
  - `apps/webui/src/main.tsx` — `QueryClient` 添加全局默认值。
  - `apps/webui/src/hooks/useSessionQueries.ts` — 按查询设置 `staleTime`。
- 调整内容：
  - 全局 `staleTime: 60_000`，`refetchOnWindowFocus: false`。
  - Sessions 查询 `staleTime: Infinity`（由 Socket 事件驱动更新，无需自动重取）。
  - Backends 查询 `staleTime: 5 * 60_000`（后端列表极少变化）。
  - Machines 查询已有 `staleTime: 30_000`，无需改动。

效果：窗口聚焦时不再触发批量 refetch，减少不必要网络请求。

### 5) 流式消息 findIndex 优化

- 修改文件：`packages/core/src/stores/chat-store.ts`
- 涉及函数：`appendAssistantChunk`、`appendThoughtChunk`、`appendUserChunk`
- 调整内容：
  - 原实现：每次 token 到达时调用 `messages.map()` 遍历全部消息，为每条消息创建新对象。
  - 新实现：使用 `findIndex` 定位目标消息，再通过 `slice(0, idx)` + 新消息 + `slice(idx + 1)` 拼接。未变更的消息保持原引用。

效果：每次 token 仅创建 1 个新消息对象（而非 N 个），降低 GC 压力；下游依赖引用相等性的 `React.memo` / `useMemo` 可正确跳过未变更消息的重渲染。

### 6) Zustand useShallow 选择器

- 修改文件：`apps/webui/src/App.tsx`
- 调整内容：
  - 引入 `useShallow`（来自 `zustand/react/shallow`，zustand 5.0.8 内置）。
  - `useChatStore()` 拆为两个订阅：
    - **响应式状态**（4 个字段）：`sessions`、`activeSessionId`、`appError`、`lastCreatedCwd`。
    - **操作函数**（~30 个）：`setActiveSessionId`、`setSending` 等。Zustand 中操作函数引用恒定，此订阅永不触发重渲染。
  - `useUiStore()` 同样拆为状态（9 个字段）与操作（9 个函数）。
  - `useMachinesStore()` 拆为状态（`machines`、`selectedMachineId`）与操作（`setMachineCapabilities`）。
  - 下游 hook 调用（`useSessionMutations`、`useSessionActivation`、`useSocket`）改为传入 `{ sessions, ...chatActions }` 展开方式，减少样板代码。

效果：`MainApp` 不再因每次 token 流式更新而整体重渲染；仅在所订阅的具体状态字段变化时触发。

---

## 构建结果对比

基于 `pnpm -C apps/webui build` 结果：

- 主 chunk：
  - 优化前（基线）：`~2980.25 kB`（gzip `~656.86 kB`）
  - 第一批后：`~2651.51 kB`（gzip `~603.92 kB`）
  - 第二批后：`~2653.75 kB`（gzip `~604.61 kB`）
- 新增按需 chunk：
  - `CodePreview-*.js`（约 `94.48 kB`）
  - `LoginPage-*.js` / `SettingsPage-*.js` / `ApiKeysPage-*.js`

主 chunk 体积主要由第一批（懒加载）降低；第二批变更为运行时优化，对包体积几乎无影响。

## 验证方式

1. `pnpm -C apps/webui test:run` — 22 个测试文件、160 条用例全部通过。
2. `pnpm build` — 全部 5 个包构建通过，TypeScript 编译无错误。
3. `pnpm format && pnpm lint` — Biome 格式化与 lint 通过。
4. 手工验证：
   - 发送流式消息 — 渲染流畅，无卡顿。
   - 切换窗口焦点 — 不再触发额外网络请求。
   - 所有 MainApp 内操作（创建/关闭/重命名会话、权限决策、模式/模型切换等）功能正常。

## 使用说明

本次改造不涉及接口或交互行为变更，无需额外配置。运行方式保持不变：

- 开发：`pnpm -C apps/webui dev`
- 构建：`pnpm -C apps/webui build`

访问对应路由或打开代码文件预览时，相关模块会自动按需加载。
