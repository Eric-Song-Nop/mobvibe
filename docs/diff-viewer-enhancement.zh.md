# 代码变更查看器增强方案

## 背景
- 当前 diff 视图只在部分渲染路径中调用，导致同一类 diff 在不同位置显示不一致。
- 现有 diff 展示为纯文本上下两段，缺少编辑器级体验：滚动同步与语法高亮。

## 目标
- 统一所有 diff 渲染入口，保证 diff 内容都走同一组件。
- 保持现有上下布局，新增左右同步滚动与语法高亮。
- 复用现有主题与语言解析工具，避免引入新依赖。

## 方案
- 新增 `DiffView` 组件（WebUI），负责渲染 diff 头部与上下两个面板。
- 用行级 diff 算法构建旧/新行数据，保持“原始/更新”垂直布局。
- 使用 `prism-react-renderer` 根据文件扩展名做语法高亮。
- 绑定双面板滚动事件，实现垂直和水平滚动同步。
- `MessageItem` 中所有 diff 类型入口统一改用 `DiffView`。

## 影响范围
- `apps/webui/src/components/chat/DiffView.tsx`（新增）
- `apps/webui/src/components/chat/MessageItem.tsx`（替换 diff 渲染入口）
- `docs/diff-viewer-enhancement.zh.md`（方案与实现记录）

## 实施步骤
1. 编写 `DiffView`：行级 diff、语法高亮、滚动同步。
2. `MessageItem` 统一 diff 渲染入口，覆盖嵌套 diff payload。
3. 更新文档，记录实现细节与使用方式。

## 风险与规避
- 大 diff 计算成本：使用 `useMemo` 缓存 diff 结果与高亮 tokens。
- 滚动同步抖动：使用锁避免互相触发。
- 语言识别失败：默认回退到 `text`。

## 实现记录
- 新增 `apps/webui/src/components/chat/DiffView.tsx`：行级 diff、语法高亮、上下双面板滚动同步。
- 更新 `apps/webui/src/components/chat/MessageItem.tsx`：统一 diff 渲染入口，覆盖嵌套 diff payload。
- 保持原有上下布局与 UI 风格，新增代码高亮与同步滚动体验。

## 使用说明
- 所有 `type: "diff"` 的工具调用内容都会统一使用 `DiffView` 渲染。
- 上下两个面板支持垂直与水平滚动联动。
- 语法高亮根据文件扩展名自动识别，未知类型回退到纯文本高亮。
