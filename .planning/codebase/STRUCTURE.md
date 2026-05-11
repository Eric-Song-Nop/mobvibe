---
last_mapped_commit: 7e89508dcca9477698c5e492fe7b8fdf9195f9af
mapping_date: 2026-05-11
---
# Codebase Structure

**Analysis Date:** 2026-05-11

## Directory Layout

```text
mobvibe/
├── apps/                         # Deployable/runtime applications
│   ├── gateway/                  # Express + Socket.io gateway service
│   │   ├── src/                  # Gateway TypeScript source
│   │   │   ├── db/               # Drizzle database schema/client
│   │   │   ├── lib/              # Auth, email, logger utilities
│   │   │   ├── middleware/       # Express middleware
│   │   │   ├── routes/           # REST route modules
│   │   │   ├── services/         # Gateway business/routing services
│   │   │   └── socket/           # Socket.io namespace handlers
│   │   └── drizzle.config.ts     # Drizzle configuration
│   ├── mobvibe-cli/              # Bun-powered CLI daemon package
│   │   ├── src/                  # CLI TypeScript source
│   │   │   ├── acp/              # ACP backend/session integration
│   │   │   ├── auth/             # CLI credential/login handling
│   │   │   ├── daemon/           # Daemon lifecycle and gateway socket client
│   │   │   ├── e2ee/             # CLI runtime crypto service
│   │   │   ├── lib/              # CLI local helpers
│   │   │   ├── registry/         # Agent registry/detection
│   │   │   └── wal/              # Local SQLite WAL storage
│   │   ├── bin/                  # Published CLI binary wrapper
│   │   └── npm/                  # Platform package manifests for binary distribution
│   ├── webui/                    # React + Vite + Tauri authenticated app
│   │   ├── src/                  # WebUI React source
│   │   │   ├── components/       # UI and feature components
│   │   │   ├── hooks/            # React hooks for sessions/socket/data
│   │   │   ├── i18n/             # WebUI translations
│   │   │   ├── lib/              # API, socket, stores, utils, E2EE
│   │   │   └── pages/            # Route-level pages
│   │   ├── src-tauri/            # Tauri native wrapper and Rust source
│   │   ├── tests/                # WebUI E2E/integration tests
│   │   └── public/               # Static web assets and copied WASM assets
│   └── website/                  # Public marketing site
│       ├── src/                  # Website React source
│       │   ├── components/       # Marketing/legal/UI components
│       │   ├── data/             # Marketing content data
│       │   ├── hooks/            # Website-specific hooks
│       │   ├── i18n/             # Website translations
│       │   └── lib/              # Page metadata and utilities
│       └── scripts/              # Website build/prerender helpers
├── packages/                     # Workspace libraries
│   ├── shared/                   # Shared TypeScript contracts/helpers
│   │   └── src/
│   │       ├── crypto/           # Shared crypto/E2EE helpers
│   │       ├── legal/            # Legal document data/helpers
│   │       ├── types/            # Cross-app API/socket/session/error types
│   │       └── validation/       # Shared validators
│   └── core/                     # Build output only in current checkout
├── docs/                         # Project documentation
├── brand/                        # Brand/design assets
├── packaging/                    # Packaging/distribution assets
├── public/                       # Root-level static assets
├── .github/workflows/            # CI/CD workflows
├── .planning/codebase/           # Generated codebase maps
├── package.json                  # Root scripts and package manager metadata
├── pnpm-workspace.yaml           # Workspace package globs
├── turbo.json                    # Turborepo task graph
├── biome.json                    # Formatting/lint configuration
├── fly.toml                      # Gateway Fly deployment config
└── render.yaml                   # Legacy/transition deployment config
```

## Directory Purposes

**`apps/gateway`:**
- Purpose: Run the hosted gateway service that authenticates users/devices, exposes REST APIs, handles WebSocket traffic, and routes session RPCs to connected CLIs.
- Contains: `apps/gateway/src/index.ts`, route modules in `apps/gateway/src/routes`, socket modules in `apps/gateway/src/socket`, services in `apps/gateway/src/services`, Drizzle schema in `apps/gateway/src/db/schema.ts`, Better Auth setup in `apps/gateway/src/lib/auth.ts`.
- Key files: `apps/gateway/src/index.ts`, `apps/gateway/src/services/session-router.ts`, `apps/gateway/src/services/cli-registry.ts`, `apps/gateway/src/socket/cli-handlers.ts`, `apps/gateway/src/socket/webui-handlers.ts`, `apps/gateway/src/routes/sessions.ts`, `apps/gateway/src/db/schema.ts`.

**`apps/webui`:**
- Purpose: Run the authenticated chat UI in browser/Tauri and interact with the gateway over REST and Socket.io.
- Contains: React app source in `apps/webui/src`, Tauri wrapper in `apps/webui/src-tauri`, tests in `apps/webui/src/__tests__` and `apps/webui/tests`, Vite/Tailwind/Playwright/Vitest configs.
- Key files: `apps/webui/src/main.tsx`, `apps/webui/src/App.tsx`, `apps/webui/src/lib/api.ts`, `apps/webui/src/lib/socket.ts`, `apps/webui/src/lib/chat-store.ts`, `apps/webui/src/hooks/useSocket.ts`, `apps/webui/src/components/auth/AuthProvider.tsx`.

**`apps/mobvibe-cli`:**
- Purpose: Provide the local `mobvibe` CLI and daemon that run ACP agents, maintain local session WAL history, and connect to the gateway.
- Contains: CLI commands in `apps/mobvibe-cli/src/index.ts`, startup flow in `apps/mobvibe-cli/src/start-command.ts`, daemon/runtime code in `apps/mobvibe-cli/src/daemon`, ACP session code in `apps/mobvibe-cli/src/acp`, WAL code in `apps/mobvibe-cli/src/wal`, auth and E2EE code in `apps/mobvibe-cli/src/auth` and `apps/mobvibe-cli/src/e2ee`.
- Key files: `apps/mobvibe-cli/src/index.ts`, `apps/mobvibe-cli/src/start-command.ts`, `apps/mobvibe-cli/src/daemon/daemon.ts`, `apps/mobvibe-cli/src/daemon/socket-client.ts`, `apps/mobvibe-cli/src/acp/session-manager.ts`, `apps/mobvibe-cli/src/acp/acp-connection.ts`, `apps/mobvibe-cli/src/wal/wal-store.ts`.

**`apps/website`:**
- Purpose: Build the public marketing/pricing/legal website with client and SSR/prerender entries.
- Contains: React source in `apps/website/src`, website build scripts in `apps/website/scripts`, Netlify config in `apps/website/netlify.toml`, Vite/TypeScript configs.
- Key files: `apps/website/src/main.tsx`, `apps/website/src/entry-server.tsx`, `apps/website/src/App.tsx`, `apps/website/src/lib/page-info.ts`, `apps/website/src/data/features.ts`, `apps/website/src/components/PricingPage.tsx`.

**`packages/shared`:**
- Purpose: Share typed API/socket contracts, ACP SDK aliases/extensions, crypto helpers, legal data, validators, and reusable constants across apps.
- Contains: Public export surface in `packages/shared/src/index.ts`, socket/API contracts in `packages/shared/src/types/socket-events.ts`, ACP type re-exports in `packages/shared/src/types/acp.ts`, session/error/registry types, crypto helpers in `packages/shared/src/crypto`, validation in `packages/shared/src/validation`.
- Key files: `packages/shared/src/index.ts`, `packages/shared/src/types/socket-events.ts`, `packages/shared/src/types/session.ts`, `packages/shared/src/types/errors.ts`, `packages/shared/src/crypto/index.ts`, `packages/shared/src/validation/acp-schemas.ts`.

**`packages/core`:**
- Purpose: Reserved/shared package location; current checkout contains build output and installed dependencies only.
- Contains: `packages/core/dist`, `packages/core/node_modules`, `packages/core/.turbo`.
- Key files: Not applicable for source additions unless `packages/core/src` is introduced with a package manifest update.

**`docs`:**
- Purpose: Human-facing architecture, deployment, feature, and implementation notes.
- Contains: Markdown project documentation.
- Key files: Use existing docs under `docs/` for feature/background context; update relevant docs when changing behavior or environment requirements.

**`brand`, `public`, `packaging`:**
- Purpose: Asset and distribution support directories.
- Contains: Brand assets in `brand/`, root static assets in `public/`, release/package assets in `packaging/`.
- Key files: Use only for assets or packaging metadata, not runtime application logic.

**`.github/workflows`:**
- Purpose: CI/CD automation.
- Contains: GitHub Actions workflows including gateway deployment.
- Key files: `.github/workflows/deploy-fly.yml`.

**`.planning/codebase`:**
- Purpose: Generated GSD codebase maps consumed by planning/execution commands.
- Contains: `ARCHITECTURE.md`, `STRUCTURE.md`, and other focus-specific mapping docs.
- Key files: `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/STRUCTURE.md`.

## Key File Locations

**Entry Points:**
- `apps/gateway/src/index.ts`: Gateway server entrypoint for Express, Socket.io, routes, auth, affinity, and shutdown.
- `apps/webui/src/main.tsx`: WebUI React root, providers, Tauri gateway setup, and E2EE bootstrap.
- `apps/webui/src/App.tsx`: Main authenticated app composition, route declarations, store wiring, and feature dialogs.
- `apps/mobvibe-cli/src/index.ts`: CLI command tree for `start`, `stop`, `status`, `login`, `logout`, `e2ee`, and `compact`.
- `apps/mobvibe-cli/src/start-command.ts`: `mobvibe start` orchestration before daemon startup.
- `apps/website/src/main.tsx`: Website browser entrypoint.
- `apps/website/src/entry-server.tsx`: Website SSR/prerender entrypoint.
- `packages/shared/src/index.ts`: Public export surface for shared package consumers.

**Configuration:**
- `package.json`: Root pnpm/Turbo scripts and Node/pnpm version expectations.
- `pnpm-workspace.yaml`: Workspace package includes for `apps/*` and `packages/*`.
- `turbo.json`: Task dependency graph and build/test/lint cache behavior.
- `biome.json`: Repository formatting and lint rules.
- `apps/gateway/package.json`: Gateway scripts and dependencies.
- `apps/gateway/drizzle.config.ts`: Drizzle migration/schema configuration.
- `apps/gateway/src/config.ts`: Gateway runtime configuration and env parsing.
- `apps/gateway/src/env.ts`: Gateway environment loading.
- `apps/webui/vite.config.ts`: WebUI Vite build config.
- `apps/webui/vitest.config.ts`: WebUI Vitest config.
- `apps/webui/playwright.config.ts`: WebUI E2E config.
- `apps/webui/src-tauri/tauri.conf.json`: Tauri desktop/mobile shell config.
- `apps/mobvibe-cli/package.json`: CLI package/bin/scripts/dependencies.
- `apps/mobvibe-cli/src/config.ts`: CLI resolved runtime config.
- `apps/mobvibe-cli/src/config-loader.ts`: CLI user config loading/saving.
- `apps/website/vite.config.ts`: Website Vite build config.
- `packages/shared/tsconfig.json`: Shared package TypeScript build config.
- `fly.toml`: Gateway Fly.io deployment config.
- `apps/webui/netlify.toml`: WebUI Netlify deployment config.
- `apps/website/netlify.toml`: Website Netlify deployment config.
- `render.yaml`: Legacy/transition deployment config.

**Core Logic:**
- `apps/gateway/src/services/session-router.ts`: User-scoped gateway-to-CLI RPC routing.
- `apps/gateway/src/services/cli-registry.ts`: In-memory connected CLI/session/backend index.
- `apps/gateway/src/services/db-service.ts`: Gateway database operations around devices and machines.
- `apps/gateway/src/services/notification-service.ts`: Web push notification service.
- `apps/gateway/src/services/instance-registry.ts`: Redis-backed instance heartbeat/registry.
- `apps/gateway/src/services/user-affinity.ts`: Redis-backed user-to-instance affinity.
- `apps/gateway/src/routes/sessions.ts`: `/acp` session/backends/message/permission REST API.
- `apps/gateway/src/routes/fs.ts`: `/fs` host/session filesystem and git REST API.
- `apps/gateway/src/routes/machines.ts`: `/api/machines` list route.
- `apps/gateway/src/routes/device.ts`: Device registration/key routes.
- `apps/gateway/src/routes/notifications.ts`: Web push subscription routes.
- `apps/gateway/src/socket/cli-handlers.ts`: `/cli` namespace auth, registration, RPC/event handling.
- `apps/gateway/src/socket/webui-handlers.ts`: `/webui` namespace auth, subscription, emit helpers.
- `apps/webui/src/lib/api.ts`: WebUI REST client.
- `apps/webui/src/lib/socket.ts`: WebUI Socket.io singleton.
- `apps/webui/src/lib/chat-store.ts`: WebUI chat/session Zustand store.
- `apps/webui/src/lib/machines-store.ts`: WebUI machine/backend Zustand store.
- `apps/webui/src/lib/ui-store.ts`: WebUI UI/draft Zustand store.
- `apps/webui/src/hooks/useSocket.ts`: Live event and WAL backfill application hook.
- `apps/webui/src/hooks/useSessionQueries.ts`: Session/backend React Query hooks.
- `apps/webui/src/hooks/useSessionMutations.ts`: Session mutation action hooks.
- `apps/mobvibe-cli/src/daemon/daemon.ts`: CLI daemon process lifecycle.
- `apps/mobvibe-cli/src/daemon/socket-client.ts`: CLI Socket.io gateway client and RPC handlers.
- `apps/mobvibe-cli/src/acp/session-manager.ts`: Local ACP session lifecycle and event persistence.
- `apps/mobvibe-cli/src/acp/acp-connection.ts`: ACP process/client adapter.
- `apps/mobvibe-cli/src/wal/wal-store.ts`: SQLite WAL persistence.
- `apps/mobvibe-cli/src/wal/compactor.ts`: WAL compaction.
- `packages/shared/src/types/socket-events.ts`: Socket and HTTP API contract types.
- `packages/shared/src/types/session.ts`: Session and backend contract types.
- `packages/shared/src/types/errors.ts`: Shared `ErrorDetail` and `AppError` helpers.
- `packages/shared/src/crypto/index.ts`: Shared crypto/E2EE public surface.

**Testing:**
- `apps/gateway/src/__tests__`: Gateway package-level tests.
- `apps/gateway/src/services/__tests__`: Gateway service tests.
- `apps/gateway/src/socket/__tests__`: Gateway socket handler tests.
- `apps/gateway/src/lib/__tests__`: Gateway library tests.
- `apps/webui/src/__tests__`: WebUI Vitest tests.
- `apps/webui/src/lib/__tests__`: WebUI utility/store tests.
- `apps/webui/tests`: WebUI Playwright/E2E tests.
- `apps/mobvibe-cli/src/**/__tests__`: CLI Bun tests colocated by feature folder.
- `packages/shared/tests`: Shared package Vitest tests.

## Naming Conventions

**Files:**
- Use `kebab-case` for normal TypeScript files: `apps/gateway/src/services/session-router.ts`, `apps/mobvibe-cli/src/config-loader.ts`, `packages/shared/src/types/socket-events.ts`.
- Use `PascalCase.tsx` for React components and route pages: `apps/webui/src/components/app/AppHeader.tsx`, `apps/webui/src/pages/SettingsPage.tsx`, `apps/website/src/components/PricingPage.tsx`.
- Use `useX.ts` or `use-kebab-name.ts` for hooks according to local folder style: `apps/webui/src/hooks/useSocket.ts`, `apps/webui/src/hooks/use-session-backfill.ts`, `apps/website/src/hooks/use-streaming-demo.ts`.
- Use `*.test.ts` or `*.test.tsx` for tests: `apps/gateway/src/socket/__tests__/cli-handlers.test.ts`, `apps/webui/src/__tests__/app.test.tsx`, `apps/mobvibe-cli/src/acp/__tests__/session-manager.test.ts`.
- Use `*-store.ts` for Zustand stores in WebUI: `apps/webui/src/lib/chat-store.ts`, `apps/webui/src/lib/machines-store.ts`, `apps/webui/src/lib/ui-store.ts`.

**Directories:**
- Use domain folders under app `src`: `routes`, `services`, `socket`, `middleware`, `lib`, `db` in `apps/gateway/src`; `components`, `hooks`, `lib`, `pages`, `i18n` in `apps/webui/src`; `acp`, `daemon`, `auth`, `e2ee`, `wal`, `registry`, `lib` in `apps/mobvibe-cli/src`.
- Keep colocated tests under `__tests__` beside the code they cover: `apps/gateway/src/services/__tests__`, `apps/mobvibe-cli/src/wal/__tests__`.
- Use feature folders under WebUI components: `apps/webui/src/components/app`, `apps/webui/src/components/chat`, `apps/webui/src/components/machines`, `apps/webui/src/components/settings`, `apps/webui/src/components/ui`.
- Use `types`, `crypto`, `validation`, and data-focused directories in `packages/shared/src`; do not add app-specific directories there.

## Where to Add New Code

**New Gateway REST endpoint:**
- Primary code: Add a route module or extend an existing route under `apps/gateway/src/routes`; mount it from `apps/gateway/src/index.ts` if it is a new router.
- Shared types: Add request/response payload types to `packages/shared/src/types/socket-events.ts` or a focused shared type file, then export from `packages/shared/src/index.ts`.
- Auth: Use `requireAuth` from `apps/gateway/src/middleware/auth.ts` and user-scoped lookup methods in `apps/gateway/src/services/session-router.ts` or `apps/gateway/src/services/cli-registry.ts`.
- Tests: Add Vitest tests under `apps/gateway/src/routes/__tests__` if a new folder exists, or the closest existing `apps/gateway/src/**/__tests__` folder.

**New Gateway Socket.io event:**
- Primary code: Add event contracts to `packages/shared/src/types/socket-events.ts`.
- CLI side: Add `/cli` handling or emission in `apps/gateway/src/socket/cli-handlers.ts` and `apps/mobvibe-cli/src/daemon/socket-client.ts`.
- WebUI side: Add `/webui` handling or emission in `apps/gateway/src/socket/webui-handlers.ts`, `apps/webui/src/lib/socket.ts`, and `apps/webui/src/hooks/useSocket.ts`.
- Tests: Add socket tests under `apps/gateway/src/socket/__tests__` and WebUI/CLI tests near changed hooks or daemon code.

**New WebUI route/page:**
- Primary code: Add page component to `apps/webui/src/pages` and route it from `apps/webui/src/App.tsx`.
- Components: Add reusable UI to `apps/webui/src/components/ui`; add feature components to `apps/webui/src/components/<feature>`.
- Data/API: Add REST calls to `apps/webui/src/lib/api.ts`; add query/mutation wrappers to `apps/webui/src/hooks`.
- Tests: Add Vitest tests in `apps/webui/src/__tests__` or `apps/webui/src/<feature>/__tests__`; add Playwright coverage in `apps/webui/tests` for user flows.

**New WebUI store state:**
- Primary code: Extend an existing store in `apps/webui/src/lib/chat-store.ts`, `apps/webui/src/lib/machines-store.ts`, `apps/webui/src/lib/ui-store.ts`, or create a new `apps/webui/src/lib/<feature>-store.ts`.
- Consumers: Read state with selectors and `useShallow` in components/hooks, following `apps/webui/src/App.tsx`.
- Persistence: Use existing storage adapters in `apps/webui/src/lib/storage-adapter.ts` and `apps/webui/src/lib/tauri-storage-adapter.ts` when state must persist.
- Tests: Place store tests under `apps/webui/src/lib/__tests__`.

**New CLI command:**
- Primary code: Register the command in `apps/mobvibe-cli/src/index.ts`.
- Implementation: Put reusable command logic in a focused file under `apps/mobvibe-cli/src` or the relevant domain folder (`auth`, `daemon`, `wal`, `registry`, `acp`).
- Tests: Add Bun tests under the relevant `apps/mobvibe-cli/src/**/__tests__` folder.

**New ACP/session capability:**
- Shared types: Add contracts to `packages/shared/src/types/socket-events.ts` or `packages/shared/src/types/session.ts` and export from `packages/shared/src/index.ts`.
- CLI runtime: Implement ACP/backend behavior in `apps/mobvibe-cli/src/acp/session-manager.ts` and `apps/mobvibe-cli/src/acp/acp-connection.ts`.
- Gateway routing: Add user-scoped proxy methods to `apps/gateway/src/services/session-router.ts` and expose REST/socket surfaces through `apps/gateway/src/routes` or `apps/gateway/src/socket`.
- WebUI UI/state: Add API calls to `apps/webui/src/lib/api.ts`, store updates to `apps/webui/src/lib/chat-store.ts`, and event application in `apps/webui/src/hooks/useSocket.ts`.

**New WAL persistence behavior:**
- Primary code: Add schema/migrations/statements to `apps/mobvibe-cli/src/wal/migrations.ts` and `apps/mobvibe-cli/src/wal/wal-store.ts`.
- Compaction/read behavior: Update `apps/mobvibe-cli/src/wal/consolidator.ts` or `apps/mobvibe-cli/src/wal/compactor.ts` when event lifecycle changes.
- Tests: Add Bun tests under `apps/mobvibe-cli/src/wal/__tests__`.

**New shared type/helper:**
- Primary code: Add domain file under `packages/shared/src/types`, `packages/shared/src/crypto`, `packages/shared/src/validation`, or root `packages/shared/src` if it is a small generic helper.
- Public export: Update `packages/shared/src/index.ts`.
- Tests: Add Vitest tests under `packages/shared/tests` for runtime helpers; type-only contracts usually need consuming package tests.

**New marketing website page:**
- Primary code: Add page/component under `apps/website/src/components` or `apps/website/src/lib`.
- Routing/meta: Update `apps/website/src/lib/page-info.ts` and branch in `apps/website/src/App.tsx`.
- Content: Add static marketing data to `apps/website/src/data` or legal/shared content to `packages/shared/src/legal` when reused.
- Build: Keep SSR compatibility with `apps/website/src/entry-server.tsx`.

**Utilities:**
- Gateway-only helpers: `apps/gateway/src/lib`.
- WebUI-only helpers: `apps/webui/src/lib`.
- CLI-only helpers: `apps/mobvibe-cli/src/lib`.
- Cross-app helpers/contracts: `packages/shared/src`, then export from `packages/shared/src/index.ts`.

## Special Directories

**`apps/webui/src-tauri`:**
- Purpose: Tauri desktop/mobile wrapper, native Rust entrypoints, generated native projects, capabilities, and icons.
- Generated: Partially. `apps/webui/src-tauri/gen` is Tauri-generated native project output; `apps/webui/src-tauri/src`, `apps/webui/src-tauri/tauri.conf.json`, and capability/config files are source/config.
- Committed: Yes for wrapper/config/native source; generated subtrees follow Tauri project policy.

**`apps/mobvibe-cli/npm`:**
- Purpose: Platform-specific npm package manifests for CLI binary distribution.
- Generated: Distribution-support metadata.
- Committed: Yes.

**`dist`, `dist-bin`, `.turbo`, `node_modules`:**
- Purpose: Build outputs, task cache, and installed dependencies.
- Generated: Yes.
- Committed: No for generated dependency/build/cache contents; do not place source changes here.

**`packages/core`:**
- Purpose: Current checkout contains `dist`, `node_modules`, and `.turbo` only.
- Generated: Current contents are generated/build/dependency artifacts.
- Committed: Source additions require introducing source/package files intentionally rather than editing generated output.

**`packages/shared/dist`:**
- Purpose: Compiled shared package output.
- Generated: Yes.
- Committed: Package policy dependent; source changes belong in `packages/shared/src`.

**`.planning/codebase`:**
- Purpose: GSD-generated architecture, structure, stack, testing, convention, integration, and concern maps.
- Generated: Yes.
- Committed: Project workflow dependent; update through mapping commands rather than hand-maintaining during feature work.

**`.agents/skills`:**
- Purpose: Project-local skill lookup directory.
- Generated: No.
- Committed: Directory exists with `web-design-guidelines/` but no `SKILL.md` content in current checkout.

**`.env`, `.env.*`, `.npmrc`, credential files:**
- Purpose: Environment and authentication configuration.
- Generated: Local/deployment-specific.
- Committed: Do not commit secrets. Note existence only and never read or quote values.

---

*Structure analysis: 2026-05-11*
