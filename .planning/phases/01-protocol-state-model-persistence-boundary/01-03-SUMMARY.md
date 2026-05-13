---
phase: 01-protocol-state-model-persistence-boundary
plan: 03
subsystem: gateway-routing
tags: [typescript, socket-io, express, mobvibe-cli, gateway, agent-team, typed-rpc]
requires:
  - phase: 01-protocol-state-model-persistence-boundary
    provides: Shared Agent Team projection/RPC/event contract from 01-01
  - phase: 01-protocol-state-model-persistence-boundary
    provides: CLI durable Agent Team store and non-content projection boundary from 01-02
provides:
  - CLI daemon handlers for Agent Team create/list/get typed RPC
  - Gateway TeamRouter that authenticates user/machine ownership and forwards typed RPC without durable Agent Team persistence
  - Authenticated `/acp/agent-teams` REST routes with recursive plaintext/secret-key rejection
  - User-scoped `agent-teams:changed` relay from CLI sockets to WebUI sockets
affects: [mobvibe-cli, gateway, webui, phase-01]
tech-stack:
  added: []
  patterns:
    - CLI AgentTeamStore exposed through typed Socket.io RPC request/response events
    - Gateway service routes Agent Team metadata requests through pending requestId maps like SessionRouter
    - REST boundary rejects forbidden content/secret keys before forwarding to CLI
    - CLI-originated projection changes are scoped to `record.userId` before WebUI relay
key-files:
  created:
    - apps/gateway/src/services/team-router.ts
    - apps/gateway/src/services/__tests__/team-router.test.ts
    - apps/gateway/src/routes/agent-teams.ts
    - apps/gateway/src/routes/__tests__/agent-teams.test.ts
  modified:
    - apps/mobvibe-cli/src/daemon/socket-client.ts
    - apps/mobvibe-cli/src/daemon/__tests__/socket-client.test.ts
    - apps/gateway/src/socket/cli-handlers.ts
    - apps/gateway/src/socket/__tests__/cli-handlers.test.ts
    - apps/gateway/src/index.ts
key-decisions:
  - "Gateway exposes Agent Team create/list/get as authenticated metadata routes but remains a router, not a durable truth owner."
  - "Agent Team typed RPC responses are delivered to both SessionRouter and TeamRouter; each router consumes only matching pending requestIds."
  - "Gateway rejects forbidden plaintext and secret-like keys recursively at the route boundary before CLI forwarding."
  - "CLI `agent-teams:changed` projection events are relayed only to the owning `record.userId`, never globally."
patterns-established:
  - "TeamRouter mirrors SessionRouter's requestId, timeout, pending map, and `handleRpcResponse` flow for Agent Team RPC events."
  - "Agent Team route handlers call `requireAuth`/`getUserId` before using TeamRouter and map RPC errors into shared error responses."
  - "Gateway socket relay enriches missing machineId from the registered CLI record and emits to WebUI by userId."
requirements-completed: [TEAM-01, TEAM-03, TEAM-04, TEAM-05]
duration: 11 min
completed: 2026-05-13
---

# Phase 01 Plan 03: Gateway Agent Team RPC Routes Summary

**Authenticated Gateway Agent Team metadata routes backed by CLI typed RPC and user-scoped projection relay.**

## Performance

- **Duration:** 11 min
- **Started:** 2026-05-13T04:07:05Z
- **Completed:** 2026-05-13T04:18:00Z
- **Tasks:** 3
- **Files modified:** 9 source/test files plus this summary

## Accomplishments

- Added CLI daemon handlers for `rpc:agent-team:create`, `rpc:agent-teams:list`, and `rpc:agent-team:get`, all backed by the CLI-local `AgentTeamStore` and typed `rpc:response` payloads.
- Added Gateway `TeamRouter` and authenticated `/acp/agent-teams` routes for metadata-only create/list/get calls without introducing Gateway Agent Team database state.
- Enforced Gateway plaintext/secret boundary rejection for `prompt`, `content`, `body`, `description`, `summaryText`, `agentOutput`, `providerToken`, `masterSecret`, `dek`, and `secret` before RPC forwarding.
- Added user-scoped CLI-to-WebUI `agent-teams:changed` relay through `record.userId`, including TeamRouter RPC response dispatch alongside SessionRouter dispatch.

## Task Commits

Each task was committed atomically using TDD RED/GREEN flow:

1. **Task 1 RED: CLI Agent Team RPC tests** - `dd511bc` (test)
2. **Task 1 GREEN: CLI Agent Team RPC handlers** - `7ba1d8e` (feat)
3. **Task 2 RED: Gateway TeamRouter and route tests** - `5a8ef2b` (test)
4. **Task 2 GREEN: Gateway TeamRouter and `/acp/agent-teams` routes** - `7e763b7` (feat)
5. **Task 3 RED: Agent Team relay tests** - `81379d5` (test)
6. **Task 3 GREEN: user-scoped Agent Team relay** - `2077572` (feat)

**Plan metadata:** committed after this summary is written.

## Files Created/Modified

- `apps/mobvibe-cli/src/daemon/socket-client.ts` - Initializes and closes `AgentTeamStore`, handles Agent Team typed RPC events, returns typed responses, and emits projection change events after create.
- `apps/mobvibe-cli/src/daemon/__tests__/socket-client.test.ts` - Covers CLI create/list/get RPC responses and create-triggered projection changes.
- `apps/gateway/src/services/team-router.ts` - Routes authenticated Agent Team create/list/get calls to user-owned CLI sockets through typed RPC events and pending response handling.
- `apps/gateway/src/services/__tests__/team-router.test.ts` - Covers machine ownership, list fan-out/merge, get forwarding, errors, and response matching.
- `apps/gateway/src/routes/agent-teams.ts` - Adds authenticated `/acp/agent-teams` REST handlers and recursive forbidden-key validation before forwarding.
- `apps/gateway/src/routes/__tests__/agent-teams.test.ts` - Covers auth, create/list/get forwarding, missing team/error mapping, and forbidden plaintext/secret-key rejection.
- `apps/gateway/src/socket/cli-handlers.ts` - Relays `agent-teams:changed` to the owning WebUI user and forwards `rpc:response` to TeamRouter without breaking SessionRouter.
- `apps/gateway/src/socket/__tests__/cli-handlers.test.ts` - Covers user-scoped Agent Team relay and unknown CLI non-broadcast behavior.
- `apps/gateway/src/index.ts` - Wires TeamRouter into Gateway startup, REST routes, and CLI socket handling.

## Decisions Made

- Kept Gateway as an authenticated router only; no Gateway DB table, Drizzle schema, env var, or durable Agent Team persistence was added.
- Reused existing SessionRouter-style pending request handling for TeamRouter to keep RPC lifecycle behavior consistent.
- Routed `rpc:response` to both routers, relying on each router's pending request map to consume only responses it owns.
- Rejected forbidden keys recursively at REST ingress instead of attempting field-by-field sanitization after accepting unsafe payloads.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. Expected negative-path route tests intentionally log mocked `Machine not found` and `RPC timeout` errors while passing.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None - created/modified files were scanned for TODO/FIXME/placeholder text and hardcoded empty UI data patterns. Empty object/array defaults found in test helper overrides and route request defaults are test/API defaults, not UI/rendering stubs.

## Threat Flags

None - the new REST route, typed RPC forwarding, and CLI-to-WebUI relay are covered by the plan threat model. No extra network endpoint, auth path, file access pattern, schema change, or secret-bearing surface outside the plan was introduced.

## TDD Gate Compliance

- **RED 1:** `dd511bc test(01-03): add failing agent team CLI RPC tests` — added failing tests for missing CLI Agent Team RPC handlers.
- **GREEN 1:** `7ba1d8e feat(01-03): add CLI agent team RPC handlers` — CLI socket-client tests passed after handler implementation.
- **RED 2:** `5a8ef2b test(01-03): add failing gateway agent team route tests` — added failing tests for missing Gateway TeamRouter/routes.
- **GREEN 2:** `7e763b7 feat(01-03): add gateway agent team routes` — Gateway route/router tests passed after implementation.
- **RED 3:** `81379d5 test(01-03): add failing agent team relay tests` — added failing tests for missing user-scoped projection relay.
- **GREEN 3:** `2077572 feat(01-03): relay agent team changes to webui` — relay and TeamRouter response dispatch tests passed.
- **REFACTOR:** No separate refactor commit was needed after Biome formatting/linting.

## Verification

- `pnpm -C apps/mobvibe-cli test -- src/daemon/__tests__/socket-client.test.ts` — PASS, 11 tests / 27 assertions.
- `pnpm -C apps/gateway test:run -- src/services/__tests__/team-router.test.ts src/routes/__tests__/agent-teams.test.ts` — PASS, 10 test files / 118 tests.
- `pnpm -C apps/gateway test:run -- src/socket/__tests__/cli-handlers.test.ts src/services/__tests__/team-router.test.ts` — PASS, 10 test files / 118 tests.
- `pnpm format` — PASS, 6 workspace packages formatted; no fixes applied.
- `pnpm lint` — PASS, 6 workspace packages checked; no fixes applied.
- `pnpm build` — PASS, 6 workspace packages built. Existing website/webui bundle-size and `web-tree-sitter` eval/browser-external warnings remain non-blocking dependency/build warnings.
- Source assertion: `apps/gateway/src/routes/agent-teams.ts` uses `requireAuth` and `getUserId` before TeamRouter calls — PASS.
- Source assertion: `apps/gateway/src/routes/agent-teams.ts` contains all exact forbidden plaintext/secret keys and rejects them before forwarding — PASS.
- Source assertion: `apps/gateway/src/services/team-router.ts` sends exactly the Agent Team RPC event names required by the plan — PASS.
- Source assertion: `apps/gateway/src/socket/cli-handlers.ts` relays `agent-teams:changed` through `record.userId` — PASS.
- Source assertion: no `apps/gateway/src/db/**/*agent*team*` files exist — PASS.

## Self-Check: PASSED

- Found `apps/gateway/src/services/team-router.ts`.
- Found `apps/gateway/src/services/__tests__/team-router.test.ts`.
- Found `apps/gateway/src/routes/agent-teams.ts`.
- Found `apps/gateway/src/routes/__tests__/agent-teams.test.ts`.
- Found modified CLI and Gateway socket/index files listed above.
- Found task commits `dd511bc`, `7ba1d8e`, `5a8ef2b`, `7e763b7`, `81379d5`, and `2077572` in git log.
- Final CLI/Gateway tests, workspace format/lint, and workspace build evidence captured above.

## Next Phase Readiness

Ready for `01-04-PLAN.md`: WebUI/Gateway callers now have authenticated Agent Team projection routes and user-scoped change events backed by CLI durable truth, so the next plan can harden mailbox/task/MCP/summary metadata recovery and projection boundaries without changing Gateway truth ownership.

---
*Phase: 01-protocol-state-model-persistence-boundary*
*Completed: 2026-05-13*
