# Roadmap: Mobvibe Agent Team

## Overview

Mobvibe Agent Team v1 以“用户配置的编排式 team run”为核心：先锁定 shared 协议、状态模型与 CLI 本地持久化边界，再交付从 WebUI 创建到 Gateway 路由、CLI 展开普通 ACP session 的最小闭环；随后补齐取消、重试、归档、部分失败和恢复语义，最后加固权限/E2EE 边界并完成移动端与规模化 UI polish。所有成员 session 继续复用既有 WAL、E2EE、权限、worktree、文件/Git 和路由能力，Gateway 不成为明文内容或 durable truth 的拥有者。

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: 协议、状态模型与持久化边界** - 用户拥有可恢复的 team run/member 元数据模型，但还不启动 agent。
- [ ] **Phase 2: 最小端到端 Team Run** - 用户可以从 WebUI 创建 team run，并看到成员普通 session 被创建和可跳转。
- [ ] **Phase 3: 生命周期、部分失败与恢复** - 用户可以安全取消、重试、归档，并在重连后恢复 team 状态。
- [ ] **Phase 4: 权限与 E2EE 加固** - 用户可以在多成员运行中清楚处理权限等待，且内容边界不被破坏。
- [ ] **Phase 5: UI 规模化与 v1 Polish** - 用户可以在桌面和移动端完成 v1 关键 team 流程。

## Phase Details

### Phase 1: 协议、状态模型与持久化边界
**Goal**: 用户拥有稳定、可恢复、跨 WebUI/Gateway/CLI 一致理解的 team run 与 member 元数据基础
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: TEAM-01, TEAM-02, TEAM-03, TEAM-04, LIFE-01
**Success Criteria** (what must be TRUE):
  1. 用户可以看到一个稳定的 team run 对象，其 ID、标题、目标、machine、workspace、执行模式、状态和时间戳在刷新后保持一致。
  2. 用户可以为同一个 team run 保存至少两个成员，并看到每个成员的 backend、角色、顺序、worktree 策略和状态。
  3. CLI 重启后，用户仍能列出既有 team run、成员配置和 member-to-session 映射占位信息。
  4. WebUI、Gateway 和 CLI 对 team 状态、错误结构和 RPC payload 的展示/传递保持一致，不出现字段漂移。
  5. 用户能看到 team run 和 member 的明确状态，而不是无法解释的空状态或隐式布尔值。
**Plans**: TBD
**UI hint**: no

### Phase 2: 最小端到端 Team Run
**Goal**: 用户可以创建一个 parallel 或基础 sequential team run，并把每个成员展开为可跳转的普通 ACP session
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: ORCH-01, ORCH-02, ORCH-03, ORCH-04, ORCH-05, ORCH-06, UI-01, UI-02, UI-03, UI-04
**Success Criteria** (what must be TRUE):
  1. 用户可以在 WebUI 选择 machine、workspace、执行模式、成员 backend、角色和 worktree 策略来创建 team run。
  2. 用户创建 parallel team run 后，可以看到每个成员绑定一个普通 ACP session，并能跳转到原 session 继续聊天、文件、Git 和权限流程。
  3. 用户创建 sequential team run 后，可以观察到成员按线性顺序启动，而不是全部同时运行。
  4. 用户能在 team detail 中看到成员 backend、角色、状态、session 链接、worktree branch、错误和最后更新时间。
  5. 当某个 backend 不存在或能力不足时，用户能看到成员级错误；其他可运行成员不因静默失败而失去可见性。
**Plans**: TBD
**UI hint**: yes

### Phase 3: 生命周期、部分失败与恢复
**Goal**: 用户可以控制运行中的 team run，并在失败、取消、归档、刷新和重连后仍理解每个成员的结果
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: LIFE-02, LIFE-03, LIFE-04, LIFE-05, LIFE-06
**Success Criteria** (what must be TRUE):
  1. 用户取消运行中的 team run 后，所有正在运行的成员都会进入对应取消结果，底层普通 session 不继续无提示运行。
  2. 用户可以只重试失败成员，并看到重试产生新的 member attempt/session，而已成功成员保持成功结果。
  3. 用户归档 team run 后，team metadata 默认被隐藏或标记归档，但成员 session 历史和 WAL 仍可访问。
  4. 当 team run 出现部分失败时，用户可以清楚分辨哪些成员成功、失败、取消或等待权限。
  5. WebUI 刷新、Gateway 重启或 CLI 重连后，用户仍能恢复 team run 列表、成员状态和 member-to-session 映射。
**Plans**: TBD
**UI hint**: no

### Phase 4: 权限与 E2EE 加固
**Goal**: 用户在多成员 team run 中安全处理权限和 summary，且 Gateway 始终只路由非敏感元数据
**Mode:** mvp
**Depends on**: Phase 3
**Requirements**: UI-05, SEC-01, SEC-02, SEC-03, SEC-04
**Success Criteria** (what must be TRUE):
  1. 用户只能访问属于自己的 machine、team 和 member session；未授权请求会被拒绝而不是转发。
  2. 用户可以在 team detail 中看到哪些成员正在等待权限，并跳转到对应普通 session 完成权限决策。
  3. Gateway 日志、路由和持久化内容中不会出现 provider token、master secret、DEK、明文 prompt、agent 输出或明文 summary。
  4. 用户可以编辑结构化 team summary，并通过 source refs 跳回成员 session 原始上下文。
  5. 如果自动 summary 会破坏 E2EE 边界，用户只能使用手动/可信域 summary，而不会得到不安全的自动总结入口。
**Plans**: TBD
**UI hint**: yes

### Phase 5: UI 规模化与 v1 Polish
**Goal**: 用户可以在桌面和移动端稳定完成 team 创建、观察、跳转、取消、重试和归档的基本流程
**Mode:** mvp
**Depends on**: Phase 4
**Requirements**: UI-06
**Success Criteria** (what must be TRUE):
  1. 用户在桌面端可以完成创建、观察、跳转、取消、重试和归档 team run 的完整 v1 流程。
  2. 用户在移动端可以完成同一组基本流程，关键操作不依赖桌面专用布局。
  3. 用户查看多个成员的 team detail 时，页面优先展示状态、错误、权限和跳转入口，不被重型文件/Git 请求阻塞。
  4. 用户可以在 team run 列表或分组视图中区分普通 session 与 team run，而不会迷失当前上下文。
**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. 协议、状态模型与持久化边界 | 0/TBD | Not started | - |
| 2. 最小端到端 Team Run | 0/TBD | Not started | - |
| 3. 生命周期、部分失败与恢复 | 0/TBD | Not started | - |
| 4. 权限与 E2EE 加固 | 0/TBD | Not started | - |
| 5. UI 规模化与 v1 Polish | 0/TBD | Not started | - |

## Requirement Coverage

| Requirement | Phase |
|-------------|-------|
| TEAM-01 | Phase 1 |
| TEAM-02 | Phase 1 |
| TEAM-03 | Phase 1 |
| TEAM-04 | Phase 1 |
| ORCH-01 | Phase 2 |
| ORCH-02 | Phase 2 |
| ORCH-03 | Phase 2 |
| ORCH-04 | Phase 2 |
| ORCH-05 | Phase 2 |
| ORCH-06 | Phase 2 |
| LIFE-01 | Phase 1 |
| LIFE-02 | Phase 3 |
| LIFE-03 | Phase 3 |
| LIFE-04 | Phase 3 |
| LIFE-05 | Phase 3 |
| LIFE-06 | Phase 3 |
| UI-01 | Phase 2 |
| UI-02 | Phase 2 |
| UI-03 | Phase 2 |
| UI-04 | Phase 2 |
| UI-05 | Phase 4 |
| UI-06 | Phase 5 |
| SEC-01 | Phase 4 |
| SEC-02 | Phase 4 |
| SEC-03 | Phase 4 |
| SEC-04 | Phase 4 |

**Coverage:** 26/26 v1 requirements mapped exactly once.
