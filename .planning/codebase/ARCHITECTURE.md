# Architecture

**Analysis Date:** 2026-05-12

## System Overview

```text
┌─────────────────────────────────────────────────────────────┐
│                 Clients and Presentation Layer               │
├──────────────────┬──────────────────┬───────────────────────┤
│      WebUI       │     Website      │     Tauri Shell       │
│ `apps/webui/src` │ `apps/website`   │ `apps/webui/src-tauri`│
└────────┬─────────┴──────────────────┴──────────┬────────────┘
         │ HTTP REST + Socket.io `/webui`          │ native storage/deep links
         ▼                                         ▼
┌─────────────────────────────────────────────────────────────┐
│                    Gateway Relay Layer                       │
│ `apps/gateway/src/index.ts`                                  │
│ Express routes + Better Auth + Socket.io `/cli` and `/webui` │
└────────┬───────────────────────┬────────────────────────────┘
         │ RPC over Socket.io     │ PostgreSQL / Redis
         ▼                       ▼
┌─────────────────────────────┐ ┌─────────────────────────────┐
│       Local CLI Daemon      │ │       Gateway Storage       │
│ `apps/mobvibe-cli/src`      │ │ `apps/gateway/src/db`       │
└────────┬────────────────────┘ └─────────────────────────────┘
         │ ACP stdio + local filesystem/git + SQLite WAL
         ▼
┌─────────────────────────────────────────────────────────────┐
│                    ACP Agent Processes                       │
│ configured by `apps/mobvibe-cli/src/config.ts`               │
└─────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| WebUI app shell | Boots React, loads E2EE state, configures Tauri/browser gateway URL, and renders providers. | `apps/webui/src/main.tsx` |
| WebUI routing | Defines auth-gated routes, lazy settings/login/legal pages, and Tauri deep-link handlers. | `apps/webui/src/app/AppRoutes.tsx` |
| WebUI controller | Composes queries, socket subscriptions, session mutations, machine discovery, hotkeys, and UI state into one controller for layout components. | `apps/webui/src/app/use-main-app-controller.tsx` |
| WebUI API client | Centralizes REST calls to `/acp`, `/fs`, `/api/machines`, and `/api/notifications`; adds auth headers for Tauri. | `apps/webui/src/lib/api.ts` |
| WebUI socket client | Owns the singleton Socket.io connection to `/webui`, session subscriptions, reconnect handling, and typed event listeners. | `apps/webui/src/lib/socket.ts` |
| WebUI chat state | Stores sessions, chat messages, streaming state, WAL cursors, E2EE runtime status, and session list projections. | `apps/webui/src/lib/chat-store.ts` |
| Gateway bootstrap | Wires Express, Better Auth, routes, Socket.io namespaces, affinity services, logging middleware, and shutdown. | `apps/gateway/src/index.ts` |
| Gateway WebUI socket handlers | Authenticates `/webui` sockets and routes session events only to owning users/subscribers. | `apps/gateway/src/socket/webui-handlers.ts` |
| Gateway CLI socket handlers | Authenticates `/cli` sockets with signed device tokens, registers machines, receives events, and forwards RPC responses. | `apps/gateway/src/socket/cli-handlers.ts` |
| Gateway session router | Converts HTTP/WebUI intent into typed RPC calls to the correct CLI and tracks pending RPC timeouts. | `apps/gateway/src/services/session-router.ts` |
| Gateway CLI registry | Maintains in-memory connected CLI records, session summaries, backend capabilities, and user-scoped indexes. | `apps/gateway/src/services/cli-registry.ts` |
| Gateway database access | Encapsulates Drizzle operations for devices, machines, and web-push subscriptions. | `apps/gateway/src/services/db-service.ts` |
| CLI command entry | Defines `mobvibe` commands (`start`, `stop`, `login`, `e2ee`, `compact`) with Commander. | `apps/mobvibe-cli/src/index.ts` |
| CLI start flow | Resolves user config, optional first-run agent selection, preflight, and daemon startup. | `apps/mobvibe-cli/src/start-command.ts` |
| CLI daemon manager | Manages background/foreground daemon lifecycle, PID files, logs, crypto setup, WAL compaction, and graceful shutdown. | `apps/mobvibe-cli/src/daemon/daemon.ts` |
| CLI gateway socket | Connects to `/cli`, registers the machine, maps gateway RPC events to local operations, and emits session changes. | `apps/mobvibe-cli/src/daemon/socket-client.ts` |
| CLI ACP sessions | Manages ACP connections, active/discovered sessions, permissions, WAL persistence, worktrees, and E2EE wrapping. | `apps/mobvibe-cli/src/acp/session-manager.ts` |
| CLI WAL store | Persists local session events and discovered sessions in SQLite with prepared statements. | `apps/mobvibe-cli/src/wal/wal-store.ts` |
| Shared protocol package | Exports common ACP, session, socket, error, crypto, registry, legal, and prompt-image types. | `packages/shared/src/index.ts` |
| Shared UI package | Publishes reusable React UI primitives and theme utilities. | `packages/ui/src/index.ts` |
| Marketing website | Provides the public landing/pricing/legal experience using shared UI components. | `apps/website/src/App.tsx` |

## Pattern Overview

**Overall:** Distributed relay architecture with a stateless-ish gateway, local stateful daemon, typed shared protocol package, and React state/query composition on the client.

**Key Characteristics:**
- Use `packages/shared/src/index.ts` as the protocol boundary between `apps/webui`, `apps/gateway`, and `apps/mobvibe-cli`; add new cross-process payloads to `packages/shared/src/types/socket-events.ts` or `packages/shared/src/types/session.ts` before consuming them.
- Keep session content end-to-end encrypted through gateway routing: WebUI and CLI use crypto helpers from `packages/shared/src/crypto/index.ts`; gateway routes `EncryptedPayload` without decrypting content.
- Treat `apps/gateway/src/services/cli-registry.ts` as ephemeral connection/session index and `apps/mobvibe-cli/src/wal/wal-store.ts` as durable chat/event history.
- Use HTTP for request/response actions and Socket.io for realtime status/event streams: WebUI REST functions live in `apps/webui/src/lib/api.ts`, realtime subscriptions in `apps/webui/src/lib/socket.ts`.
- Keep UI orchestration in hooks and stores: `apps/webui/src/app/use-main-app-controller.tsx` composes domain hooks from `apps/webui/src/hooks/` and renders through layout/components in `apps/webui/src/components/`.

## Layers

**Workspace Orchestration:**
- Purpose: Coordinates builds, scripts, and package boundaries across apps and packages.
- Location: `package.json`, `pnpm-workspace.yaml`, `turbo.json`
- Contains: pnpm workspace declarations, Turbo task graph, root scripts.
- Depends on: package-level `package.json` scripts.
- Used by: every app/package under `apps/*` and `packages/*`.

**Shared Protocol and Utilities:**
- Purpose: Defines stable types, error shapes, crypto helpers, legal content, registry types, and prompt-image validation shared across runtime boundaries.
- Location: `packages/shared/src`
- Contains: `packages/shared/src/types/socket-events.ts`, `packages/shared/src/types/session.ts`, `packages/shared/src/types/errors.ts`, `packages/shared/src/crypto/*`.
- Depends on: ACP SDK, Zod, `tweetnacl`, Noble hashes.
- Used by: `apps/webui/src/lib/api.ts`, `apps/gateway/src/socket/cli-handlers.ts`, `apps/mobvibe-cli/src/acp/session-manager.ts`.

**Reusable UI System:**
- Purpose: Provides shared React primitives, theme provider, and utility class merging for WebUI and Website.
- Location: `packages/ui/src`
- Contains: component modules such as `packages/ui/src/button.tsx`, `packages/ui/src/sidebar.tsx`, `packages/ui/src/theme-provider.tsx`.
- Depends on: React, Radix/Base UI, Hugeicons, class-variance-authority, Tailwind merge.
- Used by: `apps/webui/src/app/AppProviders.tsx`, `apps/website/src/main.tsx`, route/component files importing `@mobvibe/ui/*`.

**WebUI Presentation:**
- Purpose: Renders authenticated session management, chat, settings, machine selection, file explorer, git views, and app dialogs.
- Location: `apps/webui/src`
- Contains: app shell in `apps/webui/src/app`, reusable/feature components in `apps/webui/src/components`, route pages in `apps/webui/src/pages`, stores/API/socket utilities in `apps/webui/src/lib`.
- Depends on: `@mobvibe/shared`, `@mobvibe/ui`, React Query, Zustand, React Router, Socket.io client, Tauri plugins.
- Used by: browser deployment and Tauri wrapper in `apps/webui/src-tauri`.

**Gateway HTTP and Realtime Relay:**
- Purpose: Authenticates users/devices, routes REST requests, proxies RPC to the owning CLI, forwards realtime session events, and manages multi-instance affinity.
- Location: `apps/gateway/src`
- Contains: `apps/gateway/src/index.ts`, `apps/gateway/src/routes`, `apps/gateway/src/socket`, `apps/gateway/src/services`, `apps/gateway/src/middleware`, `apps/gateway/src/db`.
- Depends on: Express, Socket.io, Better Auth, Drizzle, PostgreSQL, Redis, pino.
- Used by: WebUI clients and CLI daemons over HTTP/WebSocket.

**CLI Daemon and ACP Adapter:**
- Purpose: Runs on the user's machine, discovers configured ACP agents, starts/loads sessions, handles filesystem/git RPCs, stores session WAL history, and streams encrypted events to the gateway.
- Location: `apps/mobvibe-cli/src`
- Contains: command entry in `apps/mobvibe-cli/src/index.ts`, daemon lifecycle in `apps/mobvibe-cli/src/daemon`, ACP session management in `apps/mobvibe-cli/src/acp`, auth in `apps/mobvibe-cli/src/auth`, WAL persistence in `apps/mobvibe-cli/src/wal`, registry discovery in `apps/mobvibe-cli/src/registry`.
- Depends on: Bun runtime, ACP SDK, Socket.io client, local filesystem/git commands, SQLite, pino.
- Used by: installed `mobvibe` CLI binary and gateway RPC/event flows.

**Gateway Persistence and Affinity:**
- Purpose: Stores auth/users/machines/device keys/push subscriptions in PostgreSQL and coordinates sticky routing with Redis/Fly Replay.
- Location: `apps/gateway/src/db`, `apps/gateway/src/services/redis.ts`, `apps/gateway/src/services/instance-registry.ts`, `apps/gateway/src/services/user-affinity.ts`, `apps/gateway/src/middleware/fly-replay.ts`
- Contains: Drizzle schema, pooled DB connection, Redis-backed instance/user affinity managers, Fly Replay middleware.
- Depends on: `DATABASE_URL`, optional `REDIS_URL`, Fly instance metadata.
- Used by: gateway bootstrap and route/socket handlers in `apps/gateway/src/index.ts`.

**Marketing Website:**
- Purpose: Static/SSR-prerendered landing, pricing, demo, and legal pages.
- Location: `apps/website/src`
- Contains: route resolver in `apps/website/src/lib/page-info.ts`, app in `apps/website/src/App.tsx`, SSR entry in `apps/website/src/entry-server.tsx`, browser entry in `apps/website/src/main.tsx`.
- Depends on: React, Vite, Tailwind, `@mobvibe/ui`, legal documents from `@mobvibe/shared`.
- Used by: Netlify website deployment.

## Data Flow

### Primary Request Path

1. WebUI initializes providers and app routes (`apps/webui/src/main.tsx:15`, `apps/webui/src/app/AppProviders.tsx:20`, `apps/webui/src/app/AppRoutes.tsx:125`).
2. Authenticated WebUI controller fetches sessions/backends and connects Socket.io through `useSocket` (`apps/webui/src/app/use-main-app-controller.tsx:146`).
3. REST session operations call gateway endpoints through `requestJson` (`apps/webui/src/lib/api.ts:72`, `apps/webui/src/lib/api.ts:155`, `apps/webui/src/lib/api.ts:158`).
4. Gateway mounts Better Auth, `/acp`, `/fs`, `/api/machines`, and `/api/notifications` routes (`apps/gateway/src/index.ts:319`, `apps/gateway/src/index.ts:360`).
5. Session routes authenticate requests and delegate to `SessionRouter` (`apps/gateway/src/routes/sessions.ts:83`, `apps/gateway/src/routes/sessions.ts:173`).
6. `SessionRouter` resolves the user-owned CLI and sends an RPC over Socket.io (`apps/gateway/src/services/session-router.ts:81`, `apps/gateway/src/services/session-router.ts:161`).
7. CLI `SocketClient` receives gateway RPCs and invokes `SessionManager`/filesystem/git handlers (`apps/mobvibe-cli/src/daemon/socket-client.ts:183`, `apps/mobvibe-cli/src/acp/session-manager.ts:222`).
8. `SessionManager` talks to ACP agent processes and persists events in WAL (`apps/mobvibe-cli/src/acp/session-manager.ts:252`, `apps/mobvibe-cli/src/wal/wal-store.ts:69`).
9. CLI emits session events to gateway; gateway forwards `session:event` only to subscribed WebUI sockets (`apps/gateway/src/index.ts:259`, `apps/gateway/src/socket/webui-handlers.ts:242`).

### CLI Registration and Affinity Flow

1. `mobvibe start` resolves config and starts daemon (`apps/mobvibe-cli/src/index.ts:20`, `apps/mobvibe-cli/src/start-command.ts:72`).
2. Daemon creates crypto, `SessionManager`, and `SocketClient` (`apps/mobvibe-cli/src/daemon/daemon.ts:193`, `apps/mobvibe-cli/src/daemon/daemon.ts:196`).
3. CLI socket signs auth payload using content from credentials/crypto service (`apps/mobvibe-cli/src/daemon/socket-client.ts:173`).
4. Gateway `/cli` namespace verifies signed token and resolves a registered device key (`apps/gateway/src/socket/cli-handlers.ts:72`, `apps/gateway/src/socket/cli-handlers.ts:93`).
5. Gateway upserts machine rows and registers the in-memory CLI record (`apps/gateway/src/socket/cli-handlers.ts:160`, `apps/gateway/src/socket/cli-handlers.ts:184`).
6. When Redis affinity exists, WebUI/CLI user ownership is claimed and wrong-instance connections use Fly Replay/redirects (`apps/gateway/src/index.ts:73`, `apps/gateway/src/socket/cli-handlers.ts:112`, `apps/gateway/src/socket/webui-handlers.ts:138`).

### Realtime Session Event Flow

1. WebUI subscribes to one session through the socket singleton (`apps/webui/src/lib/socket.ts:107`).
2. Gateway stores the subscription in `sessionSubscriptions` (`apps/gateway/src/socket/webui-handlers.ts:31`, `apps/gateway/src/socket/webui-handlers.ts:178`).
3. ACP notifications are transformed by `SessionManager` into sequenced `SessionEvent` records (`apps/mobvibe-cli/src/acp/session-manager.ts:222`, `packages/shared/src/types/socket-events.ts:39`).
4. Events are appended to SQLite WAL (`apps/mobvibe-cli/src/wal/wal-store.ts:133`).
5. CLI sends events to gateway, gateway emits `session:event` to subscribers (`apps/gateway/src/index.ts:259`, `apps/gateway/src/socket/webui-handlers.ts:242`).
6. WebUI socket handlers feed events into Zustand actions selected by `useMainAppController` (`apps/webui/src/app/use-main-app-controller.tsx:146`, `apps/webui/src/lib/chat-store.ts:122`).

**State Management:**
- Gateway state is in memory for live connections/sessions (`apps/gateway/src/services/cli-registry.ts`) plus PostgreSQL for durable auth/device/machine/push rows (`apps/gateway/src/db/schema.ts`) and optional Redis for affinity (`apps/gateway/src/services/redis.ts`).
- CLI state is local filesystem config and PID/log files (`apps/mobvibe-cli/src/config.ts`), SQLite WAL/discovered sessions (`apps/mobvibe-cli/src/wal/wal-store.ts`), and in-memory ACP session maps (`apps/mobvibe-cli/src/acp/session-manager.ts:222`).
- WebUI state uses React Query for server snapshots (`apps/webui/src/app/AppProviders.tsx:7`), Zustand for chat/machines/UI (`apps/webui/src/lib/chat-store.ts`, `apps/webui/src/lib/machines-store.ts`, `apps/webui/src/lib/ui-store.ts`), and a Socket.io singleton for realtime transport (`apps/webui/src/lib/socket.ts:21`).

## Key Abstractions

**SessionEvent / WAL Cursor:**
- Purpose: Represents ordered, replayable session updates with `revision` and `seq` for backfill and reconnection.
- Examples: `packages/shared/src/types/socket-events.ts`, `apps/mobvibe-cli/src/wal/wal-store.ts`, `apps/webui/src/lib/chat-store.ts`
- Pattern: append-only local event log at CLI; gateway forwards current events; WebUI applies events idempotently using cursor fields.

**SessionRouter RPC Bridge:**
- Purpose: Converts authenticated HTTP actions into typed RPC requests to the owning CLI socket and resolves/rejects pending promises by `requestId`.
- Examples: `apps/gateway/src/services/session-router.ts`, `packages/shared/src/types/socket-events.ts`
- Pattern: gateway-side request broker with user-scoped CLI resolution and timeout map.

**CliRegistry:**
- Purpose: Tracks live CLI machines, sessions, capabilities, and user indexes for authorization and routing.
- Examples: `apps/gateway/src/services/cli-registry.ts`, `apps/gateway/src/socket/webui-handlers.ts`, `apps/gateway/src/routes/sessions.ts`
- Pattern: process-local EventEmitter registry; do not treat it as durable storage.

**GatewaySocket Singleton:**
- Purpose: Shares one WebUI Socket.io connection across hooks/components and preserves subscriptions across reconnects.
- Examples: `apps/webui/src/lib/socket.ts`
- Pattern: class singleton exported as `gatewaySocket`; new realtime APIs should add typed methods on this class.

**React Controller Hook:**
- Purpose: Keeps high-level application orchestration outside JSX layout components.
- Examples: `apps/webui/src/app/use-main-app-controller.tsx`, `apps/webui/src/app/MainApp.tsx`, `apps/webui/src/app/MainLayout.tsx`
- Pattern: `MainApp` invokes a controller hook and passes an object to `MainLayout`.

**Shared Package Exports:**
- Purpose: Stabilizes public import surface for workspace consumers.
- Examples: `packages/shared/src/index.ts`, `packages/ui/src/index.ts`, `packages/ui/package.json`
- Pattern: add new public cross-package modules to `src/index.ts` and package `exports` where consumers import subpaths.

**E2EE Crypto Helpers:**
- Purpose: Generate/derive keys, wrap DEKs, encrypt/decrypt payloads, and sign CLI auth tokens.
- Examples: `packages/shared/src/crypto/index.ts`, `apps/mobvibe-cli/src/daemon/socket-client.ts`, `apps/webui/src/lib/e2ee.ts`
- Pattern: gateway validates auth signatures but does not decrypt message content.

## Entry Points

**WebUI browser/Tauri app:**
- Location: `apps/webui/src/main.tsx`
- Triggers: Vite bundle loaded by `apps/webui/index.html` and Tauri webview.
- Responsibilities: initialize i18n/styles, Tauri storage/gateway URL/auth token/E2EE, then render `AppProviders` and `App`.

**WebUI routes:**
- Location: `apps/webui/src/app/AppRoutes.tsx`
- Triggers: React Router after provider setup.
- Responsibilities: lazy-load pages, enforce login redirect, handle Tauri auth/deep-link pairing.

**Gateway server:**
- Location: `apps/gateway/src/index.ts`
- Triggers: `pnpm -C apps/gateway dev`, `pnpm -C apps/gateway start`, or Docker/Fly process start.
- Responsibilities: configure HTTP server, routes, Better Auth, Socket.io namespaces, Redis affinity, and graceful shutdown.

**CLI command:**
- Location: `apps/mobvibe-cli/src/index.ts`
- Triggers: `mobvibe` binary / `bun dist/index.js`.
- Responsibilities: parse commands, start/stop/status/logs/login/e2ee/compact workflows.

**CLI daemon runtime:**
- Location: `apps/mobvibe-cli/src/daemon/daemon.ts`
- Triggers: `mobvibe start --foreground` directly or background child process from `DaemonManager.spawnBackground`.
- Responsibilities: initialize local runtime, connect to gateway, manage ACP sessions and WAL lifecycle.

**Website browser app:**
- Location: `apps/website/src/main.tsx`
- Triggers: Vite website bundle.
- Responsibilities: mount marketing app with theme provider.

**Website SSR/prerender:**
- Location: `apps/website/src/entry-server.tsx`
- Triggers: website build script in `apps/website/package.json`.
- Responsibilities: render routes for prerendering/static output.

## Architectural Constraints

- **Threading:** Node gateway uses a single event loop with async DB/Redis/socket I/O in `apps/gateway/src/index.ts`; CLI uses Bun/Node APIs with child ACP processes and local SQLite in `apps/mobvibe-cli/src/daemon/daemon.ts` and `apps/mobvibe-cli/src/acp/session-manager.ts`.
- **Global state:** Gateway creates module-level `app`, `httpServer`, `io`, `cliRegistry`, `sessionRouter`, `instanceRegistry`, `userAffinity`, and timers in `apps/gateway/src/index.ts`; WebUI creates singleton `queryClient` in `apps/webui/src/app/AppProviders.tsx` and singleton `gatewaySocket` in `apps/webui/src/lib/socket.ts`.
- **Circular imports:** Not detected during mapping; maintain shared type definitions in `packages/shared/src` to prevent app-to-app imports.
- **State locality:** Do not persist chat history in gateway DB; session history belongs in CLI WAL at `apps/mobvibe-cli/src/wal/wal-store.ts`.
- **Authentication split:** Browser WebUI authenticates through Better Auth cookies; Tauri WebUI passes bearer tokens in `apps/webui/src/lib/api.ts` and `apps/webui/src/lib/socket.ts`; CLI authenticates with signed device tokens in `apps/gateway/src/socket/cli-handlers.ts`.
- **Package boundaries:** Apps may import `@mobvibe/shared` and `@mobvibe/ui`; avoid direct imports from another app's `src` tree.

## Anti-Patterns

### Bypassing Shared Protocol Types

**What happens:** New socket/REST payloads are defined ad hoc inside an app file instead of `packages/shared/src/types/socket-events.ts` or `packages/shared/src/types/session.ts`.
**Why it's wrong:** WebUI, gateway, and CLI drift apart and runtime payload mismatches become invisible to TypeScript.
**Do this instead:** Add or update the shared type in `packages/shared/src/types/socket-events.ts`, export it from `packages/shared/src/index.ts`, and consume it from `apps/webui/src/lib/api.ts`, `apps/gateway/src/services/session-router.ts`, and `apps/mobvibe-cli/src/daemon/socket-client.ts`.

### Treating Gateway Registry as Durable Storage

**What happens:** Business logic assumes `CliRegistry.sessions` in `apps/gateway/src/services/cli-registry.ts` contains complete historical session data.
**Why it's wrong:** The registry is process-local and rebuilt from connected CLIs; it can be empty after restarts or disconnects.
**Do this instead:** Ask the CLI for history via RPC/backfill through `apps/gateway/src/services/session-router.ts` and persist/replay from `apps/mobvibe-cli/src/wal/wal-store.ts`.

### Direct Component-Level Socket Creation

**What happens:** Components or hooks instantiate `io()` directly instead of using `gatewaySocket`.
**Why it's wrong:** Duplicate sockets break subscription tracking, reconnect behavior, and auth handling.
**Do this instead:** Add typed event helpers to `apps/webui/src/lib/socket.ts` and consume them through hooks like `apps/webui/src/hooks/useSocket.ts`.

### Decrypting Session Content in Gateway

**What happens:** Gateway route/socket code inspects plaintext user prompts or assistant responses.
**Why it's wrong:** The architecture promises E2EE; gateway should only authenticate, route, and persist non-content metadata.
**Do this instead:** Keep payload encryption/decryption in WebUI/CLI crypto flows (`apps/webui/src/lib/e2ee.ts`, `apps/mobvibe-cli/src/e2ee/crypto-service.ts`, `packages/shared/src/crypto/index.ts`) and route `EncryptedPayload` through gateway unchanged.

## Error Handling

**Strategy:** Use typed error payloads at protocol boundaries, structured pino logs on gateway/CLI, and normalized `ApiError` objects in WebUI.

**Patterns:**
- Shared error shape is defined and exported from `packages/shared/src/types/errors.ts` via `packages/shared/src/index.ts`.
- Gateway routes respond with `{ error: ErrorDetail }` through helpers like `respondError` in `apps/gateway/src/routes/sessions.ts:28`.
- Gateway RPC errors from CLI reject pending promises with logged structured details in `apps/gateway/src/services/session-router.ts:111`.
- WebUI REST failures throw `ApiError` from `apps/webui/src/lib/api.ts:63` and fallback errors from `apps/webui/src/lib/error-utils.ts`.
- CLI logs daemon/session/socket failures through pino logger imports such as `apps/mobvibe-cli/src/daemon/daemon.ts:10` and `apps/mobvibe-cli/src/daemon/socket-client.ts:45`.

## Cross-Cutting Concerns

**Logging:** Gateway and CLI use pino loggers (`apps/gateway/src/lib/logger.ts`, `apps/mobvibe-cli/src/lib/logger.ts`); WebUI currently uses console diagnostics in browser-facing transport/bootstrap files (`apps/webui/src/main.tsx`, `apps/webui/src/lib/socket.ts`).
**Validation:** Gateway validates route payloads before RPC calls (`apps/gateway/src/routes/sessions.ts`); CLI validates paths, prompt images, worktree paths, and agent capabilities (`apps/mobvibe-cli/src/acp/session-manager.ts`, `apps/mobvibe-cli/src/daemon/socket-client.ts`); shared validation utilities live in `packages/shared/src/validation/acp-schemas.ts` and `packages/shared/src/prompt-images.ts`.
**Authentication:** Better Auth handles WebUI/user sessions (`apps/gateway/src/lib/auth.ts`, `apps/gateway/src/index.ts:322`); WebUI supports cookie auth and Tauri bearer tokens (`apps/webui/src/lib/api.ts`, `apps/webui/src/lib/socket.ts`); CLI device auth uses signed tokens verified by gateway (`apps/gateway/src/socket/cli-handlers.ts:72`).
**Authorization:** Gateway scopes session/machine lookups to user IDs in route handlers and `SessionRouter` (`apps/gateway/src/routes/sessions.ts:96`, `apps/gateway/src/services/session-router.ts:81`).
**Internationalization:** WebUI and website initialize i18n from `apps/webui/src/i18n` and `apps/website/src/i18n`; route/components use `react-i18next`.
**Styling:** WebUI/website use Tailwind CSS and shared `@mobvibe/ui` primitives; Vite aliases `@` to each app's `src` (`apps/webui/vite.config.ts`, `apps/website/vite.config.ts`).
**Deployment:** Gateway deployment config is at `fly.toml` and legacy `render.yaml`; WebUI/Website Netlify configs are `apps/webui/netlify.toml` and `apps/website/netlify.toml`.

---

*Architecture analysis: 2026-05-12*
