# Walking Skeleton — Mobvibe Agent Team

**Phase:** 1  
**Generated:** 2026-05-13

## Capability Proven End-to-End

用户可以通过 WebUI/Gateway/CLI 看到一个由 CLI SQLite 持久化并可恢复的 Agent Team metadata projection；该 projection 使用 `packages/shared` 统一类型，经过 Gateway `/acp/agent-teams` typed RPC 转发，并进入 WebUI API/store 边界，且不包含 prompt、agent output、mailbox body、task body/title/description、summary body 或 secret material。

## Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Product object | Agent Team as a first-class aggregate, not `Session(kind="team")` | Per 01-CONTEXT locked decision: team owns coordination facts; ordinary sessions own conversation facts. |
| Shared contract | `packages/shared/src/types/agent-team.ts` plus explicit `packages/shared/src/index.ts` exports | WebUI/Gateway/CLI must share lifecycle, MCP, mailbox/task metadata, source refs, RPC payloads, and errors to avoid field drift. |
| Data layer | CLI SQLite current-state tables via existing `apps/mobvibe-cli/src/wal/migrations.ts` | Phase 1 durable truth is CLI-local current facts; no Gateway durable team storage and no team append-only WAL. |
| API boundary | WebUI calls `/acp/agent-teams`; Gateway internally forwards typed Socket.io RPC to CLI | Keeps WebUI on product resources while preserving CLI as durable truth owner. |
| Content boundary | Gateway-facing payloads carry IDs, status, counts, timestamps, safe errors, and source refs only | Gateway must not accept, persist, forward, or log plaintext prompt/content/body/description/summaryText/agentOutput or secrets. |
| MCP model | Model native `mcpCapabilities.acp` and per-session bridge fallback; do not implement runtime tools in Phase 1 | ACP-over-MCP is a capability/readiness modeling input now; actual `mobvibe_team_*` runtime is Phase 2. |
| WebUI scope | API/store/socket projection plumbing only; no visual UI design page in Phase 1 | ROADMAP UI hint is `no`; this phase proves boundaries, not UI polish. |
| Deployment/run target | Local full-stack verification through package builds/tests, not a new external deploy | Existing repo already has Gateway/WebUI/CLI scaffolds and deploy targets; Phase 1 touches protocol/state boundaries. |

## Stack Touched in Phase 1

- [x] Existing scaffold — pnpm + Turborepo, React/Vite WebUI, Express/Socket.io Gateway, Bun CLI.
- [x] Routing — `POST /acp/agent-teams`, `GET /acp/agent-teams`, `GET /acp/agent-teams/:agentTeamId`.
- [x] Database — CLI SQLite current-state tables for Agent Team metadata, members, MCP readiness, mailbox/task metadata, and summary refs.
- [x] UI boundary — WebUI API/store/socket projection-only plumbing; no visual page required.
- [x] Local full-stack verification — package-specific tests plus `pnpm build` prove the skeleton.

## Out of Scope (Deferred to Later Slices)

- Real `mobvibe_team_*` MCP tools, MCP server startup, MCP-over-ACP injection, or bridge runtime.
- Creating leader/member ordinary ACP sessions during Phase 1 create.
- Agent mailbox delivery, wake behavior, task tool runtime, or task board UI.
- Remote mailbox/task/summary body detail over Gateway.
- Gateway durable Agent Team storage.
- Team append-only WAL.
- Global MCP config edits.
- Visual UI design or UI-SPEC work.

## Subsequent Slice Plan

- Phase 2: CLI-local team MCP tools, durable mailbox, and durable task board collaboration loop.
- Phase 3: WebUI → Gateway → CLI → leader/member ordinary ACP session minimal Team Run.
- Phase 4: lifecycle controls, permissions, E2EE recovery, cancel/retry/archive, and degraded-state recovery.
- Phase 5: desktop/mobile UI scaling and v1 polish.
