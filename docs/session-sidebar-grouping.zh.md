## 功能概述
- 会话列表按后端分组展示，形成可折叠的二级菜单，默认全部展开。
- 排序遵循“最近使用”：组按组内最近会话排序，组内会话按最近更新时间排序。
- 会话条目展示工作路径末级目录名，不再显示后端/agent 信息。

## 具体实现
- 分组 key：`backendId`，为空时归入 `unknown`。
- 分组标题：`backendLabel ?? backendId ?? t("common.unknown")`。
- 组排序：取组内最大 `updatedAt`/`createdAt` 作为组时间戳，倒序排列。
- 组内排序：`updatedAt`/`createdAt` 倒序排列。
- 路径显示：`cwd` 末级目录名（`/home/user/project` -> `project`），无 `cwd` 显示 `t("common.unknown")`。

## 相关文件
- 组件：`apps/webui/src/components/session/SessionSidebar.tsx`
- 测试：`apps/webui/tests/session-sidebar.test.tsx`

## 验证方式
- 启动 WebUI 后检查：
  - 多后端会话是否分组。
  - 组/组内排序是否随最近使用变化。
  - 折叠按钮是否默认展开且可切换。
  - 会话条目显示的路径是否为末级目录名。
