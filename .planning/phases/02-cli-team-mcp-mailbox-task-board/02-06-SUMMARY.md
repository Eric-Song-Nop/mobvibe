---
phase: 02-cli-team-mcp-mailbox-task-board
plan: 06
subsystem: cli-mcp-bridge
tags: [typescript, acp, mcp, stdio-bridge, mobvibe-cli, bun-test]

requires:
  - phase: 02-cli-team-mcp-mailbox-task-board
    provides: Native MCP-over-ACP capability helpers and team MCP runtime from 02-01/02-02
provides:
  - Per-session `mobvibe-team` stdio bridge fallback declaration builder
  - Bridge tool manifest matching the five native `mobvibe_team_*` tools
  - Team session capability selection that prefers native ACP and falls back only to safe stdio bridge
  - Explicit unsupported backend validation before team session creation
  - Readiness persistence for `transport: "stdio_bridge"` with `degraded` / `tools_ready` phases
affects: [phase-03-orchestration, team-session-creation, mcp-readiness, bridge-fallback]

tech-stack:
  added: []
  patterns:
    - Per-session fallback declaration carries only `agentTeamId/memberId` routing metadata
    - Native ACP remains the primary transport; stdio bridge is selected only for explicit safe bridge capability
    - Router readiness stores the actual transport instead of assuming ACP

key-files:
  created:
    - apps/mobvibe-cli/src/team/team-bridge-stdio.ts
    - apps/mobvibe-cli/src/team/__tests__/team-bridge-stdio.test.ts
  modified:
    - apps/mobvibe-cli/src/team/team-capability.ts
    - apps/mobvibe-cli/src/team/team-mcp-router.ts
    - apps/mobvibe-cli/src/acp/acp-connection.ts
    - apps/mobvibe-cli/src/acp/session-manager.ts
    - apps/mobvibe-cli/src/acp/__tests__/session-manager.test.ts

key-decisions:
  - "Bridge fallback is represented as a per-session stdio declaration, not as global agent MCP configuration."
  - "Team session creation now uses native ACP first and safe stdio bridge second; unsupported backends still fail before ACP session creation."
  - "Bridge readiness uses the same tool-list gate as native ACP and records `transport: \"stdio_bridge\"` when the fallback path is active."

patterns-established:
  - "Fallback declaration: `buildPerSessionTeamStdioBridge` produces a single-session `mobvibe-team` stdio config with ids in args/env only."
  - "Capability selection: `buildTeamMcpSessionSelection` centralizes native-vs-bridge choice for session injection."
  - "Readiness persistence: `TeamMcpRouter.handleConnect` accepts the active MCP transport and preserves it through list-tools confirmation."

requirements-completed: [MCP-04, MCP-05, MCP-06]

duration: 9 min
completed: 2026-05-13
---

# Phase 02 Plan 06: Per-session Bridge Fallback or Explicit Team-capable Validation Error Summary

**Safe per-session stdio bridge fallback with native-first capability selection and transport-aware MCP readiness.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-05-13T14:02:10Z
- **Completed:** 2026-05-13T14:11:45Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- Added `team-bridge-stdio.ts` to build fallback-only, per-session stdio declarations named exactly `mobvibe-team` without writing global agent MCP configuration.
- Added bridge tests covering scoped `agentTeamId/memberId` args/env, exact tool-name parity, no global config mutation patterns, and `stdio_bridge` readiness persistence.
- Updated team capability selection so native `mcp.acp` remains primary while `mcp.stdio && mcp.perSessionBridge` produces a safe bridge declaration.
- Updated team session creation to inject native ACP or stdio bridge declarations and still reject unsupported backends before `connection.createSession`.
- Updated MCP router readiness to persist the actual active transport and only mark bridge sessions `tools_ready` after all five expected tools are listable.

## Task Commits

Each task was committed atomically using TDD RED/GREEN flow:

1. **Task 1 RED: stdio bridge fallback tests** - `60031c5` (test)
2. **Task 1 GREEN: per-session stdio bridge builder** - `895bece` (feat)
3. **Task 2 RED: bridge selection and readiness tests** - `9530f1c` (test)
4. **Task 2 GREEN: bridge selection integration** - `f4124b3` (feat)
5. **Formatting:** `aa4fcd3` (style)

**Plan metadata:** committed after this summary is written.

## Files Created/Modified

- `apps/mobvibe-cli/src/team/team-bridge-stdio.ts` - Builds fallback-only per-session stdio declarations and tool manifest metadata for the five team tools.
- `apps/mobvibe-cli/src/team/__tests__/team-bridge-stdio.test.ts` - Covers declaration scope, tool parity, global-config safety, and bridge readiness transport persistence.
- `apps/mobvibe-cli/src/team/team-capability.ts` - Adds native-first session selection that returns either ACP or safe stdio bridge declarations.
- `apps/mobvibe-cli/src/team/team-mcp-router.ts` - Persists MCP readiness using the active transport instead of hardcoding `acp`.
- `apps/mobvibe-cli/src/acp/acp-connection.ts` - Allows team MCP session injection to carry either native ACP or stdio bridge declarations.
- `apps/mobvibe-cli/src/acp/session-manager.ts` - Uses centralized capability selection before team session creation and keeps unsupported validation pre-create.
- `apps/mobvibe-cli/src/acp/__tests__/session-manager.test.ts` - Covers native, bridge, unsupported, and ordinary non-team session branches.

## Decisions Made

- Did not add `@modelcontextprotocol/sdk` or `zod` because this slice only needs a safe per-session bridge declaration and registry manifest; no runtime MCP stdio server process is executed yet.
- Kept stdio bridge fallback declaration scoped to `agentTeamId/memberId` args/env and excluded mailbox/task bodies, secrets, ports, or global config paths.
- Preserved native ACP priority by centralizing transport selection in `buildTeamMcpSessionSelection` and letting bridge only handle explicitly eligible backends.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- TDD RED tests intentionally failed before implementation: the bridge module did not exist, bridge-capable team sessions still rejected non-ACP transport, and router readiness hardcoded `acp`.
- Root `pnpm build` completed with pre-existing webui/website bundle-size and `web-tree-sitter` eval/externalization warnings unrelated to CLI bridge fallback changes.

## Known Stubs

None - scanned the created bridge module for placeholder/TODO/FIXME/empty UI-data patterns; no goal-blocking stubs were introduced.

## Threat Flags

None - new bridge fallback, validation, and readiness surfaces are covered by this plan's threat model.

## TDD Gate Compliance

- **RED 1:** `60031c5 test(02-06): add failing stdio bridge fallback tests` — failed because `team-bridge-stdio.js` did not exist.
- **GREEN 1:** `895bece feat(02-06): add per-session stdio bridge fallback` — bridge tests passed after adding scoped declaration and tool manifest helpers.
- **RED 2:** `9530f1c test(02-06): add failing bridge selection tests` — failed because bridge session creation rejected non-ACP transport and readiness stored `acp`.
- **GREEN 2:** `f4124b3 feat(02-06): integrate stdio bridge selection` — session-manager and bridge readiness tests passed after native-first bridge selection and transport-aware readiness.
- **STYLE:** `aa4fcd3 style(02-06): format bridge fallback changes` — Biome formatting only; tests remained green.

## Verification

- `pnpm -C apps/mobvibe-cli test -- src/team/__tests__/team-bridge-stdio.test.ts src/acp/__tests__/session-manager.test.ts src/acp/__tests__/acp-connection.test.ts` → PASS, 81 tests / 157 assertions.
- `pnpm -C apps/mobvibe-cli build` → PASS, Build complete.
- `pnpm format && pnpm lint && pnpm build` → PASS, all 6 Turbo package tasks successful; existing webui/website warnings remain non-blocking.
- Source scan of `apps/mobvibe-cli/src/team/team-bridge-stdio.ts` for `TODO|FIXME|placeholder|coming soon|not available|=[]|={}|=null|=""` → no matches.
- Source scan of `apps/mobvibe-cli/src/team/team-bridge-stdio.ts` for `settings.json|.mcp|TEAM_MCP_PORT|writeFile|mcpServers` → no matches.

## Self-Check: PASSED

- `FOUND: .planning/phases/02-cli-team-mcp-mailbox-task-board/02-06-SUMMARY.md`
- `FOUND: apps/mobvibe-cli/src/team/team-bridge-stdio.ts`
- `FOUND: apps/mobvibe-cli/src/team/__tests__/team-bridge-stdio.test.ts`
- `FOUND: 60031c5`
- `FOUND: 895bece`
- `FOUND: 9530f1c`
- `FOUND: f4124b3`
- `FOUND: aa4fcd3`

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Ready for Phase 3 team session orchestration to call `createTeamSession` against either native ACP-capable or safe bridge-capable backends.
- Unsupported autonomous team backends now fail before session creation with structured `CAPABILITY_NOT_SUPPORTED` semantics.

---
*Phase: 02-cli-team-mcp-mailbox-task-board*
*Completed: 2026-05-13*
