# Codebase Structure

**Analysis Date:** 2026-05-12

## Directory Layout

```
mobvibe/
├── apps/                         # Runtime applications
│   ├── gateway/                  # Express + Socket.io gateway server
│   │   ├── src/
│   │   │   ├── db/               # Drizzle PostgreSQL schema/connection
│   │   │   ├── lib/              # Auth, email, logger helpers
│   │   │   ├── middleware/       # Auth and Fly Replay middleware
│   │   │   ├── routes/           # Express REST route setup modules
│   │   │   ├── services/         # Business services, registries, Redis/DB access
│   │   │   ├── socket/           # Socket.io namespace handlers
│   │   │   └── index.ts          # Gateway process entrypoint
│   │   └── drizzle/              # Generated/applied DB migrations
│   ├── mobvibe-cli/              # Bun CLI daemon and ACP adapter
│   │   ├── src/
│   │   │   ├── acp/              # ACP connection/session manager
│   │   │   ├── auth/             # CLI login and credentials
│   │   │   ├── daemon/           # Daemon lifecycle, socket, host filesystem
│   │   │   ├── e2ee/             # CLI crypto runtime service
│   │   │   ├── lib/              # Git, shell, child process, logger helpers
│   │   │   ├── registry/         # ACP registry loading and agent detection
│   │   │   ├── wal/              # SQLite WAL store, migrations, compaction
│   │   │   └── index.ts          # Commander CLI entrypoint
│   │   ├── bin/                  # Published CLI executable wrapper
│   │   └── build*.ts             # Bun build scripts
│   ├── webui/                    # React 19 + Vite WebUI and Tauri app
│   │   ├── src/
│   │   │   ├── app/              # App shell, routes, layout, controller
│   │   │   ├── components/       # Feature and UI components
│   │   │   ├── hooks/            # React hooks for sessions, sockets, machines
│   │   │   ├── i18n/             # Frontend translations/config
│   │   │   ├── lib/              # API, stores, socket, E2EE, utilities
│   │   │   ├── pages/            # Route-level pages
│   │   │   └── main.tsx          # Frontend entrypoint
│   │   ├── src-tauri/            # Tauri v2 desktop/mobile wrapper
│   │   ├── public/               # Static assets and copied WASM assets
│   │   └── tests/                # WebUI integration/component tests
│   └── website/                  # Marketing/pricing/legal website
│       ├── src/
│       │   ├── components/       # Marketing and legal components
│       │   ├── data/             # Feature/demo data
│       │   ├── hooks/            # Website-specific hooks
│       │   ├── i18n/             # Website translations/config
│       │   ├── lib/              # Page routing/utilities
│       │   └── main.tsx          # Website browser entrypoint
│       └── scripts/              # Prerender/postinstall scripts
├── packages/                     # Shared workspace packages
│   ├── shared/                   # Protocol types, crypto, validation, legal data
│   │   └── src/
│   │       ├── crypto/           # E2EE and signed-token helpers
│   │       ├── legal/            # Legal document data/types
│   │       ├── types/            # ACP/session/socket/error/registry types
│   │       ├── validation/       # Shared schemas
│   │       └── index.ts          # Package export surface
│   ├── ui/                       # Reusable React UI primitives
│   │   └── src/                  # Component modules and theme utilities
│   └── core/                     # Empty/stale workspace shell; no package.json detected
├── docs/                         # Project design, audits, migration notes
├── packaging/                    # Distribution packaging assets (AUR)
├── public/                       # Root public/static assets
├── brand/                        # Brand assets
├── .agents/                      # Project-local agent skill placeholders
├── .github/                      # GitHub workflows
├── .planning/codebase/           # GSD codebase map documents
├── package.json                  # Root scripts and package manager metadata
├── pnpm-workspace.yaml           # Workspace package globs
├── turbo.json                    # Turborepo task graph
├── biome.json                    # Root formatter/linter configuration
├── fly.toml                      # Gateway Fly.io deployment
└── render.yaml                   # Legacy/transition deployment config
```

## Directory Purposes

**`apps/gateway/`:**
- Purpose: Central relay server for WebUI/CLI connections, auth, REST APIs, Socket.io event routing, database-backed user/device/machine metadata, notifications, and Fly/Redis affinity.
- Contains: TypeScript source in `apps/gateway/src`, Drizzle migrations in `apps/gateway/drizzle`, gateway config in `apps/gateway/drizzle.config.ts`, Docker/deploy helpers in `apps/gateway/Dockerfile`.
- Key files: `apps/gateway/src/index.ts`, `apps/gateway/src/config.ts`, `apps/gateway/src/env.ts`, `apps/gateway/src/db/schema.ts`, `apps/gateway/src/services/session-router.ts`, `apps/gateway/src/socket/cli-handlers.ts`, `apps/gateway/src/socket/webui-handlers.ts`.

**`apps/gateway/src/routes/`:**
- Purpose: Express route setup modules mounted by `apps/gateway/src/index.ts`.
- Contains: session routes, filesystem proxy routes, machine routes, notification routes, device-key routes, health routes.
- Key files: `apps/gateway/src/routes/sessions.ts`, `apps/gateway/src/routes/fs.ts`, `apps/gateway/src/routes/machines.ts`, `apps/gateway/src/routes/device.ts`, `apps/gateway/src/routes/health.ts`.

**`apps/gateway/src/services/`:**
- Purpose: Gateway business logic and integration services.
- Contains: in-memory CLI registry, RPC router, DB service functions, notification sender, Redis connection, instance registry, user affinity.
- Key files: `apps/gateway/src/services/cli-registry.ts`, `apps/gateway/src/services/session-router.ts`, `apps/gateway/src/services/db-service.ts`, `apps/gateway/src/services/user-affinity.ts`, `apps/gateway/src/services/redis.ts`.

**`apps/gateway/src/socket/`:**
- Purpose: Socket.io namespace handlers for CLI and WebUI transports.
- Contains: `/cli` authentication/registration/RPC/event handlers and `/webui` authentication/subscription/emitters.
- Key files: `apps/gateway/src/socket/cli-handlers.ts`, `apps/gateway/src/socket/webui-handlers.ts`.

**`apps/mobvibe-cli/`:**
- Purpose: Published CLI and local daemon that bridges gateway RPC/events to ACP-compatible local agents.
- Contains: Bun/TypeScript source in `apps/mobvibe-cli/src`, published bin wrapper in `apps/mobvibe-cli/bin`, build scripts in `apps/mobvibe-cli/build.ts` and `apps/mobvibe-cli/build-bin.ts`.
- Key files: `apps/mobvibe-cli/src/index.ts`, `apps/mobvibe-cli/src/start-command.ts`, `apps/mobvibe-cli/src/config.ts`, `apps/mobvibe-cli/src/daemon/daemon.ts`, `apps/mobvibe-cli/src/daemon/socket-client.ts`, `apps/mobvibe-cli/src/acp/session-manager.ts`.

**`apps/mobvibe-cli/src/acp/`:**
- Purpose: ACP session and process integration layer.
- Contains: ACP connection adapter, session manager, and colocated Bun tests.
- Key files: `apps/mobvibe-cli/src/acp/acp-connection.ts`, `apps/mobvibe-cli/src/acp/session-manager.ts`, `apps/mobvibe-cli/src/acp/__tests__/session-manager.test.ts`.

**`apps/mobvibe-cli/src/daemon/`:**
- Purpose: Long-running daemon runtime and gateway/local-machine IO.
- Contains: daemon lifecycle, socket client, host filesystem browsing, path/spawn helpers, tests.
- Key files: `apps/mobvibe-cli/src/daemon/daemon.ts`, `apps/mobvibe-cli/src/daemon/socket-client.ts`, `apps/mobvibe-cli/src/daemon/host-fs.ts`, `apps/mobvibe-cli/src/daemon/path-utils.ts`, `apps/mobvibe-cli/src/daemon/spawn-utils.ts`.

**`apps/mobvibe-cli/src/wal/`:**
- Purpose: Local durable session event store and compaction/consolidation logic.
- Contains: SQLite store, migrations, sequence generator, compactor, event consolidator, package barrel.
- Key files: `apps/mobvibe-cli/src/wal/wal-store.ts`, `apps/mobvibe-cli/src/wal/migrations.ts`, `apps/mobvibe-cli/src/wal/consolidator.ts`, `apps/mobvibe-cli/src/wal/seq-generator.ts`, `apps/mobvibe-cli/src/wal/index.ts`.

**`apps/webui/`:**
- Purpose: Main authenticated client for chat/session control across browser, desktop, and mobile Tauri targets.
- Contains: React source in `apps/webui/src`, Tauri wrapper in `apps/webui/src-tauri`, Vite/Vitest/Playwright config, static assets in `apps/webui/public`, tests in `apps/webui/tests` and `apps/webui/src/__tests__`.
- Key files: `apps/webui/src/main.tsx`, `apps/webui/src/App.tsx`, `apps/webui/src/app/AppRoutes.tsx`, `apps/webui/src/app/use-main-app-controller.tsx`, `apps/webui/src/lib/api.ts`, `apps/webui/src/lib/socket.ts`, `apps/webui/src/lib/chat-store.ts`.

**`apps/webui/src/app/`:**
- Purpose: App-level composition, routing, layout, dialogs, and controller hook.
- Contains: provider wrapper, route tree, main app/layout/workspace components, controller hook.
- Key files: `apps/webui/src/app/AppProviders.tsx`, `apps/webui/src/app/AppRoutes.tsx`, `apps/webui/src/app/MainApp.tsx`, `apps/webui/src/app/MainLayout.tsx`, `apps/webui/src/app/use-main-app-controller.tsx`.

**`apps/webui/src/components/`:**
- Purpose: Feature components and local UI composition.
- Contains: `app`, `auth`, `chat`, `git`, `legal`, `machines`, `plan`, `session`, `settings`, `ui`, and `workspace` subtrees.
- Key files: `apps/webui/src/components/auth/AuthProvider.tsx`, `apps/webui/src/components/app/AppSidebar.tsx`, `apps/webui/src/components/session/SessionSidebar.tsx`, `apps/webui/src/components/settings/E2EESettings.tsx`.

**`apps/webui/src/hooks/`:**
- Purpose: Domain hooks for fetching, socket handling, session activation/mutations/list composition, and machine discovery.
- Contains: hooks consumed by `apps/webui/src/app/use-main-app-controller.tsx`.
- Key files: `apps/webui/src/hooks/useSocket.ts`, `apps/webui/src/hooks/useSessionQueries.ts`, `apps/webui/src/hooks/useSessionMutations.ts`, `apps/webui/src/hooks/useSessionHandlers.ts`, `apps/webui/src/hooks/useMachineDiscovery.ts`.

**`apps/webui/src/lib/`:**
- Purpose: Client-side service layer, stores, E2EE, socket wrapper, API wrapper, platform abstractions, and pure utilities.
- Contains: Zustand stores, REST client, Socket.io singleton, auth helpers, E2EE helpers, Tree-sitter/file/git utilities.
- Key files: `apps/webui/src/lib/api.ts`, `apps/webui/src/lib/socket.ts`, `apps/webui/src/lib/chat-store.ts`, `apps/webui/src/lib/machines-store.ts`, `apps/webui/src/lib/ui-store.ts`, `apps/webui/src/lib/e2ee.ts`.

**`apps/webui/src-tauri/`:**
- Purpose: Native desktop/mobile shell for the WebUI.
- Contains: Rust/Tauri config, capabilities, generated native folders, icons, and native source.
- Key files: `apps/webui/src-tauri/tauri.conf.json`, `apps/webui/src-tauri/Cargo.toml`, `apps/webui/src-tauri/src`.

**`apps/website/`:**
- Purpose: Public marketing/pricing/legal website with Vite build and prerender support.
- Contains: React source in `apps/website/src`, Netlify config, scripts for prerender/postinstall.
- Key files: `apps/website/src/main.tsx`, `apps/website/src/entry-server.tsx`, `apps/website/src/App.tsx`, `apps/website/src/lib/page-info.ts`, `apps/website/netlify.toml`.

**`packages/shared/`:**
- Purpose: Shared protocol/type/crypto/legal package for all apps.
- Contains: public export surface, crypto helpers, ACP/session/socket/error/registry types, legal content, validation utilities.
- Key files: `packages/shared/src/index.ts`, `packages/shared/src/types/socket-events.ts`, `packages/shared/src/types/session.ts`, `packages/shared/src/types/errors.ts`, `packages/shared/src/crypto/index.ts`, `packages/shared/src/validation/acp-schemas.ts`.

**`packages/ui/`:**
- Purpose: Shared React design system primitives for WebUI and Website.
- Contains: individual component modules, theme provider, utilities, CSS export.
- Key files: `packages/ui/src/index.ts`, `packages/ui/src/button.tsx`, `packages/ui/src/sidebar.tsx`, `packages/ui/src/theme-provider.tsx`, `packages/ui/src/utils.ts`, `packages/ui/package.json`.

**`packages/core/`:**
- Purpose: Not an active source package in the current tree.
- Contains: `.turbo/`, `dist/`, and `node_modules/`; no `package.json` or source files detected.
- Key files: Not applicable.

**`docs/`:**
- Purpose: Human-readable design, implementation, audit, and migration notes.
- Contains: architecture/security/performance/e2ee/chat-sync/gateway-scaling documents.
- Key files: `docs/e2ee-implementation.md`, `docs/gateway-horizontal-scaling.md`, `docs/state-management-refactor.md`, `docs/chat-sync-rewrite.md`, `docs/security-audit-2026-02-09.zh.md`.

## Key File Locations

**Entry Points:**
- `apps/gateway/src/index.ts`: Express + Socket.io gateway process entrypoint.
- `apps/mobvibe-cli/src/index.ts`: Commander CLI command entrypoint.
- `apps/mobvibe-cli/src/start-command.ts`: `mobvibe start` orchestration.
- `apps/webui/src/main.tsx`: WebUI browser/Tauri React entrypoint.
- `apps/webui/src/App.tsx`: WebUI root component delegating to routes.
- `apps/website/src/main.tsx`: Website browser entrypoint.
- `apps/website/src/entry-server.tsx`: Website SSR/prerender entrypoint.

**Configuration:**
- `package.json`: Root package manager, engine, and Turbo scripts.
- `pnpm-workspace.yaml`: Workspace globs for `apps/*` and `packages/*`.
- `turbo.json`: Build/test/lint/format task graph.
- `biome.json`: Root Biome formatting/linting rules.
- `apps/gateway/src/config.ts`: Gateway runtime config derivation.
- `apps/gateway/src/env.ts`: Gateway environment loading side effect.
- `apps/gateway/drizzle.config.ts`: Drizzle migration config.
- `apps/webui/vite.config.ts`: WebUI Vite config and `@` alias.
- `apps/webui/tsconfig.app.json`: WebUI TypeScript compiler options and path alias.
- `apps/website/vite.config.ts`: Website Vite config and `@` alias.
- `apps/mobvibe-cli/src/config.ts`: CLI runtime config, agent registry resolution, compaction settings, local paths.
- `fly.toml`: Gateway Fly.io deployment config.
- `apps/webui/netlify.toml`: WebUI Netlify deployment config.
- `apps/website/netlify.toml`: Website Netlify deployment config.

**Core Logic:**
- `apps/gateway/src/services/session-router.ts`: Gateway-to-CLI RPC router.
- `apps/gateway/src/services/cli-registry.ts`: Connected CLI/session/capability index.
- `apps/gateway/src/socket/cli-handlers.ts`: CLI socket auth, machine registration, and event intake.
- `apps/gateway/src/socket/webui-handlers.ts`: WebUI socket auth, subscriptions, and event emission.
- `apps/gateway/src/routes/sessions.ts`: Session REST API surface.
- `apps/gateway/src/routes/fs.ts`: Filesystem/git REST proxy surface.
- `apps/gateway/src/db/schema.ts`: Gateway PostgreSQL schema.
- `apps/mobvibe-cli/src/daemon/socket-client.ts`: CLI side gateway socket and local RPC handling.
- `apps/mobvibe-cli/src/acp/session-manager.ts`: ACP session lifecycle, permissions, events, worktrees.
- `apps/mobvibe-cli/src/acp/acp-connection.ts`: ACP process/client connection abstraction.
- `apps/mobvibe-cli/src/wal/wal-store.ts`: Local SQLite WAL persistence.
- `apps/webui/src/app/use-main-app-controller.tsx`: WebUI top-level orchestration.
- `apps/webui/src/lib/api.ts`: WebUI REST API client.
- `apps/webui/src/lib/socket.ts`: WebUI Socket.io singleton.
- `apps/webui/src/lib/chat-store.ts`: WebUI chat/session Zustand store.
- `packages/shared/src/types/socket-events.ts`: Cross-process REST/RPC/socket payload types.
- `packages/shared/src/crypto/index.ts`: Shared E2EE/signature API.

**Testing:**
- `apps/gateway/src/services/__tests__/session-router.test.ts`: Gateway session router tests.
- `apps/gateway/src/services/__tests__/cli-registry.test.ts`: Gateway registry tests.
- `apps/gateway/src/services/__tests__/crypto.test.ts`: Gateway/shared crypto tests.
- `apps/mobvibe-cli/src/acp/__tests__/session-manager.test.ts`: CLI session manager tests.
- `apps/mobvibe-cli/src/daemon/__tests__/socket-client.test.ts`: CLI socket client tests.
- `apps/mobvibe-cli/src/lib/__tests__/git-utils.test.ts`: CLI git utilities tests.
- `apps/webui/src/__tests__/`: WebUI colocated Vitest tests.
- `apps/webui/tests/session-sidebar.test.tsx`: WebUI higher-level component test.
- `packages/shared/tests/prompt-images.test.ts`: Shared prompt image validation tests.

## Naming Conventions

**Files:**
- `kebab-case.ts` / `kebab-case.tsx` for most modules: `apps/gateway/src/services/session-router.ts`, `apps/webui/src/lib/chat-store.ts`, `apps/mobvibe-cli/src/daemon/socket-client.ts`.
- `PascalCase.tsx` for React component modules in WebUI/Website: `apps/webui/src/pages/SettingsPage.tsx`, `apps/webui/src/components/session/SessionSidebar.tsx`, `apps/website/src/components/DemoHeader.tsx`.
- `use-*.ts` / `use-*.tsx` or `useX.ts` for hooks depending on package convention: `apps/webui/src/app/use-main-app-controller.tsx`, `apps/website/src/hooks/use-streaming-demo.ts`.
- `*.test.ts` / `*.test.tsx` for tests: `apps/gateway/src/services/__tests__/session-router.test.ts`, `apps/webui/tests/session-sidebar.test.tsx`.

**Directories:**
- App/package roots live under workspace globs `apps/*` and `packages/*` from `pnpm-workspace.yaml`.
- Feature/domain directories are singular/plural by domain: `apps/webui/src/components/session`, `apps/webui/src/components/machines`, `apps/gateway/src/services`, `apps/mobvibe-cli/src/wal`.
- Tests are colocated in `__tests__/` for gateway/CLI/shared internals and in `apps/webui/tests/` for some WebUI integration/component tests.

## Where to Add New Code

**New Gateway REST Endpoint:**
- Primary code: add a setup module in `apps/gateway/src/routes/<domain>.ts` and mount it from `apps/gateway/src/index.ts`.
- Business logic: put reusable service logic in `apps/gateway/src/services/<domain>.ts`.
- Auth: reuse `apps/gateway/src/middleware/auth.ts` and route-level `requireAuth` patterns from `apps/gateway/src/routes/sessions.ts`.
- Tests: add `apps/gateway/src/routes/__tests__/<domain>.test.ts` or `apps/gateway/src/services/__tests__/<domain>.test.ts`.

**New Gateway Socket Event or RPC:**
- Shared types: define payload/RPC types in `packages/shared/src/types/socket-events.ts` and export from `packages/shared/src/index.ts`.
- Gateway handling: update `apps/gateway/src/socket/cli-handlers.ts`, `apps/gateway/src/socket/webui-handlers.ts`, or `apps/gateway/src/services/session-router.ts`.
- CLI handling: update `apps/mobvibe-cli/src/daemon/socket-client.ts` and/or `apps/mobvibe-cli/src/acp/session-manager.ts`.
- WebUI handling: update `apps/webui/src/lib/socket.ts`, relevant hook in `apps/webui/src/hooks/`, and store actions in `apps/webui/src/lib/chat-store.ts` if UI state changes.

**New WebUI Feature:**
- Primary code: place route-level screens in `apps/webui/src/pages`, feature components in `apps/webui/src/components/<feature>/`, and app orchestration in `apps/webui/src/app/use-main-app-controller.tsx` only when global coordination is required.
- Data access: add REST calls to `apps/webui/src/lib/api.ts`; add React Query hooks to `apps/webui/src/hooks/` if reused.
- State: use existing stores in `apps/webui/src/lib/chat-store.ts`, `apps/webui/src/lib/machines-store.ts`, or `apps/webui/src/lib/ui-store.ts`; create a new `*-store.ts` in `apps/webui/src/lib/` only for durable cross-component state.
- Tests: add `apps/webui/src/__tests__/<feature>.test.tsx` for unit/component tests or `apps/webui/tests/<feature>.test.tsx` for broader integration tests.

**New WebUI Component:**
- Implementation: put app-specific components under `apps/webui/src/components/<feature>/ComponentName.tsx`.
- Shared primitive: put reusable design-system component in `packages/ui/src/<component>.tsx`, export it from `packages/ui/src/index.ts`, and add a subpath export in `packages/ui/package.json` when consumers import `@mobvibe/ui/<component>`.
- Styling: use Tailwind classes and shared `cn` helpers from `packages/ui/src/utils.ts` or `apps/webui/src/lib/utils.ts`.

**New CLI Capability:**
- Command surface: add user-facing commands/options in `apps/mobvibe-cli/src/index.ts` or start-specific behavior in `apps/mobvibe-cli/src/start-command.ts`.
- Daemon behavior: add runtime logic under `apps/mobvibe-cli/src/daemon/`.
- ACP/session behavior: add session lifecycle logic to `apps/mobvibe-cli/src/acp/session-manager.ts` or connection logic to `apps/mobvibe-cli/src/acp/acp-connection.ts`.
- Filesystem/git helpers: place helpers in `apps/mobvibe-cli/src/lib/` or `apps/mobvibe-cli/src/daemon/host-fs.ts` for host filesystem APIs.
- Tests: add Bun tests under `apps/mobvibe-cli/src/**/__tests__/*.test.ts`.

**New Shared Type or Utility:**
- Protocol/session/socket types: add to `packages/shared/src/types/` and export from `packages/shared/src/index.ts`.
- Crypto helpers: add to `packages/shared/src/crypto/` and export from `packages/shared/src/crypto/index.ts` plus `packages/shared/src/index.ts`.
- Validation: add schemas/utilities to `packages/shared/src/validation/` or a focused module under `packages/shared/src/`.
- Tests: add `packages/shared/tests/<name>.test.ts` when runtime behavior exists.

**New Website Page/Section:**
- Page routing: update `apps/website/src/lib/page-info.ts` and render path handling in `apps/website/src/App.tsx`.
- Components: add to `apps/website/src/components/`.
- Data-driven content: add to `apps/website/src/data/`.
- Shared legal content: add legal data/types in `packages/shared/src/legal/` if it must be reused by WebUI and Website.

**Utilities:**
- WebUI-only helpers: `apps/webui/src/lib/<name>.ts`.
- Gateway-only helpers: `apps/gateway/src/lib/<name>.ts`.
- CLI-only helpers: `apps/mobvibe-cli/src/lib/<name>.ts`.
- Cross-package helpers: `packages/shared/src/<name>.ts` for protocol/runtime utilities or `packages/ui/src/<name>.tsx` for UI utilities.

## Special Directories

**`apps/webui/src-tauri/`:**
- Purpose: Tauri v2 native wrapper for WebUI desktop/mobile builds.
- Generated: Partially; `apps/webui/src-tauri/gen/` and platform native artifacts are generated/managed by Tauri.
- Committed: Yes, source/config/capabilities are committed.

**`apps/gateway/drizzle/`:**
- Purpose: Database migration artifacts for gateway PostgreSQL schema.
- Generated: Yes, via Drizzle commands from `apps/gateway/package.json`.
- Committed: Yes.

**`dist/`, `dist-bin/`, `.turbo/`, `node_modules/`:**
- Purpose: Build outputs, binary outputs, Turbo cache, package installs.
- Generated: Yes.
- Committed: No; do not place source changes here.

**`apps/webui/public/`:**
- Purpose: Static frontend assets; Tree-sitter WASM files are copied here by WebUI postinstall scripts.
- Generated: Partially.
- Committed: Static assets yes; generated copied artifacts follow project conventions.

**`docs/`:**
- Purpose: Design notes, implementation plans, audits, and migration references.
- Generated: No.
- Committed: Yes.

**`.planning/codebase/`:**
- Purpose: GSD codebase mapping outputs consumed by planning/execution workflows.
- Generated: Yes, by mapping agents.
- Committed: Project-dependent; contents should not include secrets.

**`.agents/skills/`:**
- Purpose: Project-local skill directory; currently contains an empty `web-design-guidelines/` placeholder.
- Generated: No.
- Committed: Yes if project-specific skills are added.

**`packages/core/`:**
- Purpose: Stale/empty package shell in current tree.
- Generated: Contains generated/cache/install directories only.
- Committed: No source package files detected.

---

*Structure analysis: 2026-05-12*
