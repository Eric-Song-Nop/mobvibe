# Codebase Concerns

**Analysis Date:** 2026-05-12

## Tech Debt

**Large session orchestration modules:**
- Issue: Core session, socket, and chat behavior is concentrated in very large files with many responsibilities.
- Files: `apps/mobvibe-cli/src/acp/session-manager.ts` (1856 lines), `apps/mobvibe-cli/src/daemon/socket-client.ts` (1581 lines), `apps/webui/src/lib/chat-store.ts` (1712 lines), `apps/webui/src/hooks/useSocket.ts` (884 lines), `apps/gateway/src/services/session-router.ts` (1157 lines), `apps/gateway/src/routes/sessions.ts` (925 lines), `apps/gateway/src/routes/fs.ts` (797 lines).
- Impact: Small behavior changes require understanding transport, state management, persistence, and UI synchronization together; regression risk is high around reconnects, replay, permissions, and history backfill.
- Fix approach: Split by responsibility while preserving public contracts: route validation helpers in `apps/gateway/src/routes/*`, RPC dispatch in `apps/gateway/src/services/session-router.ts`, CLI filesystem/git handlers in `apps/mobvibe-cli/src/daemon/`, and web session-event reducers/hooks in `apps/webui/src/hooks/` and `apps/webui/src/lib/`.

**Duplicated request validation and error response plumbing:**
- Issue: REST route modules define repeated `getErrorMessage`, `respondError`, `buildRequestValidationError`, and `buildAuthorizationError` helpers instead of a shared route utility.
- Files: `apps/gateway/src/routes/fs.ts`, `apps/gateway/src/routes/sessions.ts`.
- Impact: Error shape, status mapping, and authorization leak behavior can drift when new endpoints are added.
- Fix approach: Move shared helpers to `apps/gateway/src/routes/route-errors.ts` or `apps/gateway/src/lib/http-errors.ts`; keep route handlers focused on parsing, authorization, and service calls.

**Mixed production logging patterns in web UI:**
- Issue: Browser socket and backfill code uses `console.log`, `console.warn`, and `console.error` directly.
- Files: `apps/webui/src/lib/socket.ts`, `apps/webui/src/hooks/useSocket.ts`, `apps/webui/src/lib/e2ee.ts`.
- Impact: Logs are noisy in production, cannot be leveled consistently, and may expose operational details in user consoles.
- Fix approach: Add a small web logger in `apps/webui/src/lib/` with environment-aware levels; route socket, E2EE, and backfill diagnostics through it.

**Silent storage and crypto fallback failures:**
- Issue: Several storage paths swallow errors and continue with degraded state.
- Files: `apps/webui/src/lib/storage-adapter.ts`, `apps/webui/src/lib/auth-token.ts`, `apps/webui/src/lib/e2ee.ts`.
- Impact: Users can lose persisted auth/E2EE state or fall back from Tauri storage to `localStorage` without visible diagnostics; support/debugging is difficult.
- Fix approach: Return explicit status from storage helpers and show recoverable warnings in settings/login flows; log non-secret failure metadata through a web logger.

**Documentation drift around package layout:**
- Issue: The root guide describes `packages/core/`, while the current package list includes `packages/core/`, `packages/shared/`, and `packages/ui/`; `packages/ui/` is not documented in the root structure overview.
- Files: `AGENTS.md`, `packages/ui/src/index.ts`, `packages/core/`, `packages/shared/`.
- Impact: New agents may place shared UI components in app-local folders instead of `packages/ui/src/`, or miss the UI package during refactors.
- Fix approach: Update `AGENTS.md` and related docs to include `packages/ui/` placement and package-level responsibilities.

## Known Bugs

**Potential stale session synchronization after backfill errors:**
- Symptoms: A session can display a warning and best-effort pending events after backfill failure, but message history may remain stale.
- Files: `apps/webui/src/hooks/useSocket.ts` lines 269-295, `apps/webui/src/hooks/backfill-manager.ts`.
- Trigger: Event gap, revision change, or reconnect occurs while `/events` backfill fails.
- Workaround: User-triggered history sync or reconnect can replay from sequence 0.

**Machine placeholder tokens are deterministic:**
- Symptoms: New machine records receive `machineToken` values derived from the machine ID instead of random tokens.
- Files: `apps/gateway/src/services/db-service.ts` lines 103-112, `apps/gateway/src/db/schema.ts` lines 87-105.
- Trigger: `upsertMachine` creates a new machine record during CLI registration.
- Workaround: CLI authentication currently uses device public-key signatures in `apps/gateway/src/socket/cli-handlers.ts`, so the placeholder token is not the active auth mechanism.

**Host filesystem browsing exposes broad local machine paths after device auth:**
- Symptoms: The web UI can request host filesystem roots and entries for a paired machine, starting at the user's home directory on POSIX or drive roots on Windows.
- Files: `apps/gateway/src/routes/fs.ts` lines 45-120, `apps/mobvibe-cli/src/daemon/host-fs.ts`, `apps/mobvibe-cli/src/daemon/socket-client.ts` lines 533-579.
- Trigger: Authenticated web user opens host filesystem selection for a connected machine.
- Workaround: Hidden files are filtered for host entries in `apps/mobvibe-cli/src/daemon/socket-client.ts` lines 557-566; no allowlist is enforced.

## Security Considerations

**Bearer token in WebSocket query string:**
- Risk: Tauri WebUI mirrors the bearer token into the Engine.IO query for Fly affinity, which can appear in URL logs, proxies, and telemetry.
- Files: `apps/webui/src/lib/socket.ts` lines 44-50, `apps/gateway/src/index.ts` lines 34-49, `apps/gateway/src/socket/webui-handlers.ts` lines 95-114.
- Current mitigation: The token is also sent through Socket.io auth/Authorization and validated by Better Auth before connection is accepted.
- Recommendations: Prefer upgrade headers or short-lived affinity-only tokens; if query transport remains, redact `bearerToken` in all HTTP/proxy logs and keep token TTL short.

**E2EE master secrets persisted in browser storage:**
- Risk: Pairing secrets are stored in Tauri app-state storage or browser `localStorage`; any XSS or local profile compromise can extract long-lived secrets.
- Files: `apps/webui/src/lib/e2ee.ts` lines 23-30 and 217-294, `apps/webui/src/components/settings/E2EESettings.tsx`.
- Current mitigation: Secrets are not committed and are only stored client-side; E2EE payloads remain encrypted when keys are absent.
- Recommendations: Use platform keychain/secure storage for Tauri, encrypt persisted web secrets with a user passphrase or WebAuthn-bound key, and add a visible device-secret rotation flow.

**Unauthenticated-origin allowance for no-Origin requests:**
- Risk: CORS accepts requests without an Origin header, and WebSocket connections rely on auth instead of rejecting missing origins.
- Files: `apps/gateway/src/index.ts` lines 120-134, `apps/gateway/src/socket/webui-handlers.ts` lines 92-126, `apps/gateway/src/socket/cli-handlers.ts` lines 72-133.
- Current mitigation: REST routes use Better Auth in `apps/gateway/src/middleware/auth.ts`; CLI sockets require signed device tokens.
- Recommendations: Keep this behavior only for trusted native/CLI clients; add explicit comments/tests for allowed no-Origin clients and ensure browser-sensitive endpoints remain authenticated.

**Filesystem and git RPCs trust connected CLI as local authority:**
- Risk: Gateway routes forward file, git, and history requests to the CLI; authorization is user-scoped but local path policy is enforced only by CLI-side helpers.
- Files: `apps/gateway/src/routes/fs.ts`, `apps/gateway/src/services/session-router.ts`, `apps/mobvibe-cli/src/daemon/socket-client.ts` lines 581-681 and 763-839, `apps/mobvibe-cli/src/daemon/path-utils.ts`.
- Current mitigation: Session file requests use `resolveWithinCwd` in `apps/mobvibe-cli/src/daemon/path-utils.ts`; gateway session lookup is user-scoped in `apps/gateway/src/services/session-router.ts` lines 75-101.
- Recommendations: Keep path validation at the CLI boundary, add maximum file-size checks before `fs.readFile`, and test symlink/absolute-path behavior for POSIX and Windows.

## Performance Bottlenecks

**Unbounded full-file previews:**
- Problem: File preview RPC reads whole text/image files into memory and returns base64 data for images.
- Files: `apps/mobvibe-cli/src/daemon/socket-client.ts` lines 610-640, `apps/webui/src/components/app/previews/CodePreview.tsx`.
- Cause: No file-size cap, streaming, or partial-read path exists before `fs.readFile`.
- Improvement path: Add stat-based limits in `apps/mobvibe-cli/src/daemon/socket-client.ts`; return metadata plus a truncated preview and require explicit download/open for large files.

**Large resource scans per session:**
- Problem: Resource discovery walks session trees until `MAX_RESOURCE_FILES` is reached.
- Files: `apps/mobvibe-cli/src/daemon/socket-client.ts` lines 57 and 1407-1412, `apps/webui/src/components/app/CommandPalette.tsx`, `apps/webui/src/components/app/ChatFooter.tsx`.
- Cause: The CLI scans filesystem entries and applies ignore rules on demand.
- Improvement path: Cache resource listings per session cwd with invalidation, paginate results, and keep search/filtering incremental in web UI.

**In-memory registry scans for user/session operations:**
- Problem: Connected sockets and session arrays are scanned for status, subscription, and affinity operations.
- Files: `apps/gateway/src/socket/webui-handlers.ts` lines 59-67 and 204-218, `apps/gateway/src/index.ts` lines 88-111, `apps/gateway/src/services/cli-registry.ts`.
- Cause: Maps are indexed primarily by machine/socket, while many operations need user/session views.
- Improvement path: Maintain explicit `userId -> web socket ids` and `sessionId -> owner userId` indexes; update them on connect/disconnect and session changes.

**Git commands use fixed 10MB process buffers:**
- Problem: Large diffs/logs/grep results can exceed buffers or consume memory.
- Files: `apps/mobvibe-cli/src/lib/git-utils.ts` lines 14, 479-507, 584-665, 899-950.
- Cause: `execFileAsync` collects stdout in memory for git operations.
- Improvement path: Add pagination/limits to every git RPC, stream large outputs, and return explicit truncation flags to the web UI.

## Fragile Areas

**WAL replay, cursor, and backfill ordering:**
- Files: `apps/mobvibe-cli/src/wal/wal-store.ts`, `apps/webui/src/hooks/useSocket.ts`, `apps/webui/src/hooks/use-session-backfill.ts`, `apps/webui/src/hooks/backfill-manager.ts`.
- Why fragile: Correctness depends on revision, sequence, pending queues, encrypted event buffering, and reconnect timing staying in sync.
- Safe modification: Add tests before changing event ingestion; preserve `lastAppliedSeq`, revision reset, and pending overflow behavior in `apps/webui/src/hooks/useSocket.ts` lines 420-480.
- Test coverage: Strong hook tests exist in `apps/webui/src/hooks/__tests__/useSocket.test.tsx`, but cross-process gateway/CLI/WebUI reconnect behavior still depends on integration/e2e coverage.

**Permission decision lifecycle:**
- Files: `apps/mobvibe-cli/src/acp/session-manager.ts`, `apps/mobvibe-cli/src/daemon/socket-client.ts` lines 479-501, `apps/gateway/src/socket/cli-handlers.ts`, `apps/webui/src/hooks/useSocket.ts` lines 530-543.
- Why fragile: Permission requests cross ACP, CLI socket, gateway socket, WebUI store, and back to CLI; request ID mismatches can leave unresolved promises.
- Safe modification: Keep request IDs stable end-to-end and add timeout/cancellation tests around disconnects.
- Test coverage: Unit tests exist under `apps/mobvibe-cli/src/acp/__tests__/session-manager.test.ts` and `apps/gateway/src/socket/__tests__/cli-handlers.test.ts`; UI decision state tests should accompany UI changes.

**E2EE bootstrap and encrypted event buffering:**
- Files: `apps/webui/src/lib/e2ee.ts`, `apps/webui/src/hooks/encrypted-event-buffer.ts`, `apps/webui/src/hooks/useSocket.ts`, `packages/shared/src/crypto/`.
- Why fragile: Events received before DEK availability are buffered; failures can silently keep encrypted payloads visible to reducers.
- Safe modification: Preserve `e2ee.hasSessionDek`, `bootstrapSessionE2EE`, and buffer flush behavior; add tests for missing/rotated secrets.
- Test coverage: `apps/webui/src/__tests__/e2ee.test.ts` covers E2EE manager behavior; integration tests should cover real socket event ordering.

**Contenteditable composer DOM reconciliation:**
- Files: `apps/webui/src/components/app/ChatFooter.tsx` lines 575-608 and 658-939.
- Why fragile: The component manually rebuilds DOM, tracks selection offsets, token chips, image attachments, and command/resource pickers.
- Safe modification: Prefer small targeted changes with browser interaction tests; avoid mixing DOM mutation and React-rendered children in the same editable region.
- Test coverage: `apps/webui/src/components/app/__tests__/ChatFooter.test.tsx` exists; add tests for selection preservation and IME/paste behavior when changing composer logic.

## Scaling Limits

**Gateway in-memory session registry:**
- Current capacity: Active CLI/session state lives in process memory.
- Limit: Multi-instance deployments require affinity; instance restarts lose in-memory session lists until CLIs reconnect.
- Scaling path: Persist session presence metadata or use Redis-backed presence in `apps/gateway/src/services/cli-registry.ts`; keep Fly affinity in `apps/gateway/src/services/user-affinity.ts` as a routing optimization, not the only state bridge.

**Local SQLite WAL growth:**
- Current capacity: Events persist locally in Bun SQLite per CLI.
- Limit: Long-running sessions with terminal output and tool payloads can grow the local DB until compaction/archive runs.
- Scaling path: Keep compaction commands in `apps/mobvibe-cli/src/index.ts` documented and automate retention in `apps/mobvibe-cli/src/wal/`; expose DB size/retention status in CLI health output.

**Web UI persisted Zustand state:**
- Current capacity: Chat/session state persists through a local storage adapter.
- Limit: Large message histories, terminal output, and session metadata can exceed browser storage quota or slow hydration.
- Scaling path: Persist only session summaries/cursors in `apps/webui/src/lib/chat-store.ts`; fetch history through backfill on demand and cap terminal snapshots.

## Dependencies at Risk

**Bun-specific CLI runtime:**
- Risk: CLI uses `bun:sqlite`, Bun test, and Bun build scripts.
- Impact: Runtime and packaging behavior differs from Node packages in the same monorepo.
- Migration plan: Keep Bun-specific code isolated under `apps/mobvibe-cli/src/`; wrap SQLite access behind `apps/mobvibe-cli/src/wal/` interfaces before introducing alternative runtimes.

**Tauri/web storage split:**
- Risk: Auth and E2EE storage behavior diverges between browser and Tauri.
- Impact: Bugs can reproduce only on desktop/mobile wrappers.
- Migration plan: Keep `apps/webui/src/lib/tauri-store.ts`, `apps/webui/src/lib/auth-token.ts`, and `apps/webui/src/lib/e2ee.ts` covered with adapter tests; document platform storage guarantees.

## Missing Critical Features

**Explicit file preview size limits:**
- Problem: The CLI reads requested files fully for preview.
- Blocks: Safe use against large binaries, generated files, or accidental multi-MB images.

**Centralized redaction policy:**
- Problem: Logs include request IDs, paths, user IDs, public keys, and error details across gateway/CLI/web.
- Blocks: Confident production diagnostics without reviewing each logger call.

**Secure E2EE secret rotation UX:**
- Problem: Users can add/remove paired secrets, but the code does not expose a full rotation/recovery workflow.
- Blocks: Practical response to leaked browser/Tauri local storage.

## Test Coverage Gaps

**Gateway REST route validation consistency:**
- What's not tested: All invalid query/body permutations across `apps/gateway/src/routes/fs.ts` and `apps/gateway/src/routes/sessions.ts`.
- Files: `apps/gateway/src/routes/fs.ts`, `apps/gateway/src/routes/sessions.ts`.
- Risk: New endpoints drift in error shape or status code.
- Priority: Medium

**Website and shared UI package behavior:**
- What's not tested: No matching tests were detected for `apps/website/src/` or `packages/ui/src/` components.
- Files: `apps/website/src/App.tsx`, `apps/website/src/components/`, `packages/ui/src/`.
- Risk: Marketing/legal/UI package regressions can ship without automated detection.
- Priority: Medium

**Large-file and filesystem boundary cases:**
- What's not tested: Size caps, symlink traversal, image preview memory behavior, and host filesystem access policy.
- Files: `apps/mobvibe-cli/src/daemon/socket-client.ts`, `apps/mobvibe-cli/src/daemon/host-fs.ts`, `apps/mobvibe-cli/src/daemon/path-utils.ts`.
- Risk: Performance and local file exposure issues are missed.
- Priority: High

---

*Concerns audit: 2026-05-12*
