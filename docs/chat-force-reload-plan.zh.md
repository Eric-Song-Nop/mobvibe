# 强制停止并加载会话（Chat 顶栏）实现计划

## 背景
当前已支持 ACP `session/load`，需要在聊天页顶栏增加一个“强制停止并加载”的操作入口，用于用户在会话卡住或需要重新附着时手动触发重放。

## 目标
- 在聊天页顶栏提供明确入口，执行“先取消生成，再强制 load 会话并重放历史”。
- 执行前进行二次确认，避免误操作。
- 保持现有 UI 风格与错误处理逻辑。

## 方案概述
### UI/交互
- 顶栏新增按钮（图标 + 文案，移动端仅图标）。
- 点击后弹出确认对话框：
  - 标题：强制停止并加载？
  - 描述：将先停止生成，再通过 `session/load` 重放历史。
  - 操作：取消 / 确认执行

### 执行流程
1. 仅在有激活会话时显示按钮。
2. 若会话正在生成且已附着，先调用 `session/cancel`。
3. 调用 `session/load` 强制加载（清空本地消息，失败回滚）。
4. 加载成功后设置为激活会话。

### 禁用条件
- 无激活会话。
- 缺少 `cwd`、`machineId` 或 agent 不支持 `session/load`。
- 当前会话处于 `isLoading` 或全局激活流程进行中。

### 错误处理
- 复用现有 `useSessionActivation` 逻辑：清空消息、失败回滚、设置错误信息。
- 不新增额外错误类型。

### 影响范围
- `apps/webui/src/components/app/AppHeader.tsx`（新增按钮与确认弹窗）
- `apps/webui/src/App.tsx`（新增强制流程处理函数）
- `apps/webui/src/hooks/useSessionActivation.ts`（支持 force 选项）
- `apps/webui/src/i18n/locales/{zh,en}/translation.json`

## 验证方式
- 手动：选择一个会话，点击按钮确认后看到历史重放；正在生成时先停止后重放。
- 手动：不支持 `session/load` 时按钮禁用。
