# ACP Edit 文件预览支持

## 实现计划

### 现状
- 工具调用消息里对 `read` / `use` 文件的路径已有点击预览入口。
- ACP `edit` / `write` 工具调用中缺少路径识别，无法从工具调用里直接预览。

### 目标
- 在工具调用消息里识别 ACP `fs/write_text_file` / `edit` 相关路径，并提供文件预览入口。
- 保持与现有文件预览交互一致（点击路径打开文件预览弹窗）。

### 影响范围
- WebUI 消息流渲染：`apps/webui/src/components/chat/MessageItem.tsx`
- 消息渲染测试：`apps/webui/tests/message-item.test.tsx`

### 改动点
- 扩展工具调用路径收集逻辑：
  - 仅支持绝对路径（以 `/` 开头）。
  - 优先读取 `rawInput.path`（ACP 标准字段，绝对路径）。
  - 兼容 `file_path` / `filePath` 字段。
  - 兼容 `edits[]` 中的 `path` 字段。
  - 解析 `rawInput.patch` / `rawInput.patchText` / `rawInput.diff`，提取 `*** Update|Add|Delete File:` 路径。
- 新增测试覆盖 `rawInput.path` 及 `rawInput.patch` 产生可点击预览入口。

### 测试点
- 工具调用消息包含 `rawInput.path` 时，渲染的路径按钮可点击并触发 `onOpenFilePreview`。

## 实现细节
- `apps/webui/src/components/chat/MessageItem.tsx` 的工具调用路径收集逻辑新增：
  - 只接收绝对路径。
  - 读取 `rawInput.path`（ACP `fs/write_text_file` 标准字段）。
  - 兼容 `file_path` / `filePath`。
  - 兼容 `edits[]` 中的 `path`。
  - 解析 `rawInput.patch` / `rawInput.patchText` / `rawInput.diff` 中的 `*** Update|Add|Delete File:` 路径。
- `apps/webui/tests/message-item.test.tsx` 新增用例，验证 `rawInput.path` 与 `rawInput.patch` 渲染的按钮可点击并触发预览。

## 使用方法
- 当工具调用为 ACP 写文件或编辑操作时，消息摘要中的文件名将可点击。
- 仅当路径为绝对路径时才展示为可点击入口。
- 点击文件名会打开文件预览弹窗，并直接定位到对应文件。

## 测试
- `apps/webui/tests/message-item.test.tsx`：新增 `renders tool call path from rawInput.path` 和 `renders tool call paths from rawInput.patch`。
