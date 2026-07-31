# Phase 3: 最小端到端 Team Run - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-14T02:58:47Z
**Phase:** 3-最小端到端 Team Run
**Areas discussed:** 目标投递路径, 成员创建确认, 工作区策略, 详情页形态

---

## 目标投递路径

| Question | Options | Selected |
|----------|---------|----------|
| Phase 3 的创建流程应该如何处理用户目标任务？ | 创建并启动 / 先建后发 / 预览再启动 | 创建并启动 |
| 创建并启动时，WebUI 什么时候算创建成功？ | 目标已投递 / session 已创建 / metadata 已创建 | 目标已投递 |
| 创建表单里的 team title 和目标任务应该是什么关系？ | 目标生成标题 / 标题必填 / 只有标题 | 目标生成标题 |
| 目标任务投递后，Team detail 中应该如何展示目标正文？ | 只跳转查看 / 本地临时显示 / 展示加密卡片 | 只跳转查看 |

**Notes:** 用户选择创建即启动，并且目标已投递才算创建成功。目标正文不进入 team projection；通过 ordinary leader session 查看完整上下文。

---

## 成员创建确认

| Question | Options | Selected |
|----------|---------|----------|
| leader/member 通过 team tool 请求 spawn member 后，Phase 3 应该怎么执行？ | 确认后创建 / 自动创建 / 只记录请求 | 自动创建 |
| 既然选择自动创建，哪些 caller 可以触发自动 spawn？ | leader only / 任何成员 / leader 优先 | 任何成员 |
| 自动 spawn 时，如果 tool 参数没有明确 backend/worktree，默认怎么补齐？ | 继承 leader / 使用首选 backend / 缺失则失败 | 继承 leader |
| 自动创建 member 失败时，Team projection 应该留下什么？ | 失败成员槽 / 只留 intent 错误 / 自动回滚隐藏 | 失败成员槽 |

**Notes:** 用户不希望 Phase 3 加 WebUI 确认门；任何成员都可以触发自动 spawn，但仍需结构校验和 backend capability 校验。

---

## 工作区策略

| Question | Options | Selected |
|----------|---------|----------|
| 按纠正后的定义，Phase 3 的 worktree 行为应该怎么锁定？ | team 共享 worktree / 直接用当前 checkout / 每成员独立 worktree | team 共享 worktree |
| 创建 team 共享 worktree 时，UI 应该让用户输入/选择哪些内容？ | 自动分支名 / 可编辑分支名 / 选择已有 worktree | 复用现有普通 session 创建 worktree 的交互和参数 |
| Team 创建表单里，worktree 选项默认应该是什么状态？ | 默认开启 / 默认关闭 / 记住上次选择 | 默认关闭 |
| 如果 team 共享 worktree 创建失败，Phase 3 应该怎么处理？ | 创建失败 / 询问降级 / 自动降级 | 创建失败 |

**Notes:** 用户纠正了 workspace/worktree 概念：workspace 是逻辑 Git 项目/仓库上下文；worktree 是同一个 workspace 的不同 checkout/执行目录。开启 worktree 时，leader 和所有 members 共享同一个新 team worktree。

---

## 详情页形态

| Question | Options | Selected |
|----------|---------|----------|
| Phase 3 的 Team detail 主视图应该采用哪种形态？ | overview + 跳转 / AionUI 多列聊天 / 混合模式 | overview + 跳转 |
| Agent Team 在左侧导航里应该怎么出现？ | 独立 Team 区 / Workspace 内分组 / 只在详情路由 | workspace 内 session 列表父项，二级展开 members |
| 这个 workspace 内的 Agent Team 条目，默认展开还是折叠？ | 默认折叠 / 活跃时展开 / 默认展开 | 默认展开 |
| 点击展开后的 member 子项应该做什么？ | 跳 ordinary session / 打开 team detail / 二级菜单选择 | 跳 ordinary session |
| Team overview/detail 里 Phase 3 必须显示哪些非内容信息？ | 核心投影 / 极简投影 / 丰富投影 | 极简投影 |
| 在不扩大 UI 的前提下，task/mailbox projection 放在哪里最合适？ | team row 小徽标 / overview 一行 counts / 成员卡片小 counts | team row 小徽标 |

**Notes:** 用户不想要单独 Team 区。Agent Team 在 workspace session 列表内作为可展开父项出现，member 子项跳到 ordinary session。

---

## the agent's Discretion

- Exact module names, route payload split, and projection field naming are left to downstream research/planning.
- Downstream agents may decide whether to amend `TeamWorkspaceMode` or add separate team-level execution checkout metadata, as long as workspace/worktree semantics remain correct.

## Deferred Ideas

- Per-member worktrees.
- Rich AionUI-style multi-column team chat.
- Cancel/retry/archive, permission aggregation, recovery, automatic summary, and UI polish.
