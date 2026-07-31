import "@testing-library/jest-dom/vitest";
import type { AgentTeamSummary } from "@mobvibe/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Profiler, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChatStore } from "@/lib/chat-store";
import { useTeamStore } from "@/lib/team-store";
import { WorkspaceList } from "../src/components/workspace/WorkspaceList";
import { useMachinesStore } from "../src/lib/machines-store";
import { useUiStore } from "../src/lib/ui-store";

// Mock the API module so useQueries calls resolve/reject as we control
vi.mock("@/lib/api", async () => {
	const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
	return {
		...actual,
		fetchFsEntries: vi.fn(),
	};
});

// Mock discoverSessions to prevent real network calls
vi.mock("../src/hooks/useSessionQueries", () => ({
	useDiscoverSessionsMutation: () => ({ mutate: vi.fn() }),
}));

import { fetchFsEntries } from "@/lib/api";

const MACHINE_ID = "machine-1";

const createTeam = (
	overrides: Partial<AgentTeamSummary> = {},
): AgentTeamSummary => ({
	agentTeamId: "team-remote",
	machineId: "machine-2",
	title: "Remote Team",
	workspaceRootCwd: "/remote/team-project",
	workspaceMode: "shared_workspace",
	leaderMemberId: "leader-remote",
	lifecycle: "running",
	members: [
		{
			memberId: "leader-remote",
			agentTeamId: "team-remote",
			role: "leader",
			name: "Leader",
			backendId: "claude",
			lifecycle: "running",
			health: "healthy",
			mailboxCounts: { unread: 0, wakePending: 0, wakeFailed: 0 },
			taskCounts: {
				todo: 0,
				inProgress: 0,
				blocked: 0,
				completed: 0,
				failed: 0,
				cancelled: 0,
			},
			pendingPermissionCount: 0,
			createdAt: "2026-07-31T00:00:00.000Z",
			updatedAt: "2026-07-31T00:00:00.000Z",
		},
		{
			memberId: "member-current-machine",
			agentTeamId: "team-remote",
			role: "member",
			name: "Worker",
			backendId: "codex",
			sessionId: "remote-team-member-session",
			lifecycle: "running",
			health: "healthy",
			mailboxCounts: { unread: 0, wakePending: 0, wakeFailed: 0 },
			taskCounts: {
				todo: 0,
				inProgress: 0,
				blocked: 0,
				completed: 0,
				failed: 0,
				cancelled: 0,
			},
			pendingPermissionCount: 0,
			createdAt: "2026-07-31T00:00:00.000Z",
			updatedAt: "2026-07-31T00:00:00.000Z",
		},
	],
	mailboxCounts: { unread: 0, wakePending: 0, wakeFailed: 0 },
	taskCounts: {
		todo: 0,
		inProgress: 0,
		blocked: 0,
		completed: 0,
		failed: 0,
		cancelled: 0,
	},
	createdAt: "2026-07-31T00:00:00.000Z",
	updatedAt: "2026-07-31T00:00:00.000Z",
	...overrides,
});

const buildSession = (
	sessionId: string,
	cwd: string,
	overrides?: Record<string, unknown>,
) => ({
	sessionId,
	title: `Session ${sessionId}`,
	machineId: MACHINE_ID,
	cwd,
	input: "",
	inputContents: [{ type: "text" as const, text: "" }],
	messages: [],
	terminalOutputs: {},
	sending: false,
	canceling: false,
	isLoading: false,
	createdAt: "2025-01-01T00:00:00Z",
	updatedAt: "2025-01-01T00:00:00Z",
	...overrides,
});

let queryClient: QueryClient;
let onEmptyCreateSession: ReturnType<typeof vi.fn>;

const Wrapper = ({ children }: { children: ReactNode }) => (
	<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

beforeEach(() => {
	queryClient = new QueryClient({
		defaultOptions: {
			queries: { retry: false },
		},
	});
	onEmptyCreateSession = vi.fn();

	// Set up machine as connected
	useMachinesStore.setState({
		machines: {
			[MACHINE_ID]: {
				machineId: MACHINE_ID,
				hostname: "test-host",
				connected: true,
			},
		},
		selectedMachineId: MACHINE_ID,
	});

	// Clear UI store
	useUiStore.setState({
		selectedWorkspaceByMachine: {},
		sidebarTab: "workspaces",
	});
	useTeamStore.setState({
		teams: {},
		activeAgentTeamId: undefined,
		lastSyncAt: undefined,
		appError: undefined,
		isProjectionReady: false,
		isProjectionRefreshing: false,
		isProjectionUnavailable: false,
		isSessionProjectionRecoveryPending: false,
		projectionSyncEpoch: 0,
		pendingAgentTeamChanges: [],
	});
	useTeamStore.getState().replaceAgentTeams([]);
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	useChatStore.setState({
		sessions: {},
		activeSessionId: undefined,
	});
	useMachinesStore.setState({
		machines: {},
		selectedMachineId: null,
	});
	useUiStore.setState({
		selectedWorkspaceByMachine: {},
		sidebarTab: "sessions",
	});
	useTeamStore.setState({
		teams: {},
		activeAgentTeamId: undefined,
		lastSyncAt: undefined,
		appError: undefined,
		isProjectionReady: false,
		isProjectionRefreshing: false,
		isProjectionUnavailable: false,
		isSessionProjectionRecoveryPending: false,
		projectionSyncEpoch: 0,
		pendingAgentTeamChanges: [],
	});
});

describe("WorkspaceList validation effect", () => {
	it("selects valid fallback when selected workspace CWD becomes invalid", async () => {
		const validCwd = "/home/user/valid-project";
		const invalidCwd = "/home/user/deleted-project";

		// Two sessions with different CWDs
		useChatStore.setState({
			sessions: {
				"s-1": buildSession("s-1", validCwd),
				"s-2": buildSession("s-2", invalidCwd),
			},
		});

		// Select the invalid workspace
		useUiStore.setState({
			selectedWorkspaceByMachine: { [MACHINE_ID]: invalidCwd },
		});

		// fetchFsEntries: valid project succeeds, deleted project fails
		vi.mocked(fetchFsEntries).mockImplementation(async (payload) => {
			if (payload.path === validCwd) {
				return { path: payload.path, entries: [] };
			}
			throw new Error("ENOENT: no such file or directory");
		});

		render(
			<Wrapper>
				<WorkspaceList
					machineId={MACHINE_ID}
					onEmptyCreateSession={onEmptyCreateSession}
				/>
			</Wrapper>,
		);

		// Wait for validation queries to settle and the effect to fire
		await waitFor(() => {
			const state = useUiStore.getState();
			expect(state.selectedWorkspaceByMachine[MACHINE_ID]).toBe(validCwd);
		});
	});

	it("does not clear to undefined when no valid fallback exists", async () => {
		const invalidCwd = "/home/user/deleted-project";

		useChatStore.setState({
			sessions: {
				"s-1": buildSession("s-1", invalidCwd),
			},
		});

		// Select the invalid workspace
		useUiStore.setState({
			selectedWorkspaceByMachine: { [MACHINE_ID]: invalidCwd },
		});

		// All workspaces fail validation
		vi.mocked(fetchFsEntries).mockRejectedValue(
			new Error("ENOENT: no such file or directory"),
		);

		render(
			<Wrapper>
				<WorkspaceList
					machineId={MACHINE_ID}
					onEmptyCreateSession={onEmptyCreateSession}
				/>
			</Wrapper>,
		);

		// Wait for queries to settle
		await waitFor(() => {
			const fetched = vi.mocked(fetchFsEntries).mock.calls.length > 0;
			expect(fetched).toBe(true);
		});

		// The workspace should NOT be cleared to undefined (which would cause oscillation)
		const state = useUiStore.getState();
		expect(state.selectedWorkspaceByMachine[MACHINE_ID]).toBe(invalidCwd);
	});

	it("leaves selection unchanged when the CWD is valid", async () => {
		const validCwd = "/home/user/valid-project";

		useChatStore.setState({
			sessions: {
				"s-1": buildSession("s-1", validCwd),
			},
		});

		useUiStore.setState({
			selectedWorkspaceByMachine: { [MACHINE_ID]: validCwd },
		});

		vi.mocked(fetchFsEntries).mockImplementation(async (payload) => ({
			path: payload.path,
			entries: [],
		}));

		render(
			<Wrapper>
				<WorkspaceList
					machineId={MACHINE_ID}
					onEmptyCreateSession={onEmptyCreateSession}
				/>
			</Wrapper>,
		);

		// Wait for validation to complete
		await waitFor(() => {
			const fetched = vi.mocked(fetchFsEntries).mock.calls.length > 0;
			expect(fetched).toBe(true);
		});

		// Selection should remain the valid CWD
		const state = useUiStore.getState();
		expect(state.selectedWorkspaceByMachine[MACHINE_ID]).toBe(validCwd);
	});

	it("shows empty state when no sessions for machine", () => {
		useChatStore.setState({ sessions: {} });

		const { container } = render(
			<Wrapper>
				<WorkspaceList
					machineId={MACHINE_ID}
					onEmptyCreateSession={onEmptyCreateSession}
				/>
			</Wrapper>,
		);

		// Should show the empty button
		expect(container.querySelector("button")).toBeTruthy();
	});

	it("selects fallback when workspace is removed from session list", async () => {
		const cwdA = "/home/user/project-a";
		const cwdB = "/home/user/project-b";

		// Only project-a has sessions; project-b was previously selected but
		// its sessions have been removed
		useChatStore.setState({
			sessions: {
				"s-1": buildSession("s-1", cwdA),
			},
		});

		useUiStore.setState({
			selectedWorkspaceByMachine: { [MACHINE_ID]: cwdB },
		});

		vi.mocked(fetchFsEntries).mockImplementation(async (payload) => ({
			path: payload.path,
			entries: [],
		}));

		render(
			<Wrapper>
				<WorkspaceList
					machineId={MACHINE_ID}
					onEmptyCreateSession={onEmptyCreateSession}
				/>
			</Wrapper>,
		);

		// cwdB is not in workspaceList (no sessions for it), so the effect
		// should pick cwdA as the fallback
		await waitFor(() => {
			const state = useUiStore.getState();
			expect(state.selectedWorkspaceByMachine[MACHINE_ID]).toBe(cwdA);
		});
	});

	it("routes empty-state create actions through the callback", async () => {
		useChatStore.setState({ sessions: {} });
		const user = userEvent.setup();

		render(
			<Wrapper>
				<WorkspaceList
					machineId={MACHINE_ID}
					onEmptyCreateSession={onEmptyCreateSession}
				/>
			</Wrapper>,
		);

		await user.click(document.querySelector("button")!);

		expect(onEmptyCreateSession).toHaveBeenCalledTimes(1);
		expect(useMachinesStore.getState().selectedMachineId).toBe(MACHINE_ID);
	});

	it("does not project a remote team's member workspace onto the current machine", async () => {
		const ordinaryCwd = "/home/user/ordinary-project";
		const remoteTeamCwd = "/remote/team-project";

		useChatStore.setState({
			sessions: {
				"ordinary-session": buildSession("ordinary-session", ordinaryCwd),
				"remote-team-member-session": buildSession(
					"remote-team-member-session",
					remoteTeamCwd,
				),
			},
		});
		useTeamStore.setState({
			teams: { "team-remote": createTeam() },
		});
		vi.mocked(fetchFsEntries).mockImplementation(async (payload) => ({
			path: payload.path,
			entries: [],
		}));

		render(
			<Wrapper>
				<WorkspaceList
					machineId={MACHINE_ID}
					onEmptyCreateSession={onEmptyCreateSession}
				/>
			</Wrapper>,
		);

		await waitFor(() => {
			expect(screen.getByText(ordinaryCwd)).toBeInTheDocument();
		});

		expect(fetchFsEntries).toHaveBeenCalledWith({
			path: ordinaryCwd,
			machineId: MACHINE_ID,
		});
		expect(fetchFsEntries).not.toHaveBeenCalledWith({
			path: remoteTeamCwd,
			machineId: MACHINE_ID,
		});
		expect(screen.queryByText(remoteTeamCwd)).not.toBeInTheDocument();
	});

	it("does not project a marked worker workspace when the leader Team is offline", async () => {
		const ordinaryCwd = "/home/user/ordinary-project";
		const workerCwd = "/remote/team-project";

		useChatStore.setState({
			sessions: {
				"ordinary-session": buildSession("ordinary-session", ordinaryCwd),
				"remote-team-worker": buildSession("remote-team-worker", workerCwd, {
					agentTeamOwned: true,
				}),
			},
		});
		vi.mocked(fetchFsEntries).mockImplementation(async (payload) => ({
			path: payload.path,
			entries: [],
		}));

		render(
			<Wrapper>
				<WorkspaceList
					machineId={MACHINE_ID}
					onEmptyCreateSession={onEmptyCreateSession}
				/>
			</Wrapper>,
		);

		await waitFor(() => {
			expect(screen.getByText(ordinaryCwd)).toBeInTheDocument();
		});
		expect(fetchFsEntries).toHaveBeenCalledWith({
			path: ordinaryCwd,
			machineId: MACHINE_ID,
		});
		expect(fetchFsEntries).not.toHaveBeenCalledWith({
			path: workerCwd,
			machineId: MACHINE_ID,
		});
		expect(screen.queryByText(workerCwd)).not.toBeInTheDocument();
	});

	it("waits for the authoritative Team projection before validating sessions", async () => {
		const ordinaryCwd = "/home/user/ordinary-project";
		const remoteTeamCwd = "/remote/team-project";

		useTeamStore.setState({
			isProjectionReady: false,
			isProjectionRefreshing: true,
			isProjectionUnavailable: false,
			projectionSyncEpoch: 1,
			pendingAgentTeamChanges: [],
		});
		vi.mocked(fetchFsEntries).mockImplementation(async (payload) => ({
			path: payload.path,
			entries: [],
		}));

		render(
			<Wrapper>
				<WorkspaceList
					machineId={MACHINE_ID}
					onEmptyCreateSession={onEmptyCreateSession}
				/>
			</Wrapper>,
		);

		await act(async () => {
			useChatStore.setState({
				sessions: {
					"ordinary-session": buildSession("ordinary-session", ordinaryCwd),
					"remote-team-member-session": buildSession(
						"remote-team-member-session",
						remoteTeamCwd,
					),
				},
			});
			await Promise.resolve();
		});

		expect(fetchFsEntries).not.toHaveBeenCalled();
		expect(screen.queryByText(ordinaryCwd)).not.toBeInTheDocument();
		expect(screen.queryByText(remoteTeamCwd)).not.toBeInTheDocument();

		act(() => {
			useTeamStore.getState().replaceAgentTeams([createTeam()]);
		});

		await waitFor(() => {
			expect(screen.getByText(ordinaryCwd)).toBeInTheDocument();
		});
		expect(fetchFsEntries).toHaveBeenCalledTimes(1);
		expect(fetchFsEntries).toHaveBeenCalledWith({
			path: ordinaryCwd,
			machineId: MACHINE_ID,
		});
		expect(fetchFsEntries).not.toHaveBeenCalledWith({
			path: remoteTeamCwd,
			machineId: MACHINE_ID,
		});
	});

	it("validates ordinary workspaces after the initial Team projection fails", async () => {
		const ordinaryCwd = "/home/user/ordinary-project";
		useChatStore.setState({
			sessions: {
				"ordinary-session": buildSession("ordinary-session", ordinaryCwd),
			},
		});
		useTeamStore.setState({
			isProjectionReady: false,
			isProjectionUnavailable: false,
		});
		const epoch = useTeamStore.getState().beginAgentTeamProjectionSync();
		useTeamStore.getState().failAgentTeamProjectionSync(epoch);
		vi.mocked(fetchFsEntries).mockImplementation(async (payload) => ({
			path: payload.path,
			entries: [],
		}));

		render(
			<Wrapper>
				<WorkspaceList
					machineId={MACHINE_ID}
					onEmptyCreateSession={onEmptyCreateSession}
				/>
			</Wrapper>,
		);

		await waitFor(() => {
			expect(screen.getByText(ordinaryCwd)).toBeInTheDocument();
		});
		expect(fetchFsEntries).toHaveBeenCalledWith({
			path: ordinaryCwd,
			machineId: MACHINE_ID,
		});
	});

	it("validates persisted leader workspaces after the initial Team refresh fails", async () => {
		const ordinaryCwd = "/home/user/ordinary-project";
		const persistedTeamCwd = "/home/user/persisted-team-project";
		const memberWorktreeCwd = "/home/user/persisted-team-worktree";
		const persistedTeam = createTeam({
			machineId: MACHINE_ID,
			workspaceRootCwd: persistedTeamCwd,
		});
		useChatStore.setState({
			sessions: {
				"ordinary-session": buildSession("ordinary-session", ordinaryCwd),
				"remote-team-member-session": buildSession(
					"remote-team-member-session",
					memberWorktreeCwd,
				),
			},
		});
		useTeamStore.setState({
			teams: { [persistedTeam.agentTeamId]: persistedTeam },
			isProjectionReady: false,
			isProjectionUnavailable: false,
		});
		const epoch = useTeamStore.getState().beginAgentTeamProjectionSync();
		useTeamStore.getState().failAgentTeamProjectionSync(epoch);
		vi.mocked(fetchFsEntries).mockImplementation(async (payload) => ({
			path: payload.path,
			entries: [],
		}));

		render(
			<Wrapper>
				<WorkspaceList
					machineId={MACHINE_ID}
					onEmptyCreateSession={onEmptyCreateSession}
				/>
			</Wrapper>,
		);

		await waitFor(() => {
			expect(screen.getByText(ordinaryCwd)).toBeInTheDocument();
			expect(screen.getByText(persistedTeamCwd)).toBeInTheDocument();
		});
		expect(fetchFsEntries).toHaveBeenCalledWith({
			path: ordinaryCwd,
			machineId: MACHINE_ID,
		});
		expect(fetchFsEntries).toHaveBeenCalledWith({
			path: persistedTeamCwd,
			machineId: MACHINE_ID,
		});
		expect(fetchFsEntries).not.toHaveBeenCalledWith({
			path: memberWorktreeCwd,
			machineId: MACHINE_ID,
		});
		expect(screen.queryByText(memberWorktreeCwd)).not.toBeInTheDocument();
	});

	it("does not rerender for metadata-only updates from a remote Team", async () => {
		const ordinaryCwd = "/home/user/ordinary-project";
		const onRender = vi.fn();
		useChatStore.setState({
			sessions: {
				"ordinary-session": buildSession("ordinary-session", ordinaryCwd),
			},
		});
		useTeamStore.getState().replaceAgentTeams([createTeam()]);
		vi.mocked(fetchFsEntries).mockImplementation(async (payload) => ({
			path: payload.path,
			entries: [],
		}));

		render(
			<Wrapper>
				<Profiler id="workspace-list" onRender={onRender}>
					<WorkspaceList
						machineId={MACHINE_ID}
						onEmptyCreateSession={onEmptyCreateSession}
					/>
				</Profiler>
			</Wrapper>,
		);

		await waitFor(() => {
			expect(screen.getByText(ordinaryCwd)).toBeInTheDocument();
		});
		await act(async () => {
			await Promise.resolve();
		});
		onRender.mockClear();

		act(() => {
			useTeamStore.getState().handleAgentTeamsChanged({
				added: [],
				updated: [
					createTeam({
						updatedAt: "2026-07-31T01:00:00.000Z",
						taskCounts: {
							todo: 1,
							inProgress: 0,
							blocked: 0,
							completed: 0,
							failed: 0,
							cancelled: 0,
						},
					}),
				],
				removed: [],
			});
		});
		await act(async () => {
			await Promise.resolve();
		});

		expect(onRender).not.toHaveBeenCalled();
	});
});
