---
last_mapped_commit: 7e89508dcca9477698c5e492fe7b8fdf9195f9af
mapping_date: 2026-05-11
---

# Technology Stack

**Analysis Date:** 2026-05-11

## Languages

**Primary:**
- TypeScript 5.9.3 - All application and package source in `apps/gateway/src/`, `apps/webui/src/`, `apps/website/src/`, `apps/mobvibe-cli/src/`, and `packages/shared/src/`; each package uses ESM via `"type": "module"` in package manifests such as `apps/gateway/package.json` and `apps/webui/package.json`.
- TSX / React 19.2.0 - Frontend UIs in `apps/webui/src/` and marketing website in `apps/website/src/`.

**Secondary:**
- Rust - Tauri 2 native shell generated under `apps/webui/src-tauri/`; configured by `apps/webui/src-tauri/tauri.conf.json` and invoked by scripts in `apps/webui/package.json`.
- JavaScript / MJS - Build, prerender, install, and E2E helper scripts such as `apps/website/scripts/prerender.mjs`, `apps/webui/tests/e2e/fake-gateway.mjs`, and `apps/webui/scripts/postinstall.mjs`.
- Shell / Dockerfile - Gateway deployment container defined in `apps/gateway/Dockerfile`; release helpers such as `apps/mobvibe-cli/publish-platform.sh` are used by `.github/workflows/publish.yml`.
- YAML / TOML / JSON - Workspace, CI/CD, and deployment configuration in `pnpm-workspace.yaml`, `.github/workflows/*.yml`, `fly.toml`, `apps/webui/netlify.toml`, `apps/website/netlify.toml`, `turbo.json`, and `biome.json`.

## Runtime

**Environment:**
- Node.js >=22.12.0 for the root workspace, declared in `package.json`; CI uses Node 22 in `.github/workflows/ci.yml`, Netlify uses `NODE_VERSION = "22"` in `apps/webui/netlify.toml` and `apps/website/netlify.toml`, and the gateway container uses `node:22-alpine` in `apps/gateway/Dockerfile`.
- Node.js >=18.0.0 is the published minimum for `@mobvibe/cli` in `apps/mobvibe-cli/package.json`, while workspace CI and builds run it with Node 22 plus Bun.
- Bun is required for the CLI package: `apps/mobvibe-cli/package.json` runs `bun --watch`, `bun test`, `bun run build.ts`, and `bun run build-bin.ts`; `.github/workflows/ci.yml` installs Bun with `oven-sh/setup-bun@v2`.
- Browser runtime for the WebUI and website built by Vite; Tauri 2 provides desktop/mobile wrappers configured in `apps/webui/src-tauri/tauri.conf.json`.

**Package Manager:**
- pnpm 10.32.1 - Declared in `package.json` as `"packageManager": "pnpm@10.32.1"`.
- Lockfile: present at `pnpm-lock.yaml`.
- Workspace: `pnpm-workspace.yaml` includes `apps/*` and `packages/*`.

## Frameworks

**Core:**
- Turborepo 2.7.4 - Monorepo task orchestration in `turbo.json`; root scripts in `package.json` delegate `build`, `dev`, `lint`, `format`, and tests to Turbo.
- Express 4.21.2 - Gateway REST server in `apps/gateway/src/index.ts`, with routers in `apps/gateway/src/routes/`.
- Socket.io 4.8.x - Gateway real-time namespaces in `apps/gateway/src/index.ts`, WebUI client in `apps/webui/src/lib/socket.ts`, and CLI client in `apps/mobvibe-cli/src/daemon/socket-client.ts`.
- React 19.2.0 - WebUI in `apps/webui/src/App.tsx` and website in `apps/website/src/App.tsx`.
- Vite 8.0.2 - Frontend build/dev for `apps/webui/vite.config.ts` and `apps/website/vite.config.ts`.
- Tauri 2.9.x - Desktop/mobile wrapper for WebUI via `@tauri-apps/cli` and `@tauri-apps/api` in `apps/webui/package.json`, configured by `apps/webui/src-tauri/tauri.conf.json`.
- Better Auth 1.4.15 - Authentication server in `apps/gateway/src/lib/auth.ts` and React client in `apps/webui/src/lib/auth.ts`.
- Drizzle ORM 0.41.0 + Drizzle Kit 0.31.4 - PostgreSQL schema and migrations in `apps/gateway/src/db/schema.ts` and `apps/gateway/drizzle.config.ts`.
- Bun SQLite - CLI local WAL storage uses `bun:sqlite` in `apps/mobvibe-cli/src/index.ts` and related WAL modules under `apps/mobvibe-cli/src/wal/`.

**Testing:**
- Vitest 2.1.8 - Unit/integration tests in gateway, webui, and shared packages; configured for WebUI in `apps/webui/vitest.config.ts`.
- Testing Library - WebUI component tests use `@testing-library/react`, `@testing-library/jest-dom`, and `@testing-library/user-event` from `apps/webui/package.json`.
- Playwright 1.58.2 - WebUI E2E tests configured by `apps/webui/playwright.config.ts` with a fake Socket.io gateway in `apps/webui/tests/e2e/fake-gateway.mjs`.
- Bun test - CLI tests use Bun test runner via `apps/mobvibe-cli/package.json`.

**Build/Dev:**
- TypeScript compiler - Gateway and shared packages build with `tsc -p tsconfig.json` in `apps/gateway/package.json` and `packages/shared/package.json`; WebUI and website run `tsc -b` before Vite builds.
- Biome 2.3.11 - Formatting, linting, and import organization configured in `biome.json`; package scripts run `biome check` and `biome format`.
- Tailwind CSS 4.2.2 - Vite plugin in `apps/webui/vite.config.ts` and `apps/website/vite.config.ts`; UI styling dependencies declared in `apps/webui/package.json` and `apps/website/package.json`.
- Bun bundler - CLI build outputs are produced by `apps/mobvibe-cli/build.ts`; cross-platform binaries are compiled by `apps/mobvibe-cli/build-bin.ts`.
- Docker - Gateway production image is built from `apps/gateway/Dockerfile` and deployed through `fly.toml`.

## Key Dependencies

**Critical:**
- `@agentclientprotocol/sdk` 0.16.1 - ACP type and protocol integration used by `packages/shared/src/types/acp.ts` and CLI ACP modules under `apps/mobvibe-cli/src/acp/`.
- `@mobvibe/shared` workspace package - Shared socket events, ACP types, crypto, validation, and domain types consumed by `apps/gateway/package.json`, `apps/webui/package.json`, and `apps/mobvibe-cli/package.json`.
- `better-auth` 1.4.15 - Email/password auth, session cookies, bearer tokens, and OpenAPI plugin configured in `apps/gateway/src/lib/auth.ts`; client created in `apps/webui/src/lib/auth.ts`.
- `@daveyplate/better-auth-tauri` 0.1.6 - Tauri auth plugin configured in `apps/gateway/src/lib/auth.ts` and WebUI hook usage in `apps/webui/src/App.tsx`.
- `socket.io` / `socket.io-client` 4.8.x - Core real-time message transport between gateway, WebUI, and CLI in `apps/gateway/src/socket/`, `apps/webui/src/lib/socket.ts`, and `apps/mobvibe-cli/src/daemon/socket-client.ts`.
- `drizzle-orm` 0.41.0 + `pg` 8.13.0 - Gateway PostgreSQL access configured in `apps/gateway/src/db/index.ts`.
- `@tanstack/react-query` 5.83.0 - WebUI server-state queries and mutations in hooks under `apps/webui/src/hooks/`.
- `zustand` 5.0.8 - WebUI client state stores in `apps/webui/src/lib/chat-store.ts`, `apps/webui/src/lib/ui-store.ts`, and `apps/webui/src/lib/machines-store.ts`.
- `@noble/hashes`, `tweetnacl`, and shared crypto modules - E2EE and device/auth key derivation live under `packages/shared/src/crypto/` and are consumed by WebUI and CLI.

**Infrastructure:**
- `ioredis` 5.10.0 - Optional Redis affinity/instance registry for multi-instance gateway deployments in `apps/gateway/src/services/redis.ts`, `apps/gateway/src/services/instance-registry.ts`, and `apps/gateway/src/services/user-affinity.ts`.
- `resend` 6.9.1 - Transactional email delivery used by `apps/gateway/src/lib/email.ts` for Better Auth verification and password reset email templates.
- `web-push` 3.6.7 - Browser push notification delivery in `apps/gateway/src/services/notification-service.ts` and subscription routes in `apps/gateway/src/routes/notifications.ts`.
- `pino` 9.6.0 + `pino-pretty` 13.1.1 - Structured logging in gateway and CLI via `apps/gateway/src/lib/logger.ts` and `apps/mobvibe-cli/src/lib/logger.ts`.
- `commander` 13.1.0 + `@clack/prompts` 1.0.1 + `qrcode` 1.5.4 - CLI command parsing, prompts, and pairing QR output in `apps/mobvibe-cli/src/index.ts` and `apps/mobvibe-cli/src/start-command.ts`.
- `@tauri-apps/plugin-*` packages - WebUI native capabilities include barcode scanner, deep links, HTTP, notifications, OS, and store plugins in `apps/webui/package.json`.
- Tree-sitter packages and `web-tree-sitter` - Client-side code highlighting/parsing support declared in `apps/webui/package.json` and used by `apps/webui/src/lib/code-highlight.ts`.

## Configuration

**Environment:**
- Gateway configuration is centralized in `apps/gateway/src/config.ts`; it reads `PORT`, `GATEWAY_PORT`, `GATEWAY_CORS_ORIGINS`, `SITE_URL`, `DATABASE_URL`, `RESEND_API_KEY`, `EMAIL_FROM`, `SKIP_EMAIL_VERIFICATION`, `IS_PREVIEW`, `FLY_ALLOC_ID`, `FLY_REGION`, `REDIS_URL`, `WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY`, and `WEB_PUSH_SUBJECT`.
- WebUI gateway configuration is centralized in `apps/webui/src/lib/gateway-config.ts`; it reads `VITE_API_GATEWAY_URL` and `VITE_GATEWAY_URL`, falls back to Tauri Store, and finally derives `http(s)://{hostname}:3005`.
- WebUI Better Auth is enabled only when `VITE_GATEWAY_URL` is configured in `apps/webui/src/lib/auth.ts`.
- CLI configuration is centralized in `apps/mobvibe-cli/src/config.ts`; it reads `MOBVIBE_HOME`, `MOBVIBE_ENABLED_AGENTS`, `MOBVIBE_ACP_CLIENT_NAME`, `MOBVIBE_ACP_CLIENT_VERSION`, `MOBVIBE_MACHINE_ID`, `MOBVIBE_COMPACTION_ENABLED`, `MOBVIBE_CONSOLIDATION_ENABLED`, and `MOBVIBE_WORKTREE_BASE_DIR`.
- CLI gateway and E2EE root credential resolution is in `apps/mobvibe-cli/src/auth/credentials.ts`; it reads `MOBVIBE_GATEWAY_URL`, `MOBVIBE_MASTER_SECRET`, and local `~/.mobvibe/credentials.json`.
- `.env`-style files are present at `apps/gateway/.env`, `apps/gateway/.env.development`, `apps/gateway/.env.example`, `apps/webui/.env`, `apps/webui/.env.production`, `apps/webui/.env.development`, `apps/webui/.env.example`, `apps/mobvibe-cli/.env`, `apps/mobvibe-cli/.env.development`, and `apps/mobvibe-cli/.env.example`; contents are intentionally not read or quoted.

**Build:**
- Root workspace scripts and Node/pnpm engine are in `package.json`.
- Workspace package graph is in `pnpm-workspace.yaml`; task graph is in `turbo.json`.
- Biome lint/format rules are in `biome.json`.
- Gateway TypeScript, database, Docker, and Fly deployment are configured by `apps/gateway/tsconfig.json`, `apps/gateway/drizzle.config.ts`, `apps/gateway/Dockerfile`, and `fly.toml`.
- WebUI Vite, Vitest, Playwright, Netlify, and Tauri settings are configured by `apps/webui/vite.config.ts`, `apps/webui/vitest.config.ts`, `apps/webui/playwright.config.ts`, `apps/webui/netlify.toml`, and `apps/webui/src-tauri/tauri.conf.json`.
- Website Vite and Netlify settings are configured by `apps/website/vite.config.ts` and `apps/website/netlify.toml`.
- CLI Bun library and binary builds are configured by `apps/mobvibe-cli/build.ts`, `apps/mobvibe-cli/build-bin.ts`, and platform package manifests under `apps/mobvibe-cli/npm/*/package.json`.

## Platform Requirements

**Development:**
- Use pnpm for workspace package management; the root command surface is `package.json`, and package-specific commands are in `apps/*/package.json` and `packages/shared/package.json`.
- Use Node 22 for root/gateway/webui/website/shared parity with `package.json`, `apps/gateway/Dockerfile`, `apps/webui/netlify.toml`, and `.github/workflows/ci.yml`.
- Install Bun for `apps/mobvibe-cli/` development and tests because `apps/mobvibe-cli/package.json` uses Bun scripts and `apps/mobvibe-cli/src/index.ts` imports `bun:sqlite`.
- Install Rust, Java 17, Android SDK/NDK, and cargo-ndk only for Tauri Android builds; the required CI steps are documented in `.github/workflows/ci.yml`.
- PostgreSQL is required for the gateway because `apps/gateway/src/db/index.ts` throws when `DATABASE_URL` is missing.
- Redis is optional; `apps/gateway/src/services/redis.ts` degrades to single-instance mode when `REDIS_URL` is absent or unavailable.

**Production:**
- Gateway runs on Fly.io using `fly.toml` and `apps/gateway/Dockerfile`; the service listens on port 3005 and exposes `/health` for checks.
- WebUI is deployed to Netlify with `apps/webui/netlify.toml`, publishing `apps/webui/dist`.
- Website is deployed to Netlify with `apps/website/netlify.toml`, publishing `apps/website/dist`.
- PostgreSQL production storage is provided through `DATABASE_URL`; PR previews create Neon branches in `.github/workflows/preview-deploy.yml`.
- Redis production affinity is enabled by setting `REDIS_URL`; gateway code uses it for Fly multi-instance affinity in `apps/gateway/src/index.ts`.
- CLI is published to npm from `.github/workflows/publish.yml`; binaries are compiled by `apps/mobvibe-cli/build-bin.ts` for Linux, macOS, and Windows targets.

---

*Stack analysis: 2026-05-11*
