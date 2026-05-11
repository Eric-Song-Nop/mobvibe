---
last_mapped_commit: 7e89508dcca9477698c5e492fe7b8fdf9195f9af
mapping_date: 2026-05-11
---

# Codebase Concerns

**Analysis Date:** 2026-05-11

## Tech Debt

**Large stateful modules concentrate unrelated responsibilities:**
- Issue: Several files combine protocol handling, persistence coordination, UI state transitions, and edge-case recovery in single modules. `apps/mobvibe-cli/src/acp/session-manager.ts` is 1,856 lines, `apps/mobvibe-cli/src/daemon/socket-client.ts` is 1,581 lines, `apps/webui/src/lib/chat-store.ts` is 1,712 lines, `apps/webui/src/hooks/useSocket.ts` is 1,061 lines, `apps/gateway/src/services/session-router.ts` is 1,157 lines, and `apps/gateway/src/routes/fs.ts` is 797 lines.
- Files: `apps/mobvibe-cli/src/acp/session-manager.ts`, `apps/mobvibe-cli/src/daemon/socket-client.ts`, `apps/webui/src/lib/chat-store.ts`, `apps/webui/src/hooks/useSocket.ts`, `apps/gateway/src/services/session-router.ts`, `apps/gateway/src/routes/fs.ts`
- Impact: Changes to session sync, filesystem browsing, git operations, or E2EE have high blast radius. Future agents must read large files to make narrow changes, and regression risk is concentrated around reconnect/backfill and session lifecycle code.
- Fix approach: Extract vertical submodules by responsibility. Move filesystem RPC handlers from `apps/mobvibe-cli/src/daemon/socket-client.ts` into `apps/mobvibe-cli/src/daemon/fs-rpc-handlers.ts`; move git RPC handlers into `apps/mobvibe-cli/src/daemon/git-rpc-handlers.ts`; split `apps/webui/src/lib/chat-store.ts` into message reducers, session metadata reducers, and persistence adapters while preserving Zustand public actions.

**Gateway route files duplicate validation and error mapping:**
- Issue: `apps/gateway/src/routes/sessions.ts` and `apps/gateway/src/routes/fs.ts` each define local `getErrorMessage`, `respondError`, `buildRequestValidationError`, and `buildAuthorizationError` helpers, then repeat `getUserId` checks and string-matching on error messages for each endpoint.
- Files: `apps/gateway/src/routes/sessions.ts`, `apps/gateway/src/routes/fs.ts`
- Impact: New REST endpoints can drift in response shape, status codes, and authorization semantics. String matching such as `message.includes("Session not found")` couples route behavior to exact service error text.
- Fix approach: Move shared route helpers to `apps/gateway/src/routes/route-errors.ts` and return typed `AppError` instances from `apps/gateway/src/services/session-router.ts` instead of relying on message text.

**Compaction is present but disabled because history retention is unsafe:**
- Issue: The default compaction config disables automatic compaction because acked events are the only history source. The config comments also document removed consolidation fields and note that chunk consolidation is not implemented as a config-controlled feature.
- Files: `apps/mobvibe-cli/src/config.ts`, `apps/mobvibe-cli/src/wal/wal-store.ts`, `apps/mobvibe-cli/src/wal/consolidator.ts`
- Impact: Long-running CLI installations accumulate local SQLite WAL data indefinitely unless the user manually runs compaction. Re-enabling compaction without a durable history source risks deleting the only replayable session history.
- Fix approach: Add a tested retention model before enabling automatic compaction. Keep a minimum durable snapshot per session in `apps/mobvibe-cli/src/wal/wal-store.ts`, then make `apps/mobvibe-cli/src/config.ts` enable compaction only after backfill can recover from snapshots and unacked events.

**Registry and first-run agent selection failures degrade into empty backend lists:**
- Issue: `apps/mobvibe-cli/src/config.ts` records `registryFetchError` but still returns `acpBackends: []` when registry loading or detection fails. `enabledAgents` filtering can also produce no backends if IDs do not match the current registry.
- Files: `apps/mobvibe-cli/src/config.ts`, `apps/mobvibe-cli/src/startup-preflight.ts`, `apps/mobvibe-cli/src/registry/registry-client.ts`, `apps/mobvibe-cli/src/registry/agent-detector.ts`
- Impact: The daemon can appear connected while no agents are runnable. Users see empty backend lists in WebUI instead of a direct recovery path.
- Fix approach: Keep the current graceful config loading, but surface a typed startup health issue through the gateway registration payload and WebUI machine status. Use `apps/mobvibe-cli/src/startup-preflight.ts` as the single source for actionable remediation text.

## Known Bugs

**Socket affinity is initialized after WebUI handlers are registered:**
- Symptoms: `setupWebuiHandlers` receives the current `userAffinity` value before `initAffinity()` assigns it. Since `userAffinity` is `null` at module initialization time, WebUI socket handlers that depend on the passed argument can run without the affinity manager even when Redis later connects.
- Files: `apps/gateway/src/index.ts`, `apps/gateway/src/socket/webui-handlers.ts`, `apps/gateway/src/services/user-affinity.ts`
- Trigger: Start the gateway with `REDIS_URL` configured and multiple Fly.io instances. WebUI socket handler setup happens before async affinity initialization completes.
- Workaround: HTTP REST and manual WebSocket upgrade checks still reference the module-level `userAffinity` variable in `apps/gateway/src/index.ts`; however, socket namespace logic that captures the initial argument remains fragile.

**Unbounded encrypted-event buffering can grow memory for missing keys:**
- Symptoms: Live or backfilled encrypted events are stored in `encryptedBufferRef` while the device lacks a DEK. Unlike `pendingEventsRef`, the encrypted buffer has no max size or forced reset threshold.
- Files: `apps/webui/src/hooks/useSocket.ts`, `apps/webui/src/lib/e2ee.ts`
- Trigger: Open a session with `wrappedDek` metadata that the current device cannot unwrap, then receive large encrypted backfills or reconnect streams.
- Workaround: The buffer is cleared when a session resets, detaches non-recoverably, or a DEK becomes available. There is no cap for sustained missing-key sessions.

**Image and text file preview reads entire files into memory:**
- Symptoms: The CLI reads file previews with `fs.readFile(resolved)` for images and `fs.readFile(resolved, "utf8")` for code, then returns the full content over Socket.io.
- Files: `apps/mobvibe-cli/src/daemon/socket-client.ts`, `apps/gateway/src/routes/fs.ts`, `apps/gateway/src/services/session-router.ts`
- Trigger: Request `/fs/session/file` for a large image, binary file with a text extension, generated file, or log file under a session working directory.
- Workaround: Socket.io has `maxHttpBufferSize: 4 * 1024 * 1024` in `apps/gateway/src/index.ts`, but the CLI still loads the file before the transport limit applies.

## Security Considerations

**Pairing secrets are persisted in browser localStorage as raw secrets:**
- Risk: E2EE master secrets are stored in `localStorage` under `mobvibe_e2ee_secrets` when Tauri secure store access is unavailable or fails. Any XSS or browser-extension compromise can read the long-lived pairing secret and decrypt session DEKs for paired sessions.
- Files: `apps/webui/src/lib/e2ee.ts`, `apps/webui/src/App.tsx`, `packages/shared/src/crypto/keys.ts`
- Current mitigation: Tauri attempts to use `tauriStoreSet("app-state.json", STORAGE_KEY, secrets)` before falling back to localStorage. Secret fingerprints shown to users are derived from public auth keys, not the raw secret.
- Recommendations: Prefer Web Crypto non-extractable keys or IndexedDB-wrapped secrets for web, make the localStorage fallback explicit in UI, and avoid silent fallback from Tauri store failures in `apps/webui/src/lib/e2ee.ts`.

**Bearer token can be supplied in WebSocket query string:**
- Risk: `extractUpgradeBearerToken` accepts `bearerToken` from the Socket.io upgrade URL. Query-string tokens can be captured in access logs, browser history, reverse-proxy logs, or monitoring traces.
- Files: `apps/gateway/src/index.ts`, `apps/gateway/src/socket/webui-handlers.ts`, `apps/webui/src/lib/socket.ts`
- Current mitigation: Standard `Authorization: Bearer` headers and cookies are supported. The query-token path appears to exist as a fallback for environments that cannot set auth headers during WebSocket upgrade.
- Recommendations: Prefer auth payload or headers for WebSocket auth, phase out `bearerToken` query support, and redact query strings from `http_request` logs in `apps/gateway/src/index.ts`.

**Wildcard trusted origins weaken auth and CORS protections:**
- Risk: If `GATEWAY_CORS_ORIGINS` includes `*`, `apps/gateway/src/lib/auth.ts` passes `trustedOrigins: ["*"]` to Better Auth and `apps/gateway/src/index.ts` allows all origins. This is risky for credentialed browser requests and auth callbacks.
- Files: `apps/gateway/src/config.ts`, `apps/gateway/src/index.ts`, `apps/gateway/src/lib/auth.ts`
- Current mitigation: Origins are configured via environment variable and rejected origins are logged when wildcard is not used.
- Recommendations: Disallow `*` outside development or preview deployments. Validate `GATEWAY_CORS_ORIGINS` in `apps/gateway/src/config.ts` and fail startup in production when credentials are enabled with a wildcard origin.

**REST and Socket.io lack explicit rate limiting:**
- Risk: The gateway uses Express, Better Auth, Socket.io, and JSON body limits but no `rate-limit`/`helmet`-style middleware is detected in `apps/gateway/src/index.ts`. Auth endpoints, session creation, filesystem RPCs, git grep/log, and notification registration can be spammed by authenticated or unauthenticated clients depending on route.
- Files: `apps/gateway/src/index.ts`, `apps/gateway/src/routes/sessions.ts`, `apps/gateway/src/routes/fs.ts`, `apps/gateway/src/socket/webui-handlers.ts`, `apps/gateway/src/socket/cli-handlers.ts`
- Current mitigation: `express.json({ limit: "4mb" })` and Socket.io `maxHttpBufferSize` restrict payload size. Most application routes use `requireAuth`.
- Recommendations: Add per-IP unauthenticated limits around `/api/auth/*` and per-user limits for expensive RPC routes in `apps/gateway/src/routes/fs.ts` and `apps/gateway/src/routes/sessions.ts`.

**OAuth and session tokens are stored as plain text in application tables:**
- Risk: Better Auth account tokens, session tokens, machine tokens, and web push auth secrets are stored in text columns. A database leak exposes active tokens unless Better Auth or the caller hashes/encrypts them before insertion.
- Files: `apps/gateway/src/db/schema.ts`, `apps/gateway/src/lib/auth.ts`, `apps/gateway/src/routes/machines.ts`, `apps/gateway/src/routes/notifications.ts`
- Current mitigation: Database access is centralized through Drizzle and Better Auth, and token columns have indexes/uniqueness where needed.
- Recommendations: Confirm Better Auth token hashing behavior for `session.token`; hash machine tokens before storage; encrypt OAuth refresh tokens and web push secrets with an application KMS key before persistence.

## Performance Bottlenecks

**Recursive resource listing walks the working tree on demand:**
- Problem: `listSessionResources` recursively traverses the session working directory and collects up to `MAX_RESOURCE_FILES = 2000` files for each `rpc:fs:resources` request.
- Files: `apps/mobvibe-cli/src/daemon/socket-client.ts`, `apps/gateway/src/routes/fs.ts`
- Cause: The traversal calls `fs.readdir` recursively, applies `.gitignore`, and stops at a hard file count. There is no cache, cursor, depth limit, or cancellation signal.
- Improvement path: Return paginated directory/resource results from `apps/mobvibe-cli/src/daemon/socket-client.ts`, add a short-lived cache keyed by `sessionId` + cwd + gitignore mtime, and expose cursor parameters through `apps/gateway/src/routes/fs.ts`.

**Git operations rely on subprocess output buffers and broad queries:**
- Problem: Git helpers use `execFileAsync("git", ...)` with `MAX_BUFFER = 10 * 1024 * 1024`, then parse complete stdout in memory for status, grep, log, show, stash, blame, and diff operations.
- Files: `apps/mobvibe-cli/src/lib/git-utils.ts`, `apps/mobvibe-cli/src/daemon/socket-client.ts`, `apps/gateway/src/routes/fs.ts`
- Cause: The implementation favors simple full-output subprocess calls over streaming/pagination. Large repositories or binary-heavy diffs can exceed buffers or block the CLI event loop while parsing.
- Improvement path: Keep `execFile` for bounded metadata calls, but stream or paginate `git log`, `git grep`, `git show`, and large diffs. Enforce route-level limits and explicit max counts in `apps/gateway/src/routes/fs.ts` before forwarding RPCs.

**Chat state persistence stores full sanitized message history:**
- Problem: `partializeChatState` persists every session and maps every message through `sanitizeMessageForPersist`. Large histories, terminal outputs, and tool-call content can make localStorage writes expensive and quota-prone.
- Files: `apps/webui/src/lib/chat-store.ts`, `apps/webui/src/hooks/useSocket.ts`
- Cause: Zustand persistence uses full-object snapshots. Backfill cursor state and local message history share the same persisted store.
- Improvement path: Persist lightweight session metadata and cursors in `apps/webui/src/lib/chat-store.ts`; store large message histories in IndexedDB or rely on WAL backfill from the CLI.

**WAL read-time consolidation reprocesses every queried batch:**
- Problem: `consolidateEventsForRead` filters stubs and merges chunks on every read. It is linear in the queried batch and handles text, terminal output, usage, and tool-call merging in application memory.
- Files: `apps/mobvibe-cli/src/wal/consolidator.ts`, `apps/mobvibe-cli/src/wal/wal-store.ts`, `apps/mobvibe-cli/src/acp/session-manager.ts`
- Cause: Consolidation is deliberately read-time for correctness/backward compatibility, and `apps/mobvibe-cli/src/config.ts` notes write-time chunk consolidation is not implemented.
- Improvement path: Keep read-time consolidation for legacy data, but add optional write-time coalescing for new terminal/text chunks with tests in `apps/mobvibe-cli/src/wal/__tests__/consolidator.test.ts`.

## Fragile Areas

**Session event ordering and recovery is complex and cross-cutting:**
- Files: `apps/mobvibe-cli/src/wal/wal-store.ts`, `apps/mobvibe-cli/src/wal/seq-generator.ts`, `apps/mobvibe-cli/src/daemon/socket-client.ts`, `apps/webui/src/hooks/useSocket.ts`, `apps/webui/src/lib/chat-store.ts`
- Why fragile: Sequence numbers are generated per session/revision in memory, persisted to SQLite, replayed after reconnect, buffered in WebUI, and reset on revision mismatch. Bugs can duplicate messages, drop chunks, or force full backfills.
- Safe modification: Keep changes vertical and test both CLI WAL behavior and WebUI ingestion. Add or update tests near `apps/mobvibe-cli/src/wal/__tests__/wal-store.test.ts`, `apps/webui/src/hooks/__tests__/useSocket.test.tsx`, and `apps/webui/src/lib/__tests__/chat-store.test.ts` for every cursor/revision change.
- Test coverage: Good unit coverage exists for WAL, WebUI socket buffering, and chat-store behavior, but multi-process reconnect behavior still relies on mocked unit boundaries.

**Multi-instance affinity has graceful degradation that can hide routing defects:**
- Files: `apps/gateway/src/index.ts`, `apps/gateway/src/services/redis.ts`, `apps/gateway/src/services/user-affinity.ts`, `apps/gateway/src/middleware/fly-replay.ts`, `apps/gateway/src/socket/webui-handlers.ts`
- Why fragile: Redis init failure returns `null`, Fly replay middleware catches errors and passes through, and WebSocket upgrade affinity catches errors and proceeds. This preserves availability but can route stateful REST/RPC calls to an instance without the needed in-memory CLI connection.
- Safe modification: Preserve graceful degradation for single-instance local dev, but make production affinity state visible in `/health` and tests. Treat Redis-required deployment modes differently from local mode.
- Test coverage: Unit-level tests cover config and service behavior; multi-instance Fly replay and Redis failure modes need integration tests around `apps/gateway/src/index.ts` and `apps/gateway/src/middleware/fly-replay.ts`.

**Filesystem and git RPCs cross trust boundaries:**
- Files: `apps/gateway/src/routes/fs.ts`, `apps/gateway/src/services/session-router.ts`, `apps/mobvibe-cli/src/daemon/socket-client.ts`, `apps/mobvibe-cli/src/daemon/path-utils.ts`, `apps/mobvibe-cli/src/lib/git-utils.ts`
- Why fragile: Authenticated WebUI requests can make the user’s local CLI read files and execute git subprocesses under session cwd. `resolveWithinCwd` protects session file reads, but route-level numeric parameters, path sizes, and expensive git operations remain loosely bounded.
- Safe modification: Validate request schemas before RPC forwarding, keep `resolveWithinCwd` as the final guard before local file access, and add negative tests for traversal, symlinks, huge files, and unbounded git queries.
- Test coverage: `apps/mobvibe-cli/src/daemon/__tests__/path-utils.test.ts` covers path escaping. Additional integration tests should cover `apps/gateway/src/routes/fs.ts` request validation and CLI file preview limits.

**E2EE behavior depends on silent fallback and runtime-only maps:**
- Files: `apps/webui/src/lib/e2ee.ts`, `apps/webui/src/hooks/useSocket.ts`, `apps/mobvibe-cli/src/e2ee/crypto-service.ts`, `packages/shared/src/crypto/envelope.ts`
- Why fragile: Session DEKs live in runtime maps, pairing secrets can fall back to localStorage, decryption failures return the original encrypted event, and WebUI buffers encrypted events until `onDekReady` fires.
- Safe modification: Treat missing-key, decrypt-failed, and storage-fallback as explicit UI states. Do not add new encryption paths without tests in `apps/webui/src/__tests__/e2ee.test.ts`, `apps/webui/src/hooks/__tests__/useSocket.test.tsx`, and `apps/mobvibe-cli/src/e2ee/__tests__/crypto-service.test.ts`.
- Test coverage: E2EE unit tests exist for shared and WebUI logic; browser storage security and Tauri-store fallback behavior need targeted tests.

## Scaling Limits

**Gateway keeps CLI/session routing state in memory:**
- Current capacity: One `CliRegistry` stores connected CLIs and session summaries in process memory; RPC routing depends on active Socket.io sockets.
- Limit: Without Redis affinity or if affinity is misconfigured, REST and WebUI sockets can hit an instance that does not own the user’s CLI sockets.
- Scaling path: Make Redis affinity mandatory in multi-instance production, expose affinity health from `apps/gateway/src/routes/health.ts`, and persist enough routing metadata to recover when instances restart.

**Socket.io payloads are capped at 4 MiB:**
- Current capacity: Gateway config uses `maxHttpBufferSize: 4 * 1024 * 1024`.
- Limit: Large prompt images, file previews, terminal chunks, or consolidated backfills can exceed the transport cap.
- Scaling path: Use object storage or chunked transfer for large previews and prompt images; add explicit client-side and CLI-side size checks before `socket.emit`.

**Local WAL storage is per-machine SQLite:**
- Current capacity: WAL persistence uses Bun SQLite in `apps/mobvibe-cli/src/wal/wal-store.ts` under `~/.mobvibe/events.db`.
- Limit: History is local to each CLI machine, compaction is disabled by default, and other devices depend on the owning CLI being online for backfill.
- Scaling path: Add durable encrypted history snapshots or server-side metadata indexes while keeping plaintext event payloads local/encrypted.

## Dependencies at Risk

**Bun-specific CLI persistence and tests constrain runtime portability:**
- Risk: The CLI imports `Database` from `bun:sqlite` and uses Bun test conventions. Running the CLI under Node without Bun-compatible SQLite support is not viable.
- Impact: Packaging or distribution outside Bun requires extra runtime assumptions, and shared code that imports CLI internals inherits Bun constraints.
- Migration plan: Keep Bun as the CLI runtime if intentional. If Node portability is required, isolate `bun:sqlite` behind an adapter in `apps/mobvibe-cli/src/wal/` and provide a Node SQLite implementation.

**Better Auth schema stores sensitive auth state:**
- Risk: Auth behavior depends on Better Auth table semantics and plugin behavior for bearer tokens, Tauri callbacks, and OpenAPI exposure.
- Impact: Better Auth upgrades can change token storage, cookie defaults, endpoint behavior, or schema expectations.
- Migration plan: Pin upgrade tests around `apps/gateway/src/lib/auth.ts`, `apps/gateway/src/db/schema.ts`, and `apps/gateway/src/socket/webui-handlers.ts`; review Better Auth changelogs before major upgrades.

## Missing Critical Features

**Production rate limiting and abuse controls are not present:**
- Problem: No explicit rate limiting middleware or per-user RPC quotas are detected for gateway REST routes, auth endpoints, or Socket.io namespaces.
- Blocks: Safe public exposure of auth endpoints, git search, filesystem preview, and session creation under hostile traffic.

**Large file preview safety is incomplete:**
- Problem: File previews have path containment but no size checks, content sniffing, binary detection, range requests, or streaming.
- Blocks: Reliable use in large repositories and safe previewing of user-controlled files.

**Operational visibility for degraded affinity and registry state is limited:**
- Problem: Redis affinity can degrade to null and registry loading can return empty backends while the app continues to run.
- Blocks: Fast diagnosis of “connected but no sessions/backends” or multi-instance routing issues.

## Test Coverage Gaps

**Gateway production hardening paths:**
- What's not tested: CORS wildcard rejection, rate-limit behavior, query-token redaction, Redis-required production mode, and Better Auth trusted-origin failure cases.
- Files: `apps/gateway/src/index.ts`, `apps/gateway/src/config.ts`, `apps/gateway/src/lib/auth.ts`, `apps/gateway/src/services/redis.ts`
- Risk: Security regressions ship through config-only changes.
- Priority: High

**Filesystem preview limits and symlink behavior:**
- What's not tested: Huge file preview, binary-as-text preview, symlink traversal under session cwd, and resource-list recursion on deep trees.
- Files: `apps/mobvibe-cli/src/daemon/socket-client.ts`, `apps/mobvibe-cli/src/daemon/path-utils.ts`, `apps/gateway/src/routes/fs.ts`
- Risk: CLI memory spikes, leaked local file content within broad cwd scopes, or poor UX on large repositories.
- Priority: High

**Multi-instance Fly.io routing integration:**
- What's not tested: End-to-end replay from wrong gateway instance to owning instance for REST and WebSocket flows.
- Files: `apps/gateway/src/index.ts`, `apps/gateway/src/middleware/fly-replay.ts`, `apps/gateway/src/services/user-affinity.ts`, `apps/gateway/src/socket/webui-handlers.ts`
- Risk: Users on multi-instance deployments see intermittent 404/503 responses for valid sessions.
- Priority: High

**E2EE storage fallback and missing-key UX:**
- What's not tested: Tauri store failure fallback, localStorage secret persistence warnings, encrypted buffer caps, and decrypt-failed UI states.
- Files: `apps/webui/src/lib/e2ee.ts`, `apps/webui/src/hooks/useSocket.ts`, `apps/webui/src/components/settings/E2EESettings.tsx`
- Risk: Users lose access to encrypted sessions or unknowingly store secrets in weaker browser storage.
- Priority: Medium

**CLI registry and agent detection recovery:**
- What's not tested: Registry fetch failure with stale cache, mismatched `enabledAgents`, and first-run no-backend UI recovery across CLI + gateway + WebUI.
- Files: `apps/mobvibe-cli/src/config.ts`, `apps/mobvibe-cli/src/startup-preflight.ts`, `apps/mobvibe-cli/src/registry/registry-client.ts`, `apps/webui/src/components/settings/`
- Risk: Empty agent lists appear as product failure instead of recoverable configuration state.
- Priority: Medium

---

*Concerns audit: 2026-05-11*
