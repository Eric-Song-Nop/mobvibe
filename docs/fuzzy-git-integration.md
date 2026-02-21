# 模糊搜索 + Git 集成 极限产品特性方案

> **状态**: 🚧 进行中（P0-A 已完成）
>
> **目标**: 将模糊搜索和 Git 集成两个功能域推到极致，使 Mobvibe 成为最强大的 AI agent 感知工作空间。

## 背景

### 现状分析

**搜索能力（P0-A 已完成基础模糊搜索）**:

- 两处搜索已从 `String.includes()` 升级为 uFuzzy 模糊匹配（P0-A ✅）:
  - `/` 命令选择器 (`apps/webui/src/lib/command-utils.ts`) — 模糊搜索 ACP 命令 + `<mark>` 高亮
  - `@` 资源选择器 (`apps/webui/src/lib/resource-utils.ts`) — 模糊搜索文件路径 + `<mark>` 高亮
- 统一搜索引擎 `apps/webui/src/lib/fuzzy-search.ts` 已就绪，可供后续命令面板等功能复用
- 待建设: 全局搜索、命令面板、快捷键系统

**Git 集成（有基础，远未极限）**:

- CLI 侧 4 个函数: `isGitRepo()`, `getGitBranch()`, `getGitStatus()`, `getFileDiff()` (`apps/mobvibe-cli/src/lib/git-utils.ts`)
- RPC 链路完整: WebUI → Gateway → CLI → git binary
- WebUI 展示: 文件状态字母(M/A/D/?)、分支名、行级 diff 高亮、unified diff 渲染
- 缺失: 提交历史、blame、分支管理、staged/unstaged 分离、side-by-side diff、stash 等

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

### P0-B: 全局快捷键系统

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
| `Cmd/Ctrl+Shift+F` | 文件内容搜索 | P3   |
| `Cmd/Ctrl+G`       | Git 面板     | P2   |
| `Cmd/Ctrl+B`       | 切换侧边栏   | P0   |
| `Cmd/Ctrl+N`       | 新建会话     | P0   |

**移动端**: 移动端无物理键盘，所有快捷键功能通过 AppHeader 工具栏图标按钮触发。按钮优先级: 搜索(🔍) > 文件(📁) > Git，使用 `md:hidden` 仅在移动端显示（桌面端隐藏）。`isMobilePlatform()` 检测平台后条件渲染按钮组。

**改造文件**:

- `apps/webui/src/App.tsx` — 顶层注册全局快捷键
- `apps/webui/src/lib/ui-store.ts` — 新增面板状态

### P0-C: Git RPC 扩展

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
| `searchFileContents()`   | 文件内容搜索                              | `git grep` / `grep -rn`                   |

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
  isGitRepo: boolean;
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

### P1-A: 全局命令面板 (Cmd+K)

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

**移动端**: 桌面为居中浮动面板（Cmd+K 触发），移动端切换为全屏模态（`100svh × 100vw`），从 AppHeader 搜索图标按钮触发。输入框自动聚焦并弹出原生虚拟键盘。结果列表使用 `@tanstack/react-virtual` 虚拟滚动。每项触摸目标增大至 `min-h-12`（48px），符合 WCAG 2.5.8 触摸目标建议和 Material Design 规范。

### P1-B: 模糊文件搜索 (Cmd+P)

- 命令面板的 `file` 模式
- 数据源: 复用 `fetchSessionFsResources` API（TanStack Query 缓存）
- 搜索字段: `relativePath`，使用 P0-A 模糊引擎
- 结果渲染: 文件图标 + 路径高亮 + git 状态标记
- git 变更文件可选择性置顶
- 选中后: 打开 FileExplorerDialog 导航到该文件

**移动端**: 复用命令面板全屏模态容器（同 P1-A），文件图标 + 路径高亮 + git 状态 badge 布局保持一致。

### P1-C: 聊天内消息搜索 (Cmd+F)

**新建** `apps/webui/src/components/chat/ChatSearchBar.tsx`

- 嵌入 `ChatMessageList` 上方，类似浏览器 Cmd+F 搜索条
- 搜索: TextMessage / ThoughtMessage / ToolCallMessage 内容
- 上/下翻页 + 匹配计数 ("3/12") + `<mark>` 高亮
- 注意: 消息已在客户端解密，搜索在 Zustand store 数据上执行
- Escape 关闭搜索条
- **改造** `apps/webui/src/lib/ui-store.ts` — 新增搜索状态

**移动端**: 桌面为顶部搜索条（Cmd+F 触发），移动端从 AppHeader 搜索按钮展开搜索栏，覆盖 header 区域。上/下导航按钮放置在输入框两侧，匹配计数（"3/12"）居中显示。Escape 键或关闭按钮收起搜索栏。

---

## P2: 核心 Git 体验

### P2-A: 提交历史查看器

**新建** `apps/webui/src/components/git/CommitHistoryPanel.tsx`

- 作为 FileExplorerDialog 新 tab 或独立面板
- 列表: `短hash` + 日期 + 作者 + 消息 + `+N -N` 变更统计
- 点击展开: 该提交修改的文件列表
- 点击文件: 复用 `UnifiedDiffView` 显示 diff
- 虚拟滚动 + 分页加载（每次 50 条）
- 过滤: 按文件路径 / 作者 / 日期范围

**移动端**: 桌面为 FileExplorer 新 tab 或侧面板，移动端使用全屏模态（复用 `FileExplorerDialog` 的 `100svh × 100vw` 模式），列表项增大触摸区域（min-h 48px）。点击提交 → 推入新 pane 显示提交详情（复用 `FileExplorerDialog` 的 `activePane` 切换模式），展开的文件列表 → 二级 pane。

### P2-B: Staged vs Unstaged 分离视图

- CLI 侧 `getGitStatusExtended()` — 拆分 porcelain X/Y 列
- WebUI 文件浏览器新增 "Changes" 视图:
  - **Staged** — 已暂存的变更
  - **Unstaged** — 未暂存的变更
  - **Untracked** — 未追踪的文件
- Mobvibe 是只读监控面板 — 展示状态帮助理解 agent 行为

**移动端**: 使用分段按钮（Segmented Control: Staged | Unstaged | Untracked）切换三类视图，替代桌面端的并排/折叠布局。每段使用独立的 `@tanstack/react-virtual` 虚拟滚动列表。

### P2-C: Side-by-Side Diff 视图

**新建** `apps/webui/src/components/chat/SideBySideDiffView.tsx`

- 复用 `DiffView.tsx` 的 `buildDiffOps` / `parseUnifiedDiff` 逻辑
- 左栏旧文件 / 右栏新文件，匹配行对齐，空行填充
- 复用 Prism 语法高亮
- 在 `UnifiedDiffView` 旁添加 Unified | Split 视图切换按钮

**移动端**: 直接隐藏 side-by-side 选项 — 移动端屏幕宽度不足以并排显示两栏代码，仅保留 unified 模式。检测方式: `sm:` 响应式断点隐藏切换按钮，或通过 `isMobilePlatform()` 条件渲染。

### P2-D: 分支管理 UI

- 文件浏览器 header 分支名 → 可点击下拉菜单
- 内容: 本地 + 远程分支列表，内置模糊搜索过滤
- 每分支: 名称 + 最近提交日期 + ahead/behind 计数
- 只读操作（查看分支信息，不执行 checkout 等写操作）

**移动端**: 桌面为 header 内下拉菜单，移动端使用 Bottom Sheet（从底部推入），由分支名 tap 触发。分支列表内集成模糊搜索过滤输入框，列表项增大触摸区域。

---

## P3: 高级搜索 + 高级 Git

### P3-A: 跨会话搜索

- 命令面板 `#` 模式
- 搜索: 会话标题 + cwd + backend 名称（从 Zustand chat-store）
- 深度搜索（可选扩展）: 新 RPC `rpc:session:searchMessages` 在 CLI 侧检索消息内容

**移动端**: 复用命令面板 `#` 模式的全屏模态容器（同 P1-A），交互方式与桌面端一致。

### P3-B: Git Blame 集成

- `CodePreview.tsx` 新增 blame 模式
- 左侧 gutter: 短 hash + 作者 + 日期
- 同一提交连续行合并显示
- 大文件: 只请求可见行范围（`git blame -L`）
- 点击 blame 注释: 弹出提交详情卡片

**移动端**: 桌面左侧 gutter 显示 blame 注释，移动端默认隐藏 blame 列（屏幕宽度有限），提供切换按钮开启。点击代码行 → Bottom Sheet 显示 blame 详情（commit hash + 作者 + 日期 + 提交消息），替代桌面端的 hover tooltip（触屏无 hover 事件）。

### P3-C: 文件内容搜索 (Cmd+Shift+F)

- CLI 侧 `searchFileContents()` 使用 `git grep`（git repo）或 `grep -rn`（非 git）
- WebUI 命令面板搜索模式，结果按文件分组
- 支持: 大小写敏感切换、正则表达式、文件模式过滤 (`*.ts`)
- 点击结果: 打开文件预览跳转到对应行

**移动端**: 复用命令面板搜索模式的全屏模态容器。结果点击 → 推入文件预览 pane（同 `FileExplorerDialog` 的 `activePane` 切换模式）。

### P3-D: Git Stash 查看

- Git 面板新增 Stash tab
- 列表: stash 索引 + 消息 + 分支名 + 日期
- 只读查看

**移动端**: 嵌入 Git 面板内，列表项增大触摸区域（min-h 48px），布局与桌面端一致。

---

## P4: 极限功能

### P4-A: "Agent 做了什么" 专用视图

> **Mobvibe 最核心的差异化功能** — 用户打开远程 AI agent WebUI，第一个问题就是 "agent 刚才改了什么"。

- 会话视图新增 **"Changes" tab**（与 Chat / Files 并列）
- 自动追踪: 每次 `turn_end` 事件后刷新 git status
- 展示: 本次 turn 的 git 变更 + 关联的 tool_call 事件
- 时间线视图: 聊天消息 + git 提交交错排列
- 关联 `ToolCallLocation` 类型，将工具调用与文件变更映射

**移动端**: 使用全屏 tab 切换模式（Chat | Changes | Files），tab 栏固定在顶部。时间线视图保持竖向布局，天然适合移动端纵向滚动。变更文件列表项增大触摸区域。

### P4-B: 冲突解决助手

- 检测 `U`（Unmerged）状态文件
- 自动解析冲突标记 (`<<<<<<<`, `=======`, `>>>>>>>`)
- 三路合并视图: ours / theirs / merged
- 辅助用户生成 agent prompt 解决冲突（不直接编辑文件）

**移动端**: 保留冲突检测 + 通知功能，但三路合并视图仅桌面端可用（移动端屏幕宽度无法承载三栏对比）。移动端显示简化的冲突文件列表 + "在桌面端查看完整合并视图" 提示。

### P4-C: Git Graph 可视化

- 轻量 SVG 渲染的分支拓扑图
- 节点 = 提交，边 = 父子关系，颜色 = 分支
- 与 commit history 联动: 点击节点显示提交详情
- 简单 SVG path 绘制（不引入 d3.js）
- lazy import 控制 bundle 大小

**移动端**: 不渲染 SVG 分支拓扑图 — 小屏幕上分支图不可读且交互困难。替代方案: 线性提交列表，每项附带分支名称标签（badge），通过 `isMobilePlatform()` 条件渲染切换。

---

## 搜索与 Git 的协同设计

两个功能域深度交织，产生 1+1>2 的效果:

| 场景              | 桌面端实现                                      | 移动端触发                                |
| ----------------- | ----------------------------------------------- | ----------------------------------------- |
| 搜索变更文件      | 文件搜索中 git 变更文件置顶 + 状态标记 (Cmd+P)  | header 搜索图标 → 全屏模态                |
| 搜索提交消息      | 命令面板 `git:` 前缀 → `rpc:git:searchLog`      | header 搜索 → 输入 `git:` 前缀            |
| 模糊匹配分支      | 分支下拉菜单集成模糊搜索                        | 分支名 tap → Bottom Sheet + 模糊搜索      |
| diff 内搜索       | diff 视图中 Cmd+F                               | header 搜索按钮 → 覆盖式搜索栏            |
| "agent 改了什么"  | 命令面板 `changes:` → tool_call + git 变更关联  | Changes tab 直接查看                      |
| 文件历史搜索      | 文件预览 History tab 模糊搜索提交消息           | 全屏模态 History pane                     |
| 跨会话 + git 关联 | "在哪个会话中修改了 X 文件" — 跨会话 git log    | header 搜索 → 输入 `#` 前缀               |

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

在 P0 阶段需新增以下移动端基础设施，供后续 P1-P4 功能复用:

| 组件                | 实现方案                                                                         | 备注                                        |
| ------------------- | -------------------------------------------------------------------------------- | ------------------------------------------- |
| **Bottom Sheet**    | 基于 Radix Dialog + CSS `transform: translateY()` 动画，从底部推入               | 用于分支管理、blame 详情等场景              |
| **SafeArea 扩展**   | 全边缘 `env(safe-area-inset-*)` 支持，封装为 `SafeAreaView` 容器组件             | 当前仅 bottom，需扩展 top/left/right        |
| **长按探测器 Hook** | `useLongPress(callback, delay)` — 基于 `pointerdown`/`pointerup` 计时器          | 替代桌面右键菜单，用于上下文操作            |
| **Header 工具栏**   | AppHeader 新增移动端专用图标按钮组（搜索/文件/Git），`md:hidden` 仅移动端可见     | 替代桌面快捷键入口                          |

### 各功能移动端适配总览

| 功能         | 桌面端                    | 移动端                                                 | 降级策略           |
| ------------ | ------------------------- | ------------------------------------------------------ | ------------------ |
| 命令面板     | 居中浮动面板 (Cmd+K)      | 全屏模态 (100svh) + header 搜索按钮触发                | —                  |
| 快捷键       | 键盘快捷键                | AppHeader 图标按钮替代                                 | —                  |
| 文件搜索     | 居中浮动面板 (Cmd+P)      | 全屏模态                                               | —                  |
| 聊天内搜索   | 顶部搜索条 (Cmd+F)        | 覆盖 header 区域的搜索栏                               | —                  |
| 提交历史     | 侧面板/新 tab             | 全屏模态 + pane 推入                                   | —                  |
| Staged 视图  | 并排/折叠列表             | 分段按钮切换 (Staged/Unstaged/Untracked)               | —                  |
| Side-by-Side | Unified/Split 切换        | 仅 unified                                             | 隐藏 Split 选项    |
| 分支管理     | 下拉菜单                  | Bottom Sheet                                           | —                  |
| Git Blame    | 左侧 gutter + hover       | 默认隐藏，tap 行 → Bottom Sheet 详情                   | 隐藏 gutter        |
| 文件内容搜索 | 命令面板模式              | 全屏模态 + pane 推入                                   | —                  |
| Git Stash    | 面板 tab                  | 面板 tab，增大触摸区域                                 | —                  |
| Agent 变更   | 内嵌 tab                  | 全屏 tab 切换 (Chat/Changes/Files)                     | —                  |
| 冲突解决     | 三路合并视图              | 冲突文件列表 + "在桌面端查看" 提示                     | 隐藏三路合并视图   |
| Git Graph    | SVG 分支拓扑图            | 线性提交列表 + 分支标签                                | 不渲染 SVG 拓扑图  |

---

## 技术风险与缓解

| 风险                              | 缓解措施                                                                                 |
| --------------------------------- | ---------------------------------------------------------------------------------------- |
| RPC 三跳延迟（WebUI→Gateway→CLI） | TanStack Query 缓存 (staleTime) + 骨架屏 + 乐观更新                                      |
| 大仓库 git 操作慢                 | CLI 侧始终带 `--max-count` 限制 + 分页加载                                               |
| E2EE 兼容性                       | Git 元数据不含对话内容，无需加密；消息搜索在客户端解密后执行                             |
| Bundle 大小增长                   | uFuzzy ~2KB；git graph 等高级组件 lazy import                                            |
| CLI 断连时 git 不可用             | 优雅降级 + "CLI 离线，Git 功能不可用" 提示                                               |
| 移动端虚拟键盘遮挡输入框         | `visualViewport` API 监听键盘高度，动态调整模态框底部 padding                            |
| 触屏误触（触摸目标过小）         | 所有可交互元素 min-h 44px（iOS HIG）/ 48dp（Material Design），符合 WCAG 2.5.8           |
| 移动端首屏加载慢                  | P2+ 功能 lazy import（`React.lazy`）；Git 面板按需加载，不计入首屏 bundle                |
| SafeArea 适配不完整               | 封装 `SafeAreaView` 组件统一处理 `env(safe-area-inset-*)`，覆盖 top/bottom/left/right    |

---

## 实施优先级

| 阶段   | 内容                                             | 工作量 | 价值 | 周期    |
| ------ | ------------------------------------------------ | ------ | ---- | ------- |
| **P0** | 基础设施（搜索引擎 ✅ + 快捷键 + Git RPC）       | 中     | 极高 | ~1 周   |
| **P1** | 核心搜索（命令面板 + 文件搜索 + 聊天搜索）       | 中     | 极高 | ~1 周   |
| **P2** | 核心 Git（提交历史 + staged 分离 + diff + 分支） | 大     | 高   | ~2 周   |
| **P3** | 高级功能（跨会话搜索 + blame + grep + stash）    | 大     | 中高 | ~2 周   |
| **P4** | 极限功能（Agent 变更视图 + 冲突助手 + graph）    | 大     | 中   | ~2-3 周 |

**建议启动顺序**: P0 → P1-A + P1-C (并行) → P1-B → P2-A → P2-B → P2-C → P2-D → P3 → P4
