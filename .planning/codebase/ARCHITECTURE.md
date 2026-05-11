---
last_mapped_commit: 7e89508dcca9477698c5e492fe7b8fdf9195f9af
mapping_date: 2026-05-11
---
<!-- refreshed: 2026-05-11 -->
# Architecture

**Analysis Date:** 2026-05-11

## System Overview

```text
┌─────────────────────────────────────────────────────────────┐
│                    Client and Agent Layer                    │
├──────────────────────┬────────────────────┬─────────────────┤
│ React WebUI / Tauri  │ Marketing Website  │ Local CLI Daemon │
│ `apps/webui/src`     │ `apps/website/src` │ `apps/mobvibe-cli/src` │
└──────────┬───────────┴──────────┬─────────┴────────┬────────┘
           │ REST + Socket.io     │ static/SSR       │ ACP stdio
           ▼                      ▼                  ▼
┌─────────────────────────────────────────────────────────────┐
│              Gateway API and Real-Time Router                │
│              `apps/gateway/src/index.ts`                     │
├──────────────────────┬────────────────────┬─────────────────┤
│ REST routes          │ Socket namespaces  │ Auth/affinity   │
│ `apps/gateway/src/routes` │ `apps/gateway/src/socket` │ `apps/gateway/src/lib/auth.ts` │
└──────────┬───────────┴──────────┬─────────┴────────┬────────┘
           │                      │                  │
           ▼                      ▼                  ▼
┌─────────────────────────────────────────────────────────────┐
│               Shared Contracts and Persistence               │
├──────────────────────┬────────────────────┬─────────────────┤
│ Shared TS types/E2EE │ PostgreSQL/Drizzle │ Redis affinity  │
│ `packages/shared/src`│ `apps/gateway/src/db` │ `apps/gateway/src/services/redis.ts` │
└──────────────────────┴────────────────────┴─────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│               Local Agent Runtime and WAL Store              │
│ `apps/mobvibe-cli/src/acp`, `apps/mobvibe-cli/src/wal`        │
└─────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Gateway entrypoint | Creates Express, HTTP server, Socket.io namespaces, Better Auth mount, REST routers, affinity services, and graceful shutdown. | `apps/gateway/src/index.ts` |
| Session router | Bridges authenticated REST operations to the correct CLI socket via typed RPC requests and response correlation. | `apps/gateway/src/services/session-router.ts` |
| CLI registry | Tracks connected CLI machines, user ownership, backend capabilities, live sessions, and session-change events in memory. | `apps/gateway/src/services/cli-registry.ts` |
| WebUI socket handlers | Authenticates WebUI sockets, maintains session subscriptions, and emits user-scoped live events. | `apps/gateway/src/socket/webui-handlers.ts` |
| CLI socket handlers | Authenticates CLI sockets with signed device tokens, registers machines, receives session events, and forwards payloads to WebUI. | `apps/gateway/src/socket/cli-handlers.ts` |
| Gateway auth | Configures Better Auth with Drizzle PostgreSQL storage, email/password auth, bearer tokens, Tauri callback support, and OpenAPI plugin. | `apps/gateway/src/lib/auth.ts` |
| Gateway database schema | Defines Better Auth tables plus app tables for machines, device keys, and web push subscriptions. | `apps/gateway/src/db/schema.ts` |
| WebUI application shell | Composes auth, routing, Zustand stores, React Query hooks, socket handlers, and feature dialogs into the chat UI. | `apps/webui/src/App.tsx` |
| WebUI socket client | Maintains the `/webui` Socket.io connection, bearer-token handling for Tauri, reconnect subscriptions, and typed event registration. | `apps/webui/src/lib/socket.ts` |
| WebUI API client | Wrap REST calls to `/acp`, `/fs`, `/api/machines`, and `/api/notifications`, including Tauri fetch and auth behavior. | `apps/webui/src/lib/api.ts` |
| WebUI chat store | Holds session list, chat messages, streaming state, WAL cursors, terminal snapshots, permissions, and UI-facing session metadata. | `apps/webui/src/lib/chat-store.ts` |
| CLI command entrypoint | Defines `mobvibe` commands for daemon lifecycle, login/logout, E2EE status, and WAL compaction. | `apps/mobvibe-cli/src/index.ts` |
| CLI daemon manager | Starts foreground/background daemon process, initializes crypto, creates `SessionManager`, connects Socket.io client, and schedules WAL compaction. | `apps/mobvibe-cli/src/daemon/daemon.ts` |
| CLI gateway client | Connects to gateway `/cli`, signs auth payloads, registers machine/backends, and handles gateway RPC events. | `apps/mobvibe-cli/src/daemon/socket-client.ts` |
| ACP connection | Spawns ACP backend processes, builds ACP client handlers, and maps protocol-level notifications/terminal calls to Mobvibe events. | `apps/mobvibe-cli/src/acp/acp-connection.ts` |
| Session manager | Owns local session records, ACP backend connections, permission request coordination, E2EE integration, worktree creation, and WAL emission. | `apps/mobvibe-cli/src/acp/session-manager.ts` |
| WAL store | Persists local session metadata and ordered session events in Bun SQLite with prepared statements and migrations. | `apps/mobvibe-cli/src/wal/wal-store.ts` |
| Shared contracts | Re-exports SDK types, project-specific socket/API contracts, error helpers, crypto helpers, and legal/shared utilities. | `packages/shared/src/index.ts` |
| Website app | Renders marketing, pricing, and legal pages with client entry and SSR/prerender entry. | `apps/website/src/App.tsx`, `apps/website/src/entry-server.tsx` |

## Pattern Overview

**Overall:** Monorepo with gateway-mediated, typed event/RPC architecture.

**Key Characteristics:**
- Use `@mobvibe/shared` as the boundary contract between gateway, web UI, CLI daemon, and website; add new cross-package types in `packages/shared/src` and export them from `packages/shared/src/index.ts`.
- Use the gateway as the only remote coordination point: WebUI talks to `apps/gateway/src/routes/*` over REST and `apps/gateway/src/socket/webui-handlers.ts` over Socket.io; CLI talks to `apps/gateway/src/socket/cli-handlers.ts` over Socket.io.
- Keep authoritative agent/session runtime local to the CLI daemon in `apps/mobvibe-cli/src/acp/session-manager.ts`; gateway session state is an in-memory routing/index layer in `apps/gateway/src/services/cli-registry.ts`.
- Persist durable user and machine identity in PostgreSQL via `apps/gateway/src/db/schema.ts`; persist chat event history locally in the CLI WAL via `apps/mobvibe-cli/src/wal/wal-store.ts`.
- Use user-scoped routing everywhere: REST routes call `getUserId()` from `apps/gateway/src/middleware/auth.ts`, `SessionRouter` resolves CLI ownership by user, and socket handlers emit only to a user’s sockets.

## Layers

**Workspace orchestration:**
- Purpose: Define packages, task graph, and root commands.
- Location: `package.json`, `pnpm-workspace.yaml`, `turbo.json`
- Contains: Turbo tasks for build/dev/lint/test, pnpm workspace package globs, root scripts.
- Depends on: Package scripts in `apps/*/package.json` and `packages/*/package.json`.
- Used by: CI, local development, and repo-level commands.

**Shared contract layer:**
- Purpose: Provide stable TypeScript contracts and helpers shared across app boundaries.
- Location: `packages/shared/src`
- Contains: Socket event types in `packages/shared/src/types/socket-events.ts`, ACP SDK re-exports in `packages/shared/src/types/acp.ts`, session/error/registry types, crypto helpers, prompt image helpers, and legal content exports.
- Depends on: `@agentclientprotocol/sdk`, `zod`, `tweetnacl`, `@noble/hashes` via `packages/shared/package.json`.
- Used by: `apps/gateway/src`, `apps/webui/src`, and `apps/mobvibe-cli/src`.

**Gateway HTTP and WebSocket layer:**
- Purpose: Authenticate users/devices, expose REST APIs, maintain Socket.io namespaces, and route RPCs between WebUI and CLI.
- Location: `apps/gateway/src`
- Contains: Entrypoint `apps/gateway/src/index.ts`, routes in `apps/gateway/src/routes`, socket handlers in `apps/gateway/src/socket`, in-memory services in `apps/gateway/src/services`, auth/db/logging in `apps/gateway/src/lib` and `apps/gateway/src/db`.
- Depends on: Express, Socket.io, Better Auth, Drizzle, PostgreSQL, optional Redis, `@mobvibe/shared`.
- Used by: WebUI REST/socket clients and CLI socket client.

**WebUI application layer:**
- Purpose: Render the authenticated chat/machine/session UI and synchronize live session events into local state.
- Location: `apps/webui/src`
- Contains: App shell `apps/webui/src/App.tsx`, route pages in `apps/webui/src/pages`, feature components in `apps/webui/src/components`, hooks in `apps/webui/src/hooks`, stores/API/socket/utilities in `apps/webui/src/lib`, Tauri wrapper in `apps/webui/src-tauri`.
- Depends on: React 19, React Router, React Query, Zustand, Socket.io client, Better Auth client, Tauri plugins, Tailwind.
- Used by: Browser and Tauri desktop/mobile shell.

**CLI daemon and ACP adapter layer:**
- Purpose: Run local ACP backends, manage sessions, persist WAL events, serve host FS/git RPCs, and maintain gateway connection.
- Location: `apps/mobvibe-cli/src`
- Contains: CLI entry `apps/mobvibe-cli/src/index.ts`, daemon lifecycle in `apps/mobvibe-cli/src/daemon`, ACP integration in `apps/mobvibe-cli/src/acp`, auth credentials in `apps/mobvibe-cli/src/auth`, E2EE in `apps/mobvibe-cli/src/e2ee`, WAL in `apps/mobvibe-cli/src/wal`, shared local helpers in `apps/mobvibe-cli/src/lib`.
- Depends on: Bun runtime, Commander, Socket.io client, ACP SDK, pino, Bun SQLite, `@mobvibe/shared`.
- Used by: End users running the `mobvibe` binary and the gateway `/cli` namespace.

**Marketing website layer:**
- Purpose: Render static/SSR marketing, pricing, and legal pages.
- Location: `apps/website/src`
- Contains: Client entry `apps/website/src/main.tsx`, SSR entry `apps/website/src/entry-server.tsx`, page resolver `apps/website/src/lib/page-info.ts`, marketing components in `apps/website/src/components`, feature data in `apps/website/src/data/features.ts`.
- Depends on: React, Vite, Tailwind, i18next, shared legal documents from `@mobvibe/shared`.
- Used by: Netlify static hosting/prerender build.

## Data Flow

### Primary Request Path

1. WebUI initializes providers and gateway settings in `apps/webui/src/main.tsx:17`, `apps/webui/src/main.tsx:40`, and renders `App` inside `AuthProvider` at `apps/webui/src/main.tsx:31`.
2. Authenticated UI actions call REST helpers from `apps/webui/src/lib/api.ts:155` and socket handlers from `apps/webui/src/hooks/useSocket.ts:107`.
3. Gateway mounts auth, session, FS, machine, device, and notification routes in `apps/gateway/src/index.ts:319`, `apps/gateway/src/index.ts:335`, and `apps/gateway/src/index.ts:360`.
4. Session REST routes require Better Auth middleware in `apps/gateway/src/routes/sessions.ts:83` and validate `userId` before calling `SessionRouter` at `apps/gateway/src/routes/sessions.ts:117`.
5. `SessionRouter` resolves a user-owned CLI and sends a typed Socket.io RPC in `apps/gateway/src/services/session-router.ts:138` and `apps/gateway/src/services/session-router.ts:161`.
6. CLI `SocketClient` receives gateway RPCs and delegates to `SessionManager` from `apps/mobvibe-cli/src/daemon/socket-client.ts:163`.
7. `SessionManager` creates or reuses `AcpConnection` instances and writes ordered session events through `WalStore` in `apps/mobvibe-cli/src/acp/session-manager.ts:222` and `apps/mobvibe-cli/src/wal/wal-store.ts:69`.
8. CLI emits `session:event` and related updates back to gateway; gateway forwards user-scoped events through `apps/gateway/src/index.ts:221` and `apps/gateway/src/socket/webui-handlers.ts:59`.
9. WebUI applies live/backfilled events to Zustand state in `apps/webui/src/hooks/useSocket.ts:191` and displays sessions/messages from `apps/webui/src/lib/chat-store.ts:122`.

### CLI Startup and Registration Flow

1. `mobvibe start` is registered in `apps/mobvibe-cli/src/index.ts:19` and calls `runStartCommand()` in `apps/mobvibe-cli/src/start-command.ts:72`.
2. Start command loads config, optionally prompts for enabled agents, runs preflight, and starts `DaemonManager` in `apps/mobvibe-cli/src/start-command.ts:84`, `apps/mobvibe-cli/src/start-command.ts:131`, and `apps/mobvibe-cli/src/start-command.ts:133`.
3. Foreground daemon initializes crypto, `SessionManager`, and `SocketClient` in `apps/mobvibe-cli/src/daemon/daemon.ts:184` and `apps/mobvibe-cli/src/daemon/daemon.ts:193`.
4. `SocketClient` connects to `${gatewayUrl}/cli`, signs a token using the auth key pair, and registers handlers in `apps/mobvibe-cli/src/daemon/socket-client.ts:170`.
5. Gateway `/cli` namespace verifies signed tokens and registered device keys in `apps/gateway/src/socket/cli-handlers.ts:72` and `apps/gateway/src/socket/cli-handlers.ts:93`.
6. Gateway upserts machine records and adds the CLI to `CliRegistry` in `apps/gateway/src/socket/cli-handlers.ts:153` and `apps/gateway/src/socket/cli-handlers.ts:184`.

### Live Event and Backfill Flow

1. ACP backend notifications enter through `AcpConnection` client handlers in `apps/mobvibe-cli/src/acp/acp-connection.ts:115`.
2. `SessionManager` owns local session records and event emitters in `apps/mobvibe-cli/src/acp/session-manager.ts:222` and stores WAL events via `WalStore` in `apps/mobvibe-cli/src/wal/wal-store.ts:133`.
3. CLI `SocketClient` sends ordered session events to gateway using `SessionEvent` contracts from `packages/shared/src/types/socket-events.ts:39`.
4. Gateway forwards `session:event` to WebUI via `apps/gateway/src/index.ts:259` and subscriber/user emitters in `apps/gateway/src/socket/webui-handlers.ts:40`.
5. WebUI `useSocket` applies events by kind and tracks cursors for gap recovery in `apps/webui/src/hooks/useSocket.ts:77`, `apps/webui/src/hooks/useSocket.ts:145`, and `apps/webui/src/hooks/useSocket.ts:191`.

### Website Render Flow

1. Browser render starts in `apps/website/src/main.tsx:8` and wraps `App` in `ThemeProvider` at `apps/website/src/main.tsx:11`.
2. Static/SSR render uses `render()` in `apps/website/src/entry-server.tsx:29`, resolves page metadata through `apps/website/src/lib/page-info.ts`, and renders `App` with a pathname at `apps/website/src/entry-server.tsx:36`.
3. `App` selects legal, pricing, or marketing home by `resolveWebsitePage()` in `apps/website/src/App.tsx:16`.

**State Management:**
- Gateway connection/session routing state is in-memory in `apps/gateway/src/services/cli-registry.ts` and `apps/gateway/src/socket/webui-handlers.ts`; use it only for connected machines and live subscriptions.
- Gateway identity and app account state is PostgreSQL-backed through `apps/gateway/src/db/schema.ts` and Better Auth in `apps/gateway/src/lib/auth.ts`.
- Multi-instance affinity is optional Redis-backed through `apps/gateway/src/services/redis.ts`, `apps/gateway/src/services/instance-registry.ts`, and `apps/gateway/src/services/user-affinity.ts`.
- WebUI client state lives in Zustand stores such as `apps/webui/src/lib/chat-store.ts`, `apps/webui/src/lib/machines-store.ts`, `apps/webui/src/lib/ui-store.ts`, and `apps/webui/src/lib/notification-store.ts`; React Query owns server-cache state in hooks under `apps/webui/src/hooks`.
- CLI durable session history lives in Bun SQLite WAL through `apps/mobvibe-cli/src/wal/wal-store.ts`; active ACP connection/session objects live in `apps/mobvibe-cli/src/acp/session-manager.ts`.

## Key Abstractions

**SessionEvent / WAL cursor:**
- Purpose: Represent ordered, revisioned chat/session updates that can be live-streamed and backfilled.
- Examples: `packages/shared/src/types/socket-events.ts`, `apps/mobvibe-cli/src/wal/wal-store.ts`, `apps/webui/src/hooks/useSocket.ts`
- Pattern: Append locally in CLI, forward through gateway, apply idempotently in WebUI with `revision` and `seq` cursors.

**RpcRequest / RpcResponse:**
- Purpose: Correlate WebUI-initiated gateway REST operations to CLI-owned ACP actions.
- Examples: `packages/shared/src/types/socket-events.ts`, `apps/gateway/src/services/session-router.ts`, `apps/mobvibe-cli/src/daemon/socket-client.ts`
- Pattern: Gateway creates request IDs and pending promises; CLI emits `rpc:response`; gateway resolves/rejects with timeout.

**CliRegistry:**
- Purpose: Keep the gateway’s connected-machine index and user-scoped session lookup.
- Examples: `apps/gateway/src/services/cli-registry.ts`, `apps/gateway/src/socket/cli-handlers.ts`, `apps/gateway/src/routes/machines.ts`
- Pattern: Register on `cli:register`, update sessions from CLI payloads, resolve machines/sessions by `userId` for auth safety.

**SessionManager:**
- Purpose: Own the local ACP session lifecycle and bridge backend protocol details to Mobvibe concepts.
- Examples: `apps/mobvibe-cli/src/acp/session-manager.ts`, `apps/mobvibe-cli/src/acp/acp-connection.ts`, `apps/mobvibe-cli/src/daemon/socket-client.ts`
- Pattern: Keep session records in maps, use event emitters for gateway-facing updates, persist ordered events in `WalStore`.

**GatewaySocket singleton:**
- Purpose: Provide a single typed WebUI socket connection with subscription persistence across reconnects.
- Examples: `apps/webui/src/lib/socket.ts`, `apps/webui/src/hooks/useSocket.ts`
- Pattern: Export a singleton, register event handlers through methods, keep subscribed session IDs in memory, reconnect to the configured gateway URL.

**Better Auth context:**
- Purpose: Unify browser/Tauri authentication across REST and socket calls.
- Examples: `apps/gateway/src/lib/auth.ts`, `apps/gateway/src/middleware/auth.ts`, `apps/webui/src/components/auth/AuthProvider.tsx`, `apps/webui/src/lib/auth.ts`
- Pattern: Server validates sessions via `auth.api.getSession`; WebUI exposes auth state through `AuthProvider`; Tauri uses bearer tokens where cookies are unavailable.

## Entry Points

**Gateway server:**
- Location: `apps/gateway/src/index.ts`
- Triggers: `pnpm -C apps/gateway dev`, `pnpm -C apps/gateway start`, Fly deployment.
- Responsibilities: Initialize config, Express, Socket.io, Better Auth, route modules, Redis affinity, services, and shutdown handlers.

**WebUI browser/Tauri app:**
- Location: `apps/webui/src/main.tsx`
- Triggers: Vite dev/build, Tauri dev/build, browser page load.
- Responsibilities: Configure React Query, router, auth provider, Tauri storage/gateway initialization, E2EE loading, and React root rendering.

**CLI binary:**
- Location: `apps/mobvibe-cli/src/index.ts`
- Triggers: `mobvibe` binary, `bun dist/index.js`, package `bin/mobvibe.mjs`.
- Responsibilities: Register command tree and delegate daemon/auth/E2EE/compaction operations.

**CLI daemon startup:**
- Location: `apps/mobvibe-cli/src/start-command.ts`, `apps/mobvibe-cli/src/daemon/daemon.ts`
- Triggers: `mobvibe start` command.
- Responsibilities: Resolve config and agents, run preflight, start foreground/background daemon, initialize crypto/session/socket runtime.

**Website browser app:**
- Location: `apps/website/src/main.tsx`
- Triggers: Vite client bundle load.
- Responsibilities: Render marketing/pricing/legal UI.

**Website SSR/prerender:**
- Location: `apps/website/src/entry-server.tsx`
- Triggers: `apps/website` build script and prerender script.
- Responsibilities: Render static HTML and metadata for prerendered routes.

**Shared package public surface:**
- Location: `packages/shared/src/index.ts`
- Triggers: TypeScript imports from workspace packages.
- Responsibilities: Export stable types/helpers; every new shared contract belongs here.

## Architectural Constraints

- **Threading:** Gateway and WebUI run on the Node/browser event loop; CLI daemon runs on Bun/Node-compatible event loop and spawns child ACP/backend processes from `apps/mobvibe-cli/src/acp/acp-connection.ts` and background daemon process from `apps/mobvibe-cli/src/daemon/daemon.ts`.
- **Global state:** Gateway creates module-level `app`, `httpServer`, `io`, `cliRegistry`, and `sessionRouter` in `apps/gateway/src/index.ts`; WebUI uses singleton `gatewaySocket` in `apps/webui/src/lib/socket.ts`; gateway Redis connection is module-level in `apps/gateway/src/services/redis.ts`; CLI WAL and sessions are instance state in `apps/mobvibe-cli/src/acp/session-manager.ts` and `apps/mobvibe-cli/src/wal/wal-store.ts`.
- **Circular imports:** No circular dependency chain is documented in code comments; keep dependency direction from UI/CLI/Gateway toward `packages/shared/src`, not from shared back into apps.
- **Transport limits:** Gateway Socket.io sets `maxHttpBufferSize` to 4 MiB in `apps/gateway/src/index.ts:136`; WebUI and CLI prompt/file/image payload flows must stay within shared validation such as `packages/shared/src/prompt-images.ts`.
- **Multi-instance routing:** Redis affinity is optional; when `REDIS_URL` is unavailable, `apps/gateway/src/services/redis.ts` returns `null` and gateway runs without affinity, so new stateful gateway behavior must work in single-instance mode and respect replay middleware when affinity exists.
- **Auth boundary:** REST routes under `/acp` and `/fs` call `requireAuth` in `apps/gateway/src/routes/sessions.ts` and `apps/gateway/src/routes/fs.ts`; socket namespaces authenticate separately in `apps/gateway/src/socket/webui-handlers.ts` and `apps/gateway/src/socket/cli-handlers.ts`.

## Anti-Patterns

### Bypassing Shared Contracts

**What happens:** Defining socket/API payload shapes locally in an app instead of in `packages/shared/src/types/socket-events.ts` creates mismatches between WebUI, gateway, and CLI.
**Why it's wrong:** The same event crosses `apps/webui/src/lib/socket.ts`, `apps/gateway/src/socket/*`, and `apps/mobvibe-cli/src/daemon/socket-client.ts`; local-only types make runtime drift likely.
**Do this instead:** Add or update the shared type in `packages/shared/src/types/socket-events.ts` and re-export it from `packages/shared/src/index.ts` before using it in app code.

### Storing Durable Session History in Gateway Memory

**What happens:** Treating `CliRegistry` in `apps/gateway/src/services/cli-registry.ts` as durable session storage loses data on gateway restart or CLI disconnect.
**Why it's wrong:** Gateway registry is an in-memory connected-client index; ordered event history belongs to the CLI WAL.
**Do this instead:** Persist session events through `apps/mobvibe-cli/src/wal/wal-store.ts` and expose recovery through `SessionManager`/`SessionRouter` RPC paths.

### Emitting Cross-User Events Broadly

**What happens:** Emitting WebUI socket events without `userId` filtering can leak session metadata across users.
**Why it's wrong:** WebUI sockets are authenticated per user in `apps/gateway/src/socket/webui-handlers.ts`, and CLI sessions are indexed by `userId` in `apps/gateway/src/services/cli-registry.ts`.
**Do this instead:** Use `emitToUser()` or subscription ownership checks in `apps/gateway/src/socket/webui-handlers.ts` and user-scoped lookup methods in `apps/gateway/src/services/session-router.ts`.

### Adding App-Specific Logic to `packages/shared`

**What happens:** Putting runtime behavior that depends on Express, React, Bun, Socket.io, or Tauri into `packages/shared/src` couples all packages to app-specific environments.
**Why it's wrong:** Shared is consumed by Node gateway, browser/Tauri WebUI, and Bun CLI; platform-specific imports can break one target.
**Do this instead:** Keep `packages/shared/src` to platform-neutral types, validators, crypto helpers, and constants; place runtime adapters in `apps/gateway/src/lib`, `apps/webui/src/lib`, or `apps/mobvibe-cli/src/lib`.

## Error Handling

**Strategy:** Use typed `ErrorDetail` for API/RPC-facing errors, structured pino logs for gateway/CLI runtime errors, and UI normalization in WebUI.

**Patterns:**
- REST routes build request/authorization/internal errors with helpers from `@mobvibe/shared` in `apps/gateway/src/routes/sessions.ts` and `apps/gateway/src/routes/fs.ts`.
- Gateway logs request lifecycle with a generated `x-request-id` in `apps/gateway/src/index.ts:273`.
- `SessionRouter` maps RPC errors into rejected promises and logs code/scope/detail in `apps/gateway/src/services/session-router.ts:103`.
- CLI ACP errors become `ErrorDetail` through helpers in `apps/mobvibe-cli/src/acp/acp-connection.ts:177`.
- WebUI wraps failed REST responses in `ApiError` and `ErrorDetail` in `apps/webui/src/lib/api.ts:63`.

## Cross-Cutting Concerns

**Logging:** Gateway and CLI use pino loggers from `apps/gateway/src/lib/logger.ts` and `apps/mobvibe-cli/src/lib/logger.ts`; WebUI uses browser console in socket/bootstrap paths such as `apps/webui/src/lib/socket.ts` and `apps/webui/src/main.tsx`.
**Validation:** Gateway validates request bodies/queries inline in route modules such as `apps/gateway/src/routes/sessions.ts`; shared validation exists for ACP schemas and prompt images in `packages/shared/src/validation/acp-schemas.ts` and `packages/shared/src/prompt-images.ts`.
**Authentication:** Gateway Better Auth config lives in `apps/gateway/src/lib/auth.ts`; REST auth middleware lives in `apps/gateway/src/middleware/auth.ts`; WebUI auth provider lives in `apps/webui/src/components/auth/AuthProvider.tsx`; CLI auth uses signed device tokens from shared crypto in `apps/gateway/src/socket/cli-handlers.ts` and `apps/mobvibe-cli/src/daemon/socket-client.ts`.
**E2EE:** Shared crypto helpers are exported from `packages/shared/src/crypto`; CLI runtime service lives in `apps/mobvibe-cli/src/e2ee/crypto-service.ts`; WebUI E2EE client logic lives in `apps/webui/src/lib/e2ee.ts`.
**Persistence:** Gateway uses Drizzle/PostgreSQL in `apps/gateway/src/db`; CLI uses Bun SQLite WAL in `apps/mobvibe-cli/src/wal`; WebUI persisted client state uses storage adapters in `apps/webui/src/lib/storage-adapter.ts`, `apps/webui/src/lib/tauri-storage-adapter.ts`, and Zustand persist in `apps/webui/src/lib/chat-store.ts`.

---

*Architecture analysis: 2026-05-11*
