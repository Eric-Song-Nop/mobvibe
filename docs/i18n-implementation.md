# i18n 多语言支持（实现前计划）

## 目标

- 前端引入中英文双语切换能力，默认根据浏览器语言自动选择（`zh`/`zh-CN`/`zh-TW` 显示中文，其他显示英文）。
- 文案集中管理，减少硬编码文字，便于后续扩展更多语言。
- 提供语言切换入口，并使用本地存储持久化选择。

## 方案概览

- 采用 `react-i18next` + `i18next` + `i18next-browser-languagedetector` 作为 i18n 方案。
- 在 `apps/web/src/i18n` 下新增初始化与语言资源文件：
  - `apps/web/src/i18n/index.ts`：初始化 i18n、语言检测、持久化。
  - `apps/web/src/i18n/locales/zh/translation.json`：中文文案。
  - `apps/web/src/i18n/locales/en/translation.json`：英文文案。
- 在 `apps/web/src/main.tsx` 引入初始化逻辑。
- 为 UI 入口新增语言切换（放在侧边栏右上角的会话区域）。
- 逐步替换前端中文硬编码文案为 `t("...")` 形式，并同步更新测试断言。

## 文案组织

- 以功能域为分组：`common`、`status`、`chat`、`session`、`fileExplorer`、`codePreview`、`toolCall` 等。
- 统一维护 `translation.json`，避免零散 key。

## 验收点

- 浏览器语言为中文时默认显示中文；其他显示英文。
- UI 提供语言切换，切换后刷新仍保持选择。
- 主要界面文案不再硬编码中文。
- 测试用例更新后可通过。

## 实施记录

- 在 `apps/web/src/i18n` 内补齐通用与功能域文案，新增语言切换相关文案。
- `SessionSidebar` 顶部右侧加入语言切换下拉框，使用 `i18n.changeLanguage` 并读取当前 `resolvedLanguage`。
- `MessageItem`、`CodePreview`、会话变更 hooks 与错误处理统一使用 `t(...)` 渲染状态与提示。
- `chat-store` 与 `error-utils` 统一通过 i18n 生成默认错误与会话标题。
- 对单元/集成测试的断言统一改为使用 i18n 文案或英文占位，避免依赖硬编码中文。

## 使用说明

- 侧边栏顶部右上角新增语言切换下拉框，可在中文/英文之间切换。
- 语言选择会写入 `localStorage` 的 `mobvibe.locale`，刷新后保持。
- 浏览器语言以中文（`zh*`）开头时默认中文，否则默认英文。
