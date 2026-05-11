---
last_mapped_commit: 7e89508dcca9477698c5e492fe7b8fdf9195f9af
mapping_date: 2026-05-11
---

# Coding Conventions

**Analysis Date:** 2026-05-11

## Naming Patterns

**Files:**
- Use `kebab-case` for TypeScript source and test files: `apps/gateway/src/services/session-router.ts`, `apps/mobvibe-cli/src/config-loader.ts`, `packages/shared/src/types/agent-config.ts`.
- React route/app components in `apps/webui/src/components/` commonly use `PascalCase.tsx` when the exported component is the primary file symbol: `apps/webui/src/components/app/AppHeader.tsx`, `apps/webui/src/components/app/ColumnFileBrowser.tsx`.
- Store modules use `*-store.ts`: `apps/webui/src/lib/chat-store.ts`, `apps/webui/src/lib/ui-store.ts`, `apps/webui/src/lib/machines-store.ts`.
- Tests use `*.test.ts` or `*.test.tsx` and live under `src/**/__tests__/` or `apps/webui/tests/`: `apps/gateway/src/services/__tests__/session-router.test.ts`, `apps/mobvibe-cli/src/acp/__tests__/session-manager.test.ts`, `apps/webui/tests/message-item.test.tsx`.

**Functions:**
- Use `camelCase` for functions and factories: `createFallbackError` in `apps/webui/src/lib/error-utils.ts`, `getGatewayConfig` in `apps/gateway/src/config.ts`, `createMockSocket` in `apps/gateway/src/services/__tests__/session-router.test.ts`.
- React hooks must start with `use`: `apps/webui/src/hooks/useSessionMutations.ts`, `apps/webui/src/hooks/useSocket.tsx`, `apps/webui/src/hooks/use-qr-scanner.tsx`.
- API wrapper functions use action-oriented verbs: `fetchSessions`, `discoverSessions`, `registerWebPushSubscription`, and `unregisterWebPushSubscription` in `apps/webui/src/lib/api.ts`.

**Variables:**
- Use `camelCase` for local variables and module state: `fallbackUuid` and `createMemoryStorage` in `apps/webui/src/setup-tests.ts`, `gatewayPort` and `webPort` in `apps/webui/playwright.config.ts`.
- Use `UPPER_SNAKE_CASE` for module constants that represent fixed values: `LOG_LEVEL` in `apps/gateway/src/lib/logger.ts` and `apps/mobvibe-cli/src/lib/logger.ts`, `SEND_MESSAGE_TIMEOUT_MS` in `apps/webui/src/lib/api.ts`.
- Prefer explicit `mock*` names for test doubles: `mockFetch` in `apps/webui/src/lib/__tests__/api.test.ts`, `mockIsGitRepo` in `apps/mobvibe-cli/src/acp/__tests__/session-manager.test.ts`.

**Types:**
- Use `PascalCase` for types, interfaces, classes, and React components: `GatewayConfig` in `apps/gateway/src/config.ts`, `ApiError` in `apps/webui/src/lib/api.ts`, `SessionManager` in `apps/mobvibe-cli/src/acp/session-manager.ts`.
- Shared type exports belong in `packages/shared/src/index.ts`; add new public types there after adding implementation files under `packages/shared/src/types/`, `packages/shared/src/crypto/`, or another shared subdirectory.

## Code Style

**Formatting:**
- Use Biome as the only formatter. Root config is `biome.json`; package overrides are `apps/webui/biome.json`, `apps/website/biome.json`, and `packages/shared/biome.json`.
- Use tabs for indentation from `biome.json` and package Biome configs.
- Use double quotes for JavaScript/TypeScript strings from `biome.json` and package Biome configs.
- Do not manually sort imports; Biome organizeImports is enabled in `biome.json`, `apps/webui/biome.json`, and `apps/website/biome.json`.
- Run formatting through package scripts: root `pnpm format`, gateway `pnpm -C apps/gateway format`, webui `pnpm -C apps/webui format`, CLI `pnpm -C apps/mobvibe-cli format`, shared `pnpm -C packages/shared format`.

**Linting:**
- Use Biome checks through `pnpm lint` or package `lint` scripts. Root lint delegates through Turbo from `package.json`.
- Root `biome.json` enables recommended rules and treats unknown file types as errors except `scripts/**` is excluded.
- Web UI and website Biome configs warn for accessibility, disable suspicious/style rule groups, and keep Tailwind CSS directives enabled: `apps/webui/biome.json`, `apps/website/biome.json`.
- TypeScript strict mode is enabled in every main package: `apps/webui/tsconfig.app.json`, `apps/gateway/tsconfig.json`, `apps/mobvibe-cli/tsconfig.json`, `packages/shared/tsconfig.json`.
- Avoid `any`; use `unknown` with narrowing. Existing tests and mocks use `unknown` in prop passthrough types in `apps/webui/src/components/app/__tests__/AppHeader.test.tsx`.

## Import Organization

**Order:**
1. Node built-ins and third-party packages: `node:path`, `@playwright/test`, `@testing-library/react`, `vitest`, `react`.
2. Workspace packages and shared public types: `@mobvibe/shared` from `apps/webui/src/lib/api.ts`, `apps/gateway/src/services/__tests__/session-router.test.ts`, and `apps/mobvibe-cli/src/daemon/host-fs.ts`.
3. WebUI alias imports: `@/components/...`, `@/hooks/...`, `@/lib/...` in `apps/webui/src/App.tsx` and `apps/webui/src/components/app/ColumnFileBrowser.tsx`.
4. Relative package-local imports: `../session-router.js` in `apps/gateway/src/services/__tests__/session-router.test.ts`, `./auth-token` in `apps/webui/src/lib/api.ts`, `../lib/logger.js` in `apps/mobvibe-cli/src/config.ts`.

**Path Aliases:**
- Use `@/*` only inside `apps/webui`; it maps to `apps/webui/src/*` in `apps/webui/tsconfig.app.json` and `apps/webui/vitest.config.ts`.
- Use `@mobvibe/shared` for cross-package shared contracts; keep those exports stable in `packages/shared/src/index.ts`.
- Use explicit `.js` extensions in NodeNext packages (`apps/gateway`, `apps/mobvibe-cli`, `packages/shared`) for relative TypeScript imports that compile to ESM, e.g. `../cli-registry.js` in `apps/gateway/src/services/__tests__/session-router.test.ts`.
- WebUI bundler modules omit extensions for relative imports and aliases, e.g. `./auth` and `@/lib/error-utils` in `apps/webui/src/lib/api.ts`.

## Error Handling

**Patterns:**
- Use structured shared errors when crossing API boundaries. `apps/webui/src/lib/api.ts` throws `ApiError` with `ErrorDetail`, and `apps/webui/src/lib/error-utils.ts` normalizes unknown errors with `normalizeError`.
- Preserve and rethrow known typed errors. `requestJson` in `apps/webui/src/lib/api.ts` rethrows `ApiError` encountered while parsing failed responses.
- Convert aborts/timeouts into typed API errors. `requestJsonWithTimeout` in `apps/webui/src/lib/api.ts` checks `AbortError` and throws `ApiError` with `createFallbackError`.
- Validate env parsing at boundaries. `parsePort` in `apps/gateway/src/config.ts` throws on invalid port input instead of silently defaulting.
- Do not silently catch errors. If a catch block absorbs an error, it must either preserve a fallback path with a typed result (`apps/webui/src/lib/api.ts`) or log with structured context (`apps/mobvibe-cli/src/registry/registry-client.ts`).

## Logging

**Framework:** pino for gateway and CLI; browser code primarily surfaces typed errors to UI state instead of long-lived `console` logging.

**Patterns:**
- Use `logger` from `apps/gateway/src/lib/logger.ts` in gateway code and `apps/mobvibe-cli/src/lib/logger.ts` in CLI code.
- Log structured objects first and stable event names second: `logger.info({ machineId: info.machineId }, "gateway_registered")` in `apps/mobvibe-cli/src/daemon/socket-client.ts`.
- Pass caught errors as `{ err: error }` or `{ error: message }` to pino serializers/redaction paths, as used in `apps/mobvibe-cli/src/daemon/socket-client.ts` and `apps/mobvibe-cli/src/registry/registry-client.ts`.
- Keep token-like fields out of logs. Both `apps/gateway/src/lib/logger.ts` and `apps/mobvibe-cli/src/lib/logger.ts` redact authorization headers, cookies, API keys, and `token` fields.
- Reserve `console.log`/`console.error` for direct CLI user output boundaries such as `apps/mobvibe-cli/src/index.ts` and injectable output functions in `apps/mobvibe-cli/src/start-command.ts`.

## Comments

**When to Comment:**
- Comment non-obvious platform or build constraints, e.g. pino pretty stream worker behavior in `apps/mobvibe-cli/src/lib/logger.ts`.
- Comment public configuration fields when they encode deployment semantics, e.g. `GatewayConfig` in `apps/gateway/src/config.ts`.
- Test comments may document mock limitations or async simulation, e.g. `apps/gateway/src/services/__tests__/session-router.test.ts` and `apps/mobvibe-cli/src/acp/__tests__/session-manager.test.ts`.
- Avoid comments that restate simple code; prefer descriptive names like `buildSessionFsEntriesPath` in `apps/webui/src/lib/api.ts`.

**JSDoc/TSDoc:**
- Use lightweight JSDoc for exported functions or module-level helpers where the contract is useful to callers: `setApiBaseUrl` in `apps/webui/src/lib/api.ts`, `normalizeError` in `apps/webui/src/lib/error-utils.ts`.
- Type-only packages can use comments to group exports in `packages/shared/src/index.ts`, but keep the actual export list explicit.

## Function Design

**Size:** Keep functions focused and prefer small builders/helpers. `apps/webui/src/lib/api.ts` uses `buildSessionsDiscoverPath`, `buildFsRootsPath`, and `buildFsEntriesPath` instead of inlining query construction in API calls.

**Parameters:**
- Use object parameters for multi-field payloads crossing boundaries, e.g. `discoverSessions(payload)` and `registerWebPushSubscription(payload)` in `apps/webui/src/lib/api.ts`.
- Use `Partial<T>` override factories in tests to keep fixtures readable: `createMockRegistrationInfo` and `createMockSessionSummary` in `apps/gateway/src/services/__tests__/session-router.test.ts`.
- Use `unknown` at unsafe boundaries and narrow before access, as in `normalizeError` in `apps/webui/src/lib/error-utils.ts`.

**Return Values:**
- API helpers return typed `Promise<T>` values, e.g. `Promise<SessionsResponse>` in `apps/webui/src/lib/api.ts`.
- Config helpers return explicit config types, e.g. `getGatewayConfig(): GatewayConfig` in `apps/gateway/src/config.ts`.
- Functions that can fail should throw typed errors or return explicit booleans/results; tests assert rejection messages in `apps/gateway/src/services/__tests__/session-router.test.ts` and `apps/mobvibe-cli/src/acp/__tests__/session-manager.test.ts`.

## Module Design

**Exports:**
- Prefer named exports for utilities, services, stores, and shared contracts: `logger` in `apps/gateway/src/lib/logger.ts`, `createFallbackError` in `apps/webui/src/lib/error-utils.ts`, shared exports in `packages/shared/src/index.ts`.
- Use classes when instances own state and behavior, e.g. `ApiError` in `apps/webui/src/lib/api.ts`, `SessionRouter` in `apps/gateway/src/services/session-router.ts`, `SessionManager` in `apps/mobvibe-cli/src/acp/session-manager.ts`.
- Public shared exports must be added to `packages/shared/src/index.ts`; do not import deep shared internals from app packages when an index export is appropriate.

**Barrel Files:**
- `packages/shared/src/index.ts` is the primary barrel for cross-package types and utilities.
- Avoid adding broad barrels in app feature folders; existing app code imports concrete modules such as `@/components/app/AppHeader` and `@/lib/api`.

---

*Convention analysis: 2026-05-11*
