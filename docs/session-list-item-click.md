# SessionListItem 全区域点击选中

## 背景

- 目标：点击会话项任意空白区域可选中会话。
- 交互：按钮区与编辑输入尽量不触发选中。

## 实现前计划

- 将选中事件绑定到 SessionListItem 外层容器。
- 保留内容区域 Enter 键选中逻辑。
- 按钮区阻止事件冒泡，避免误触发选中。
- 涉及文件：`apps/web/src/components/session/SessionSidebar.tsx`。
- 验证要点：标题/空白区域可选中，会话操作按钮不切换（允许例外）。

## 实现后记录

- 外层容器绑定 `onClick`，点击空白区域即可选中。
- 选中逻辑集中到 `handleSelect`，保留 Enter 键选中。
- 操作按钮区阻止冒泡，避免误触发选中。
