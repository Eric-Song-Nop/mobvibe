---
last_mapped_commit: 7e89508dcca9477698c5e492fe7b8fdf9195f9af
mapping_date: 2026-05-11
---

# External Integrations

**Analysis Date:** 2026-05-11

## APIs & External Services

**Realtime Gateway:**
- Socket.io gateway - Connects WebUI and local CLI daemons for session state, ACP events, permission requests, file operations, machine status, and notifications.
  - SDK/Client: `socket.io` in `apps/gateway/package.json`, `socket.io-client` in `apps/webui/package.json`, and `socket.io-client` in `apps/mobvibe-cli/package.json`.
  - Server implementation: `apps/gateway/src/index.ts`, `apps/gateway/src/socket/webui-handlers.ts`, and `apps/gateway/src/socket/cli-handlers.ts`.
  - WebUI client: `apps/webui/src/lib/socket.ts` connects to `${GATEWAY_URL}/webui` over `/socket.io`.
  - CLI client: `apps/mobvibe-cli/src/daemon/socket-client.ts` connects local ACP backends to the gateway.
  - Auth: Browser sessions use Better Auth cookies; Tauri/mobile sockets pass bearer token auth via `apps/webui/src/lib/socket.ts`; CLI credentials are resolved in `apps/mobvibe-cli/src/auth/credentials.ts`.

**Agent Client Protocol:**
- ACP Registry CDN - CLI downloads the registry of supported ACP agents and caches it locally.
  - SDK/Client: native `fetch` in `apps/mobvibe-cli/src/registry/registry-client.ts`.
  - Endpoint: `https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json` in `apps/mobvibe-cli/src/registry/registry-client.ts`.
  - Auth: none detected.
- ACP TypeScript SDK - Shared types and CLI ACP runtime integration.
  - SDK/Client: `@agentclientprotocol/sdk` in `packages/shared/package.json` and `apps/mobvibe-cli/package.json`.
  - Implementation: shared ACP types in `packages/shared/src/types/acp.ts`; CLI ACP connection/session modules under `apps/mobvibe-cli/src/acp/`.
  - Auth: local ACP backend process configuration; no external service token is configured by repository code.

**Email Delivery:**
- Resend - Sends Better Auth verification and password reset emails from the gateway.
  - SDK/Client: `resend` in `apps/gateway/package.json`.
  - Implementation: `apps/gateway/src/lib/email.ts` and email templates in `apps/gateway/src/lib/email-templates.ts`.
  - Auth: `RESEND_API_KEY`; sender configured by `EMAIL_FROM` in `apps/gateway/src/config.ts`.

**Browser Push Notifications:**
- Web Push service endpoints - Sends notifications to browser-managed push endpoints for permission requests and session events.
  - SDK/Client: `web-push` in `apps/gateway/package.json`.
  - Implementation: `apps/gateway/src/services/notification-service.ts`, `apps/gateway/src/routes/notifications.ts`, and subscription persistence in `apps/gateway/src/services/db-service.ts`.
  - Auth: VAPID config via `WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY`, and `WEB_PUSH_SUBJECT` in `apps/gateway/src/config.ts`.

**Native App Platform APIs:**
- Tauri plugins - WebUI desktop/mobile access for deep links, HTTP, notifications, barcode scanning, OS metadata, and key/value store.
  - SDK/Client: `@tauri-apps/api`, `@tauri-apps/plugin-barcode-scanner`, `@tauri-apps/plugin-deep-link`, `@tauri-apps/plugin-http`, `@tauri-apps/plugin-notification`, `@tauri-apps/plugin-os`, and `@tauri-apps/plugin-store` in `apps/webui/package.json`.
  - Implementation: Tauri app config in `apps/webui/src-tauri/tauri.conf.json`, Tauri store access in `apps/webui/src/lib/tauri-store.ts`, platform fetch in `apps/webui/src/lib/tauri-fetch.ts`, and platform detection in `apps/webui/src/lib/platform.ts`.
  - Auth: Better Auth Tauri plugin with deep link scheme `mobvibe` configured in `apps/gateway/src/lib/auth.ts` and `apps/webui/src-tauri/tauri.conf.json`.

**Public Web Properties:**
- Production gateway - Default CLI target and WebUI backend service.
  - SDK/Client: HTTP and Socket.io clients in `apps/mobvibe-cli/src/auth/credentials.ts`, `apps/webui/src/lib/gateway-config.ts`, and `apps/webui/src/lib/socket.ts`.
  - Endpoint: `https://api.mobvibe.net` default in `apps/mobvibe-cli/src/auth/credentials.ts`; Fly app health and API routing in `fly.toml`.
  - Auth: Better Auth session cookies, bearer tokens, and CLI master-secret credentials.
- Production WebUI - Browser app hosted at app domain.
  - SDK/Client: Static Vite app built from `apps/webui/package.json` and deployed by `apps/webui/netlify.toml`.
  - Endpoint: `https://app.mobvibe.net` referenced in `render.yaml`, `README.zh.md`, and website links in `apps/website/src/components/PricingPage.tsx` and `apps/website/src/components/GetStartedDialog.tsx`.
  - Auth: Better Auth client in `apps/webui/src/lib/auth.ts`.
- Marketing website - Static site for public pages.
  - SDK/Client: Static Vite app built from `apps/website/package.json` and deployed by `apps/website/netlify.toml`.
  - Endpoint: `https://mobvibe.net` referenced in `render.yaml` and deployment notes in `AGENTS.md`.
  - Auth: none detected.

## Data Storage

**Databases:**
- PostgreSQL - Gateway durable storage for Better Auth tables, machines, device keys, and web push subscriptions.
  - Connection: `DATABASE_URL` in `apps/gateway/src/db/index.ts` and `apps/gateway/drizzle.config.ts`.
  - Client: `pg` pool wrapped by Drizzle ORM in `apps/gateway/src/db/index.ts`.
  - Schema: `apps/gateway/src/db/schema.ts` defines `user`, `session`, `account`, `verification`, `machines`, `deviceKeys`, and `webPushSubscriptions` tables.
  - Migrations: Drizzle migrations output to `apps/gateway/drizzle/` via `apps/gateway/drizzle.config.ts`; the production container runs `npx drizzle-kit migrate` in `apps/gateway/Dockerfile`.
- Neon PostgreSQL - PR preview database branching.
  - Connection: PR workflow generates a pooled `DATABASE_URL` using `neonctl connection-string` in `.github/workflows/preview-deploy.yml`.
  - Client: Gateway uses the same Drizzle/pg code path in `apps/gateway/src/db/index.ts`.
- Bun SQLite - CLI local write-ahead log and compaction state.
  - Connection: Local file path `~/.mobvibe/events.db` derived as `walDbPath` in `apps/mobvibe-cli/src/config.ts`.
  - Client: `bun:sqlite` imported in `apps/mobvibe-cli/src/index.ts` and WAL modules under `apps/mobvibe-cli/src/wal/`.

**File Storage:**
- Local user filesystem - CLI stores credentials, registry cache, logs, daemon PID, WAL database, and worktrees under `MOBVIBE_HOME` or `~/.mobvibe` in `apps/mobvibe-cli/src/config.ts` and `apps/mobvibe-cli/src/auth/credentials.ts`.
- Tauri Store - Desktop/mobile WebUI stores gateway URL and client-side data via `apps/webui/src/lib/tauri-store.ts`, `apps/webui/src/lib/tauri-storage-adapter.ts`, and `apps/webui/src/lib/gateway-config.ts`.
- Netlify static assets - WebUI publishes `apps/webui/dist` via `apps/webui/netlify.toml`; website publishes `apps/website/dist` via `apps/website/netlify.toml`.

**Caching:**
- Redis - Optional gateway multi-instance affinity, instance registry, and heartbeat coordination.
  - Connection: `REDIS_URL` in `apps/gateway/src/config.ts` and `apps/gateway/src/services/redis.ts`.
  - Client: `ioredis` in `apps/gateway/src/services/redis.ts`.
  - Consumers: `apps/gateway/src/services/instance-registry.ts`, `apps/gateway/src/services/user-affinity.ts`, `apps/gateway/src/middleware/fly-replay.ts`, and affinity wiring in `apps/gateway/src/index.ts`.
- ACP registry file cache - CLI caches the registry at `~/.mobvibe/cache/registry.json` with a one-hour TTL in `apps/mobvibe-cli/src/registry/registry-client.ts`.
- Better Auth cookie cache - Gateway enables session cookie caching for five minutes in `apps/gateway/src/lib/auth.ts`.
- HTTP/browser asset cache - Netlify sets long-lived cache headers for `/assets/*` and `/*.wasm` in `apps/webui/netlify.toml`; website asset cache headers are in `apps/website/netlify.toml`.

## Authentication & Identity

**Auth Provider:**
- Better Auth - Custom self-hosted email/password authentication backed by PostgreSQL.
  - Implementation: `apps/gateway/src/lib/auth.ts` configures Better Auth with Drizzle adapter, email verification, password reset, bearer plugin, OpenAPI plugin, and Tauri plugin.
  - Database: Better Auth tables are declared in `apps/gateway/src/db/schema.ts` and accessed through `apps/gateway/src/db/index.ts`.
  - Client: `apps/webui/src/lib/auth.ts` creates the Better Auth React client against `VITE_GATEWAY_URL`.
  - Middleware: `apps/gateway/src/middleware/auth.ts` validates sessions for protected Express routes.
  - Secrets: Better Auth requires `BETTER_AUTH_SECRET`; deployment references appear in `render.yaml` and `.github/workflows/preview-deploy.yml`.

**Machine / CLI Identity:**
- CLI master secret - Local root credential used for E2EE and machine authentication.
  - Implementation: credentials are stored at `~/.mobvibe/credentials.json` by `apps/mobvibe-cli/src/auth/credentials.ts` with file mode `0600`.
  - Env override: `MOBVIBE_MASTER_SECRET` in `apps/mobvibe-cli/src/auth/credentials.ts`.
  - Gateway URL override: `MOBVIBE_GATEWAY_URL` in `apps/mobvibe-cli/src/auth/credentials.ts` and `apps/mobvibe-cli/src/index.ts`.
- Device public keys - Registered through protected gateway route for E2EE device identity.
  - Implementation: `apps/gateway/src/routes/device.ts` registers base64 Ed25519 public keys into `deviceKeys` table in `apps/gateway/src/db/schema.ts`.
  - Auth: requires Better Auth session through `apps/gateway/src/middleware/auth.ts`.
- Tauri/mobile bearer token - Native WebUI auth tokens are stored client-side and attached as bearer credentials.
  - Implementation: `apps/webui/src/lib/auth.ts`, `apps/webui/src/lib/auth-token.ts`, and `apps/webui/src/lib/socket.ts`.
  - Gateway handling: bearer auth is supported by Better Auth plugin in `apps/gateway/src/lib/auth.ts`; WebSocket upgrade token extraction is in `apps/gateway/src/index.ts`.

## Monitoring & Observability

**Error Tracking:**
- External error tracking service: Not detected.
- GitHub Actions publish/release failures surface through `.github/workflows/ci.yml`, `.github/workflows/deploy-fly.yml`, `.github/workflows/preview-deploy.yml`, and `.github/workflows/publish.yml`.

**Logs:**
- Gateway uses pino structured logs via `apps/gateway/src/lib/logger.ts`; request logging and shutdown logs are in `apps/gateway/src/index.ts`.
- CLI uses pino structured logs via `apps/mobvibe-cli/src/lib/logger.ts`; CLI status/log commands are exposed in `apps/mobvibe-cli/src/index.ts`.
- Redis, email, push notification, auth, and preview deployment paths log errors or warnings in `apps/gateway/src/services/redis.ts`, `apps/gateway/src/lib/email.ts`, `apps/gateway/src/services/notification-service.ts`, `apps/gateway/src/middleware/auth.ts`, and `.github/workflows/preview-deploy.yml`.

## CI/CD & Deployment

**Hosting:**
- Gateway: Fly.io via `fly.toml`, deployed by `.github/workflows/deploy-fly.yml`, built from `apps/gateway/Dockerfile`, and exposed on internal port 3005 with `/health` checks.
- WebUI: Netlify via `apps/webui/netlify.toml`, with production static publish directory `apps/webui/dist`.
- Website: Netlify via `apps/website/netlify.toml`, with production static publish directory `apps/website/dist`.
- PR previews: Fly.io gateway app, Neon database branch, and Netlify WebUI alias created by `.github/workflows/preview-deploy.yml`.
- Legacy Render config: `render.yaml` is retained for reference and marks Fly.io + Netlify as current deployment targets.

**CI Pipeline:**
- GitHub Actions CI: `.github/workflows/ci.yml` runs format/lint checks, installs dependencies, builds all packages, installs Playwright Chromium, runs tests, and optionally builds Tauri Android.
- Gateway deployment: `.github/workflows/deploy-fly.yml` deploys to Fly.io on `master` changes under `apps/gateway/**`, `packages/shared/**`, or `fly.toml`.
- Preview deployment: `.github/workflows/preview-deploy.yml` provisions Neon/Fly/Netlify previews for pull requests and comments URLs on the PR.
- Preview cleanup: `.github/workflows/preview-cleanup.yml` removes PR preview resources.
- npm publishing and GitHub Releases: `.github/workflows/publish.yml` runs CI, builds CLI platform binaries, publishes `@mobvibe/cli` and platform packages, and attaches Android artifacts to a GitHub Release.

## Environment Configuration

**Required env vars:**
- `DATABASE_URL` - Required by `apps/gateway/src/db/index.ts` and `apps/gateway/drizzle.config.ts`; gateway fails fast when missing.
- `BETTER_AUTH_SECRET` - Required by Better Auth deployment; referenced by `render.yaml` and `.github/workflows/preview-deploy.yml`.
- `GATEWAY_CORS_ORIGINS` - Controls gateway REST and Socket.io CORS in `apps/gateway/src/config.ts` and `apps/gateway/src/index.ts`.
- `SITE_URL` - Better Auth base URL and trusted origin input in `apps/gateway/src/config.ts` and `apps/gateway/src/lib/auth.ts`.
- `VITE_GATEWAY_URL` - Enables WebUI Better Auth client in `apps/webui/src/lib/auth.ts` and configures WebUI gateway target in `apps/webui/src/lib/gateway-config.ts`.
- `MOBVIBE_GATEWAY_URL` - Overrides CLI target gateway in `apps/mobvibe-cli/src/auth/credentials.ts` and `apps/mobvibe-cli/src/index.ts`.

**Optional env vars:**
- Gateway: `PORT`, `GATEWAY_PORT`, `RESEND_API_KEY`, `EMAIL_FROM`, `SKIP_EMAIL_VERIFICATION`, `IS_PREVIEW`, `FLY_ALLOC_ID`, `FLY_REGION`, `REDIS_URL`, `WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY`, and `WEB_PUSH_SUBJECT` are parsed in `apps/gateway/src/config.ts`.
- WebUI: `VITE_API_GATEWAY_URL` is accepted as an alias/priority override in `apps/webui/src/lib/gateway-config.ts`; Playwright uses `PLAYWRIGHT_GATEWAY_PORT` and `PLAYWRIGHT_WEB_PORT` in `apps/webui/playwright.config.ts`.
- Website: `VITE_WEB_APP_URL` controls app links in `apps/website/src/components/PricingPage.tsx` and `apps/website/src/components/GetStartedDialog.tsx`.
- CLI: `MOBVIBE_HOME`, `MOBVIBE_MASTER_SECRET`, `MOBVIBE_ENABLED_AGENTS`, `MOBVIBE_ACP_CLIENT_NAME`, `MOBVIBE_ACP_CLIENT_VERSION`, `MOBVIBE_MACHINE_ID`, `MOBVIBE_COMPACTION_ENABLED`, `MOBVIBE_CONSOLIDATION_ENABLED`, `MOBVIBE_WORKTREE_BASE_DIR`, `MOBVIBE_SHELL`, and `MOBVIBE_BUN_TARGET` are read in `apps/mobvibe-cli/src/` modules.

**Secrets location:**
- Local secret files exist but are not read or quoted: `apps/gateway/.env`, `apps/gateway/.env.development`, `apps/webui/.env`, `apps/webui/.env.production`, `apps/webui/.env.development`, `apps/mobvibe-cli/.env`, and `apps/mobvibe-cli/.env.development`.
- GitHub Actions secrets are referenced by workflow files such as `.github/workflows/deploy-fly.yml`, `.github/workflows/preview-deploy.yml`, `.github/workflows/ci.yml`, and `.github/workflows/publish.yml`.
- Fly.io secrets are set by `.github/workflows/preview-deploy.yml` and production secrets are expected on the Fly deployment targeted by `fly.toml`.
- Netlify dashboard/site secrets are expected for `VITE_GATEWAY_URL` and deployment tokens referenced by `apps/webui/netlify.toml`, `.github/workflows/preview-deploy.yml`, and project deployment notes.
- CLI stores local credentials in `~/.mobvibe/credentials.json` via `apps/mobvibe-cli/src/auth/credentials.ts`.

## Webhooks & Callbacks

**Incoming:**
- Better Auth routes are mounted at `/api/auth/*` in `apps/gateway/src/index.ts`; email verification and password reset callback URLs point back to `/login?verified=1` in `apps/webui/src/lib/auth.ts`.
- Tauri deep link scheme `mobvibe://` is configured by Better Auth Tauri plugin in `apps/gateway/src/lib/auth.ts` and by Tauri config in `apps/webui/src-tauri/tauri.conf.json`.
- Socket.io incoming realtime connections use `/socket.io` and the `/webui` namespace in `apps/gateway/src/index.ts` and `apps/webui/src/lib/socket.ts`.
- Machine and ACP REST endpoints include `/api/machines`, `/auth/device/register`, `/api/notifications/*`, `/acp/*`, and `/fs/*` mounted in `apps/gateway/src/index.ts`.
- Fly.io HTTP/WebSocket replay for stateful routes is implemented in `apps/gateway/src/middleware/fly-replay.ts` and WebSocket upgrade handling in `apps/gateway/src/index.ts`.

**Outgoing:**
- Resend email API calls are sent from `apps/gateway/src/lib/email.ts`.
- Web Push notifications are sent from `apps/gateway/src/services/notification-service.ts` to browser subscription endpoints stored in PostgreSQL.
- ACP registry fetches go to `https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json` from `apps/mobvibe-cli/src/registry/registry-client.ts`.
- PR preview workflows call Neon CLI, Fly.io CLI, Netlify CLI, and GitHub REST/comment APIs from `.github/workflows/preview-deploy.yml`.
- Release workflows publish packages to npm and create GitHub Releases from `.github/workflows/publish.yml`.

---

*Integration audit: 2026-05-11*
