---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: ready_to_plan
stopped_at: Phase 03 verified and marked complete
last_updated: "2026-05-14T06:48:30Z"
last_activity: 2026-05-14
progress:
  total_phases: 5
  completed_phases: 3
  total_plans: 17
  completed_plans: 17
  percent: 60
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-14)

**Core value:** 用户可以在一个 Mobvibe 团队任务中安全地协调多个不同 ACP agent，让它们围绕同一代码目标协作，并清楚看到每个 agent 的进展、任务、消息、产出和最终汇总。
**Current focus:** Phase 4 — 生命周期、权限、E2EE 与恢复

## Current Position

Phase: 4
Plan: Not started
Status: Ready to plan
Last activity: 2026-05-14

Progress: [██████░░░░] 60%

## Performance Metrics

**Velocity:**

- Total plans completed: 17
- Average duration: 12 min
- Total execution time: 2.1 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1. 协议、状态模型与持久化边界 | 5 | 41 min | 8 min |
| 2. CLI Team MCP、Mailbox 与 Task Board | 7 | 67 min | 10 min |
| 3. 最小端到端 Team Run | 5 | 154 min | 31 min |
| 4. 生命周期、权限、E2EE 与恢复 | 0 | TBD | N/A |
| 5. UI 规模化与 v1 Polish | 0 | TBD | N/A |

**Recent Trend:**

- Last 5 plans: 01-05 (10 min), 02-01 (9 min), 02-02 (35 min), 02-03 (14 min), 02-06 (9 min)
- Trend: variable due to deeper CLI MCP runtime and mailbox implementation plans

| Phase 01 P04 | 5 min | 3 tasks | 4 files |
| Phase 01 P05 | 10 min | 3 tasks | 8 files |
| Phase 02 P01 | 9 min | 2 tasks | 6 files |
| Phase 02 P02 | 35 min | 2 tasks | 9 files |
| Phase 02 P03 | 14 min | 2 tasks | 8 files |
| Phase 02 P06 | 9 min | 2 tasks | 7 files |
| Phase 02 P04 | 12 min | 2 tasks | 6 files |
| Phase 03-team-run P01 | 8 min | 3 tasks | 7 files |
| Phase 03-team-run P02 | 17 min | 4 tasks | 6 files |
| Phase 03-team-run P05 | 24min | 4 tasks | 12 files |

## Accumulated Context

### Decisions

决策记录在 PROJECT.md 的 Key Decisions 表和当前 phase context 文档中。
Recent decisions affecting current work:

- [Roadmap]: v1 按 research 推荐使用 5 个 coarse MVP phase。
- [Roadmap]: Team member 继续展开为普通 ACP session；team coordination 由 CLI-hosted team MCP server、durable mailbox 和 task board 提供。
- [Roadmap]: ACP MCP-over-ACP RFD 是首选隔离机制；team tools 只注入 team session，普通 session 不受影响。
- [Roadmap]: Phase 1 优先锁定 shared 类型、状态模型、CLI durable owner、MCP readiness、mailbox/task 和内容边界。
- [Phase 1]: 产品语言锁定为 Agent Team；每个 leader/member 都是一等 ordinary ACP session。
- [Phase 1]: WebUI 按 AionUI 方向展示：Agent Team 是独立一级对象，team-owned member sessions 默认从普通 session 列表隐藏或折叠。
- [Phase 1]: Gateway 采用混合方案：对 WebUI暴露 `/acp/agent-teams`，内部只转发 typed CLI RPC，不持久化 Agent Team truth。
- [Phase 1]: Gateway-facing team projection 不携带 mailbox/task/summary 正文；CLI-local store 可以保存协作正文。
- [Phase 1]: lifecycle 不使用 `idle`/`ready`；MCP readiness、permission waiting、activity counts 和 health 独立表达。
- [Phase 1]: source refs 是强类型定位引用，不承载正文；优先跳转到 member ordinary session history。
- [Phase 1]: CLI SQLite 当前事实表是 team durable truth；Gateway 只做 presence 与 snapshot 转发。
- [Phase 01-01]: Shared Agent Team contract now defines projection, source refs, MCP capability discovery, typed create/list/get RPC payloads, and `agent-teams:changed` events.
- [Phase 01-02]: Agent Team durable truth reuses the existing CLI WAL SQLite database and schema_version migration path.
- [Phase 01-02]: Phase 1 creates only leader metadata and MCP readiness defaults; it does not create an ordinary ACP session.
- [Phase 01-02]: Gateway-facing Agent Team results are rebuilt projections and asserted against forbidden plaintext/secret keys before return.
- [Phase 01-03]: Gateway exposes Agent Team create/list/get as authenticated metadata routes but remains a router, not a durable truth owner.
- [Phase 01-03]: Agent Team typed RPC responses are delivered to both SessionRouter and TeamRouter; each router consumes only matching pending requestIds.
- [Phase 01-03]: Gateway rejects forbidden plaintext and secret-like keys recursively at the route boundary before CLI forwarding.
- [Phase 01-03]: CLI `agent-teams:changed` projection events are relayed only to the owning `record.userId`, never globally.
- [Phase 01-04]: Lifecycle strings are validated at projection time — Persisted idle/ready values are rejected before reaching Gateway-facing summaries.
- [Phase 01-04]: Dependency metadata contributes to blocked task count — Task blocked count includes explicit blocked status and non-empty blocked_by_json dependency metadata.
- [Phase 01-04]: Source refs are metadata-only — Mailbox/task/summary source refs are projected as typed metadata only; body_local_json remains CLI-local.
- [Phase 01-05]: WebUI createAgentTeam allowlists metadata fields instead of serializing caller objects wholesale.
- [Phase 01-05]: WebUI Agent Team projection state lives in `team-store.ts`, separate from ordinary session transcript state.
- [Phase 01-05]: Persisted WebUI Agent Team state includes projections, active id, and last sync timestamp only; runtime appError and content/secret-like keys are excluded.
- [Phase 02]: [Phase 02-01]: ACP SDK 0.21.x still lacks generated MCP-over-ACP acp schema, so Mobvibe keeps RFD-only declarations behind team-capability.ts. — Plan execution verified SDK schema after upgrade and localized RFD-only declarations.
- [Phase 02]: [Phase 02-01]: Team MCP capability resolution prefers native mcp.acp and only allows stdio bridge when perSessionBridge is true. — This enforces MCP-04/MCP-05 safe bridge eligibility before autonomous team tools are exposed.
- [Phase 02]: [Phase 02-02]: Team MCP caller identity is bound from per-member ACP server ids and tool arguments cannot override it. — Transport-derived caller binding prevents agent-controlled fromMemberId/memberId args from spoofing identity.
- [Phase 02]: [Phase 02-02]: tools_ready requires all five expected mobvibe_team_* tools from list-tools; mcp/connect alone only reaches tools_waiting. — This preserves MCP readiness as a verified tools-list state instead of a connection-only state.
- [Phase 02]: [Phase 02-02]: spawn/rename/shutdown remain CLI-local durable request facts in Phase 2 and do not execute session lifecycle side effects. — Full member orchestration and lifecycle execution stay deferred to Phase 3/4 boundaries.
- [Phase 02-03]: Mailbox delivery success is the durable SQLite row; wake metadata starts as pending and remains separate for Plan 02-04.
- [Phase 02-03]: mobvibe_team_send_message sender identity comes only from TeamMcpRouter caller binding; fromMemberId args are ignored.
- [Phase 02-03]: Gateway-facing Agent Team projections receive mailbox counts/source refs only, never mailbox plaintext or body_local_json.
- [Phase 02-06]: Bridge fallback is represented as a per-session stdio declaration, not as global agent MCP configuration.
- [Phase 02-06]: Team session creation now uses native ACP first and safe stdio bridge second; unsupported backends still fail before ACP session creation.
- [Phase 02-06]: Bridge readiness uses the same tool-list gate as native ACP and records transport stdio_bridge when fallback is active.
- [Phase 02-04]: Wake success and failure are durable metadata updates on accepted mailbox rows, not part of delivery acceptance.
- [Phase 02-04]: Mailbox plaintext enters recipient visibility only via ordinary ACP session prompt/WAL semantics, never via Agent Team projection.
- [Phase 02-04]: Member completion sends idle_notification to the leader, but leader wake waits until all non-leader members are not running.
- [Phase 02-07]: Production ACP MCP callbacks now enter the SessionManager-owned TeamRuntime through AcpConnection extension method routing.
- [Phase 02-07]: stdio_bridge is rejected until a real executable MCP stdio server exists; native MCP-over-ACP is required for team sessions in the current implementation.
- [Phase 02-07]: Callback-path tests prove mailbox/task tools mutate durable AgentTeamStore facts while projection payloads remain plaintext-safe.
- [Phase 03-team-run]: Agent Team create contract reuses ordinary session worktree metadata instead of introducing team-only worktree field names. — This preserves Phase 3 team-shared worktree semantics and avoids contract drift with ordinary session creation.
- [Phase 03-team-run]: Target/plaintext delivery remains outside /acp/agent-teams; WebUI createAgentTeam serializes only metadata and nested worktree options. — This preserves the existing E2EE boundary: target delivery must use the ordinary encrypted message path.
- [Phase 03-02]: SessionManager owns Agent Team create/start orchestration so durable store updates, ordinary session events, and Team MCP callbacks share one source of truth.
- [Phase 03-02]: Team-shared worktree keeps workspaceRootCwd/worktreeSourceCwd pointed at the source repo root while cwd points at the execution checkout.
- [Phase 03-02]: Team create failures use existing shared ErrorCode values while preserving safe failure metadata on the leader member projection.
- [Phase 03-03]: `mobvibe_team_spawn_member` 只接受 metadata-only `name`/`backendId` 参数；caller identity 来自 MCP server 绑定，不能由 tool args 覆盖。
- [Phase 03-03]: Spawned member 在 Phase 3 复用 leader/team shared checkout；per-member worktree isolation 延后，不作为当前阶段语义。
- [Phase 03-04]: Agent Team target/plaintext 不进入 `/acp/agent-teams`；WebUI 先创建 metadata-only team/leader，再通过 ordinary session E2EE `sendMessage()` 投递 target。
- [Phase 03-05]: Agent Team sidebar 使用独立 SidebarSessionListEntry 派生模型，不把 team 伪装成普通 ChatSession。
- [Phase 03-05]: Team parent 与 ordinary session selection 互斥；member jump 复用普通 session activation path。
- [Phase 03-05]: AgentTeamOverview 只展示 projection metadata/counts/safe errors，不展示协作正文或 agent output。

### Pending Todos

- Phase 3 已验证完成；下一步规划 Phase 4 生命周期、权限、E2EE 与恢复。

### Blockers/Concerns

- No blocking gaps. Phase 02 verification passed 6/6 after 02-07 gap closure.
- Non-blocking warning carried forward: mailbox wake retry semantics still mark rows read before successful injection; address in a later reliability slice.
- Phase 3 verification passed 6/6. Non-blocking carry-forward: create succeeds but encrypted target send fails cleanup/retry belongs to Phase 4 lifecycle/recovery.
- Codebase drift gate returned warn-only structural drift; run `/gsd-map-codebase --paths .codex,.dockerignore,.gitattributes,.gitignore,.npmrc,AGENTS.md,CLAUDE.md,LICENSE,README.md,README.zh.md,apps/gateway,apps/mobvibe-cli,packages/shared,packages/ui,pnpm-lock.yaml,render.yaml` when refreshing planning context.

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| v2 | 模板、角色库、自动合并、复杂自动 DAG 调度、跨 machine team、多用户协作 | Deferred | Project initialization |

## Session Continuity

Last session: 2026-05-14T06:48:30Z
Stopped at: Phase 03 verified and marked complete
Resume file: None
