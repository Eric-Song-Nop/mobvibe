import type { AgentTeamSummary } from "@mobvibe/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import {
	refreshSessionQueriesAfterReconnect,
	useSessionQueries,
} from "../useSessionQueries";

// Mock the API module
vi.mock("@/lib/api", () => ({
	fetchSessions: vi.fn(),
	fetchAcpBackends: vi.fn(),
	fetchAgentTeams: vi.fn(),
	discoverSessions: vi.fn(),
}));

const mockBeginAgentTeamProjectionSync = vi.hoisted(() => vi.fn());
const mockCompleteAgentTeamProjectionSync = vi.hoisted(() => vi.fn());
const mockFailAgentTeamProjectionSync = vi.hoisted(() => vi.fn());
const mockBeginSessionProjectionRecovery = vi.hoisted(() => vi.fn());
const mockCompleteSessionProjectionRecovery = vi.hoisted(() => vi.fn());
const mockMarkSessionProjectionSnapshotReady = vi.hoisted(() => vi.fn());
const mockAbortSessionProjectionRecovery = vi.hoisted(() => vi.fn());
const mockSetTeamAppError = vi.hoisted(() => vi.fn());
const mockSessionProjectionRecoveryState = vi.hoisted(() => ({
	generation: 0,
}));

vi.mock("@/lib/team-store", () => ({
	useTeamStore: {
		getState: () => ({
			beginAgentTeamProjectionSync: mockBeginAgentTeamProjectionSync,
			completeAgentTeamProjectionSync: mockCompleteAgentTeamProjectionSync,
			failAgentTeamProjectionSync: mockFailAgentTeamProjectionSync,
			beginSessionProjectionRecovery: mockBeginSessionProjectionRecovery,
			completeSessionProjectionRecovery: mockCompleteSessionProjectionRecovery,
			markSessionProjectionSnapshotReady:
				mockMarkSessionProjectionSnapshotReady,
			abortSessionProjectionRecovery: mockAbortSessionProjectionRecovery,
			sessionProjectionRecoveryGeneration:
				mockSessionProjectionRecoveryState.generation,
			setAppError: mockSetTeamAppError,
		}),
	},
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
		mockBeginAgentTeamProjectionSync.mockReturnValue(7);
		mockSessionProjectionRecoveryState.generation = 0;
		mockBeginSessionProjectionRecovery.mockImplementation(() => {
			mockSessionProjectionRecoveryState.generation += 1;
			return mockSessionProjectionRecoveryState.generation;
		});
	});

	it("fetches agent teams inside a fenced projection sync", async () => {
		const team: AgentTeamSummary = {
			agentTeamId: "team-1",
			machineId: "machine-1",
			title: "Team One",
			workspaceRootCwd: "/repo",
			workspaceMode: "shared_workspace",
			leaderMemberId: "leader-1",
			lifecycle: "running",
			members: [],
			mailboxCounts: { unread: 0, wakePending: 0, wakeFailed: 0 },
			taskCounts: {
				todo: 0,
				inProgress: 0,
				blocked: 0,
				completed: 0,
				failed: 0,
				cancelled: 0,
			},
			sourceRefs: [],
			summaryRefs: [],
			createdAt: "2026-05-14T00:00:00.000Z",
			updatedAt: "2026-05-14T00:00:00.000Z",
		};
		vi.mocked(api.fetchSessions).mockResolvedValue({
			sessions: [],
			coveredMachineIds: [],
		});
		vi.mocked(api.fetchAcpBackends).mockResolvedValue({ backends: [] });
		vi.mocked(api.fetchAgentTeams).mockResolvedValue({
			teams: [team],
			coveredLeaderMachineIds: ["machine-1"],
		});

		renderHook(() => useSessionQueries(), { wrapper });

		await waitFor(() => {
			expect(mockCompleteAgentTeamProjectionSync).toHaveBeenCalledWith(
				7,
				[team],
				["machine-1"],
			);
		});
		expect(mockBeginAgentTeamProjectionSync).toHaveBeenCalledTimes(1);
		expect(mockFailAgentTeamProjectionSync).not.toHaveBeenCalled();
		expect(api.fetchAgentTeams).toHaveBeenCalledTimes(1);
	});

	it("ends only the matching projection sync when the Team snapshot fails", async () => {
		vi.mocked(api.fetchSessions).mockResolvedValue({
			sessions: [],
			coveredMachineIds: [],
		});
		vi.mocked(api.fetchAcpBackends).mockResolvedValue({ backends: [] });
		vi.mocked(api.fetchAgentTeams).mockRejectedValue(
			new Error("Team snapshot unavailable"),
		);

		const { result } = renderHook(() => useSessionQueries(), { wrapper });

		await waitFor(() => {
			expect(result.current.agentTeamsQuery.isError).toBe(true);
		});
		expect(mockFailAgentTeamProjectionSync).toHaveBeenCalledWith(7);
		expect(mockCompleteAgentTeamProjectionSync).not.toHaveBeenCalled();
	});

	it("refreshes the authoritative Team projection before session summaries", async () => {
		const invalidatedKeys: string[] = [];
		let releaseTeamRefresh = () => {};
		const teamRefresh = new Promise<void>((resolve) => {
			releaseTeamRefresh = resolve;
		});
		vi.spyOn(queryClient, "invalidateQueries").mockImplementation((filters) => {
			const key = String(filters?.queryKey?.[0]);
			invalidatedKeys.push(key);
			return key === "agent-teams" ? teamRefresh : Promise.resolve();
		});

		const refresh = refreshSessionQueriesAfterReconnect(queryClient);

		expect(mockBeginSessionProjectionRecovery).toHaveBeenCalledTimes(1);
		expect(invalidatedKeys).toEqual(["agent-teams", "acp-backends"]);
		expect(mockMarkSessionProjectionSnapshotReady).not.toHaveBeenCalled();

		releaseTeamRefresh();
		await refresh;

		expect(invalidatedKeys).toEqual([
			"agent-teams",
			"acp-backends",
			"sessions",
		]);
		expect(mockMarkSessionProjectionSnapshotReady).toHaveBeenCalledWith(1);
		expect(mockCompleteSessionProjectionRecovery).not.toHaveBeenCalled();
		expect(mockAbortSessionProjectionRecovery).not.toHaveBeenCalled();
	});

	it("lets only the newest overlapping Team refresh release session summaries", async () => {
		const invalidatedKeys: string[] = [];
		const releaseTeamRefreshes: Array<() => void> = [];
		vi.spyOn(queryClient, "invalidateQueries").mockImplementation((filters) => {
			const key = String(filters?.queryKey?.[0]);
			invalidatedKeys.push(key);
			if (key !== "agent-teams") {
				return Promise.resolve();
			}
			return new Promise<void>((resolve) => {
				releaseTeamRefreshes.push(resolve);
			});
		});

		const firstRefresh = refreshSessionQueriesAfterReconnect(queryClient);
		const secondRefresh = refreshSessionQueriesAfterReconnect(queryClient);
		expect(releaseTeamRefreshes).toHaveLength(2);

		releaseTeamRefreshes[0]?.();
		await firstRefresh;
		expect(invalidatedKeys).not.toContain("sessions");

		releaseTeamRefreshes[1]?.();
		await secondRefresh;
		expect(invalidatedKeys.filter((key) => key === "sessions")).toHaveLength(1);
		expect(mockMarkSessionProjectionSnapshotReady).toHaveBeenCalledOnce();
		expect(mockMarkSessionProjectionSnapshotReady).toHaveBeenCalledWith(2);
		expect(mockCompleteSessionProjectionRecovery).not.toHaveBeenCalled();
	});

	it("aborts the current fence when the authoritative Team refetch fails", async () => {
		vi.mocked(api.fetchSessions).mockResolvedValue({
			sessions: [],
			coveredMachineIds: [],
		});
		vi.mocked(api.fetchAcpBackends).mockResolvedValue({ backends: [] });
		vi.mocked(api.fetchAgentTeams).mockResolvedValue({
			teams: [],
			coveredLeaderMachineIds: [],
		});
		const { result } = renderHook(() => useSessionQueries(), { wrapper });
		await waitFor(() => {
			expect(result.current.agentTeamsQuery.isSuccess).toBe(true);
			expect(result.current.sessionsQuery.isSuccess).toBe(true);
		});
		vi.mocked(api.fetchSessions).mockClear();
		vi.mocked(api.fetchAgentTeams).mockRejectedValue(
			new Error("Team refresh failed"),
		);

		await expect(
			refreshSessionQueriesAfterReconnect(queryClient),
		).rejects.toThrow("Team refresh failed");

		expect(api.fetchSessions).not.toHaveBeenCalled();
		expect(mockCompleteSessionProjectionRecovery).not.toHaveBeenCalled();
		expect(mockMarkSessionProjectionSnapshotReady).not.toHaveBeenCalled();
		expect(mockAbortSessionProjectionRecovery).toHaveBeenCalledWith(1);
	});

	it("aborts the current fence when the session snapshot refetch fails", async () => {
		vi.spyOn(queryClient, "invalidateQueries").mockImplementation((filters) => {
			const key = String(filters?.queryKey?.[0]);
			if (key === "sessions") {
				return Promise.reject(new Error("Session refresh failed"));
			}
			return Promise.resolve();
		});

		await expect(
			refreshSessionQueriesAfterReconnect(queryClient),
		).rejects.toThrow("Session refresh failed");

		expect(mockAbortSessionProjectionRecovery).toHaveBeenCalledWith(1);
		expect(mockMarkSessionProjectionSnapshotReady).not.toHaveBeenCalled();
		expect(mockCompleteSessionProjectionRecovery).not.toHaveBeenCalled();
	});

	it("does not let a stale session failure abort the current generation", async () => {
		let rejectStaleSessionRefresh: ((error: Error) => void) | undefined;
		let sessionRefreshCount = 0;
		vi.spyOn(queryClient, "invalidateQueries").mockImplementation((filters) => {
			const key = String(filters?.queryKey?.[0]);
			if (key !== "sessions") {
				return Promise.resolve();
			}
			sessionRefreshCount += 1;
			if (sessionRefreshCount === 1) {
				return new Promise<void>((_resolve, reject) => {
					rejectStaleSessionRefresh = reject;
				});
			}
			return Promise.resolve();
		});

		const staleRefresh = refreshSessionQueriesAfterReconnect(queryClient);
		await waitFor(() => {
			expect(rejectStaleSessionRefresh).toBeDefined();
		});
		const currentRefresh = refreshSessionQueriesAfterReconnect(queryClient);
		rejectStaleSessionRefresh?.(new Error("Stale session refresh failed"));

		await staleRefresh;
		await currentRefresh;

		expect(mockAbortSessionProjectionRecovery).not.toHaveBeenCalled();
		expect(mockMarkSessionProjectionSnapshotReady).toHaveBeenCalledOnce();
		expect(mockMarkSessionProjectionSnapshotReady).toHaveBeenCalledWith(2);
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
			coveredMachineIds: ["machine-1"],
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

		vi.mocked(api.fetchSessions).mockResolvedValue({
			sessions: [],
			coveredMachineIds: [],
		});
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

		vi.mocked(api.fetchSessions).mockResolvedValue({
			sessions: [],
			coveredMachineIds: [],
		});
		vi.mocked(api.fetchAcpBackends).mockResolvedValue(mockBackends);

		const { result } = renderHook(() => useSessionQueries(), { wrapper });

		await waitFor(() => {
			expect(result.current.backendsQuery.isSuccess).toBe(true);
		});

		expect(result.current.availableBackends).toEqual(mockBackends.backends);
	});

	it("should return empty availableBackends when no backends available", async () => {
		vi.mocked(api.fetchSessions).mockResolvedValue({
			sessions: [],
			coveredMachineIds: [],
		});
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
		vi.mocked(api.fetchSessions).mockResolvedValue({
			sessions: [],
			coveredMachineIds: [],
		});
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
		vi.mocked(api.fetchSessions).mockResolvedValue({
			sessions: [],
			coveredMachineIds: [],
		});
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
		vi.mocked(api.fetchSessions).mockResolvedValue({
			sessions: [],
			coveredMachineIds: [],
		});
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
		vi.mocked(api.fetchSessions).mockResolvedValue({
			sessions: [],
			coveredMachineIds: [],
		});
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
		vi.mocked(api.fetchSessions).mockResolvedValue({
			sessions: [],
			coveredMachineIds: [],
		});
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
