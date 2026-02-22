# 模糊搜索 + Git 集成 极限产品特性方案

> **状态**: ✅ 完成（P0 + P1 + P2 全部完成）
>
> **目标**: 将模糊搜索和 Git 集成两个功能域推到极致，使 Mobvibe 成为最强大的 AI agent 感知工作空间。

## 背景

### 现状分析

**搜索能力（P0-A ~ P1-D 已完成）**:

- 两处搜索已从 `String.includes()` 升级为 uFuzzy 模糊匹配（P0-A ✅）:
  - `/` 命令选择器 (`apps/webui/src/lib/command-utils.ts`) — 模糊搜索 ACP 命令 + `<mark>` 高亮
  - `@` 资源选择器 (`apps/webui/src/lib/resource-utils.ts`) — 模糊搜索文件路径 + `<mark>` 高亮
- 统一搜索引擎 `apps/webui/src/lib/fuzzy-search.ts` 已就绪
- 全局快捷键系统 `apps/webui/src/lib/hotkeys.ts` 已就绪（P0-B ✅）
- 全局命令面板 `apps/webui/src/components/app/CommandPalette.tsx` 已就绪（P1-A ✅），含模糊文件搜索 @ 模式（P1-B ✅）
- 聊天内消息搜索 `apps/webui/src/components/chat/ChatSearchBar.tsx` 已就绪（P1-C ✅）
- 列内文件模糊过滤 `apps/webui/src/components/app/ColumnFileBrowser.tsx` 已就绪（P1-D ✅）

**Git 集成（P0-C ~ P2-D 已完成基础 + RPC 扩展 + 核心 Git 体验）**:

- CLI 侧 13 个函数: 原有 4 个 + 新增 9 个（P0-C ✅）
- RPC 链路完整: WebUI → Gateway → CLI → git binary，共 11 个 RPC 端点
- WebUI 展示: 文件状态字母(M/A/D/?)、分支名、行级 diff 高亮、unified diff 渲染
- FileExplorer Git Changes 视图已就绪（P1-E ✅）
- 提交历史查看器已就绪（P2-A ✅）、staged/unstaged 分离已就绪（P2-B ✅）、side-by-side diff 已就绪（P2-C ✅）、分支管理 UI 已就绪（P2-D ✅）

### 架构约束

```
WebUI (React 19 + Zustand + TanStack Query)
    ↕ REST HTTP + Socket.io
Gateway (Express + Socket.io)
    ↕ Socket.io RPC (Ed25519 认证)
CLI daemon (Bun)
    ↕ execFileAsync("git", ...)
git binary
```

所有 git 操作必须在 CLI 侧执行，经 Socket.io RPC 管道传递。E2EE 要求内容端到端加密（git 元数据除外）。

**非 Git 仓库策略**: `isGitRepo()` 返回 false 时，所有 Git 相关功能（状态、diff、历史、blame、分支等）完全隐藏，不实现任何降级替代方案。搜索功能中依赖 `git grep` 的文件内容搜索同样不可用。

---

## P0: 基础设施层

> 所有后续功能的基石，优先级最高。

### P0-A: 前端模糊搜索引擎 ✅

> **已完成** — `feat(webui): replace substring search with uFuzzy fuzzy matching`

引入 [`uFuzzy`](https://github.com/leeoniya/uFuzzy)（~2KB gzipped，零依赖，性能优于 fuse.js），新建统一搜索封装。

**新建文件**:

- `apps/webui/src/lib/fuzzy-search.ts` — 统一搜索引擎 + `FuzzyHighlight` 组件 + `sliceHighlightRanges` 辅助函数

**核心 API**:

```typescript
// 通用模糊搜索
function fuzzySearch<T>(options: {
  items: T[];
  getText: (item: T) => string; // 单字段提取，调用方自行组合搜索文本
  query: string;
}): FuzzySearchResult<T>[];

type FuzzySearchResult<T> = {
  item: T;
  score: number; // 越小越好（uFuzzy 约定）
  highlightRanges: [number, number][]; // 匹配字符区间
};

// 将全局 ranges 切割到子段的局部 ranges
function sliceHighlightRanges(
  ranges: [number, number][],
  segmentStart: number,
  segmentEnd: number,
): [number, number][];

// React 高亮组件，匹配部分用 <mark> 渲染
function FuzzyHighlight(props: {
  text: string;
  ranges: [number, number][];
  className?: string;
  markClassName?: string;
}): ReactNode;
```

- 空查询返回全部 items（score=0，无高亮），保持与旧 `includes("")` 行为一致
- 有查询时按 uFuzzy `order()` 返回相关性排序结果
- KISS 原则: `getText` 替代 `keys` 数组，每个调用点自行组合搜索文本

**改造文件**:

- `apps/webui/src/lib/command-utils.ts` — 移除 `CommandSearchItem`/`buildSearchText`/`buildCommandSearchItems`，`filterCommandItems` 直接接收 `AvailableCommand[]` 并返回 `FuzzySearchResult[]`
- `apps/webui/src/lib/resource-utils.ts` — 移除 `ResourceSearchItem`/`buildResourceSearchItems`，`filterResourceItems` 直接接收 `SessionFsResourceEntry[]`
- `apps/webui/src/components/app/CommandCombobox.tsx` — props 改为 `results`，description/hint 使用 `FuzzyHighlight` + `sliceHighlightRanges` 渲染高亮
- `apps/webui/src/components/app/ResourceCombobox.tsx` — props 改为 `results`，relativePath 使用 `FuzzyHighlight` 渲染高亮
- `apps/webui/src/components/app/ChatFooter.tsx` — 移除 `buildCommandSearchItems`/`buildResourceSearchItems` 中间层，回调类型更新为 `FuzzySearchResult` 包装

### P0-B: 全局快捷键系统 ✅

**新建文件**:

- `apps/webui/src/lib/hotkeys.ts` — 轻量快捷键注册（原生 keydown，不引入第三方库）

**设计要点**:

- 自动处理 macOS `Cmd` vs Windows/Linux `Ctrl`
- 对话框/模态框打开时抑制冲突快捷键
- 移动端通过 header 按钮替代

**快捷键映射**:

| 快捷键             | 功能         | 阶段 |
| ------------------ | ------------ | ---- |
| `Cmd/Ctrl+K`       | 命令面板     | P1   |
| `Cmd/Ctrl+P`       | 模糊文件搜索 | P1   |
| `Cmd/Ctrl+F`       | 聊天内搜索   | P1   |
| `Cmd/Ctrl+G`       | Git 面板     | P2   |
| `Cmd/Ctrl+B`       | 切换侧边栏   | P0   |
| `Cmd/Ctrl+N`       | 新建会话     | P0   |

**移动端**: 移动端无物理键盘，所有快捷键功能通过命令面板统一入口触发。AppHeader 仅新增一个命令面板按钮（`md:hidden`，仅移动端显示），用户通过命令面板的模式前缀（`>`/`@`/`#`/`git:` 等）访问各功能，避免 header 按钮堆积。

**改造文件**:

- `apps/webui/src/App.tsx` — 顶层注册全局快捷键
- `apps/webui/src/lib/ui-store.ts` — 新增面板状态

### P0-C: Git RPC 扩展 ✅

在现有 4 个 git 函数基础上大幅扩展 CLI 侧能力。

**改造文件** `apps/mobvibe-cli/src/lib/git-utils.ts` — 新增:

| 函数                     | 说明                                      | git 命令                                  |
| ------------------------ | ----------------------------------------- | ----------------------------------------- |
| `getGitLog()`            | 提交历史（分页、路径/作者过滤、消息搜索） | `git log --format=...`                    |
| `getGitShow()`           | 单提交详情 + 文件变更列表                 | `git show --stat --format=...`            |
| `getGitBlame()`          | 行级 blame（支持行范围）                  | `git blame --porcelain -L`                |
| `getGitBranches()`       | 分支列表（含 ahead/behind）               | `git branch -a --format=...`              |
| `getGitStashList()`      | stash 列表                                | `git stash list --format=...`             |
| `getGitStatusExtended()` | 分离 staged/unstaged/untracked            | `git status --porcelain=v1` (解析 X/Y 列) |
| `searchGitLog()`         | 搜索提交消息/diff/作者                    | `git log --grep/--author/-S`              |
| `getGitFileHistory()`    | 单文件提交历史                            | `git log -- <path>`                       |
| `searchFileContents()`   | 文件内容搜索                              | `git grep`                                |

**共享类型** `packages/shared/src/types/socket-events.ts` — 新增:

```typescript
type GitLogEntry = {
  hash: string;
  shortHash: string;
  author: string;
  authorEmail: string;
  date: string; // ISO string
  subject: string;
  body?: string;
  filesChanged?: number;
  insertions?: number;
  deletions?: number;
};

type GitCommitDetail = GitLogEntry & {
  files: Array<{
    path: string;
    status: "A" | "M" | "D" | "R" | "C";
    oldPath?: string;
    insertions: number;
    deletions: number;
  }>;
};

type GitBlameLine = {
  lineNumber: number;
  commitHash: string;
  shortHash: string;
  author: string;
  date: string;
  content: string;
};

type GitBranch = {
  name: string;
  current: boolean;
  remote?: string;
  upstream?: string;
  aheadBehind?: { ahead: number; behind: number };
  lastCommitDate?: string;
};

type GitStashEntry = {
  index: number;
  message: string;
  date: string;
  branchName?: string;
};

type GitStatusExtended = {
  branch?: string;
  staged: Array<{ path: string; status: GitFileStatus }>;
  unstaged: Array<{ path: string; status: GitFileStatus }>;
  untracked: Array<{ path: string }>;
  dirStatus: Record<string, GitFileStatus>;
};

type GrepResult = {
  path: string;
  lineNumber: number;
  content: string;
  matchStart: number;
  matchEnd: number;
};
```

**RPC 管道扩展**:

- `apps/mobvibe-cli/src/daemon/socket-client.ts` — 新增 RPC handler
- `apps/gateway/src/routes/fs.ts` — 新增 HTTP 路由
- `apps/gateway/src/services/session-router.ts` — 新增 RPC 转发

---

## P1: 核心搜索体验

### P1-A: 全局命令面板 (Cmd+K) ✅

**新建** `apps/webui/src/components/app/CommandPalette.tsx`

**功能设计**:

- 基于 Radix AlertDialog 模态框
- 多模式搜索:
  - 默认 / `>` — 命令搜索（Session/导航/Agent/Git 操作）
  - `@` — 文件搜索
  - `#` — 会话搜索
  - `git:` — git 搜索（提交、分支）
- 最近使用命令置顶
- `@tanstack/react-virtual` 虚拟滚动（已是项目依赖）
- 每个结果项显示快捷键提示

**移动端**: 桌面为居中浮动面板（Cmd+K 触发），移动端切换为全屏模态（`100svh × 100vw`），从 AppHeader 命令面板按钮触发。输入框自动聚焦并弹出原生虚拟键盘。结果列表使用 `@tanstack/react-virtual` 虚拟滚动。每项触摸目标增大至 `min-h-12`（48px），符合 WCAG 2.5.8 触摸目标建议和 Material Design 规范。

### P1-B: 模糊文件搜索 (Cmd+P) ✅

- 命令面板的 `file` 模式（`@` 前缀触发）
- 数据源: 复用 `fetchSessionFsResources` API（TanStack Query 缓存）
- 搜索字段: `relativePath`，使用 P0-A 模糊引擎
- 结果渲染: 文件图标 + 路径高亮 + git 状态标记
- git 变更文件可选择性置顶
- 选中后: 打开 FileExplorerDialog 导航到该文件

**移动端**: 复用命令面板全屏模态容器（同 P1-A），文件图标 + 路径高亮 + git 状态 badge 布局保持一致。

**依赖**: P0-A ✅（模糊搜索引擎）、P1-A（命令面板容器）

### P1-C: 聊天内消息搜索 (Cmd+F) ✅

**新建** `apps/webui/src/components/chat/ChatSearchBar.tsx`

- 嵌入 `ChatMessageList` 上方，类似浏览器 Cmd+F 搜索条
- 搜索: TextMessage / ThoughtMessage / ToolCallMessage 内容
- 上/下翻页 + 匹配计数 ("3/12") + `<mark>` 高亮
- 注意: 消息已在客户端解密，搜索在 Zustand store 数据上执行
- Escape 关闭搜索条
- **改造** `apps/webui/src/lib/ui-store.ts` — 新增搜索状态

**移动端**: 桌面为顶部搜索条（Cmd+F 触发），移动端通过命令面板的"聊天搜索"命令激活搜索栏，覆盖 header 区域。上/下导航按钮放置在输入框两侧，匹配计数（"3/12"）居中显示。Escape 键或关闭按钮收起搜索栏。

### P1-D: 文件列表内实时模糊过滤 ✅

**改造文件**:

- `apps/webui/src/components/app/ColumnFileBrowser.tsx` — 最后一列增加搜索输入框，集成 fuzzySearch + FuzzyHighlight

**设计要点**:

- 搜索框位置: 仅最后一列（当前活跃目录）的列头下方、条目列表上方
- 搜索范围: 当前列文件名（entry.name），不含路径前缀
- 搜索引擎: 复用 P0-A 的 fuzzySearch() + FuzzyHighlight 组件
- 空搜索返回全部条目（保持现有行为），有搜索时按相关性排序 + 名称高亮
- 与现有 filterEntry prop 正交: filterEntry 先过滤，fuzzySearch 后匹配
- 列切换时（导航进入子目录或返回父目录）自动清空搜索状态
- 快捷键 `/` 聚焦搜索框，Escape 清空并退出，ArrowDown/Up + Enter 键盘导航
- 不修改 useColumnFileBrowser hook — 搜索过滤在组件展示层处理

**移动端**: 搜索输入框直接可见（无快捷键依赖），min-h 44px 触摸目标，内置 clear 按钮。虚拟键盘弹出时列表自适应缩小。

**依赖**: P0-A ✅（fuzzySearch 引擎已就绪）
**不依赖**: P0-B/P0-C — 可独立实施

### P1-E: FileExplorer Git Changes 视图 ✅

**新建文件**:

- `apps/webui/src/components/app/GitChangesView.tsx` — 变更文件分组折叠列表
- `apps/webui/src/components/app/git-status-indicator.tsx` — 提取 GitStatusIndicator + GIT_STATUS_CONFIG 为共享模块

**改造文件**:

- `apps/webui/src/components/app/FileExplorerDialog.tsx`:
  - Header "Session files" 文字替换为 [Files | Changes] tab 按钮组
  - 新增 activeTab: "files" | "changes" 状态
  - Changes tab 激活时显示 GitChangesView，替代 ColumnFileBrowser
  - 预览区域两个 tab 共享: Changes 中点击文件同样触发文件预览
- `apps/webui/src/components/app/ColumnFileBrowser.tsx`:
  - GitStatusIndicator 和 GIT_STATUS_CONFIG 提取到独立模块后改为导入

**数据来源（Phase 1，基于现有 API，无需后端改动）**:

- 复用 gitStatusQuery（GitStatusResponse.files），按 status 分两组:
  - "Changed" 分组: status 为 M/A/D/R/C/U 的文件
  - "Untracked" 分组: status 为 ? 的文件
- Phase 2（P2-B 完成后）升级为三分组: Staged / Unstaged / Untracked

**交互设计**:

- 桌面端: Changes 列表占左侧（同 ColumnFileBrowser 位置），预览区域在右侧
- 移动端: Changes 列表全屏，点击文件 → setActivePane("preview") 切到预览
- 分组标题可折叠/展开，显示文件计数（如 "Changed (5)"）
- 每个文件条目: 相对路径 + GitStatusIndicator（复用共享模块）
- 点击文件条目: 设置 selectedFilePath + 切到 preview pane

**Header Tab + 移动端 Pane 切换矩阵**:

| activeTab | activePane | 桌面端                    | 移动端          |
| --------- | ---------- | ------------------------- | --------------- |
| files     | browser    | ColumnFileBrowser + Preview | ColumnFileBrowser |
| files     | preview    | ColumnFileBrowser + Preview | Preview         |
| changes   | browser    | GitChangesView + Preview  | GitChangesView  |
| changes   | preview    | GitChangesView + Preview  | Preview         |

移动端 header 按钮:

- activeTab=files → [Directories | Preview] 切换
- activeTab=changes → [Changes | Preview] 切换

**移动端**: 折叠列表天然适合纵向滚动，条目 min-h 44px 触摸区域。不需要 Bottom Sheet 等新基础设施，完全复用现有 Button + AlertDialog + activePane 机制。

**依赖**: 无（仅使用现有 gitStatusQuery + 现有组件）
**升级路径**: P0-C 完成后 → P2-B 使用 GitStatusExtended 升级为三分组

---

## P2: 核心 Git 体验

### P2-A: 提交历史查看器 ✅

**新建** `apps/webui/src/components/git/CommitHistoryPanel.tsx`

- 作为 FileExplorerDialog 新 tab 或独立面板
- 列表: `短hash` + 日期 + 作者 + 消息 + `+N -N` 变更统计
- 点击展开: 该提交修改的文件列表
- 点击文件: 复用 `UnifiedDiffView` 显示 diff
- 虚拟滚动 + 分页加载（每次 50 条）
- 过滤: 按文件路径 / 作者 / 日期范围

**移动端**: 桌面为 FileExplorer 新 tab 或侧面板，移动端使用全屏模态（复用 `FileExplorerDialog` 的 `100svh × 100vw` 模式），列表项增大触摸区域（min-h 48px）。点击提交 → 推入新 pane 显示提交详情（复用 `FileExplorerDialog` 的 `activePane` 切换模式），展开的文件列表 → 二级 pane。

**依赖**: P0-C（getGitLog RPC）

### P2-B: Staged vs Unstaged 完整分离 ✅

> P1-E 已实现基础 Changes 视图（Changed / Untracked 两分组），本阶段升级为完整的三分组分离。

**后端**:

- CLI 侧 getGitStatusExtended() — 拆分 porcelain X/Y 列（依赖 P0-C）
- Gateway + shared 类型扩展

**前端升级**:

- GitChangesView.tsx 从两分组升级为三分组（Staged / Unstaged / Untracked）
- FileExplorerDialog 的 gitStatusQuery 切换为调用 fetchSessionGitStatusExtended
- 条件降级: getGitStatusExtended 不可用时回退到 getGitStatus（Phase 1 行为）
- Mobvibe 是只读监控面板 — 展示状态帮助理解 agent 行为

**移动端**: 保持 P1-E 的折叠列表布局，分组数量从 2 增至 3，无额外适配。

**依赖**: P0-C（Git RPC 扩展）、P1-E（Changes 视图 Phase 1）

### P2-C: Side-by-Side Diff 视图 ✅

**新建** `apps/webui/src/components/chat/SideBySideDiffView.tsx`

- 复用 `DiffView.tsx` 的 `buildDiffOps` / `parseUnifiedDiff` 逻辑（当前为未导出的内部函数，需先导出或提取到 `lib/diff-utils.ts` 共享模块）
- 左栏旧文件 / 右栏新文件，匹配行对齐，空行填充
- 复用 Prism 语法高亮
- 在 `UnifiedDiffView` 旁添加 Unified | Split 视图切换按钮

**移动端**: 直接隐藏 side-by-side 选项 — 移动端屏幕宽度不足以并排显示两栏代码，仅保留 unified 模式。检测方式: `sm:` 响应式断点隐藏切换按钮，或通过 `isMobilePlatform()` 条件渲染。

**依赖**: 无（仅复用现有 DiffView.tsx 逻辑）

### P2-D: 分支管理 UI ✅

- 文件浏览器 header 分支名 → 可点击下拉菜单
- 内容: 本地 + 远程分支列表，内置模糊搜索过滤
- 每分支: 名称 + 最近提交日期 + ahead/behind 计数
- 只读操作（查看分支信息，不执行 checkout 等写操作）

**移动端**: 桌面为 header 内下拉菜单，移动端使用 Bottom Sheet（从底部推入），由分支名 tap 触发。分支列表内集成模糊搜索过滤输入框，列表项增大触摸区域。

**依赖**: P0-C（getGitBranches RPC）、P0-A（模糊搜索过滤）

---

## 搜索与 Git 的协同设计

两个功能域深度交织，产生 1+1>2 的效果:

| 场景              | 桌面端实现                                      | 移动端触发                                |
| ----------------- | ----------------------------------------------- | ----------------------------------------- |
| 搜索变更文件      | 文件搜索中 git 变更文件置顶 + 状态标记 (Cmd+P)  | 命令面板按钮 → `@` 模式                   |
| 搜索提交消息      | 命令面板 `git:` 前缀 → `rpc:git:searchLog`      | 命令面板按钮 → `git:` 前缀                |
| 模糊匹配分支      | 分支下拉菜单集成模糊搜索                        | 分支名 tap → Bottom Sheet + 模糊搜索      |
| diff 内搜索       | diff 视图中 Cmd+F                               | 命令面板 → 聊天搜索命令                   |
| 文件历史搜索      | 文件预览 History tab 模糊搜索提交消息           | 全屏模态 History pane                     |
| 列内快速过滤文件  | ColumnFileBrowser 搜索框 + uFuzzy (/) (P1-D)    | 搜索框直接可见，tap 聚焦                   |
| 查看当前变更文件  | FileExplorer Changes tab (P1-E)                 | 同 Changes tab，点击文件 → preview         |

---

## 移动端 UX 设计

### 设计原则

- **触屏优先的交互模式** — tap 替代 hover，长按替代右键菜单，滑动替代滚动条拖拽
- **全屏模态 + Bottom Sheet** — 替代桌面端的浮动面板和下拉菜单，充分利用移动端屏幕空间
- **平台检测驱动的条件渲染** — 通过 `isMobilePlatform()`（`src/lib/platform.ts`）和 `md:` 响应式断点双重检测，实现桌面/移动端差异化 UI
- **SafeArea 全覆盖** — 当前仅 ChatFooter 支持 `env(safe-area-inset-bottom)`，需扩展到 top/left/right 以适配刘海屏和圆角屏
- **虚拟滚动保证大列表性能** — 所有列表组件复用 `@tanstack/react-virtual`（已是项目依赖，`ChatMessageList.tsx` 已有实践）
- **触摸目标尺寸合规** — 所有可交互元素 min-h 44px（iOS HIG）/ 48dp（Material Design），符合 WCAG 2.5.8

### 基础设施前置（P0 阶段新增）

在 P0 阶段需新增以下移动端基础设施，供后续 P1-P2 功能复用:

| 组件                | 实现方案                                                                         | 备注                                        |
| ------------------- | -------------------------------------------------------------------------------- | ------------------------------------------- |
| **Bottom Sheet**    | 基于 Radix Dialog + CSS `transform: translateY()` 动画，从底部推入               | 用于分支管理等场景                          |
| **SafeArea 扩展**   | 全边缘 `env(safe-area-inset-*)` 支持，封装为 `SafeAreaView` 容器组件             | 当前仅 bottom，需扩展 top/left/right        |
| **长按探测器 Hook** | `useLongPress(callback, delay)` — 基于 `pointerdown`/`pointerup` 计时器          | 替代桌面右键菜单，用于上下文操作            |
| **Header 工具栏**   | AppHeader 新增移动端命令面板按钮（单个），`md:hidden` 仅移动端可见                | 命令面板为所有快捷键功能的统一入口          |

### 各功能移动端适配总览

| 功能         | 桌面端                    | 移动端                                                 | 降级策略           |
| ------------ | ------------------------- | ------------------------------------------------------ | ------------------ |
| 命令面板     | 居中浮动面板 (Cmd+K)      | 全屏模态 (100svh) + header 命令面板按钮触发            | —                  |
| 快捷键       | 键盘快捷键                | 命令面板统一入口                                       | —                  |
| 文件搜索     | 居中浮动面板 (Cmd+P)      | 全屏模态                                               | —                  |
| 聊天内搜索   | 顶部搜索条 (Cmd+F)        | 覆盖 header 区域的搜索栏                               | —                  |
| 提交历史     | 侧面板/新 tab             | 全屏模态 + pane 推入                                   | —                  |
| Staged 视图  | 并排/折叠列表             | 分段按钮切换 (Staged/Unstaged/Untracked)               | —                  |
| Side-by-Side | Unified/Split 切换        | 仅 unified                                             | 隐藏 Split 选项    |
| 分支管理     | 下拉菜单                  | Bottom Sheet                                           | —                  |
| 列内模糊过滤 | 最后一列搜索框 + `/` 快捷键 | 搜索框直接可见，tap 聚焦                               | —                  |
| Changes 视图 | FileExplorer Changes tab  | 同 Changes tab，折叠列表全屏                           | —                  |

---

## 技术风险与缓解

| 风险                              | 缓解措施                                                                                 |
| --------------------------------- | ---------------------------------------------------------------------------------------- |
| RPC 三跳延迟（WebUI→Gateway→CLI） | TanStack Query 缓存 (staleTime) + 骨架屏 + 乐观更新                                      |
| 大仓库 git 操作慢                 | CLI 侧始终带 `--max-count` 限制 + 分页加载                                               |
| E2EE 兼容性                       | Git 元数据不含对话内容，无需加密；消息搜索在客户端解密后执行                             |
| Bundle 大小增长                   | uFuzzy ~2KB；高级组件 lazy import                                                        |
| CLI 断连时 git 不可用             | 优雅降级 + "CLI 离线，Git 功能不可用" 提示                                               |
| 移动端虚拟键盘遮挡输入框         | `visualViewport` API 监听键盘高度，动态调整模态框底部 padding                            |
| 触屏误触（触摸目标过小）         | 所有可交互元素 min-h 44px（iOS HIG）/ 48dp（Material Design），符合 WCAG 2.5.8           |
| 移动端首屏加载慢                  | Git 面板等高级组件 lazy import（`React.lazy`），不计入首屏 bundle                         |
| SafeArea 适配不完整               | 封装 `SafeAreaView` 组件统一处理 `env(safe-area-inset-*)`，覆盖 top/bottom/left/right    |

---

## 实施优先级

| 阶段   | 内容                                             | 工作量 | 价值 | 状态    |
| ------ | ------------------------------------------------ | ------ | ---- | ------- |
| **P0** | 基础设施（搜索引擎 ✅ + 快捷键 ✅ + Git RPC ✅）  | 中     | 极高 | ✅ 完成 |
| **P1** | 核心搜索 + FileExplorer 增强（命令面板 ✅ + 文件搜索 ✅ + 聊天搜索 ✅ + 列内过滤 ✅ + Changes 视图 ✅） | 中     | 极高 | ✅ 完成 |
| **P2** | 核心 Git（提交历史 ✅ + staged 分离 ✅ + diff ✅ + 分支 ✅） | 大     | 高   | ✅ 完成 |
