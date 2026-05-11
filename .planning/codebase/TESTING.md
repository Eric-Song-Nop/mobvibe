---
last_mapped_commit: 7e89508dcca9477698c5e492fe7b8fdf9195f9af
mapping_date: 2026-05-11
---

# Testing Patterns

**Analysis Date:** 2026-05-11

## Test Framework

**Runner:**
- Vitest `^2.1.8` for `apps/gateway`, `apps/webui`, and `packages/shared`; scripts live in `apps/gateway/package.json`, `apps/webui/package.json`, and `packages/shared/package.json`.
- Bun test for `apps/mobvibe-cli`; scripts live in `apps/mobvibe-cli/package.json`.
- Playwright `^1.58.2` for WebUI E2E tests under `apps/webui/tests/e2e/`; config is `apps/webui/playwright.config.ts`.

**Assertion Library:**
- Vitest `expect` for gateway, webui unit/integration tests, and shared tests.
- Bun `expect` from `bun:test` for CLI tests.
- `@testing-library/jest-dom/vitest` for DOM assertions in WebUI; setup is `apps/webui/src/setup-tests.ts` and some legacy tests import it directly from `apps/webui/tests/*.test.tsx`.
- Playwright `expect` from `@playwright/test` for browser E2E specs in `apps/webui/tests/e2e/*.spec.ts`.

**Run Commands:**
```bash
pnpm test:run                                      # Run all repo tests once, including WebUI E2E via Turbo
pnpm -C apps/gateway test:run                     # Run gateway Vitest tests once
pnpm -C apps/webui test:run                       # Run WebUI Vitest tests once
pnpm -C apps/webui test:e2e                       # Run WebUI Playwright E2E tests
pnpm -C apps/mobvibe-cli test                     # Run CLI Bun tests
pnpm -C packages/shared test:run                  # Run shared Vitest tests once
```

## Test File Organization

**Location:**
- Gateway tests are colocated under `apps/gateway/src/**/__tests__/*.test.ts`, e.g. `apps/gateway/src/services/__tests__/session-router.test.ts` and `apps/gateway/src/socket/__tests__/webui-handlers.test.ts`.
- CLI tests are colocated under `apps/mobvibe-cli/src/**/__tests__/*.test.ts`, e.g. `apps/mobvibe-cli/src/acp/__tests__/session-manager.test.ts` and `apps/mobvibe-cli/src/lib/__tests__/git-utils.test.ts`.
- WebUI unit and component tests live in both `apps/webui/src/**/__tests__/*.test.ts(x)` and `apps/webui/tests/*.test.tsx`, e.g. `apps/webui/src/lib/__tests__/api.test.ts` and `apps/webui/tests/session-sidebar.test.tsx`.
- WebUI E2E specs live under `apps/webui/tests/e2e/*.spec.ts`, and are excluded from Vitest by `apps/webui/vitest.config.ts`.
- Shared package tests live under `packages/shared/tests/*.test.ts`, e.g. `packages/shared/tests/prompt-images.test.ts`.

**Naming:**
- Use `*.test.ts` for TypeScript logic tests.
- Use `*.test.tsx` for React component/hook tests.
- Use `*.spec.ts` only for Playwright E2E specs under `apps/webui/tests/e2e/`.
- Keep test names behavior-focused: `"throws error when no CLI connected for machine"` in `apps/gateway/src/services/__tests__/session-router.test.ts`, `"sends requests with Bearer token when token exists"` in `apps/webui/src/lib/__tests__/api.test.ts`.

**Structure:**
```
apps/gateway/src/<area>/__tests__/<module>.test.ts
apps/mobvibe-cli/src/<area>/__tests__/<module>.test.ts
apps/webui/src/<area>/__tests__/<module>.test.ts(x)
apps/webui/tests/<feature>.test.tsx
apps/webui/tests/e2e/<flow>.spec.ts
packages/shared/tests/<module>.test.ts
```

## Test Structure

**Suite Organization:**
```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

const createMockSocket = () => ({ emit: vi.fn(), on: vi.fn() });

describe("SessionRouter", () => {
	let sessionRouter: SessionRouter;

	beforeEach(() => {
		sessionRouter = new SessionRouter(new CliRegistry());
	});

	describe("discoverSessions", () => {
		it("routes discover request to CLI and returns result", async () => {
			await expect(sessionRouter.discoverSessions("machine-1", undefined, "user-1"))
				.resolves.toBeDefined();
		});
	});
});
```

**Patterns:**
- Group by module, then by method/flow with nested `describe` blocks, as in `apps/gateway/src/services/__tests__/session-router.test.ts` and `apps/mobvibe-cli/src/acp/__tests__/session-manager.test.ts`.
- Put factories above suites for repeated data: `createMockSocket`, `createMockRegistrationInfo`, and `createMockSessionSummary` in `apps/gateway/src/services/__tests__/session-router.test.ts`.
- Reset module state and mocks in `beforeEach`/`afterEach`: `vi.resetModules`, `vi.restoreAllMocks`, and `mockFetch.mockReset` in `apps/webui/src/lib/__tests__/api.test.ts`.
- Test async failures with `await expect(promise).rejects.toThrow(...)`, as used in gateway and CLI session tests.
- Use Testing Library queries (`screen`, `getByRole`, `getByText`) and `userEvent.setup()` for React UI interactions in `apps/webui/src/components/app/__tests__/AppHeader.test.tsx` and `apps/webui/tests/session-sidebar.test.tsx`.

## Mocking

**Framework:**
- Vitest `vi.fn`, `vi.mock`, `vi.doMock`, `vi.stubEnv`, and `vi.mocked` for `apps/gateway`, `apps/webui`, and `packages/shared`.
- Bun `mock` and `mock.module` for `apps/mobvibe-cli`.
- Playwright fake services are started through `apps/webui/playwright.config.ts`, including `apps/webui/tests/e2e/fake-gateway.mjs`.

**Patterns:**
```typescript
// Vitest module mocking before dynamic import.
vi.resetModules();
vi.stubEnv("VITE_GATEWAY_URL", "http://localhost:3005");
vi.doMock("../auth", () => ({ isInTauri: () => true }));
const { fetchSessions } = await import("../api");

// Bun module mocking before dynamic import.
mock.module("../../lib/logger.js", () => ({
	logger: { info: mock(() => {}), warn: mock(() => {}), error: mock(() => {}) },
}));
const { SessionManager } = await import("../session-manager.js");
```

**What to Mock:**
- Mock network and platform boundaries: `global.fetch` and `platformFetch` in `apps/webui/src/lib/__tests__/api.test.ts`, `socket.io-client` in `apps/mobvibe-cli/src/daemon/__tests__/socket-client.test.ts`.
- Mock filesystem, git, and process-like boundaries in CLI tests: `node:fs/promises` and `../../lib/git-utils.js` in `apps/mobvibe-cli/src/acp/__tests__/session-manager.test.ts`.
- Mock UI infrastructure components when the test target is higher-level behavior: popover, sheet, alert dialog, badge, and button mocks in `apps/webui/src/components/app/__tests__/AppHeader.test.tsx`.
- Mock i18n in component tests when text stability matters: `react-i18next` mocks in `apps/webui/src/components/app/__tests__/AppHeader.test.tsx`.

**What NOT to Mock:**
- Do not mock the class or function under test; instantiate real `SessionRouter` with a real `CliRegistry` in `apps/gateway/src/services/__tests__/session-router.test.ts`.
- Do not mock shared contracts from `@mobvibe/shared` unless a test targets a boundary failure; use real shared types in `apps/gateway/src/services/__tests__/session-router.test.ts` and `apps/mobvibe-cli/src/daemon/__tests__/host-fs.test.ts`.
- Do not mock DOM behavior that Testing Library can exercise directly; use `render`, `screen`, and `userEvent` in `apps/webui/src/components/app/__tests__/AppHeader.test.tsx`.

## Fixtures and Factories

**Test Data:**
```typescript
const createMockRegistrationInfo = (
	overrides: Partial<CliRegistrationInfo> = {},
): CliRegistrationInfo => ({
	machineId: "machine-1",
	hostname: "test-host",
	version: "1.0.0",
	backends: [{ backendId: "backend-1", backendLabel: "Claude Code" }],
	...overrides,
});
```

**Location:**
- Keep small factories in the test file that uses them, as in `apps/gateway/src/services/__tests__/session-router.test.ts` and `apps/mobvibe-cli/src/acp/__tests__/session-manager.test.ts`.
- Use WebUI setup polyfills in `apps/webui/src/setup-tests.ts` for global browser APIs such as `crypto.randomUUID`, `ResizeObserver`, `DOMRect`, `scrollIntoView`, `localStorage`, and `sessionStorage`.
- Use package-level fake servers for E2E flows under `apps/webui/tests/e2e/`, configured by `apps/webui/playwright.config.ts`.

## Coverage

**Requirements:** None enforced in package scripts or config. No coverage thresholds are detected in `apps/webui/vitest.config.ts`, package `package.json` scripts, or root `package.json`.

**View Coverage:**
```bash
pnpm -C apps/webui test --coverage
pnpm -C apps/gateway test -- --coverage
pnpm -C packages/shared test -- --coverage
```

## Test Types

**Unit Tests:**
- Pure utilities and parsing logic are tested directly, e.g. `apps/mobvibe-cli/src/lib/__tests__/git-utils.test.ts`, `apps/webui/src/lib/__tests__/error-utils.test.ts`, `packages/shared/tests/prompt-images.test.ts`.
- Config parsing is tested with env/module reset patterns in `apps/gateway/src/__tests__/config.test.ts` and `apps/mobvibe-cli/src/__tests__/config-loader.test.ts`.

**Integration Tests:**
- In-process service/socket integration tests wire real service instances to mocked sockets, e.g. `apps/gateway/src/services/__tests__/session-router.test.ts`, `apps/gateway/src/socket/__tests__/webui-handlers.test.ts`, and `apps/gateway/src/socket/__tests__/cli-handlers.test.ts`.
- WebUI hook/store tests combine stores, mocked API modules, and React hooks under Testing Library: `apps/webui/src/hooks/__tests__/useSessionMutations.test.tsx`, `apps/webui/src/lib/__tests__/chat-store.test.ts`.
- CLI daemon/session tests combine mocked IO with real session manager behavior: `apps/mobvibe-cli/src/acp/__tests__/session-manager.test.ts` and `apps/mobvibe-cli/src/daemon/__tests__/socket-client.test.ts`.

**E2E Tests:**
- Playwright is used for WebUI E2E flows under `apps/webui/tests/e2e/`.
- `apps/webui/playwright.config.ts` starts a fake gateway and a Vite server on per-run ports, runs headless with one worker, and uses `tests/e2e` as `testDir`.
- Root `pnpm test:run` runs `turbo test:run && turbo test:e2e` from `package.json`.

## Common Patterns

**Async Testing:**
```typescript
socket.emit.mockImplementation((event, request) => {
	if (event === "rpc:sessions:discover") {
		setTimeout(() => {
			sessionRouter.handleRpcResponse({ requestId: request.requestId, result: mockResult });
		}, 0);
	}
});

const result = await sessionRouter.discoverSessions("machine-1", undefined, "user-1");
expect(result.sessions).toHaveLength(2);
```

**Error Testing:**
```typescript
await expect(
	sessionRouter.discoverSessions("unknown-machine", undefined, "user-1"),
).rejects.toThrow("Machine not found");

await expect(fetchSessions()).rejects.toThrow(ApiError);
```

**React Interaction Testing:**
```typescript
render(
	<MemoryRouter>
		<ThemeProvider defaultTheme="light">
			<AppHeader />
		</ThemeProvider>
	</MemoryRouter>,
);
const user = userEvent.setup();
await user.click(screen.getByRole("button", { name: /open/i }));
```

---

*Testing analysis: 2026-05-11*
