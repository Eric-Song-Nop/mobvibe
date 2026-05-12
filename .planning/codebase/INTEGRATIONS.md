# External Integrations

**Analysis Date:** 2026-05-12

## APIs & External Services

**Gateway HTTP API:**
- Mobvibe Gateway - REST API, Better Auth endpoints, health checks, ACP session routes, filesystem routes, machine/device registration, and notification routes.
  - SDK/Client: Browser `fetch`, Tauri HTTP plugin wrapper in `apps/webui/src/lib/tauri-fetch.ts`, Express routers in `apps/gateway/src/index.ts`.
  - Auth: Cookie sessions for browser WebUI and bearer tokens for Tauri/CLI through Better Auth in `apps/gateway/src/lib/auth.ts` and `apps/webui/src/lib/auth.ts`.

**Real-time Messaging:**
- Socket.IO Gateway - WebUI connects to `/webui`; CLI connects to `/cli`; both use `path: "/socket.io"`.
  - SDK/Client: `socket.io` in `apps/gateway/src/index.ts`; `socket.io-client` in `apps/webui/src/lib/socket.ts` and `apps/mobvibe-cli/src/daemon/socket-client.ts`.
  - Auth: Browser cookies for WebUI, Tauri bearer token query/auth transport in `apps/webui/src/lib/socket.ts`, and CLI machine/master-secret-derived credentials through `apps/mobvibe-cli/src/auth/credentials.ts` and Gateway socket handlers.

**ACP Agent Registry:**
- Agent Client Protocol CDN - CLI fetches `https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json` to detect local ACP backends.
  - SDK/Client: Native `fetch` in `apps/mobvibe-cli/src/registry/registry-client.ts` with one-hour cache under `~/.mobvibe/cache/registry.json`.
  - Auth: None detected.

**Local ACP Backends:**
- Agent Client Protocol processes - CLI launches and communicates with local ACP agent backends for sessions, prompts, permissions, history, and events.
  - SDK/Client: `@agentclientprotocol/sdk` in `apps/mobvibe-cli/src/acp/acp-connection.ts` and `apps/mobvibe-cli/src/acp/session-manager.ts`.
  - Auth: Local process invocation and user-selected backend configuration in `apps/mobvibe-cli/src/config.ts`; external provider credentials are owned by each ACP backend, not this repo.

**Email Delivery:**
- Resend - Sends Better Auth verification and password reset emails.
  - SDK/Client: `resend` package in `apps/gateway/src/lib/email.ts`.
  - Auth: `RESEND_API_KEY`; sender configured by `EMAIL_FROM` in `apps/gateway/src/config.ts`.

**Browser Push:**
- Web Push / Push Service endpoints - Sends permission request, response completed, and session error notifications to registered browser push subscriptions.
  - SDK/Client: `web-push` package in `apps/gateway/src/services/notification-service.ts`; WebUI notification helpers under `apps/webui/src/lib/notifications.ts`.
  - Auth: VAPID keys configured by `WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY`, and `WEB_PUSH_SUBJECT` in `apps/gateway/src/config.ts`.

**Native App Capabilities:**
- Tauri plugins - WebUI uses native deep links, persistent store, HTTP, notifications, OS detection, and mobile barcode scanning.
  - SDK/Client: `@tauri-apps/api`, `@tauri-apps/plugin-*` packages in `apps/webui/package.json`; Rust plugins in `apps/webui/src-tauri/Cargo.toml`.
  - Auth: Better Auth Tauri plugin uses bearer token storage and `mobvibe://` callback/deep-link scheme in `apps/gateway/src/lib/auth.ts` and `apps/webui/src-tauri/tauri.conf.json`.

## Data Storage

**Databases:**
- PostgreSQL - Gateway persistence for Better Auth users/sessions/accounts/verifications, machines, device keys, and web push subscriptions.
  - Connection: `DATABASE_URL` in `apps/gateway/src/db/index.ts` and `apps/gateway/drizzle.config.ts`.
  - Client: `pg` pool plus Drizzle ORM in `apps/gateway/src/db/index.ts`; schema in `apps/gateway/src/db/schema.ts`; migrations in `apps/gateway/drizzle/`.
- SQLite-like local WAL database path - CLI stores local event WAL data at `~/.mobvibe/events.db` by default.
  - Connection: path computed by `apps/mobvibe-cli/src/config.ts` from `MOBVIBE_HOME`.
  - Client: WAL modules under `apps/mobvibe-cli/src/wal/`.

**File Storage:**
- Local filesystem - CLI stores credentials, cache, logs, config, worktrees, and WAL files under `~/.mobvibe` by default in `apps/mobvibe-cli/src/config.ts` and `apps/mobvibe-cli/src/auth/credentials.ts`.
- Tauri Store - Desktop/mobile WebUI stores gateway URL and app state in local Tauri store files through `apps/webui/src/lib/tauri-store.ts`, `apps/webui/src/lib/tauri-storage-adapter.ts`, and `apps/webui/src/lib/gateway-config.ts`.
- Static assets - WebUI and Website serve built assets from `apps/webui/dist` and `apps/website/dist`; Tree-sitter WASM assets are prepared for WebUI public assets by package scripts.

**Caching:**
- Redis / Upstash-compatible Redis - Optional Gateway multi-instance instance registry and user affinity store.
  - Connection: `REDIS_URL` in `apps/gateway/src/config.ts` and `apps/gateway/src/services/redis.ts`.
  - Client: `ioredis` in `apps/gateway/src/services/redis.ts`.
- CLI registry cache - ACP registry JSON cached under `~/.mobvibe/cache/registry.json` by `apps/mobvibe-cli/src/registry/registry-client.ts`.
- Browser/Tauri local state - Zustand and Tauri storage adapters in `apps/webui/src/lib/*-store.ts` and `apps/webui/src/lib/tauri-storage-adapter.ts`.

## Authentication & Identity

**Auth Provider:**
- Better Auth - Custom email/password authentication using Gateway PostgreSQL storage.
  - Implementation: `betterAuth()` in `apps/gateway/src/lib/auth.ts` with Drizzle adapter, email verification, password reset, bearer plugin, OpenAPI plugin, Tauri plugin, cookie session cache, and trusted origins.
  - Client: `createAuthClient()` in `apps/webui/src/lib/auth.ts`; browser mode uses credentials/cookies, Tauri mode uses bearer token capture from `set-auth-token` headers.
  - Database: Better Auth tables in `apps/gateway/src/db/schema.ts` (`user`, `session`, `account`, `verification`).
  - Required auth/config env vars: `DATABASE_URL`; production deployments also require `BETTER_AUTH_SECRET` per repo guidance and secure Gateway secrets.

**Machine / CLI Identity:**
- Mobvibe master secret and device keys - CLI stores a base64 master secret in `~/.mobvibe/credentials.json` or reads `MOBVIBE_MASTER_SECRET`.
  - Implementation: `apps/mobvibe-cli/src/auth/credentials.ts`, Gateway machine/device routes in `apps/gateway/src/routes/machines.ts` and `apps/gateway/src/routes/device.ts`, crypto helpers in `packages/shared/src/`.
  - Auth: `MOBVIBE_MASTER_SECRET` override or credentials file; Gateway URL from `MOBVIBE_GATEWAY_URL`, credentials file, or `https://api.mobvibe.net`.

**OAuth / Social Login:**
- Not detected in active auth configuration. Better Auth account schema supports external providers in `apps/gateway/src/db/schema.ts`, but `apps/gateway/src/lib/auth.ts` enables email/password, bearer, OpenAPI, and Tauri plugins only.

## Monitoring & Observability

**Error Tracking:**
- None detected; no Sentry/PostHog/OpenTelemetry integration appears in package manifests or source imports.

**Logs:**
- Gateway logs structured HTTP requests, CORS rejections, Redis affinity state, email delivery, push failures, and shutdown via Pino in `apps/gateway/src/lib/logger.ts` and `apps/gateway/src/index.ts`.
- CLI logs through Pino in `apps/mobvibe-cli/src/lib/logger.ts`; log level controlled by `LOG_LEVEL` and pretty output by `NODE_ENV`.
- Development-only email fallback logs email subject/body metadata when `RESEND_API_KEY` is absent in `apps/gateway/src/lib/email.ts`.

## CI/CD & Deployment

**Hosting:**
- Gateway: Fly.io using `fly.toml`, `apps/gateway/Dockerfile`, and `.github/workflows/deploy-fly.yml`; production app listens on port 3005 and exposes `/health`.
- WebUI: Netlify using `apps/webui/netlify.toml`; production app target is `app.mobvibe.net` per repo guide.
- Website: Netlify using `apps/website/netlify.toml`; production app target is `mobvibe.net` per repo guide.
- CLI: npm package `@mobvibe/cli` plus platform binary packages under `apps/mobvibe-cli/npm/*`, published by `.github/workflows/publish.yml`.

**CI Pipeline:**
- GitHub Actions CI in `.github/workflows/ci.yml` runs format/lint checks, builds, Vitest/Bun/Playwright tests, and optional Tauri Android builds.
- Fly deploy in `.github/workflows/deploy-fly.yml` runs `flyctl deploy --remote-only` with `FLY_API_TOKEN` from GitHub Secrets.
- Netlify preview deployment workflows exist at `.github/workflows/preview-deploy.yml` and `.github/workflows/preview-cleanup.yml`.
- npm publish and GitHub Release are defined in `.github/workflows/publish.yml` using `NODE_AUTH_TOKEN` / `NPM_TOKEN` and release artifacts.

## Environment Configuration

**Required env vars:**
- Gateway: `DATABASE_URL` required by `apps/gateway/src/db/index.ts` and `apps/gateway/drizzle.config.ts`.
- Gateway auth/email/config: `BETTER_AUTH_SECRET` per repo guide, `GATEWAY_CORS_ORIGINS`, `SITE_URL`, `RESEND_API_KEY`, `EMAIL_FROM`, `SKIP_EMAIL_VERIFICATION`.
- Gateway deployment/affinity: `PORT`, `GATEWAY_PORT`, `NODE_ENV`, `LOG_LEVEL`, `IS_PREVIEW`, `FLY_APP_NAME`, `FLY_ALLOC_ID`, `FLY_REGION`, `REDIS_URL`.
- Gateway push: `WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY`, `WEB_PUSH_SUBJECT`.
- WebUI: `VITE_GATEWAY_URL`; `VITE_API_GATEWAY_URL` is also supported by `apps/webui/src/lib/gateway-config.ts` and E2E tests.
- Website: `VITE_WEB_APP_URL` for links into the web app.
- CLI: `MOBVIBE_GATEWAY_URL`, `MOBVIBE_MASTER_SECRET`, `MOBVIBE_HOME`, `MOBVIBE_ENABLED_AGENTS`, `MOBVIBE_ACP_CLIENT_NAME`, `MOBVIBE_ACP_CLIENT_VERSION`, `MOBVIBE_MACHINE_ID`, `MOBVIBE_COMPACTION_ENABLED`, `MOBVIBE_CONSOLIDATION_ENABLED`, `MOBVIBE_WORKTREE_BASE_DIR`, `MOBVIBE_SHELL`, `SHELL`, `LOG_LEVEL`.
- Tests/builds: `PLAYWRIGHT_GATEWAY_PORT`, `PLAYWRIGHT_WEB_PORT`, `MOBVIBE_BUN_TARGET`, Android signing secrets referenced by `.github/workflows/ci.yml`.

**Secrets location:**
- Local development env files exist at `apps/gateway/.env`, `apps/mobvibe-cli/.env`, and `apps/webui/.env`; examples/development variants also exist and must not be treated as source for secret values.
- CLI credentials are stored at `~/.mobvibe/credentials.json` with mode `0600` by `apps/mobvibe-cli/src/auth/credentials.ts`.
- GitHub Actions secrets referenced by workflow files include `FLY_API_TOKEN`, `NPM_TOKEN`, and Android signing values in `.github/workflows/deploy-fly.yml`, `.github/workflows/publish.yml`, and `.github/workflows/ci.yml`.
- Fly.io and Netlify runtime secrets are managed outside the repo; committed files only define non-secret build/deploy settings such as `fly.toml`, `apps/webui/netlify.toml`, and `apps/website/netlify.toml`.

## Webhooks & Callbacks

**Incoming:**
- Better Auth endpoints mounted at `/api/auth/*` by `apps/gateway/src/index.ts`; email verification and password reset callbacks route back to `/login?verified=1` from `apps/webui/src/lib/auth.ts`.
- Tauri/deep-link callback scheme `mobvibe://` configured in `apps/gateway/src/lib/auth.ts` and `apps/webui/src-tauri/tauri.conf.json`.
- Socket.IO upgrade/polling endpoint `/socket.io` with namespaces `/webui` and `/cli` in `apps/gateway/src/index.ts`.
- REST routes mounted by Gateway: `/health`, `/api/notifications`, `/api/machines`, `/acp`, `/fs`, and device routes from `apps/gateway/src/routes/`.
- GitHub Actions event triggers: PRs and manual dispatch in `.github/workflows/ci.yml`, pushes to `master` in `.github/workflows/deploy-fly.yml`, and `v*` tags in `.github/workflows/publish.yml`.

**Outgoing:**
- Gateway sends emails through Resend from `apps/gateway/src/lib/email.ts`.
- Gateway sends browser push messages through Web Push endpoints from `apps/gateway/src/services/notification-service.ts`.
- CLI fetches ACP registry JSON from `https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json` in `apps/mobvibe-cli/src/registry/registry-client.ts`.
- CLI opens Socket.IO client connections to the configured Gateway URL in `apps/mobvibe-cli/src/daemon/socket-client.ts`.
- WebUI opens HTTP and Socket.IO connections to the configured Gateway URL in `apps/webui/src/lib/gateway-config.ts`, `apps/webui/src/lib/auth.ts`, and `apps/webui/src/lib/socket.ts`.
- CI deploys Gateway to Fly.io and publishes packages to npm/GitHub Releases through `.github/workflows/deploy-fly.yml` and `.github/workflows/publish.yml`.

---

*Integration audit: 2026-05-12*
