## 目标

- 在聊天输入框支持 `@` 触发的资源选择器（复用现有 fuzzy finder 交互）。
- 仅展示会话工作目录内文件，优先遵循 `.gitignore`，不可用时退回全量扫描。
- 输入阶段就维护结构化 `ContentBlock[]`，发送时直接使用资源链接。
- 消息正文中的 `@filename` 可点击打开文件预览。

## 实现前计划

### 功能范围

- 输入框输入 `@` 时弹出资源选择器，候选项以「相对 cwd 的路径」平铺展示。
- 选中后在输入中插入 `@filename`，并同步插入 `resource_link` 内容块。
- 用户手打 `@xxx` 不生成资源块；资源 token 不允许局部编辑，只能整段删除。
- 发送时直接使用 `ContentBlock[]` 作为 ACP prompt。

### 数据流设计

- 后端：新增 `/fs/session/resources`，返回 `cwd` 下文件列表。
  - Git 可用：`git -C <cwd> ls-files -c -o --exclude-standard`。
  - Git 不可用：递归扫描所有文件（含隐藏）。
- 前端：
  - 维护 `inputText`（展示）与 `inputContents`（结构化）。
  - 资源选择器复用 `CommandCombobox` 的布局与键盘交互。
  - `resource_link` 使用 `file://绝对路径` 作为 URI。

### 交互细节

- `@filename` 显示不可编辑，编辑命中时转为整块删除。
- 点击 `@filename` 时，根据结构化内容找到 `resource_link` 并打开预览。
- 资源选择器在输入框附近弹出，ESC 关闭、上下键导航、Enter 插入。

### 影响范围

- `apps/server/src/index.ts`：新增资源索引接口与 Git 扫描逻辑。
- `apps/web/src/lib/api.ts`：新增资源接口类型与请求函数。
- `apps/web/src/lib/chat-store.ts`：新增 `inputContents` 与结构化消息。
- `apps/web/src/components/app/ChatFooter.tsx`：`@` 资源选择与 token 控制。
- `apps/web/src/components/chat/MessageItem.tsx`：用户消息内 `@filename` 可点击。

## 实现后记录

- 待实现后补充。
