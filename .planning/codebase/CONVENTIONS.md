# Coding Conventions

**Analysis Date:** 2026-05-12

## Naming Patterns

**Files:**
- Use `kebab-case` for TypeScript source files across apps and packages, e.g. `apps/gateway/src/services/session-router.ts`, `apps/webui/src/lib/chat-store.ts`, `apps/mobvibe-cli/src/config-loader.ts`, and `packages/shared/src/types/socket-events.ts`.
- React component implementation files may use `PascalCase.tsx` when the component is the file boundary, e.g. `apps/webui/src/components/app/ChatFooter.tsx` and `apps/webui/src/components/app/AppSidebar.tsx`.
- Store files use `*-store.ts`, e.g. `apps/webui/src/lib/chat-store.ts`, `apps/webui/src/lib/ui-store.ts`, and `apps/webui/src/lib/machines-store.ts`.
- Test files use `*.test.ts` / `*.test.tsx` for unit and component tests, and Playwright E2E specs use `*.spec.ts`, e.g. `apps/webui/tests/e2e/session-restore.spec.ts`.

**Functions:**
- Use `camelCase` for functions and helpers, e.g. `normalizeBackendIds` in `apps/webui/src/hooks/useSessionQueries.ts`, `requestJsonWithTimeout` in `apps/webui/src/lib/api.ts`, and `createMockSessionSummary` in `apps/gateway/src/services/__tests__/session-router.test.ts`.
- React hooks must use `useX` naming and live under `apps/webui/src/hooks/`, e.g. `useSessionQueries` and `useDiscoverSessionsMutation` in `apps/webui/src/hooks/useSessionQueries.ts`.
- Type guard helpers should use `isX`, e.g. `isPromptImageFile` in `apps/webui/src/components/app/ChatFooter.tsx` and `isAbortError` in `apps/webui/src/lib/api.ts`.
- Factory/test helpers should use `createX` or `buildX`, e.g. `createFallbackError` in `apps/webui/src/lib/error-utils.ts`, `buildRequestValidationError` in `apps/gateway/src/routes/sessions.ts`, and `createImageBlock` in `packages/shared/tests/prompt-images.test.ts`.

**Variables:**
- Use `camelCase` for locals and parameters, e.g. `backendCapabilities`, `lastError`, and `hasExplicitBackendSelection` in `apps/webui/src/hooks/useSessionQueries.ts`.
- Use `UPPER_SNAKE_CASE` for module-level constants with fixed configuration values, e.g. `SEND_MESSAGE_TIMEOUT_MS` and `SESSION_LOAD_TIMEOUT_MS` in `apps/webui/src/lib/api.ts`, and `RPC_TIMEOUT` in `apps/gateway/src/services/session-router.ts`.
- Prefix intentionally unused destructured props/parameters with `_`, e.g. `_size` in `apps/webui/src/components/app/__tests__/ChatFooter.test.tsx`.

**Types:**
- Use `PascalCase` for exported types, classes, and React props, e.g. `ChatSession`, `ChatMessage`, and `SessionListEntry` in `apps/webui/src/lib/chat-store.ts`, `ApiError` in `apps/webui/src/lib/api.ts`, and `SessionRouter` in `apps/gateway/src/services/session-router.ts`.
- Prefer explicit discriminated unions for state and messages, e.g. `ChatMessage` and message `kind` variants in `apps/webui/src/lib/chat-store.ts`.
- Use `unknown` for untrusted error/input values and narrow before use, e.g. `normalizeError(error: unknown, ...)` in `apps/webui/src/lib/error-utils.ts` and `getErrorMessage(error: unknown)` in `apps/gateway/src/routes/sessions.ts`.

## Code Style

**Formatting:**
- Tool: Biome 2.3.11 configured in `biome.json` and package overrides such as `packages/ui/biome.json`.
- Use tabs for indentation (`biome.json` line 14) and double quotes for JavaScript/TypeScript strings (`biome.json` line 24).
- Do not manually organize imports; Biome source action `organizeImports` is enabled in `biome.json` and `packages/ui/biome.json`.
- Keep TypeScript strict. `strict: true` is enabled in `apps/webui/tsconfig.app.json`, `apps/gateway/tsconfig.json`, `apps/mobvibe-cli/tsconfig.json`, and `packages/shared/tsconfig.json`.

**Linting:**
- Tool: Biome check. Root scripts are `pnpm format`, `pnpm lint`, `pnpm format:check`, and `pnpm lint:check` in `package.json`.
- Package scripts run `biome check --write .` and `biome format --write .`, e.g. `apps/webui/package.json`, `apps/gateway/package.json`, `apps/mobvibe-cli/package.json`, `packages/shared/package.json`, and `packages/ui/package.json`.
- `packages/ui/biome.json` keeps recommended rules but warns on accessibility and disables `suspicious` and `style`; UI package changes should still follow root conventions unless this override is intentional.

## Import Organization

**Order:**
1. Node built-ins and external packages, e.g. `node:crypto`, `@mobvibe/shared`, `socket.io`, `@tanstack/react-query` in `apps/gateway/src/services/session-router.ts` and `apps/webui/src/components/app/ChatFooter.tsx`.
2. Workspace packages such as `@mobvibe/shared` and `@mobvibe/ui/*`, e.g. `apps/webui/src/components/app/ChatFooter.tsx` and `apps/webui/src/pages/LegalPage.tsx`.
3. App aliases, e.g. `@/components/*`, `@/hooks/*`, and `@/lib/*` in `apps/webui/src/components/app/ChatFooter.tsx`.
4. Relative imports from the same package/module, e.g. `../services/session-router.js` in `apps/gateway/src/services/__tests__/session-router.test.ts` and `./error-utils` in `apps/webui/src/lib/api.ts`.

**Path Aliases:**
- WebUI uses `@/*` for `apps/webui/src/*`, configured in `apps/webui/tsconfig.json`, `apps/webui/tsconfig.app.json`, and `apps/webui/vitest.config.ts`.
- NodeNext packages use explicit `.js` extensions for relative TypeScript source imports that emit to ESM, e.g. `../lib/logger.js` in `apps/gateway/src/services/session-router.ts` and `./types/errors.js` in `packages/shared/src/index.ts`.
- Package public imports should use workspace package names and subpath exports, e.g. `@mobvibe/ui/button` and `@mobvibe/shared` in `apps/webui/src/components/app/ChatFooter.tsx`.

## Error Handling

**Patterns:**
- Normalize unknown errors before surfacing them. Use `normalizeError` and `createFallbackError` from `apps/webui/src/lib/error-utils.ts` for WebUI user-facing errors.
- HTTP client failures should throw `ApiError` with structured `ErrorDetail`, as implemented in `apps/webui/src/lib/api.ts`; avoid throwing raw response payloads.
- Gateway routes should return structured `{ error: ErrorDetail }` responses through helpers such as `respondError`, `buildRequestValidationError`, and `buildAuthorizationError` in `apps/gateway/src/routes/sessions.ts`.
- Backend services and routes should log caught errors with structured context before returning generic internal errors, e.g. `logger.error({ err: error, userId }, "session_create_error")` in `apps/gateway/src/routes/sessions.ts`.
- Use `Promise.allSettled` when partial failure is acceptable, then explicitly decide whether to throw or continue, e.g. multi-backend discovery in `apps/webui/src/hooks/useSessionQueries.ts` and bulk archive logic in `apps/gateway/src/services/session-router.ts`.
- Do not silently catch errors. If a catch intentionally ignores a recoverable failure, include a comment explaining why, e.g. backend discovery fallback in `apps/webui/src/hooks/useSessionQueries.ts`.

## Logging

**Framework:** pino for gateway and CLI runtime services; browser WebUI uses limited `console.*` logging.

**Patterns:**
- Gateway logging should import `logger` from `apps/gateway/src/lib/logger.ts`; CLI daemon/service logging should import `logger` from `apps/mobvibe-cli/src/lib/logger.ts`.
- Use structured log objects as the first pino argument and a stable event name as the message, e.g. `logger.info({ userId, backendId, machineId }, "session_create_request")` in `apps/gateway/src/routes/sessions.ts`.
- Do not log secrets. Both pino loggers redact `authorization`, `cookie`, `x-api-key`, `apiKey`, and `token` fields in `apps/gateway/src/lib/logger.ts` and `apps/mobvibe-cli/src/lib/logger.ts`.
- CLI command UI output may use `console.log` / `console.error` for user-facing messages in `apps/mobvibe-cli/src/index.ts` and `apps/mobvibe-cli/src/auth/login.ts`.
- WebUI operational warnings currently use `console.warn` / `console.error` in files such as `apps/webui/src/lib/e2ee.ts`, `apps/webui/src/lib/socket.ts`, and `apps/webui/src/hooks/use-qr-scanner.ts`; keep these concise and never include tokens or secrets.

## Comments

**When to Comment:**
- Comment security-sensitive or non-obvious control flow, e.g. authorization-preserving lookup comments in `apps/gateway/src/services/session-router.ts` and branch injection validation in `apps/gateway/src/routes/sessions.ts`.
- Comment test-only simulations and captured callbacks, e.g. RPC response simulation in `apps/gateway/src/services/__tests__/session-router.test.ts` and `sessionUpdateCallback` in `apps/mobvibe-cli/src/acp/__tests__/session-manager.test.ts`.
- Avoid comments that restate obvious code; prefer descriptive function and variable names.

**JSDoc/TSDoc:**
- Use JSDoc for exported helpers, hooks, and API methods where the contract is important, e.g. `createFallbackError` and `normalizeError` in `apps/webui/src/lib/error-utils.ts`, route descriptions in `apps/gateway/src/routes/sessions.ts`, and `SessionRouter` methods in `apps/gateway/src/services/session-router.ts`.
- Inline object fields may use short doc comments for persisted/runtime state, e.g. `provisional`, `failed`, and `e2eeStatus` in `apps/webui/src/lib/chat-store.ts`.

## Function Design

**Size:** Keep functions focused and prefer extracting pure helpers when logic grows. Examples include small helpers in `apps/webui/src/components/app/ChatFooter.tsx` (`isEditorContentBlock`, `getImageContentBlocks`, `hasSendablePromptContent`) and `apps/gateway/src/routes/sessions.ts` (`normalizeRelativeCwd`, `buildAuthorizationError`).

**Parameters:**
- Prefer typed object parameters for multi-field operations and API calls, e.g. `DiscoverSessionsVariables` in `apps/webui/src/hooks/useSessionQueries.ts` and session route payload parsing in `apps/gateway/src/routes/sessions.ts`.
- Use explicit return types on exported functions, hooks, classes, and public API helpers, e.g. `useSessionQueries(): UseSessionQueriesReturn` in `apps/webui/src/hooks/useSessionQueries.ts` and `setApiBaseUrl(...): void` in `apps/webui/src/lib/api.ts`.

**Return Values:**
- Return typed domain objects or discriminated unions rather than loose objects, e.g. `SessionListEntry` from `toSessionListEntry` in `apps/webui/src/lib/chat-store.ts` and `PromptImageValidationResult` from shared prompt image validators in `packages/shared/src/prompt-images.ts`.
- Use `Promise<T>` for async service boundaries, e.g. `createSession(...): Promise<SessionSummary>` in `apps/gateway/src/services/session-router.ts`.

## Module Design

**Exports:**
- Shared package exports must be surfaced through `packages/shared/src/index.ts` when adding public types or utilities.
- UI package exports must be added to both `packages/ui/src/index.ts` and `packages/ui/package.json` subpath exports when adding public components.
- WebUI local modules generally export named functions/types instead of default exports, e.g. `apps/webui/src/lib/api.ts`, `apps/webui/src/lib/error-utils.ts`, and `apps/webui/src/hooks/useSessionQueries.ts`.

**Barrel Files:**
- Use package-level barrel files for public workspace APIs: `packages/shared/src/index.ts` and `packages/ui/src/index.ts`.
- Avoid deep app-wide barrel files inside `apps/webui/src`; import direct module paths such as `@/lib/chat-store` and `@/components/app/ChatFooter`.

---

*Convention analysis: 2026-05-12*
