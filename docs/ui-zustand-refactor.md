# UI Zustand 重构计划（实现前）

## 背景

当前 `apps/web/src/App.tsx` 负责大量 UI 交互状态（侧边栏抽屉、对话框开关、编辑态、草稿字段等），这些状态通过 props 逐层传递到 `AppSidebar`/`SessionSidebar`/`CreateSessionDialog` 等组件，形成明显的 prop drilling。团队希望将这类 UI 状态迁移到 Zustand，减少组件之间的状态透传，保持 `App.tsx` 只处理数据编排与 API 调用。

## 目标

- 建立独立的 UI Zustand store，集中管理与会话数据无关的 UI 状态。
- 保持 `chat-store` 仅管理会话/消息等业务状态，不引入 UI 控制字段。
- 逐步重构：侧边栏 → 对话框 → 输入区。
- 保持现有行为与 UI 文案不变。

## 范围与边界

- 不迁移 `activeSessionId`，继续由 `chat-store` 负责。
- UI store 可以管理：
  - `mobileMenuOpen`
  - `editingSessionId`、`editingTitle`
  - `createDialogOpen`、`draftTitle`、`draftBackendId`、`draftCwd`
  - `fileExplorerOpen`、`filePreviewPath`
- 仍由 `App.tsx` 负责：
  - Tanstack Query 的查询/Mutation
  - `useSessionEventSources` 与 `useMessageAutoScroll`
  - 业务侧衍生数据（`sessionList`、`activeSession`）

## Store 设计（草案）

```ts
// apps/web/src/lib/ui-store.ts

type UiState = {
  mobileMenuOpen: boolean;
  createDialogOpen: boolean;
  fileExplorerOpen: boolean;
  filePreviewPath?: string;
  editingSessionId: string | null;
  editingTitle: string;
  draftTitle: string;
  draftBackendId?: string;
  draftCwd?: string;
  setMobileMenuOpen: (open: boolean) => void;
  setCreateDialogOpen: (open: boolean) => void;
  setFileExplorerOpen: (open: boolean) => void;
  setFilePreviewPath: (path?: string) => void;
  startEditingSession: (sessionId: string, title: string) => void;
  updateEditingTitle: (title: string) => void;
  stopEditingSession: () => void;
  setDraftTitle: (title: string) => void;
  setDraftBackendId: (backendId?: string) => void;
  setDraftCwd: (cwd?: string) => void;
};
```

## 重构步骤

1. 新增 `ui-store` 与 selector hooks。
2. `AppSidebar`/`SessionSidebar` 直接从 `ui-store` 读取编辑态与抽屉状态。
3. `CreateSessionDialog` 改为使用 `ui-store` 草稿字段。
4. `ChatFooter`/`ChatMessageList` 仅保留必要业务 props（`activeSession` 等）。
5. `App.tsx` 移除对应的 `useState` 与 props 传递。
6. 补齐测试（如需要）并更新实现后文档。

## 风险与注意事项

- 避免 store 过度耦合业务逻辑，UI store 仅存 UI 控制字段。
- 仅在需要的组件中使用 selector，避免无关重渲染。
- 迁移过程中注意保持移动端抽屉关闭逻辑与文件预览关闭逻辑一致。

## 实现后记录

- 新增 `apps/web/src/lib/ui-store.ts`，集中管理 `mobileMenuOpen`、`createDialogOpen`、`fileExplorerOpen`、`filePreviewPath`、`editingSessionId`、`editingTitle`、`draftTitle`、`draftBackendId`、`draftCwd` 以及对应 setter。
- 侧边栏改为直接读取 UI store：`apps/web/src/components/app/AppSidebar.tsx` 与 `apps/web/src/components/session/SessionSidebar.tsx` 不再接收编辑态 props。
- `CreateSessionDialog` 直接读取/更新草稿字段，App 仅负责 open/create 行为。
- `ChatFooter` 直接调用 `useChatStore().setInput` 更新输入内容，减少输入回调透传。
- `ChatMessageList` 直接设置 `filePreviewPath` 并打开文件预览对话框。
- `App.tsx` 移除 UI 本地状态与相关 props 传递。
- 测试 `apps/web/tests/session-sidebar.test.tsx` 通过 `useUiStore.setState` 注入编辑态。
