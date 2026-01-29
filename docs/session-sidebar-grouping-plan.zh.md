## 目标
- 中会话列表按后端分组展示，形成二级菜单（可折叠，默认展开）。
- 排序规则：先按后端最近使用排序，再按该后端下会话最近使用排序。
- 会话条目不再展示 agent/backend 信息，改为展示工作路径末级目录名。

## 分组与排序规则
- 分组 key：`backendId`，为空时归入“未知后端”。
- 分组标题：`backendLabel ?? backendId ?? t("common.unknown")`。
- 组排序：取组内最近的 `updatedAt`/`createdAt` 作为组时间戳，倒序排列。
- 组内排序：使用 `updatedAt`/`createdAt` 倒序排列。

## UI 结构
- SessionSidebar 列表区域改为按组渲染：
  - 组头：可点击折叠/展开。
  - 组内容：该后端下的会话列表。
- 会话条目展示：标题 + 状态 + 工作路径末级目录名。
- 工作路径取值：`cwd` 的末级目录名（`/home/user/project` -> `project`）。
  - 无 `cwd` 或解析失败时显示 `t("common.unknown")`。

## 影响范围
- `apps/webui/src/components/session/SessionSidebar.tsx`
- `apps/webui/tests/session-sidebar.test.tsx`
- `apps/webui/src/i18n/locales/*/translation.json`（如需新增文案）
- 新增实现文档 `docs/session-sidebar-grouping.zh.md`

## 验证点
- 无会话时空状态不变。
- 多后端会话时分组正确，组/组内排序符合“最近使用”。
- 折叠默认展开，点击组头可切换。
- 会话条目显示工作路径末级目录名，不再展示后端/agent badge。
