# Phase 4: 生命周期、权限、E2EE 与恢复 - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-14T00:00:00Z
**Phase:** 4-生命周期、权限、E2EE 与恢复
**Areas discussed:** 取消语义, 重试语义, 归档边界, 权限聚合, 恢复与降级, E2EE/日志边界, UI 形态

---

## 取消语义

| Question | Options | Selected |
|----------|---------|----------|
| Team cancel 应该删除、停止还是解除 team coordination？ | 删除所有事实 / 停止 coordination 并取消运行成员 / 只标记 team cancelled | 停止 coordination 并取消运行成员 |
| 已完成成员在 cancel 后如何处理？ | 改成 cancelled / 保持 completed / 复制为 archived result | 保持 completed |
| 普通 session cancel 失败时怎么表达？ | team cancel 失败 / member degraded/detached / 忽略 | member degraded/detached |
| 用户应该看到什么取消结果？ | 只有 team status / per-member result / raw error dump | per-member result |

**Notes:** Cancel 不删除 ordinary session WAL，也不伪造底层取消成功。它要把 team coordination 和成员真实结果分开表达。

---

## 重试语义

| Question | Options | Selected |
|----------|---------|----------|
| Retry 范围是什么？ | 整个 team / failed/degraded members only / 任意成员重跑 | failed/degraded members only |
| Retry 是否复用原 sessionId？ | 复用 / 新 attempt + 新 session / 视 backend 决定 | 新 attempt + 新 session |
| 已成功成员是否重跑？ | 默认重跑 / 不重跑 / 用户逐个选择 | 不重跑 |
| Retry 是否引入 per-member worktree？ | 是 / 否 / 只对失败成员 | 否 |
| Retry prompt/context 是否可通过 Gateway 明文传输？ | 可以 / 不可以 / 只允许 summary | 不可以 |

**Notes:** Retry 是恢复失败成员，不是整队重新开始。旧 attempt/source refs 保留，以免丢失失败证据。

---

## 归档边界

| Question | Options | Selected |
|----------|---------|----------|
| Archive 删除哪些内容？ | 删除 team + sessions / 只归档 team metadata / 压缩历史 | 只归档 team metadata |
| Archived team 是否仍可访问历史？ | 不可访问 / 通过 filter/direct link 可访问 / 只读导出 | 通过 filter/direct link 可访问 |
| Archived team 是否允许继续运行操作？ | 允许 / 禁止 / 自动 unarchive | 禁止 |

**Notes:** Archive 是可见性和 lifecycle 语义，不是数据清理。成员 WAL、mailbox、task history 和 source refs 必须保留。

---

## 权限聚合

| Question | Options | Selected |
|----------|---------|----------|
| Team detail 是否直接批准权限？ | approve all / 逐项 approve / 只聚合并跳转 | 只聚合并跳转 |
| 权限正文属于谁？ | Team projection / Gateway route / ordinary session | ordinary session |
| 聚合字段应该包含什么？ | 完整权限请求 / metadata/count/jump refs / 只有红点 | metadata/count/jump refs |
| Team cancel 后 pending permission 如何显示？ | 隐藏 / 保留并标注 lifecycle / 自动拒绝 | 保留并标注 lifecycle |

**Notes:** 批量自动授权风险太高。Phase 4 只提供聚合可见性和跳转，实际决策仍复用 ordinary session 权限 UI。

---

## 恢复与降级

| Question | Options | Selected |
|----------|---------|----------|
| Gateway 重启后谁恢复 team truth？ | Gateway durable store / CLI snapshot / WebUI cache | CLI snapshot |
| WebUI persisted team-store 能否作为 truth？ | 能 / 不能 / 离线时能 | 不能 |
| CLI 重连时遇到 missing session/worktree 怎么办？ | 删除 member / degraded projection / 自动重建 | degraded projection |
| Recovery 是否自动重启 agents 或重发目标？ | 是 / 否 / 只重启 leader | 否 |
| mailbox wake read 标记何时发生？ | 接收消息时 / 注入成功后 / 查看 team detail 后 | 注入成功后 |

**Notes:** 恢复优先可解释和安全，不做隐式重新执行。Carry-forward 的 mailbox wake read-before-injection 问题纳入 Phase 4。

---

## E2EE 与日志边界

| Question | Options | Selected |
|----------|---------|----------|
| Lifecycle routes 是否可携带明文 target/retry prompt？ | 可以 / 不可以 / 仅 retry 可以 | 不可以 |
| Summary v1 的 Gateway-facing 内容是什么？ | summary body / metadata + source refs / encrypted blob passthrough | metadata + source refs |
| 日志安全主要在哪些层处理？ | 只在 Gateway / route + projection + error serialization / 只靠字段名 denylist | route + projection + error serialization |
| 新 route ownership 如何校验？ | teamRunId 即可 / user+machine+team+session 绑定 / CLI 自行校验即可 | user+machine+team+session 绑定 |

**Notes:** Phase 4 明确把新增 lifecycle/summary 操作纳入已有 E2EE 边界，避免在 error/log payload 中间接泄露正文。

---

## UI 形态

| Question | Options | Selected |
|----------|---------|----------|
| Phase 4 是否扩展成 rich team page？ | 是 / 否，继续 overview+jump / 混合 | 否，继续 overview+jump |
| 最小新增控制有哪些？ | cancel/retry/archive/permissions / 全部 lifecycle matrix / 仅按钮 | cancel/retry/archive/permissions |
| 按钮不可用时怎么处理？ | 隐藏 / 禁用并解释 / 允许点击后报错 | 禁用并解释 |
| UI-07 是否本阶段完整交付？ | 是 / 否，留 Phase 5 / 只移动端 | 否，留 Phase 5 |

**Notes:** Phase 4 重在状态与安全语义，不扩大为完整 UI polish 阶段。

---

## the agent's Discretion

- 具体 enum、RPC path、attempt schema、summary schema 和组件拆分留给 planning/implementation agents。
- 若计划过大，优先拆成 lifecycle contract、CLI operation truth、Gateway route/security、WebUI controls/recovery verification 的垂直切片。
- 保持所有 Agent Team projection metadata-only，正文和 agent output 继续留在 ordinary session/E2EE/CLI-local 边界内。

## Deferred Ideas

- UI 规模化和完整移动端 polish。
- per-member worktree isolation。
- 自动 summary agent。
- approve-all permissions。
- 自动代码合并、跨 machine team、多用户协作。
