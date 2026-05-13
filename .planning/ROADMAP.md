# Roadmap: Mobvibe Agent Team

## Overview

Mobvibe Agent Team v1 以“CLI-hosted team MCP server + durable mailbox + task board + ordinary ACP leader/member sessions”为核心。Team tools 优先通过 ACP 官方 MCP-over-ACP per-session transport 注入：只有 team `session/new` 声明 `mobvibe-team` MCP server，普通 agent session 不声明该 server，因此普通 agent 使用路径不变。对没有 native MCP-over-ACP 的 backend，只允许使用仅作用于该 team session 的 bridge，不修改全局 agent MCP 配置。

路线图先锁定 shared 协议、状态模型、CLI durable store 和内容边界；再实现 CLI 本地 MCP/mailbox/task 协作闭环；随后交付 WebUI → Gateway → CLI → leader/member ordinary ACP session 的端到端 team run；最后补齐生命周期、权限、E2EE、恢复和 UI polish。Gateway 始终只做认证、授权、RPC 路由和非内容 metadata 转发，不成为明文内容或 durable truth 的拥有者。

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: 协议、状态模型与持久化边界** - 用户拥有可恢复的 team/member/MCP/mailbox/task 元数据模型，但还不启动 agent。
- [ ] **Phase 2: CLI Team MCP、Mailbox 与 Task Board** - CLI 本地具备 per-session team tools、durable mailbox 和 durable task board 的协作闭环。
- [ ] **Phase 3: 最小端到端 Team Run** - 用户可以从 WebUI 创建 team run，leader/member 普通 ACP session 被创建、注入 MCP 并可跳转。
- [ ] **Phase 4: 生命周期、权限、E2EE 与恢复** - 用户可以安全取消、重试、归档、处理权限，并在重连后恢复 team 状态。
- [ ] **Phase 5: UI 规模化与 v1 Polish** - 用户可以在桌面和移动端完成 v1 关键 team 流程。

## Phase Details

### Phase 1: 协议、状态模型与持久化边界
**Goal**: 用户拥有稳定、可恢复、跨 WebUI/Gateway/CLI 一致理解的 team、member、MCP readiness、mailbox 和 task board 元数据基础
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: TEAM-01, TEAM-02, TEAM-03, TEAM-04, TEAM-05, LIFE-01
**Success Criteria** (what must be TRUE):
  1. 用户可以看到一个稳定的 team run 对象，其 ID、标题、machine、workspace、leader、状态和时间戳在刷新后保持一致。
  2. 用户可以看到 leader/member 的 backend、role、sessionId 关联占位、MCP phase、worktree 策略和状态字段。
  3. CLI 重启后，team run、member 映射、MCP readiness、mailbox/task metadata 和 summary refs 可以从 durable store 恢复。
  4. WebUI、Gateway 和 CLI 对 team/MCP/mailbox/task 状态、错误结构和 RPC payload 的传递保持一致，不出现字段漂移。
  5. Gateway-facing 字段与 CLI-local/encrypted/source-ref 内容边界被类型化，避免后续误把 prompt、mailbox、task 或 summary 正文放进 Gateway payload。
**Plans**: 5 plans
Plans:
- [x] 01-01-PLAN.md — Shared Agent Team contract and typed RPC/event payloads
- [x] 01-02-PLAN.md — CLI durable Agent Team store and base non-content projection
- [x] 01-03-PLAN.md — Gateway `/acp/agent-teams` routes, typed CLI RPC, and user-scoped projection relay
- [x] 01-04-PLAN.md — CLI mailbox/task/MCP/summary metadata recovery and non-content projection hardening
- [x] 01-05-PLAN.md — WebUI API/store/socket projection boundary and Chinese implementation documentation
**UI hint**: no

### Phase 2: CLI Team MCP、Mailbox 与 Task Board
**Goal**: CLI 本地可以为 team session 提供 `mobvibe_team_*` tools，并把 agent 间消息和任务板持久化为可恢复事实
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: MCP-01, MCP-02, MCP-03, MCP-04, MCP-05, MCP-06, MCP-07, COORD-01, COORD-02, COORD-03, COORD-04
**Success Criteria** (what must be TRUE):
  1. CLI 可以为 team run 启动 team MCP server，并生成 MCP-over-ACP per-session declaration 或安全 per-session bridge config。
  2. 普通非 team session 的 create path 不包含 `mobvibe-team` MCP server declaration，也不会修改 agent 全局 MCP 配置。
  3. Backend 不支持 native MCP-over-ACP 且无法安全 bridge 时，用户会得到 team-capable validation error，而不是创建一个不可协作成员。
  4. Agent tool call 可以写入 durable mailbox；message 持久化、read/unread 和 wake status 被分开记录。
  5. Agent tool call 可以创建、列出和更新 durable task board，包含 owner、status 和 blockedBy/blocks。
  6. Team MCP tools 携带 caller identity，并按 leader-only、用户确认和 workspace policy 执行。
**Plans**: 6 plans
Plans:
- [x] 02-01-PLAN.md — SDK/capability foundation and narrow MCP-over-ACP adapter boundary
- [ ] 02-02-PLAN.md — Team MCP runtime, per-session injection, caller binding, and tools readiness
- [ ] 02-03-PLAN.md — Durable mailbox `send_message` tool path and projection-safe delivery metadata
- [ ] 02-04-PLAN.md — Mailbox wake/injection semantics and idle notification guard
- [ ] 02-05-PLAN.md — Durable task board tools and dependency mutation
- [ ] 02-06-PLAN.md — Per-session bridge fallback or explicit team-capable validation error
**UI hint**: no

### Phase 3: 最小端到端 Team Run
**Goal**: 用户可以创建一个 leader-driven team run，并看到 leader/member 普通 ACP session、MCP readiness、task/mailbox projection 和 session 跳转
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: ORCH-01, ORCH-02, ORCH-03, ORCH-04, ORCH-05, ORCH-06, UI-01, UI-02, UI-03, UI-04, UI-05
**Success Criteria** (what must be TRUE):
  1. 用户可以在 WebUI 选择 machine、workspace、leader backend、目标任务和 workspace/worktree 策略来创建 team run。
  2. Gateway 认证并把创建请求路由到目标 CLI，且不需要解密或存储目标任务明文。
  3. CLI 创建 leader 普通 ACP session，注入 team MCP server，并在 MCP ready 后把用户目标交给 leader。
  4. Leader 可以通过 team tools 创建任务、发送 mailbox message，并在确认后 spawn 一个普通 member ACP session。
  5. Team detail 展示 leader/member、MCP phase、task/mailbox 非内容 projection、session 链接、worktree branch、错误和最后更新时间。
  6. 用户可以从 team detail 跳转到任意成员普通 session，继续使用现有聊天、文件、Git 和权限 UI。
**Plans**: TBD
**UI hint**: yes

### Phase 4: 生命周期、权限、E2EE 与恢复
**Goal**: 用户可以控制运行中的 team run，并在失败、取消、归档、权限等待、刷新和重连后仍理解每个成员的结果与安全边界
**Mode:** mvp
**Depends on**: Phase 3
**Requirements**: LIFE-02, LIFE-03, LIFE-04, LIFE-05, LIFE-06, UI-06, SEC-01, SEC-02, SEC-03, SEC-04
**Success Criteria** (what must be TRUE):
  1. 用户取消运行中的 team run 后，running members、MCP server/bridge、pending wake、pending permission 和普通 session cancel 都有 per-member 结果。
  2. 用户可以只重试 failed/degraded member，并看到重试产生新的 attempt/session 和新的 MCP readiness，而已成功成员保持成功结果。
  3. 用户归档 team run 后，team metadata 默认隐藏或标记归档，但成员 session WAL、mailbox 和 task history 仍可访问。
  4. 用户可以在 team detail 中看到哪些成员正在等待权限，并跳转到对应普通 session 完成权限决策。
  5. WebUI 刷新、Gateway 重启或 CLI 重连后，team run、成员状态、MCP phase、mailbox/task counts 和 member-to-session 映射可以恢复或显示 degraded。
  6. Gateway 日志、路由和持久化内容中不会出现 provider token、master secret、DEK、明文 prompt、mailbox、task、summary 或 agent 输出。
  7. 用户可以编辑结构化 team summary，并通过 source refs 跳回成员 session、mailbox message 或 task。
**Plans**: TBD
**UI hint**: yes

### Phase 5: UI 规模化与 v1 Polish
**Goal**: 用户可以在桌面和移动端稳定完成 team 创建、观察、跳转、取消、重试和归档的基本流程
**Mode:** mvp
**Depends on**: Phase 4
**Requirements**: UI-07
**Success Criteria** (what must be TRUE):
  1. 用户在桌面端可以完成创建、观察、跳转、取消、重试和归档 team run 的完整 v1 流程。
  2. 用户在移动端可以完成同一组基本流程，关键操作不依赖桌面专用布局。
  3. 用户查看多个成员的 team detail 时，页面优先展示状态、MCP phase、task/mailbox projection、错误、权限和跳转入口，不被重型文件/Git 请求阻塞。
  4. 用户可以在 team run 列表或分组视图中区分普通 session 与 team run，而不会迷失当前上下文。
**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. 协议、状态模型与持久化边界 | 5/5 | Completed | 2026-05-13 |
| 2. CLI Team MCP、Mailbox 与 Task Board | 0/TBD | Not started | - |
| 3. 最小端到端 Team Run | 0/TBD | Not started | - |
| 4. 生命周期、权限、E2EE 与恢复 | 0/TBD | Not started | - |
| 5. UI 规模化与 v1 Polish | 0/TBD | Not started | - |

## Requirement Coverage

| Requirement | Phase |
|-------------|-------|
| TEAM-01 | Phase 1 |
| TEAM-02 | Phase 1 |
| TEAM-03 | Phase 1 |
| TEAM-04 | Phase 1 |
| TEAM-05 | Phase 1 |
| MCP-01 | Phase 2 |
| MCP-02 | Phase 2 |
| MCP-03 | Phase 2 |
| MCP-04 | Phase 2 |
| MCP-05 | Phase 2 |
| MCP-06 | Phase 2 |
| MCP-07 | Phase 2 |
| COORD-01 | Phase 2 |
| COORD-02 | Phase 2 |
| COORD-03 | Phase 2 |
| COORD-04 | Phase 2 |
| ORCH-01 | Phase 3 |
| ORCH-02 | Phase 3 |
| ORCH-03 | Phase 3 |
| ORCH-04 | Phase 3 |
| ORCH-05 | Phase 3 |
| ORCH-06 | Phase 3 |
| LIFE-01 | Phase 1 |
| LIFE-02 | Phase 4 |
| LIFE-03 | Phase 4 |
| LIFE-04 | Phase 4 |
| LIFE-05 | Phase 4 |
| LIFE-06 | Phase 4 |
| UI-01 | Phase 3 |
| UI-02 | Phase 3 |
| UI-03 | Phase 3 |
| UI-04 | Phase 3 |
| UI-05 | Phase 3 |
| UI-06 | Phase 4 |
| UI-07 | Phase 5 |
| SEC-01 | Phase 4 |
| SEC-02 | Phase 4 |
| SEC-03 | Phase 4 |
| SEC-04 | Phase 4 |

**Coverage:** 39/39 v1 requirements mapped exactly once.
