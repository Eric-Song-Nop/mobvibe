# Testing Patterns

**Analysis Date:** 2026-05-12

## Test Framework

**Runner:**
- Vitest 2.1.8 for `apps/gateway`, `apps/webui`, and `packages/shared`, declared in `apps/gateway/package.json`, `apps/webui/package.json`, and `packages/shared/package.json`.
- Bun test for `apps/mobvibe-cli`, declared as `bun test` in `apps/mobvibe-cli/package.json`.
- Playwright 1.58.2 for WebUI E2E tests under `apps/webui/tests/e2e`, configured in `apps/webui/playwright.config.ts`.

**Assertion Library:**
- Vitest `expect` for gateway, shared, and WebUI unit tests.
- `@testing-library/jest-dom/vitest` for WebUI DOM matchers, loaded by `apps/webui/src/setup-tests.ts` and directly in some `apps/webui/tests/*.test.tsx` files.
- Bun's `expect` from `bun:test` for CLI tests, e.g. `apps/mobvibe-cli/src/acp/__tests__/session-manager.test.ts`.
- Playwright `expect` for E2E assertions, e.g. `apps/webui/tests/e2e/session-restore.spec.ts`.

**Run Commands:**
```bash
pnpm test:run                                      # Run full repo one-shot tests, including WebUI E2E via turbo
pnpm -C apps/gateway test:run                      # Run gateway Vitest tests once
pnpm -C apps/webui test:run                        # Run WebUI Vitest tests once
pnpm -C apps/webui test:e2e                        # Run WebUI Playwright E2E tests
pnpm -C apps/mobvibe-cli test                      # Run CLI Bun tests
pnpm -C packages/shared test:run                   # Run shared package Vitest tests once
pnpm -C apps/webui test:run -- -t "session list"   # Run a named Vitest test subset
```

## Test File Organization

**Location:**
- Gateway tests are colocated under `apps/gateway/src/**/__tests__/`, e.g. `apps/gateway/src/services/__tests__/session-router.test.ts` and `apps/gateway/src/socket/__tests__/webui-handlers.test.ts`.
- CLI tests are colocated under `apps/mobvibe-cli/src/**/__tests__/`, e.g. `apps/mobvibe-cli/src/acp/__tests__/session-manager.test.ts` and `apps/mobvibe-cli/src/lib/__tests__/git-utils.test.ts`.
- WebUI tests are split between colocated `apps/webui/src/**/__tests__/` and integration-style `apps/webui/tests/`, e.g. `apps/webui/src/components/app/__tests__/ChatFooter.test.tsx` and `apps/webui/tests/session-sidebar.test.tsx`.
- Shared package tests live in `packages/shared/tests/`, e.g. `packages/shared/tests/prompt-images.test.ts`.
- WebUI E2E specs live in `apps/webui/tests/e2e/`, e.g. `apps/webui/tests/e2e/session-restore.spec.ts`.

**Naming:**
- Unit/component tests use `*.test.ts` or `*.test.tsx`.
- Playwright E2E tests use `*.spec.ts`.
- Test helper modules do not use test suffixes, e.g. `apps/webui/tests/e2e/test-helpers.ts` and `apps/webui/tests/e2e/fake-gateway.mjs`.

**Structure:**
```
apps/gateway/src/**/__tests__/*.test.ts
apps/mobvibe-cli/src/**/__tests__/*.test.ts
apps/webui/src/**/__tests__/*.test.ts(x)
apps/webui/tests/*.test.ts(x)
apps/webui/tests/e2e/*.spec.ts
packages/shared/tests/*.test.ts
```

## Test Structure

**Suite Organization:**
```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("useSessionQueries", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("should fetch sessions successfully", async () => {
		vi.mocked(api.fetchSessions).mockResolvedValue({ sessions: [] });

		const { result } = renderHook(() => useSessionQueries(), { wrapper });

		await waitFor(() => {
			expect(result.current.sessionsQuery.isSuccess).toBe(true);
		});
	});
});
```
Use this Vitest pattern for WebUI hooks/components and gateway service tests, as shown in `apps/webui/src/hooks/__tests__/useSessionQueries.test.tsx` and `apps/gateway/src/services/__tests__/session-router.test.ts`.

**Patterns:**
- Use nested `describe` blocks around feature areas or methods, e.g. `describe("discoverSessions")` inside `apps/gateway/src/services/__tests__/session-router.test.ts`.
- Put reusable builders near the top of the test file, e.g. `createMockSocket`, `createMockRegistrationInfo`, and `createMockSessionSummary` in `apps/gateway/src/services/__tests__/session-router.test.ts`.
- Reset mocks and stores in `beforeEach`, e.g. `vi.clearAllMocks()`, `useUiStore.setState(...)`, and `useMachinesStore.setState(...)` in `apps/webui/src/components/app/__tests__/ChatFooter.test.tsx`.
- For React Query tests, create a fresh `QueryClient` per test with retries disabled, e.g. `apps/webui/src/hooks/__tests__/useSessionQueries.test.tsx` and `apps/webui/src/components/app/__tests__/ChatFooter.test.tsx`.
- For async UI assertions, use Testing Library `findBy*` queries and `waitFor`, e.g. `apps/webui/src/components/app/__tests__/ChatFooter.test.tsx`.
- For promise rejection behavior, use `await expect(...).rejects.toThrow(...)`, e.g. `apps/gateway/src/services/__tests__/session-router.test.ts` and `apps/mobvibe-cli/src/acp/__tests__/session-manager.test.ts`.

## Mocking

**Framework:** Vitest `vi` for gateway/shared/webui tests; Bun `mock` for CLI tests; Playwright fake HTTP/WebSocket gateway for E2E tests.

**Patterns:**
```typescript
const { mockGetSession } = vi.hoisted(() => ({
	mockGetSession: vi.fn(),
}));

vi.mock("../../lib/auth.js", () => ({
	auth: {
		api: {
			getSession: mockGetSession,
		},
	},
}));
```
Use hoisted Vitest mocks when a module mock needs shared mutable mock functions before import evaluation, as in `apps/gateway/src/socket/__tests__/webui-handlers.test.ts` and `apps/webui/src/components/app/__tests__/ChatFooter.test.tsx`.

```typescript
mock.module("node:fs/promises", () => ({
	default: {
		stat: mock(() => Promise.resolve({ isDirectory: () => true })),
		readFile: mock(() => Promise.resolve("")),
	},
	stat: mock(() => Promise.resolve({ isDirectory: () => true })),
	readFile: mock(() => Promise.resolve("")),
}));

const { SessionManager } = await import("../session-manager.js");
```
Use Bun `mock.module` before dynamic imports in CLI tests, as in `apps/mobvibe-cli/src/acp/__tests__/session-manager.test.ts`.

**What to Mock:**
- Mock network/API modules at component and hook boundaries, e.g. `@/lib/api` in `apps/webui/src/hooks/__tests__/useSessionQueries.test.tsx` and `apps/webui/src/components/app/__tests__/ChatFooter.test.tsx`.
- Mock browser or native APIs missing in jsdom through setup files, e.g. `crypto.randomUUID`, `ResizeObserver`, `DOMRect`, `scrollIntoView`, `localStorage`, and `sessionStorage` in `apps/webui/src/setup-tests.ts`.
- Mock UI component libraries when the test targets app logic rather than library behavior, e.g. `@mobvibe/ui/button`, `@mobvibe/ui/select`, and icon packages in `apps/webui/src/components/app/__tests__/ChatFooter.test.tsx`.
- Mock loggers in unit tests to avoid noisy output and assert behavior separately, e.g. `../../lib/logger.js` in `apps/gateway/src/socket/__tests__/webui-handlers.test.ts` and `apps/mobvibe-cli/src/acp/__tests__/session-manager.test.ts`.
- For gateway socket/service tests, use lightweight typed fakes for sockets and registries, e.g. `createMockSocket` in `apps/gateway/src/services/__tests__/session-router.test.ts`.

**What NOT to Mock:**
- Do not mock the unit under test or its pure transformation helpers; shared validators are tested directly in `packages/shared/tests/prompt-images.test.ts`.
- Do not mock Zustand stores when the test verifies store interaction; reset actual store state instead, as in `apps/webui/src/components/app/__tests__/ChatFooter.test.tsx`.
- Do not mock React Query itself; wrap the hook/component in `QueryClientProvider` with a fresh client, as in `apps/webui/src/hooks/__tests__/useSessionQueries.test.tsx`.
- E2E tests should not mock the browser UI; use the fake gateway configured by `apps/webui/playwright.config.ts` and interact through user-visible roles/text in `apps/webui/tests/e2e/session-restore.spec.ts`.

## Fixtures and Factories

**Test Data:**
```typescript
const buildSession = (overrides: Partial<ChatSession> = {}): ChatSession =>
	({
		sessionId: "session-1",
		title: "Session 1",
		input: "",
		messages: [],
		terminalOutputs: {},
		sending: false,
		canceling: false,
		...overrides,
	}) as ChatSession;
```
This override-friendly factory pattern is used in `apps/webui/src/components/app/__tests__/ChatFooter.test.tsx`, `apps/gateway/src/services/__tests__/session-router.test.ts`, and `apps/mobvibe-cli/src/acp/__tests__/session-manager.test.ts`.

**Location:**
- Keep factories local to the test file when they only serve that suite, e.g. `buildSession` in `apps/webui/src/components/app/__tests__/ChatFooter.test.tsx` and `createMockConfig` in `apps/mobvibe-cli/src/acp/__tests__/session-manager.test.ts`.
- Put cross-spec Playwright helpers in `apps/webui/tests/e2e/test-helpers.ts`, e.g. `preloadState`, `expectTextOrder`, `expectTranscript`, and `fillComposer`.
- Shared package tests define simple local data builders, e.g. `createBase64OfSize` and `createImageBlock` in `packages/shared/tests/prompt-images.test.ts`.

## Coverage

**Requirements:** None enforced in repository scripts. `apps/webui/AGENTS.md` documents `pnpm test --coverage`, but no coverage threshold is configured in `apps/webui/vitest.config.ts` or package scripts.

**View Coverage:**
```bash
pnpm -C apps/webui test --coverage
pnpm -C apps/gateway test -- --coverage
pnpm -C packages/shared test -- --coverage
```

## Test Types

**Unit Tests:**
- Use Vitest for pure functions, stores, API helpers, and gateway services, e.g. `apps/webui/src/lib/__tests__/error-utils.test.ts`, `apps/webui/src/lib/__tests__/chat-store.test.ts`, `apps/gateway/src/services/__tests__/crypto.test.ts`, and `packages/shared/tests/prompt-images.test.ts`.
- Use Bun test for CLI logic and filesystem/process integration seams, e.g. `apps/mobvibe-cli/src/lib/__tests__/shell.test.ts`, `apps/mobvibe-cli/src/daemon/__tests__/host-fs.test.ts`, and `apps/mobvibe-cli/src/acp/__tests__/session-manager.test.ts`.

**Integration Tests:**
- WebUI component and hook tests use Testing Library with providers and store state, e.g. `apps/webui/src/components/app/__tests__/ChatFooter.test.tsx` and `apps/webui/src/hooks/__tests__/useSessionQueries.test.tsx`.
- Gateway socket tests exercise middleware setup and auth flows with mocked Better Auth and socket namespaces, e.g. `apps/gateway/src/socket/__tests__/webui-handlers.test.ts`.

**E2E Tests:**
- WebUI uses Playwright with `testDir: "./tests/e2e"`, one worker, jsdom-independent browser execution, and a fake gateway web server configured in `apps/webui/playwright.config.ts`.
- E2E tests preload persisted app state and interact through visible UI, e.g. `preloadState(page, ...)`, `page.goto("/")`, `page.getByLabel("Sync history").click()`, and transcript assertions in `apps/webui/tests/e2e/session-restore.spec.ts`.

## Common Patterns

**Async Testing:**
```typescript
const { result } = renderHook(() => useSessionQueries(), { wrapper });

await waitFor(() => {
	expect(result.current.backendsQuery.isSuccess).toBe(true);
});
```
Use `waitFor` for asynchronous React state, as in `apps/webui/src/hooks/__tests__/useSessionQueries.test.tsx`. Use `setTimeout(..., 0)` to simulate async socket replies when testing RPC routing, as in `apps/gateway/src/services/__tests__/session-router.test.ts`.

**Error Testing:**
```typescript
await expect(
	sessionRouter.discoverSessions("unknown-machine", undefined, "user-1"),
).rejects.toThrow("Machine not found");
```
Use rejection assertions for async service errors, as in `apps/gateway/src/services/__tests__/session-router.test.ts` and `apps/mobvibe-cli/src/acp/__tests__/session-manager.test.ts`. For UI error states, mock rejected API calls and assert visible state or store error updates, as in `apps/webui/src/hooks/__tests__/useSessionQueries.test.tsx` and `apps/webui/src/components/app/__tests__/ChatFooter.test.tsx`.

---

*Testing analysis: 2026-05-12*
