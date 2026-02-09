# Mobvibe Codebase Guide (for AI Agents)

This guide is for automated coding agents. It covers build/format/lint/test commands, code conventions, and architecture details.

## Repository Structure

```
mobvibe/                          # pnpm + Turbo monorepo (Apache-2.0)
├── apps/
│   ├── gateway/                  # Express + Socket.io API server (port 3005)
│   ├── webui/                    # React 19 + Vite frontend (with Tauri desktop/mobile)
│   └── mobvibe-cli/              # Bun CLI daemon (@mobvibe/cli on npm)
├── packages/
│   ├── shared/                   # Shared TypeScript types (@mobvibe/shared)
│   └── core/                     # Shared stores/hooks/socket/utils/i18n (@mobvibe/core)
├── docs/                         # Design & implementation docs (Chinese)
├── .github/workflows/            # CI (lint, test, build), Publish, OpenCode
├── biome.json                    # Root Biome formatter + linter config
├── turbo.json                    # Turbo task pipeline
└── pnpm-workspace.yaml           # Workspace: apps/* + packages/*
```

There is no `apps/mobile/` directory. The actual directories above are authoritative.

## General Constraints

- Use `pnpm` (v10.27.0+), never `npm` or `yarn`.
- All formatting and linting is handled by Biome. Do not manually reorder imports.
- Before committing: run `pnpm format && pnpm lint` and fix any errors.
- Before committing: run `pnpm build` and ensure the entire project builds cleanly.
- Node.js 22+ is required. Bun is required for mobvibe-cli.

## Root Commands

```bash
pnpm install          # Install all dependencies
pnpm dev              # Turbo starts all packages (usually already running - don't start unless asked)
pnpm build            # Build all packages (respects dependency order via Turbo)
pnpm format           # Biome format all packages
pnpm lint             # Biome lint all packages (with auto-fix)
pnpm test             # Vitest watch mode (not for agents/CI)
pnpm test:run         # Vitest single run (use this in agents/CI)
```

## Per-Package Commands

### gateway (`apps/gateway`)

```bash
pnpm -C apps/gateway dev              # tsx watch src/index.ts
pnpm -C apps/gateway build            # tsc compile
pnpm -C apps/gateway start            # node dist/index.js
pnpm -C apps/gateway start:migrate    # drizzle-kit migrate + start
pnpm -C apps/gateway format
pnpm -C apps/gateway lint
pnpm -C apps/gateway test             # vitest watch
pnpm -C apps/gateway test:run         # vitest single run
pnpm -C apps/gateway db:generate      # drizzle-kit generate
pnpm -C apps/gateway db:migrate       # drizzle-kit migrate
pnpm -C apps/gateway db:push          # drizzle-kit push (sync schema)
pnpm -C apps/gateway db:studio        # drizzle-kit studio (DB browser)
```

### webui (`apps/webui`)

```bash
pnpm -C apps/webui dev                # Vite dev server
pnpm -C apps/webui build              # tsc + vite build
pnpm -C apps/webui preview            # Vite preview built output
pnpm -C apps/webui format
pnpm -C apps/webui lint
pnpm -C apps/webui test               # vitest watch
pnpm -C apps/webui test:run           # vitest single run
pnpm -C apps/webui dev:tauri          # Tauri desktop dev
pnpm -C apps/webui build:tauri        # Tauri desktop build
pnpm -C apps/webui android:dev        # Tauri Android dev
pnpm -C apps/webui ios:dev            # Tauri iOS dev
```

### mobvibe-cli (`apps/mobvibe-cli`)

```bash
pnpm -C apps/mobvibe-cli build        # bun run build.ts
pnpm -C apps/mobvibe-cli build:bin    # bun --compile single binary
pnpm -C apps/mobvibe-cli start        # bun dist/index.js
pnpm -C apps/mobvibe-cli format
pnpm -C apps/mobvibe-cli lint
pnpm -C apps/mobvibe-cli test         # bun test (NOT vitest)
```

### core / shared (`packages/core`, `packages/shared`)

```bash
pnpm -C packages/core build           # tsc compile
pnpm -C packages/core dev             # tsc --watch
pnpm -C packages/core format
pnpm -C packages/core lint
pnpm -C packages/shared build
pnpm -C packages/shared dev
pnpm -C packages/shared format
pnpm -C packages/shared lint
```

## Running Individual Tests

Vitest (gateway, webui, core):
```bash
pnpm -C apps/gateway test:run -- src/socket/__tests__/session-router.test.ts
pnpm -C apps/webui test:run -- src/__tests__/app.test.tsx
pnpm -C apps/webui test:run -- -t "session list"    # filter by test name
```

Bun test (mobvibe-cli):
```bash
pnpm -C apps/mobvibe-cli test -- src/acp/__tests__/session-manager.test.ts
```

Workspace filter:
```bash
pnpm -F webui test:run -- src/__tests__/app.test.tsx
```

## Architecture Overview

Mobvibe is a distributed system for connecting local ACP (Agent Client Protocol) backends (like Claude Code) to a centralized gateway with a WebUI for management.

```
┌─────────────┐    Socket.io     ┌──────────┐    Socket.io     ┌────────────┐
│ mobvibe-cli │ ───────────────→ │ gateway  │ ←──────────────→ │   webui    │
│ (ACP agent) │    CLI events    │ (Express │    WebUI events  │ (React 19) │
│             │                  │  + S.IO) │                  │            │
└──────┬──────┘                  └────┬─────┘                  └────────────┘
       │                              │
       │ ACP SDK                      │ Drizzle ORM
       ↓                              ↓
  Local ACP backends            PostgreSQL DB
  (Claude Code, etc.)
```

### Gateway (`apps/gateway`)

Express + Socket.io server on port 3005. Handles:
- **Auth**: Better Auth (email/password, OAuth, API keys) via `/api/auth/*`
- **REST routes**: health (`/health`, `/status`), machines, ACP sessions, filesystem
- **Socket.io**: Separate handlers for CLI connections (`cli-handlers.ts`) and WebUI connections (`webui-handlers.ts`)
- **Session routing**: Routes messages between CLI daemons and WebUI clients (`session-router.ts`)
- **Database**: PostgreSQL via Drizzle ORM. Schema in `src/db/schema.ts`
- **Logging**: Pino
- **Email**: Resend

**Database tables**: `user`, `session`, `account`, `verification`, `apikey`, `machines`, `acp_sessions`

Key source layout:
```
apps/gateway/src/
├── index.ts              # Entry: Express + Socket.io setup
├── config.ts             # GatewayConfig type
├── middleware/auth.ts     # requireAuth, getUserId
├── lib/                   # auth, logger, email, email-templates
├── db/                    # schema.ts, index.ts (Drizzle pool)
├── services/              # cli-registry, session-router, db-service
├── socket/                # cli-handlers.ts, webui-handlers.ts
└── routes/                # health, machines, sessions, fs
```

### WebUI (`apps/webui`)

React 19 + Vite frontend with multi-platform support via Tauri.

Key technologies:
- **Routing**: React Router v7 with lazy loading
- **State**: Zustand stores (chat, machines, UI) via `@mobvibe/core`
- **Data fetching**: TanStack React Query v5
- **Styling**: Tailwind CSS v4 + Radix UI + Shadcn + Base UI
- **Code display**: Tree-sitter (15 languages) + Prism
- **i18n**: i18next with browser language detection
- **Real-time**: Socket.io client
- **Desktop**: Tauri (macOS/Windows/Linux)
- **Mobile**: Tauri (iOS/Android)
- **Testing**: Vitest + JSDOM + @testing-library/react

Key source layout:
```
apps/webui/src/
├── main.tsx               # Entry: React root, Tauri init
├── App.tsx                # Main component with routing
├── pages/                 # LoginPage, MachinesPage, SettingsPage, ApiKeysPage
├── components/
│   ├── ui/                # Base UI components (Shadcn/Radix)
│   ├── app/               # Header, Sidebar, Chat, Dialogs
│   ├── auth/              # AuthProvider, login flows
│   ├── chat/              # Chat message components
│   ├── machines/          # Machine list/management
│   └── session/           # Session components
├── hooks/                 # useMachineDiscovery, useSessionList, useSocket, etc.
├── lib/                   # api, socket, gateway-config, stores, auth, tauri-storage
└── i18n/locales/          # Translation files
```

### mobvibe-cli (`apps/mobvibe-cli`)

Bun-based CLI daemon published as `@mobvibe/cli` on npm. Connects local ACP backends to the gateway.

Key features:
- **Commands** (Commander): `start`, `stop`, `status`, `logs`, `login`, `logout`
- **ACP**: Full Agent Client Protocol via `@agentclientprotocol/sdk`
- **Persistence**: WAL (Write-Ahead Log) via SQLite
- **Config**: Platform-specific directories (Linux: `~/.config/mobvibe`, macOS: `~/Library/Application Support/mobvibe`)
- **Binary**: Single-file executable via `bun --compile`
- **Logging**: Pino

Key source layout:
```
apps/mobvibe-cli/src/
├── index.ts               # Commander CLI entry
├── config.ts              # Config file handling
├── daemon/                # DaemonManager, socket-client
├── auth/                  # login flow, credentials
├── acp/                   # ACP connection, session manager
├── wal/                   # Write-Ahead Log (SQLite store, indexing, compaction)
└── lib/                   # logger, git-utils
```

### Shared Package (`packages/shared`)

TypeScript type definitions shared across all apps:
- ACP types (re-exported from `@agentclientprotocol/sdk`)
- Socket.io event types (CLI→Gateway, Gateway→WebUI, WebUI→Gateway)
- Session metadata & capabilities
- Agent configuration types
- Error types

### Core Package (`packages/core`)

Shared runtime code consumed by webui (and potentially other React apps):
- **Stores** (`./stores`): Zustand stores for chat, machines, UI, notifications + storage adapter
- **Socket** (`./socket`): Socket.io client wrapper (`gateway-socket.ts`)
- **API** (`./api`): Fetch-based API client
- **Hooks** (`./hooks`): `useSocket`, `useSessionBackfill`, etc.
- **i18n** (`./i18n`): i18next configuration + locale files
- **Utils** (`./utils`): Error handling, content block processing

Peer dependencies: `react>=18.0.0`, `@tanstack/react-query>=5.0.0`

## Code Style & Conventions

### Formatting & Indentation
- Biome is the sole formatter and linter (config: root `biome.json`).
- Indentation: **tabs**. Strings: **double quotes**.
- Import ordering is handled automatically by Biome's `organizeImports`. Do not reorder manually.

### Imports & Modules
- All packages use ESM (`"type": "module"` in every package.json).
- When adding public types or utilities, update the corresponding entry file (e.g. `packages/shared/src/index.ts`).
- Keep import paths clean. Do not add unused dependencies.

### Types & Naming
- `any` is forbidden. Use `unknown` with type narrowing for unknown types.
- Keep functions under ~50 lines. Layer logic clearly.
- File names: `kebab-case`. Components/classes: `PascalCase`. Functions/variables: `camelCase`. Hooks: `useX`.

### Error Handling
- Never silently catch exceptions. Always log or explicitly handle them.
- Gateway/CLI logging: use the existing Pino logger, not `console.log`.

### React/UI (webui)
- Components should be small and focused. Avoid over-abstraction.
- Follow existing Tailwind + component library patterns. New components go in the matching existing directory.

### Database & Config (gateway)
- New environment variables must be documented. Never commit secrets.
- Database schema lives in `apps/gateway/src/db/schema.ts`. Use Drizzle ORM patterns.
- After schema changes: run `pnpm -C apps/gateway db:generate` and `db:migrate`.

## Test Conventions

- **gateway/core/cli**: Tests in `src/**/__tests__/`, named `*.test.ts`.
- **webui**: Tests in `src/__tests__/` or `tests/`, named `*.test.ts(x)`.
- **webui test env**: JSDOM via Vitest, setup file at `src/setup-tests.ts`.
- **mobvibe-cli**: Uses Bun's built-in test runner (not Vitest).
- Behavioral changes should include tests or a clear explanation of why not.

## Environment Variables

### gateway
| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `PORT` / `GATEWAY_PORT` | Server port (default: 3005) |
| `NODE_ENV` | `development` / `test` / `production` |
| `SITE_URL` | Auth base URL |
| `WEB_URL` | WebUI URL |
| `GATEWAY_CORS_ORIGINS` | Comma-separated allowed origins |
| `BETTER_AUTH_SECRET` | Auth signing secret |
| `RESEND_API_KEY` | Email service API key |
| `EMAIL_FROM` | Sender address (default: `Mobvibe <noreply@example.com>`) |

### webui
| Variable | Purpose |
|---|---|
| `VITE_GATEWAY_URL` | Gateway endpoint URL |

### mobvibe-cli
| Variable | Purpose |
|---|---|
| `MOBVIBE_GATEWAY_URL` | Gateway endpoint URL |
| `ANTHROPIC_AUTH_TOKEN` | Token for ACP backend |

## CI/CD

CI runs on PRs to `main`/`master` (`.github/workflows/ci.yml`):
1. **Lint** - `biome ci .` (Node 22, Ubuntu)
2. **Test** - `pnpm build && pnpm test:run` (Node 22 + Bun, Ubuntu)
3. **Build** - `pnpm build` (Node 22 + Bun, Ubuntu)
4. **Tauri Android** - Optional, builds signed APK/AAB

Publish on version tags (`.github/workflows/publish.yml`):
1. Runs full CI
2. Publishes `@mobvibe/cli` to npm with provenance
3. Builds single-file CLI binaries (Linux/macOS/Windows) and uploads to GitHub Release
4. Uploads Android APK/AAB artifacts

## Dependency Graph

```
packages/shared         (standalone - ACP types)
     ↑
packages/core           (depends on shared - stores, hooks, socket, i18n)
     ↑
apps/webui              (depends on core)

apps/gateway            (depends on shared)
apps/mobvibe-cli        (depends on shared as devDep)
```

Build order (enforced by Turbo `^build`): `shared` → `core` → `gateway` / `webui` / `mobvibe-cli`

## Other Notes

- Do not commit: `node_modules/`, `.venv/`, `__pycache__/`, `.DS_Store`, `.env` files.
- Tree-sitter WASM files in `apps/webui/public/` are generated by `postinstall` - do not commit them.
- Reference docs: this file (`CLAUDE.md`) and the `docs/` directory.
- License: Apache-2.0 across all packages.
- Package manager version: pnpm 10.27.0 (pinned in root `package.json`).
