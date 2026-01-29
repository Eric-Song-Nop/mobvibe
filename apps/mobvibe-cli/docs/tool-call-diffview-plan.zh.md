# 工具调用 DiffView 计划

## 背景
- ACP 工具调用的输出内容中可能包含 `diff` 类型，当前仅以纯文本展示 old/new。
- 需要在工具调用消息里提供更清晰的代码变更预览，并保持垂直布局（原始/更新上下分区）。

## ACP 协议要点
- Tool call 输出内容支持 `diff` 类型，包含 `path`、`oldText`（可为空/新文件）、`newText`（必填）。
- `diff` 作为工具调用输出的一种内容类型，需在消息渲染阶段处理。

## 目标
- 当工具调用内容为 `diff` 时，渲染垂直布局的代码变更视图。
- 保留原有文件路径按钮（可打开文件预览）。
- 在新增文件场景下，清晰标识“新文件”。

## 范围
- WebUI 消息渲染：`apps/webui/src/components/chat/MessageItem.tsx`
- 新增 DiffView 组件：`apps/webui/src/components/chat/DiffView.tsx`

## 方案
- 新建 `DiffView` 组件，接收 `path/oldText/newText` 与 `getLabel`。
- 使用行级 diff（Myers）生成 `added/removed/unchanged` 标记。
- 以“原始/更新”上下两块垂直展示：
  - 原始区域仅显示删除/未变更行，删除行高亮。
  - 更新区域仅显示新增/未变更行，新增行高亮。
- `oldText` 为空时，原始区域显示“新文件”提示。

## 任务步骤
1. 提取/实现行级 diff 算法与行数据结构。
2. 渲染垂直 DiffView（标题、路径按钮、两段滚动区）。
3. 替换现有 `renderDiffBlock` 为新 DiffView。

## 风险与规避
- 大文本 diff 计算成本：使用 `useMemo` 缓存结果，减少重复计算。
- 样式与现有 UI 不一致：沿用现有 Card/Badge 颜色体系与字体大小。
