import type {
	AgentAuthenticationCapabilities,
	AgentCapabilitiesRpcResult,
} from "@mobvibe/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import {
	agentCapabilitiesQueryKey,
	normalizeAgentAuthenticationCapabilities,
	useAgentAuthentication,
} from "../useAgentAuthentication";

vi.mock("@/lib/api", () => ({
	authenticateAgent: vi.fn(),
	fetchAgentCapabilities: vi.fn(),
	logoutAgent: vi.fn(),
}));

const capabilitiesResult = (
	auth: AgentAuthenticationCapabilities,
): AgentCapabilitiesRpcResult => ({
	capabilities: {
		auth,
		list: true,
		load: true,
	},
});

describe("normalizeAgentAuthenticationCapabilities", () => {
	it("keeps bounded Unicode methods and rejects unsafe or inconsistent fields", () => {
		const normalized = normalizeAgentAuthenticationCapabilities({
			logout: "true",
			methods: [
				{
					description: "由 Agent 管理",
					id: "browser",
					name: "浏览器认证",
				},
				{ id: " browser-padded ", name: "Padded ID" },
				{ id: "control-name", name: "Unsafe\u0000name" },
				{
					description: "Unsafe\u007fdescription",
					id: "safe-description-fallback",
					name: "Safe name",
				},
				{ id: "browser", name: "Duplicate" },
			],
		});

		expect(normalized).toEqual({
			logout: false,
			methods: [
				{
					description: "由 Agent 管理",
					id: "browser",
					name: "浏览器认证",
				},
				{
					description: undefined,
					id: "safe-description-fallback",
					name: "Safe name",
				},
			],
		});
	});

	it("caps the number and display length of advertised methods", () => {
		const normalized = normalizeAgentAuthenticationCapabilities({
			logout: false,
			methods: Array.from({ length: 40 }, (_, index) => ({
				description: "d".repeat(800),
				id: `method-${index}`,
				name: `Method ${index} ${"n".repeat(180)}`,
			})),
		});

		expect(normalized?.methods).toHaveLength(32);
		expect(normalized?.methods[0].name.length).toBe(128);
		expect(normalized?.methods[0].description).toHaveLength(512);
	});
});

describe("useAgentAuthentication", () => {
	let queryClient: QueryClient;

	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);

	beforeEach(() => {
		queryClient = new QueryClient({
			defaultOptions: {
				mutations: { retry: false },
				queries: { retry: false },
			},
		});
		vi.clearAllMocks();
	});

	it("queries a machine/backend pair and aborts stale selections", async () => {
		const signals: AbortSignal[] = [];
		vi.mocked(api.fetchAgentCapabilities).mockImplementation(
			(_payload, signal) => {
				if (!signal) {
					throw new Error("Expected an AbortSignal");
				}
				signals.push(signal);
				return new Promise<never>((_resolve, reject) => {
					signal.addEventListener(
						"abort",
						() => reject(new DOMException("Aborted", "AbortError")),
						{ once: true },
					);
				});
			},
		);

		const { rerender, unmount } = renderHook(
			({ backendId }) =>
				useAgentAuthentication({
					backendId,
					enabled: true,
					machineId: "machine-1",
				}),
			{ initialProps: { backendId: "backend-1" }, wrapper },
		);
		await waitFor(() => expect(signals).toHaveLength(1));

		rerender({ backendId: "backend-2" });
		await waitFor(() => expect(signals[0].aborted).toBe(true));
		await waitFor(() => expect(signals).toHaveLength(2));
		expect(api.fetchAgentCapabilities).toHaveBeenLastCalledWith(
			{ backendId: "backend-2", machineId: "machine-1" },
			signals[1],
		);

		unmount();
		expect(signals[1].aborted).toBe(true);
	});

	it("deduplicates actions and refreshes capability, session, and machine queries", async () => {
		const auth = {
			logout: true,
			methods: [{ id: "browser", name: "Browser login" }],
		};
		vi.mocked(api.fetchAgentCapabilities).mockResolvedValue(
			capabilitiesResult(auth),
		);
		vi.mocked(api.authenticateAgent).mockResolvedValue(
			capabilitiesResult(auth),
		);
		const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

		const { result } = renderHook(
			() =>
				useAgentAuthentication({
					backendId: "backend-1",
					enabled: true,
					machineId: "machine-1",
				}),
			{ wrapper },
		);
		await waitFor(() =>
			expect(result.current.capabilities?.methods).toHaveLength(1),
		);

		act(() => {
			result.current.authenticate("browser");
			result.current.authenticate("browser");
		});

		await waitFor(() => expect(api.authenticateAgent).toHaveBeenCalledTimes(1));
		expect(api.authenticateAgent).toHaveBeenCalledWith(
			{
				backendId: "backend-1",
				machineId: "machine-1",
				methodId: "browser",
			},
			expect.any(AbortSignal),
		);
		await waitFor(() => expect(result.current.actionSucceeded).toBe(true));
		expect(invalidateSpy).toHaveBeenCalledWith({
			exact: true,
			queryKey: agentCapabilitiesQueryKey("machine-1", "backend-1"),
		});
		expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["sessions"] });
		expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["machines"] });
		expect(api.fetchAgentCapabilities).toHaveBeenCalledTimes(2);
	});

	it("aborts an Agent action on backend switch without surfacing an error", async () => {
		const auth = {
			logout: true,
			methods: [{ id: "browser", name: "Browser login" }],
		};
		let actionSignal: AbortSignal | undefined;
		vi.mocked(api.fetchAgentCapabilities).mockResolvedValue(
			capabilitiesResult(auth),
		);
		vi.mocked(api.authenticateAgent).mockImplementation((_payload, signal) => {
			actionSignal = signal;
			return new Promise<never>((_resolve, reject) => {
				signal?.addEventListener(
					"abort",
					() => reject(new DOMException("Aborted", "AbortError")),
					{ once: true },
				);
			});
		});

		const { result, rerender } = renderHook(
			({ backendId }) =>
				useAgentAuthentication({
					backendId,
					enabled: true,
					machineId: "machine-1",
				}),
			{ initialProps: { backendId: "backend-1" }, wrapper },
		);
		await waitFor(() => expect(result.current.capabilities).toBeDefined());
		act(() => result.current.authenticate("browser"));
		await waitFor(() => expect(actionSignal).toBeDefined());

		rerender({ backendId: "backend-2" });
		await waitFor(() => expect(actionSignal?.aborted).toBe(true));
		expect(result.current.actionError).toBeUndefined();
	});
});
