# Technology Stack

**Analysis Date:** 2026-05-12

## Languages

**Primary:**
- TypeScript 5.9.x - Main application language across `apps/gateway/src/`, `apps/webui/src/`, `apps/website/src/`, `apps/mobvibe-cli/src/`, `packages/shared/src/`, and `packages/ui/src/`.
- TSX / React JSX - UI screens and components in `apps/webui/src/`, `apps/website/src/`, and `packages/ui/src/`.

**Secondary:**
- Rust 2021 edition - Tauri native shell in `apps/webui/src-tauri/Cargo.toml` and `apps/webui/src-tauri/src/`.
- JavaScript / MJS - Build, prerender, and patch scripts in `apps/webui/scripts/`, `apps/website/scripts/`, and `apps/mobvibe-cli/bin/mobvibe.mjs`.
- SQL migration artifacts - Drizzle-generated PostgreSQL migrations in `apps/gateway/drizzle/`.
- TOML / YAML / JSON - Deployment, CI, workspace, and app configuration in `fly.toml`, `.github/workflows/*.yml`, `apps/*/netlify.toml`, `turbo.json`, and `biome.json`.

## Runtime

**Environment:**
- Node.js >=22.12.0 - Root workspace runtime from `package.json`; CI uses Node 22 in `.github/workflows/ci.yml`; Gateway Docker image uses `node:22-alpine` in `apps/gateway/Dockerfile`.
- Bun - CLI development, build, binary packaging, and tests in `apps/mobvibe-cli/package.json`; CI installs Bun via `oven-sh/setup-bun@v2` in `.github/workflows/ci.yml` and `.github/workflows/publish.yml`.
- Rust stable - Tauri desktop/mobile builds in `apps/webui/src-tauri/Cargo.toml`; CI Android job installs Rust stable in `.github/workflows/ci.yml`.
- Browser / WebView - WebUI and Website run as Vite-built SPAs; WebUI also runs inside Tauri desktop/mobile WebViews configured by `apps/webui/src-tauri/tauri.conf.json`.

**Package Manager:**
- pnpm 10.32.1 - Declared in root `package.json`; workspace packages declared by `pnpm-workspace.yaml`.
- Lockfile: present at `pnpm-lock.yaml`; an additional app lockfile exists at `apps/webui/pnpm-lock.yaml`.
- Cargo - Rust dependency resolution for Tauri under `apps/webui/src-tauri/`.

## Frameworks

**Core:**
- Turborepo ^2.7.4 - Monorepo task orchestration in `turbo.json` and root `package.json` scripts.
- Express ^4.21.2 - Gateway HTTP API server in `apps/gateway/src/index.ts`.
- Socket.IO ^4.8.x - Real-time Gateway namespaces for WebUI and CLI in `apps/gateway/src/index.ts`, `apps/gateway/src/socket/`, `apps/webui/src/lib/socket.ts`, and `apps/mobvibe-cli/src/daemon/socket-client.ts`.
- React ^19.2.0 - WebUI, Website, and shared UI package in `apps/webui/package.json`, `apps/website/package.json`, and `packages/ui/package.json`.
- Vite ^8.0.2 - WebUI and Website frontend builds in `apps/webui/vite.config.ts` and `apps/website/vite.config.ts`.
- Tauri 2 - Desktop/mobile wrapper for WebUI in `apps/webui/src-tauri/Cargo.toml` and `apps/webui/src-tauri/tauri.conf.json`.
- Better Auth ^1.4.15 - Gateway authentication and WebUI auth client in `apps/gateway/src/lib/auth.ts` and `apps/webui/src/lib/auth.ts`.
- Drizzle ORM ^0.41.0 / Drizzle Kit ^0.31.4 - PostgreSQL schema and migrations in `apps/gateway/src/db/schema.ts`, `apps/gateway/src/db/index.ts`, and `apps/gateway/drizzle.config.ts`.
- Agent Client Protocol SDK ^0.16.1 - CLI ACP backend integration in `apps/mobvibe-cli/src/acp/` and shared types in `packages/shared/src/`.

**Testing:**
- Vitest ^2.1.8 - Unit tests for Gateway, WebUI, and shared packages via `apps/gateway/package.json`, `apps/webui/package.json`, and `packages/shared/package.json`.
- @testing-library/react ^16.3.0 and jsdom ^24.1.3 - React component tests in `apps/webui/vitest.config.ts`.
- Playwright ^1.58.2 - WebUI E2E tests in `apps/webui/playwright.config.ts` and `apps/webui/tests/e2e/`.
- Bun test - CLI tests in `apps/mobvibe-cli/package.json` and `apps/mobvibe-cli/src/**/__tests__/`.

**Build/Dev:**
- TypeScript compiler ~5.9.3 - Package builds through `tsc` in `apps/gateway/package.json`, `apps/webui/package.json`, `apps/website/package.json`, `packages/shared/package.json`, and `packages/ui/package.json`.
- tsx ^4.19.3 - Gateway watch-mode development in `apps/gateway/package.json`.
- Biome 2.3.11 - Formatting, linting, and import organization in `biome.json` and per-package `biome.json` files.
- Tailwind CSS ^4.2.2 with `@tailwindcss/vite` - Styling for WebUI and Website in `apps/webui/package.json`, `apps/website/package.json`, and `packages/ui/src/styles.css`.
- Bun build scripts - CLI library and platform binaries in `apps/mobvibe-cli/build.ts`, `apps/mobvibe-cli/build-bin.ts`, and `apps/mobvibe-cli/package.json`.

## Key Dependencies

**Critical:**
- `@mobvibe/shared` workspace package - Shared ACP, socket, crypto, and domain types consumed by `apps/gateway`, `apps/webui`, and `apps/mobvibe-cli`.
- `@mobvibe/ui` workspace package - Shared React UI components consumed by `apps/webui` and `apps/website`.
- `better-auth` - Email/password auth, sessions, bearer auth, OpenAPI plugin, and Tauri auth support in `apps/gateway/src/lib/auth.ts` and `apps/webui/src/lib/auth.ts`.
- `drizzle-orm` and `pg` - PostgreSQL data access in `apps/gateway/src/db/index.ts` and schema definitions in `apps/gateway/src/db/schema.ts`.
- `socket.io` / `socket.io-client` - CLI-to-Gateway and WebUI-to-Gateway real-time transport in `apps/gateway/src/index.ts`, `apps/webui/src/lib/socket.ts`, and `apps/mobvibe-cli/src/daemon/socket-client.ts`.
- `@agentclientprotocol/sdk` - Local ACP process integration in `apps/mobvibe-cli/src/acp/acp-connection.ts` and `apps/mobvibe-cli/src/acp/session-manager.ts`.
- `tweetnacl` and `@noble/hashes` - End-to-end encryption and key derivation utilities in `packages/shared/src/` and Gateway tests under `apps/gateway/src/services/__tests__/crypto.test.ts`.

**Infrastructure:**
- `ioredis` - Optional Redis-backed multi-instance affinity and instance registry in `apps/gateway/src/services/redis.ts`, `apps/gateway/src/services/instance-registry.ts`, and `apps/gateway/src/services/user-affinity.ts`.
- `resend` - Email delivery for Better Auth verification and password reset in `apps/gateway/src/lib/email.ts`.
- `web-push` - Browser push notification delivery in `apps/gateway/src/services/notification-service.ts`.
- `pino` and `pino-pretty` - Structured logging in Gateway and CLI via `apps/gateway/src/lib/logger.ts` and `apps/mobvibe-cli/src/lib/logger.ts`.
- `@tanstack/react-query` - Client-side server state in `apps/webui/src/app/AppProviders.tsx` and WebUI hooks.
- `zustand` - WebUI local state stores in `apps/webui/src/lib/*-store.ts`.
- `i18next`, `react-i18next`, and `i18next-browser-languagedetector` - Localization in `apps/webui/src/i18n/` and `apps/website/src/i18n/`.
- `@tauri-apps/*` plugins - Native deep links, HTTP, notifications, OS detection, barcode scanner, and persistent store in `apps/webui/package.json`, `apps/webui/src/lib/`, and `apps/webui/src-tauri/Cargo.toml`.
- `web-tree-sitter` and language parsers - In-browser code parsing and previews in `apps/webui/package.json` and copied WASM assets under `apps/webui/public/`.

## Configuration

**Environment:**
- Gateway loads `.env.{NODE_ENV}` then `.env` through `apps/gateway/src/env.ts`; required and optional values are read in `apps/gateway/src/config.ts`.
- WebUI reads `VITE_GATEWAY_URL` and `VITE_API_GATEWAY_URL` in `apps/webui/src/lib/auth.ts` and `apps/webui/src/lib/gateway-config.ts`; Tauri builds can persist a gateway URL through `apps/webui/src/lib/tauri-store.ts`.
- Website reads `VITE_WEB_APP_URL` in `apps/website/src/components/GetStartedDialog.tsx` and `apps/website/src/components/PricingPage.tsx`.
- CLI reads `MOBVIBE_*`, `LOG_LEVEL`, `NODE_ENV`, and shell-related variables in `apps/mobvibe-cli/src/config.ts`, `apps/mobvibe-cli/src/auth/credentials.ts`, `apps/mobvibe-cli/src/lib/logger.ts`, and `apps/mobvibe-cli/src/lib/shell.ts`.
- `.env` files are present at `apps/gateway/.env`, `apps/mobvibe-cli/.env`, and `apps/webui/.env`; `.env.example`, `.env.development`, and `.env.production` variants are present and must be treated as environment configuration files, not source of committed secret values.

**Build:**
- Root workspace: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `pnpm-lock.yaml`.
- Formatting/linting: `biome.json`, package-level `apps/webui/biome.json`, `apps/website/biome.json`, `packages/shared/biome.json`, and `packages/ui/biome.json`.
- TypeScript: package `tsconfig.json` files under `apps/gateway/`, `apps/webui/`, `apps/website/`, `apps/mobvibe-cli/`, `packages/shared/`, and `packages/ui/`.
- Frontend bundling: `apps/webui/vite.config.ts` and `apps/website/vite.config.ts`.
- Testing: `apps/webui/vitest.config.ts`, `apps/webui/playwright.config.ts`, and package test scripts.
- Database migrations: `apps/gateway/drizzle.config.ts`, `apps/gateway/drizzle/`, and `apps/gateway/Dockerfile` startup migrations.
- Native app: `apps/webui/src-tauri/Cargo.toml`, `apps/webui/src-tauri/tauri.conf.json`, `apps/webui/src-tauri/tauri.ios.conf.json`, and capability files in `apps/webui/src-tauri/capabilities/`.

## Platform Requirements

**Development:**
- Use `pnpm install` from the repo root; package graph is declared in `pnpm-workspace.yaml`.
- Use Node.js 22+ for workspace packages; root requires `>=22.12.0` in `package.json`.
- Use Bun for `apps/mobvibe-cli` development, builds, and tests.
- Use Rust stable, platform toolchains, and Tauri CLI for desktop/mobile builds; Android builds require Java 17, Android SDK/NDK, and cargo-ndk as shown in `.github/workflows/ci.yml`.
- Use PostgreSQL-compatible `DATABASE_URL` before starting Gateway or running Drizzle migrations; `apps/gateway/src/db/index.ts` and `apps/gateway/drizzle.config.ts` throw when it is absent.

**Production:**
- Gateway deploys to Fly.io using `fly.toml`, `apps/gateway/Dockerfile`, and `.github/workflows/deploy-fly.yml`; runtime listens on port 3005.
- WebUI deploys to Netlify from `apps/webui/netlify.toml` and serves `apps/webui/dist`.
- Website deploys to Netlify from `apps/website/netlify.toml` and serves `apps/website/dist`.
- CLI publishes to npm via `.github/workflows/publish.yml`, including platform binary packages under `apps/mobvibe-cli/npm/`.
- Android Tauri artifacts are built in `.github/workflows/ci.yml` and attached to GitHub Releases by `.github/workflows/publish.yml`.

---

*Stack analysis: 2026-05-12*
