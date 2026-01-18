# Tree-sitter 代码大纲

## 背景

- 现有代码预览已支持 JavaScript/TypeScript/TSX 的 Tree-sitter 大纲。
- 需要补充单测保障，并扩展更多语言解析能力。

## 目标

- 为 Tree-sitter 大纲补充可维护的单元测试。
- 扩展到更多语言，同时保持前端加载与解析性能。
- 记录实现细节，方便后续维护与扩展。

## 语言范围

- 现有：`javascript` / `typescript` / `tsx`
- 新增（对齐 outline.nvim 经验值）：`python`、`go`、`rust`、`java`、`c`、`cpp`、`ruby`、`php`、`csharp`、`bash`

## 实现前计划

- **Tree-sitter 解析链路**
  - 复用 `CodePreview` 内的解析管线：语言识别 → 加载 wasm → Query 匹配 → 构建树形大纲。
  - 大纲项展示统一使用 `definition.*` / `@name` 捕获规范。
- **语言配置扩展**
  - 新增对应的 tree-sitter wasm 依赖与 `postinstall` 拷贝。
  - 扩展 `OutlineLanguage`、配置与 `resolveOutlineLanguage` 映射。
  - Query 复用 outline.nvim 规则，覆盖类/函数/方法/接口/类型/常量/模块/枚举。
- **性能与缓存**
  - 复用现有语言/Query 缓存，避免重复加载 wasm。
- **单测策略**
  - 使用 Vitest + Testing Library。
  - mock `web-tree-sitter`，避免 wasm 依赖。
  - 覆盖大纲渲染状态、节点展示、跳转行为。

## 架构设计

- **语言识别**：`resolveLanguageFromPath` 根据扩展名映射语言。
- **解析流程**：`CodePreview` 负责初始化 Tree-sitter、加载语言/Query、解析语法树并构建树形大纲。
- **展示交互**：UI 通过折叠、滚动定位、长按复制实现移动端体验。

## 实现后记录

- 已扩展 Tree-sitter 大纲语言：`bash`、`c`、`cpp`、`csharp`、`go`、`java`、`php`、`python`、`ruby`、`rust`。
- Query 规则参考 outline.nvim/aerial 风格，统一为 `definition.*` + `@name` 捕获，覆盖类/函数/方法/接口/结构体/枚举/字段等常见符号。
- 暂未启用 `kotlin` / `lua` / `swift`，保持 wasm 加载链路最简。

## 使用说明

- 保证 `apps/web/public/` 下存在对应 wasm（由 `pnpm install` 触发 `postinstall` 自动拷贝）。
- 代码预览页会根据文件扩展名识别语言并自动启用大纲。
- 若语言暂未提供 wasm，则仍显示“当前语言暂无大纲”。
