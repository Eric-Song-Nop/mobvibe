import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import { useSessionQueries } from "../useSessionQueries";

// Mock the API module
vi.mock("@/lib/api", () => ({
	fetchSessions: vi.fn(),
	fetchAcpBackends: vi.fn(),
	discoverSessions: vi.fn(),
}));

describe("useSessionQueries", () => {
	let queryClient: QueryClient;

	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);

	beforeEach(() => {
		queryClient = new QueryClient({
			defaultOptions: {
				queries: {
					retry: false,
				},
			},
		});
		vi.clearAllMocks();
	});

	it("should initialize with loading state", () => {
		vi.mocked(api.fetchSessions).mockImplementation(
			() => new Promise(() => {}), // Never resolves
		);
		vi.mocked(api.fetchAcpBackends).mockImplementation(
			() => new Promise(() => {}), // Never resolves
		);

		const { result } = renderHook(() => useSessionQueries(), { wrapper });

		expect(result.current.sessionsQuery.isLoading).toBe(true);
		expect(result.current.backendsQuery.isLoading).toBe(true);
	});

	it("should fetch sessions successfully", async () => {
		const mockSessions: api.SessionsResponse = {
			sessions: [
				{
					sessionId: "session-1",
					title: "Test Session",
					backendId: "backend-1",
					backendLabel: "Backend 1",
					createdAt: "2025-01-01T00:00:00Z",
					updatedAt: "2025-01-01T00:00:00Z",
				},
			],
		};

		vi.mocked(api.fetchSessions).mockResolvedValue(mockSessions);
		vi.mocked(api.fetchAcpBackends).mockResolvedValue({
			backends: [],
		});

		const { result } = renderHook(() => useSessionQueries(), { wrapper });

		await waitFor(() => {
			expect(result.current.sessionsQuery.isSuccess).toBe(true);
		});

		expect(result.current.sessionsQuery.data).toEqual(mockSessions);
		expect(api.fetchSessions).toHaveBeenCalledTimes(1);
	});

	it("should fetch backends successfully", async () => {
		const mockBackends = {
			backends: [
				{
					backendId: "backend-1",
					backendLabel: "Backend 1",
				},
				{
					backendId: "backend-2",
					backendLabel: "Backend 2",
				},
			],
		};

		vi.mocked(api.fetchSessions).mockResolvedValue({ sessions: [] });
		vi.mocked(api.fetchAcpBackends).mockResolvedValue(mockBackends);

		const { result } = renderHook(() => useSessionQueries(), { wrapper });

		await waitFor(() => {
			expect(result.current.backendsQuery.isSuccess).toBe(true);
		});

		expect(result.current.backendsQuery.data).toEqual(mockBackends);
		expect(api.fetchAcpBackends).toHaveBeenCalledTimes(1);
	});

	it("should extract availableBackends from data", async () => {
		const mockBackends = {
			backends: [
				{
					backendId: "backend-1",
					backendLabel: "Backend 1",
				},
				{
					backendId: "backend-2",
					backendLabel: "Backend 2",
				},
			],
		};

		vi.mocked(api.fetchSessions).mockResolvedValue({ sessions: [] });
		vi.mocked(api.fetchAcpBackends).mockResolvedValue(mockBackends);

		const { result } = renderHook(() => useSessionQueries(), { wrapper });

		await waitFor(() => {
			expect(result.current.backendsQuery.isSuccess).toBe(true);
		});

		expect(result.current.availableBackends).toEqual(mockBackends.backends);
	});

	it("should return empty availableBackends when no backends available", async () => {
		vi.mocked(api.fetchSessions).mockResolvedValue({ sessions: [] });
		vi.mocked(api.fetchAcpBackends).mockResolvedValue({
			backends: [],
		});

		const { result } = renderHook(() => useSessionQueries(), { wrapper });

		await waitFor(() => {
			expect(result.current.backendsQuery.isSuccess).toBe(true);
		});

		expect(result.current.availableBackends).toEqual([]);
	});

	it("should handle fetchSessions errors", async () => {
		vi.mocked(api.fetchSessions).mockRejectedValue(
			new Error("Failed to fetch sessions"),
		);
		vi.mocked(api.fetchAcpBackends).mockResolvedValue({
			backends: [],
		});

		const { result } = renderHook(() => useSessionQueries(), { wrapper });

		await waitFor(() => {
			expect(result.current.sessionsQuery.isError).toBe(true);
		});

		expect(result.current.sessionsQuery.error).toBeDefined();
	});

	it("should handle fetchAcpBackends errors", async () => {
		vi.mocked(api.fetchSessions).mockResolvedValue({ sessions: [] });
		vi.mocked(api.fetchAcpBackends).mockRejectedValue(
			new Error("Failed to fetch backends"),
		);

		const { result } = renderHook(() => useSessionQueries(), { wrapper });

		await waitFor(() => {
			expect(result.current.backendsQuery.isError).toBe(true);
		});

		expect(result.current.backendsQuery.error).toBeDefined();
	});

	it("discovers sessions and invalidates sessions query", async () => {
		vi.mocked(api.fetchSessions).mockResolvedValue({ sessions: [] });
		vi.mocked(api.fetchAcpBackends).mockResolvedValue({
			backends: [{ backendId: "backend-1", backendLabel: "Backend 1" }],
		});
		vi.mocked(api.discoverSessions).mockResolvedValueOnce({
			sessions: [],
			capabilities: { list: true, load: true },
			nextCursor: "next",
		});
		vi.mocked(api.discoverSessions).mockResolvedValueOnce({
			sessions: [],
			capabilities: { list: true, load: true },
			nextCursor: undefined,
		});

		const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

		const { result } = renderHook(() => useSessionQueries(), { wrapper });

		await result.current.discoverSessionsMutation.mutateAsync({
			machineId: "machine-1",
		});

		expect(api.discoverSessions).toHaveBeenCalledTimes(2);
		expect(api.discoverSessions).toHaveBeenCalledWith({
			machineId: "machine-1",
			cwd: undefined,
			cursor: undefined,
			backendId: "backend-1",
		});
		expect(api.discoverSessions).toHaveBeenCalledWith({
			machineId: "machine-1",
			cwd: undefined,
			cursor: "next",
			backendId: "backend-1",
		});
		expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["sessions"] });
	});

	it("discovers sessions across all available backends", async () => {
		vi.mocked(api.fetchSessions).mockResolvedValue({ sessions: [] });
		vi.mocked(api.fetchAcpBackends).mockResolvedValue({
			backends: [
				{ backendId: "opencode", backendLabel: "OpenCode" },
				{ backendId: "codex-acp", backendLabel: "Codex ACP" },
			],
		});
		vi.mocked(api.discoverSessions).mockResolvedValue({
			sessions: [],
			capabilities: { list: true, load: true },
			nextCursor: undefined,
		});

		const { result } = renderHook(() => useSessionQueries(), { wrapper });
		await waitFor(() => {
			expect(result.current.backendsQuery.isSuccess).toBe(true);
		});

		await result.current.discoverSessionsMutation.mutateAsync({
			machineId: "machine-1",
			cwd: "/workspace/project",
		});

		expect(api.discoverSessions).toHaveBeenCalledTimes(2);
		expect(api.discoverSessions).toHaveBeenCalledWith({
			machineId: "machine-1",
			cwd: "/workspace/project",
			cursor: undefined,
			backendId: "opencode",
		});
		expect(api.discoverSessions).toHaveBeenCalledWith({
			machineId: "machine-1",
			cwd: "/workspace/project",
			cursor: undefined,
			backendId: "codex-acp",
		});
	});

	it("continues discovery when a non-explicit backend is unsupported", async () => {
		vi.mocked(api.fetchSessions).mockResolvedValue({ sessions: [] });
		vi.mocked(api.fetchAcpBackends).mockResolvedValue({
			backends: [
				{ backendId: "opencode", backendLabel: "OpenCode" },
				{ backendId: "codex-acp", backendLabel: "Codex ACP" },
			],
		});
		vi.mocked(api.discoverSessions).mockImplementation(async (payload) => {
			if (payload?.backendId === "opencode") {
				throw new Error("Backend not found");
			}
			return {
				sessions: [],
				capabilities: { list: true, load: true },
				nextCursor: undefined,
			};
		});

		const { result } = renderHook(() => useSessionQueries(), { wrapper });
		await waitFor(() => {
			expect(result.current.backendsQuery.isSuccess).toBe(true);
		});

		await expect(
			result.current.discoverSessionsMutation.mutateAsync({
				machineId: "machine-1",
			}),
		).resolves.toEqual({
			machineId: "machine-1",
			backendCapabilities: {
				"codex-acp": { list: true, load: true },
			},
		});
		expect(api.discoverSessions).toHaveBeenCalledTimes(2);
	});

	it("should use correct query keys", async () => {
		vi.mocked(api.fetchSessions).mockResolvedValue({ sessions: [] });
		vi.mocked(api.fetchAcpBackends).mockResolvedValue({
			backends: [],
		});

		renderHook(() => useSessionQueries(), { wrapper });

		await waitFor(() => {
			expect(api.fetchSessions).toHaveBeenCalled();
		});

		// Check query keys are set correctly
		const queryCache = queryClient.getQueryCache();
		const queries = queryCache.getAll();

		const sessionQuery = queries.find((q) => q.queryKey.includes("sessions"));
		const backendsQuery = queries.find((q) =>
			q.queryKey.includes("acp-backends"),
		);

		expect(sessionQuery).toBeDefined();
		expect(backendsQuery).toBeDefined();
	});
});
