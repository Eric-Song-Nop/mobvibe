---
phase: 02-cli-team-mcp-mailbox-task-board
plan: 01
subsystem: cli-mcp-capability
tags: [acp, mcp, cli, team-capability, bun-test]

requires:
  - phase: 01-protocol-state-model-persistence-boundary
    provides: Agent Team shared types, durable projection boundaries, and session capability shape
provides:
  - ACP SDK 0.21.x upgrade probe with schema evidence for local RFD adapter boundary
  - Ordinary ACP session isolation tests for empty `mcpServers` on non-team create/load paths
  - Team MCP capability helpers for native ACP declarations and safe per-session bridge eligibility
affects: [phase-02-runtime, team-mcp-injection, bridge-fallback, phase-03-orchestration]

tech-stack:
  added: ["@agentclientprotocol/sdk@0.21.0"]
  patterns:
    - Mobvibe-owned narrow MCP-over-ACP RFD adapter boundary
    - Component-owned `mobvibe-team:<agentTeamId>:<memberId>` caller identity
    - Structured AppError capability validation for unsupported team backends

key-files:
  created:
    - apps/mobvibe-cli/src/team/team-capability.ts
    - apps/mobvibe-cli/src/team/__tests__/team-capability.test.ts
  modified:
    - apps/mobvibe-cli/package.json
    - pnpm-lock.yaml
    - apps/mobvibe-cli/src/acp/acp-connection.ts
    - apps/mobvibe-cli/src/acp/__tests__/acp-connection.test.ts

key-decisions:
  - "ACP SDK upgraded to 0.21.x, but `type: \"acp\"` remains outside generated `McpServer` schema, so Phase 2 keeps the RFD declaration behind `team-capability.ts`."
  - "Ordinary non-team session/new and session/load paths remain isolated with `mcpServers: []`; team declarations are constructed only by team-specific helpers."
  - "Backend team eligibility resolves native `mcp.acp` first, then only `mcp.stdio && mcp.perSessionBridge`; unsupported backends throw 409-compatible `CAPABILITY_NOT_SUPPORTED`."

patterns-established:
  - "RFD adapter boundary: official SDK types are not widened throughout the codebase; RFD-only fields are read through local narrow helpers."
  - "Caller identity: team MCP server ids are generated from `agentTeamId/memberId`; helper inputs do not accept `fromMemberId`."

requirements-completed: [MCP-02, MCP-04, MCP-05]

duration: 9 min
completed: 2026-05-13
---

# Phase 02 Plan 01: SDK/capability foundation and narrow MCP-over-ACP adapter boundary Summary

**ACP SDK 0.21.x probe plus Mobvibe-owned team MCP capability helpers for native ACP declarations and safe per-session bridge validation**

## Performance

- **Duration:** 9 min
- **Started:** 2026-05-13T12:59:16Z
- **Completed:** 2026-05-13T13:08:12Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Upgraded `@agentclientprotocol/sdk` from `^0.16.1` to `^0.21.0` and recorded that the generated schema still lacks RFD `type: "acp"` MCP server support.
- Added regression tests proving ordinary non-team ACP `session/new` and `session/load` payloads continue to pass `mcpServers: []`.
- Added `team-capability.ts` helpers to generate `mobvibe-team:<agentTeamId>:<memberId>` ids, create native ACP declarations, resolve `acp` / `stdio_bridge` transports, and reject unsupported backends with structured errors.

## Task Commits

Each task was committed atomically:

1. **Task 1: Probe ACP SDK upgrade and pin the narrow RFD adapter boundary** - `0802ac0` (feat)
2. **Task 2: Implement team capability validation and per-member declaration helpers** - `1df27d4` (feat)
3. **Build-safety follow-up for Task 1 test fixture** - `115faa9` (fix)

**Plan metadata:** pending final docs commit

## Files Created/Modified

- `apps/mobvibe-cli/package.json` - Pins `@agentclientprotocol/sdk` to `^0.21.0` for the upgrade probe.
- `pnpm-lock.yaml` - Records the 0.21.0 SDK resolution.
- `apps/mobvibe-cli/src/acp/acp-connection.ts` - Maps RFD-only MCP capability booleans into `AgentSessionCapabilities.mcp` through a narrow local reader.
- `apps/mobvibe-cli/src/acp/__tests__/acp-connection.test.ts` - Covers SDK schema probe, MCP capability mapping, and ordinary `mcpServers: []` isolation for non-team create/load paths.
- `apps/mobvibe-cli/src/team/team-capability.ts` - Provides team MCP server id, native ACP declaration, transport resolution, and structured capability/identity validation helpers.
- `apps/mobvibe-cli/src/team/__tests__/team-capability.test.ts` - Covers native ACP declaration, bridge fallback eligibility, unsupported backend errors, malformed ids, and caller-spoofing rejection by omission.

## Decisions Made

- Kept RFD-only `type: "acp"` declarations in Mobvibe-owned `team-capability.ts` instead of widening SDK generated types across ACP connection code.
- Treated `mcp.acp === true` as primary team transport and `mcp.stdio === true && mcp.perSessionBridge === true` as the only safe bridge eligibility for this plan.
- Rejected malformed `agentTeamId` / `memberId` before declaration construction to preserve server id as the caller identity source.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed RFD-only test fixture type error during build**
- **Found during:** Overall verification after Task 2
- **Issue:** The test object used RFD-only `mcpCapabilities.acp` fields directly against the SDK-generated `McpCapabilities` type, causing `pnpm -C apps/mobvibe-cli build` to fail even though runtime Bun tests passed.
- **Fix:** Moved the RFD-only fixture behind an `unknown` cast at the test boundary, preserving behavior coverage without pretending the generated SDK type includes `acp`.
- **Files modified:** `apps/mobvibe-cli/src/acp/__tests__/acp-connection.test.ts`
- **Verification:** `pnpm -C apps/mobvibe-cli test -- src/acp/__tests__/acp-connection.test.ts src/team/__tests__/team-capability.test.ts`, `pnpm -C apps/mobvibe-cli build`, `pnpm -C apps/mobvibe-cli lint`, and root `pnpm format && pnpm lint && pnpm build` all passed.
- **Committed in:** `115faa9`

---

**Total deviations:** 1 auto-fixed (Rule 1 bug)
**Impact on plan:** The fix preserved the intended adapter boundary and removed a build blocker without adding scope.

## Issues Encountered

- SDK 0.21.0 still lacks generated `McpServer` `type: "acp"` and `mcpCapabilities.acp` schema fields. This was an expected probe outcome and is now covered by tests and the local adapter boundary.

## Known Stubs

None - no placeholder UI/data stubs were introduced.

## User Setup Required

None - no external service configuration required.

## Verification

- `pnpm -C apps/mobvibe-cli test -- src/acp/__tests__/acp-connection.test.ts` → 19 pass, 0 fail.
- `pnpm -C apps/mobvibe-cli test -- src/team/__tests__/team-capability.test.ts` → 6 pass, 0 fail.
- `pnpm -C apps/mobvibe-cli test -- src/acp/__tests__/acp-connection.test.ts src/team/__tests__/team-capability.test.ts` → 25 pass, 0 fail.
- `pnpm -C apps/mobvibe-cli build` → Build complete.
- `pnpm -C apps/mobvibe-cli lint` → Checked 63 files, no fixes applied.
- `pnpm format && pnpm lint && pnpm build` → all 6 Turbo package tasks successful.

## Self-Check: PASSED

- `FOUND: .planning/phases/02-cli-team-mcp-mailbox-task-board/02-01-SUMMARY.md`
- `FOUND: apps/mobvibe-cli/src/team/team-capability.ts`
- `FOUND: 0802ac0`
- `FOUND: 1df27d4`
- `FOUND: 115faa9`

## Next Phase Readiness

- Ready for `02-02`: runtime injection can call `buildTeamMcpDeclaration` for native ACP sessions and rely on `resolveTeamMcpTransport` before exposing autonomous team tools.
- Bridge fallback remains intentionally limited to eligibility detection; actual stdio bridge wiring is deferred to later Phase 2 plans.

---
*Phase: 02-cli-team-mcp-mailbox-task-board*
*Completed: 2026-05-13*
