import type { AgentTeamSummary } from "@mobvibe/shared";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { ChatSession } from "@/lib/chat-store";
import { useChatStore } from "@/lib/chat-store";
import { useTeamStore } from "@/lib/team-store";
import { useSessionList } from "../useSessionList";

const taskCounts = {
	todo: 1,
	inProgress: 1,
	blocked: 0,
	completed: 2,
	failed: 0,
	cancelled: 0,
};

const mailboxCounts = { unread: 2, wakePending: 1, wakeFailed: 0 };

const createSession = (
	sessionId: string,
	overrides: Partial<ChatSession> = {},
): ChatSession => ({
	sessionId,
	title: sessionId,
	input: "",
	inputContents: [],
	messages: [],
	terminalOutputs: {},
	sending: false,
	canceling: false,
	machineId: "machine-1",
	backendId: "claude",
	backendLabel: "Claude",
	cwd: "/repo",
	createdAt: "2026-05-14T00:00:00.000Z",
	updatedAt: "2026-05-14T00:00:00.000Z",
	...overrides,
});

const createTeam = (
	overrides: Partial<AgentTeamSummary> = {},
): AgentTeamSummary => ({
	agentTeamId: "team-1",
	machineId: "machine-1",
	title: "Ship Agent Team UI",
	workspaceRootCwd: "/repo",
	workspaceMode: "shared_workspace",
	leaderMemberId: "leader-1",
	lifecycle: "running",
	mailboxCounts,
	taskCounts,
	members: [
		{
			memberId: "leader-1",
			agentTeamId: "team-1",
			role: "leader",
			name: "Leader",
			backendId: "claude",
			sessionId: "leader-session",
			lifecycle: "running",
			health: "healthy",
			mcp: {
				transport: "acp",
				phase: "tools_ready",
				updatedAt: "2026-05-14T00:02:00.000Z",
			},
			mailboxCounts,
			taskCounts,
			pendingPermissionCount: 0,
			worktreeSourceCwd: "/repo",
			worktreeBranch: "team/ui",
			createdAt: "2026-05-14T00:00:00.000Z",
			updatedAt: "2026-05-14T00:02:00.000Z",
		},
		{
			memberId: "member-1",
			agentTeamId: "team-1",
			role: "member",
			name: "Reviewer",
			backendId: "opencode",
			sessionId: "member-session",
			lifecycle: "completed",
			health: "healthy",
			mailboxCounts: { unread: 0, wakePending: 0, wakeFailed: 0 },
			taskCounts: {
				todo: 0,
				inProgress: 0,
				blocked: 0,
				completed: 1,
				failed: 0,
				cancelled: 0,
			},
			pendingPermissionCount: 0,
			worktreeSourceCwd: "/repo",
			worktreeBranch: "team/ui",
			createdAt: "2026-05-14T00:01:00.000Z",
			updatedAt: "2026-05-14T00:03:00.000Z",
		},
	],
	createdAt: "2026-05-14T00:00:00.000Z",
	updatedAt: "2026-05-14T00:03:00.000Z",
	...overrides,
});

describe("useSessionList", () => {
	beforeEach(() => {
		useChatStore.setState({ sessions: {}, activeSessionId: undefined });
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

	it("does not aggregate sessions until the authoritative Team projection is ready", () => {
		const remoteMember = {
			...createTeam().members[1]!,
			memberId: "remote-member",
			agentTeamId: "team-remote",
			sessionId: "remote-member-session",
			worktreeSourceCwd: "/remote/repo",
		};
		const remoteTeam = createTeam({
			agentTeamId: "team-remote",
			machineId: "machine-2",
			workspaceRootCwd: "/remote/repo",
			leaderMemberId: "remote-member",
			members: [remoteMember],
		});
		useChatStore.setState({
			sessions: {
				"remote-member-session": createSession("remote-member-session", {
					cwd: "/remote/repo",
					worktreeSourceCwd: "/remote/repo",
				}),
				"solo-session": createSession("solo-session", { cwd: "/repo" }),
			},
		});

		const { result } = renderHook(() =>
			useSessionList({
				activeSessionId: undefined,
				selectedMachineId: "machine-1",
				selectedWorkspaceByMachine: {},
			}),
		);

		expect(result.current.workspaceList).toEqual([]);
		expect(result.current.sessionList).toEqual([]);
		expect(result.current.sidebarSessionList).toEqual([]);

		act(() => {
			useTeamStore.getState().replaceAgentTeams([remoteTeam]);
		});

		expect(result.current.workspaceList).toEqual([
			expect.objectContaining({ cwd: "/repo" }),
		]);
		expect(result.current.sessionList).toEqual([
			expect.objectContaining({ sessionId: "solo-session" }),
		]);
		expect(result.current.sidebarSessionList).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					kind: "agent-team",
					team: expect.objectContaining({ agentTeamId: "team-remote" }),
				}),
				expect.objectContaining({
					kind: "session",
					session: expect.objectContaining({ sessionId: "solo-session" }),
				}),
			]),
		);
	});

	it("keeps the last good session projection visible during refresh", () => {
		useChatStore.setState({
			sessions: {
				"solo-session": createSession("solo-session", { cwd: "/repo" }),
			},
		});
		useTeamStore.getState().replaceAgentTeams([]);

		const { result } = renderHook(() =>
			useSessionList({
				activeSessionId: undefined,
				selectedMachineId: "machine-1",
				selectedWorkspaceByMachine: {},
			}),
		);
		expect(result.current.sessionList).toEqual([
			expect.objectContaining({ sessionId: "solo-session" }),
		]);

		act(() => {
			useTeamStore.getState().beginAgentTeamProjectionSync();
		});

		expect(result.current.sessionList).toEqual([
			expect.objectContaining({ sessionId: "solo-session" }),
		]);
	});

	it("keeps ordinary navigation available when the initial Team projection fails", () => {
		useChatStore.setState({
			sessions: {
				"solo-session": createSession("solo-session", { cwd: "/repo" }),
			},
		});
		const epoch = useTeamStore.getState().beginAgentTeamProjectionSync();
		useTeamStore.getState().failAgentTeamProjectionSync(epoch);

		const { result } = renderHook(() =>
			useSessionList({
				activeSessionId: undefined,
				selectedMachineId: "machine-1",
				selectedWorkspaceByMachine: {},
			}),
		);

		expect(result.current.workspaceList).toEqual([
			expect.objectContaining({ cwd: "/repo" }),
		]);
		expect(result.current.sessionList).toEqual([
			expect.objectContaining({ sessionId: "solo-session" }),
		]);
	});

	it("uses persisted Team facts after initial refresh failure until a successful slice replacement", () => {
		const workspaceRootCwd = "/persisted/team-repo";
		const persistedTeam = createTeam({
			title: "Persisted Team",
			workspaceRootCwd,
			members: createTeam().members.map((member) => ({
				...member,
				worktreeSourceCwd: workspaceRootCwd,
			})),
		});
		useChatStore.setState({
			sessions: {
				"leader-session": createSession("leader-session", {
					cwd: workspaceRootCwd,
					workspaceRootCwd,
					agentTeamOwned: true,
				}),
				"member-session": createSession("member-session", {
					cwd: workspaceRootCwd,
					workspaceRootCwd,
					agentTeamOwned: true,
				}),
				"solo-session": createSession("solo-session", {
					cwd: workspaceRootCwd,
					workspaceRootCwd,
				}),
			},
		});
		useTeamStore.setState({
			teams: { [persistedTeam.agentTeamId]: persistedTeam },
			isProjectionReady: false,
			isProjectionUnavailable: false,
		});
		const failedEpoch = useTeamStore.getState().beginAgentTeamProjectionSync();
		useTeamStore.getState().failAgentTeamProjectionSync(failedEpoch);

		const { result } = renderHook(() =>
			useSessionList({
				activeSessionId: undefined,
				selectedMachineId: "machine-1",
				selectedWorkspaceByMachine: {},
			}),
		);

		expect(result.current.workspaceList).toEqual([
			expect.objectContaining({ cwd: workspaceRootCwd }),
		]);
		expect(result.current.sessionList).toEqual([
			expect.objectContaining({ sessionId: "solo-session" }),
		]);
		expect(result.current.sidebarSessionList).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					kind: "agent-team",
					team: expect.objectContaining({
						agentTeamId: "team-1",
						title: "Persisted Team",
					}),
					members: [
						expect.objectContaining({
							memberId: "leader-1",
							session: expect.objectContaining({
								sessionId: "leader-session",
							}),
						}),
						expect.objectContaining({
							memberId: "member-1",
							session: expect.objectContaining({
								sessionId: "member-session",
							}),
						}),
					],
				}),
			]),
		);

		act(() => {
			const epoch = useTeamStore.getState().beginAgentTeamProjectionSync();
			useTeamStore
				.getState()
				.completeAgentTeamProjectionSync(
					epoch,
					[{ ...persistedTeam, title: "Current Team" }],
					["machine-1"],
				);
		});
		expect(
			result.current.sidebarSessionList.find(
				(entry) => entry.kind === "agent-team",
			),
		).toMatchObject({
			team: { title: "Current Team" },
		});

		act(() => {
			const epoch = useTeamStore.getState().beginAgentTeamProjectionSync();
			useTeamStore
				.getState()
				.completeAgentTeamProjectionSync(epoch, [], ["machine-1"]);
		});
		expect(
			result.current.sidebarSessionList.some(
				(entry) => entry.kind === "agent-team",
			),
		).toBe(false);
	});

	it("does not expose a marked remote Team worker when its leader projection is offline", () => {
		useChatStore.setState({
			sessions: {
				"remote-worker": {
					...createSession("remote-worker", {
						cwd: "/remote/team-worktree",
						workspaceRootCwd: "/remote/repo",
					}),
					agentTeamOwned: true,
				},
				"solo-session": createSession("solo-session", { cwd: "/repo" }),
			},
		});
		useTeamStore.getState().replaceAgentTeams([]);

		const { result } = renderHook(() =>
			useSessionList({
				activeSessionId: undefined,
				selectedMachineId: "machine-1",
				selectedWorkspaceByMachine: {},
			}),
		);

		expect(result.current.workspaceList).toEqual([
			expect.objectContaining({ cwd: "/repo" }),
		]);
		expect(result.current.sessionList).toEqual([
			expect.objectContaining({ sessionId: "solo-session" }),
		]);
		expect(result.current.sidebarSessionList).toEqual([
			expect.objectContaining({
				kind: "session",
				session: expect.objectContaining({ sessionId: "solo-session" }),
			}),
		]);
	});

	it("folds team-owned ordinary sessions under a team parent without top-level duplicates", () => {
		useChatStore.setState({
			sessions: {
				"leader-session": createSession("leader-session", {
					title: "Leader ordinary session",
					cwd: "/worktrees/team-ui",
					workspaceRootCwd: "/repo",
					worktreeSourceCwd: "/repo",
					worktreeBranch: "team/ui",
				}),
				"member-session": createSession("member-session", {
					title: "Member ordinary session",
					cwd: "/worktrees/team-ui",
					workspaceRootCwd: "/repo",
					worktreeSourceCwd: "/repo",
					worktreeBranch: "team/ui",
				}),
				"solo-session": createSession("solo-session", {
					title: "Solo session",
				}),
			},
		});
		useTeamStore.getState().replaceAgentTeams([createTeam()]);

		const { result } = renderHook(() =>
			useSessionList({
				activeSessionId: undefined,
				selectedMachineId: "machine-1",
				selectedWorkspaceByMachine: { "machine-1": "/repo" },
			}),
		);

		expect(result.current.sidebarSessionList).toHaveLength(2);
		expect(result.current.sidebarSessionList[0]).toMatchObject({
			kind: "agent-team",
			team: { agentTeamId: "team-1", title: "Ship Agent Team UI" },
		});
		expect(
			result.current.sidebarSessionList[0]?.kind === "agent-team"
				? result.current.sidebarSessionList[0].members
				: [],
		).toHaveLength(2);
		expect(result.current.sidebarSessionList[1]).toMatchObject({
			kind: "session",
			session: { sessionId: "solo-session" },
		});
		expect(result.current.sessionList).toEqual([
			expect.objectContaining({ sessionId: "solo-session" }),
		]);
	});

	it("does not bind or leak an ordinary session that collides with a Team member raw ID", () => {
		useChatStore.setState({
			sessions: {
				"leader-session": createSession("leader-session", {
					title: "Ordinary raw-ID collision",
				}),
				"member-session": createSession("member-session", {
					title: "Classified Team member",
					agentTeamOwned: true,
				}),
				"solo-session": createSession("solo-session"),
			},
		});
		useTeamStore.getState().replaceAgentTeams([createTeam()]);

		const { result } = renderHook(() =>
			useSessionList({
				activeSessionId: undefined,
				selectedMachineId: "machine-1",
				selectedWorkspaceByMachine: { "machine-1": "/repo" },
			}),
		);
		const teamEntry = result.current.sidebarSessionList.find(
			(entry) => entry.kind === "agent-team",
		);
		if (!teamEntry || teamEntry.kind !== "agent-team") {
			throw new Error("Expected Agent Team sidebar entry");
		}

		expect(teamEntry.members[0]?.session).toBeUndefined();
		expect(teamEntry.members[1]?.session).toMatchObject({
			sessionId: "member-session",
			title: "Classified Team member",
		});
		expect(result.current.sessionList).toEqual([
			expect.objectContaining({ sessionId: "solo-session" }),
		]);
	});

	it("does not bind one classified raw session ID to multiple Team member refs", () => {
		const duplicateRawIdTeam = createTeam({
			members: createTeam().members.map((member) => ({
				...member,
				sessionId: "shared-member-session",
			})),
		});
		useChatStore.setState({
			sessions: {
				"shared-member-session": createSession("shared-member-session", {
					agentTeamOwned: true,
				}),
				"solo-session": createSession("solo-session"),
			},
		});
		useTeamStore.getState().replaceAgentTeams([duplicateRawIdTeam]);

		const { result } = renderHook(() =>
			useSessionList({
				activeSessionId: undefined,
				selectedMachineId: "machine-1",
				selectedWorkspaceByMachine: { "machine-1": "/repo" },
			}),
		);
		const teamEntry = result.current.sidebarSessionList.find(
			(entry) => entry.kind === "agent-team",
		);
		if (!teamEntry || teamEntry.kind !== "agent-team") {
			throw new Error("Expected Agent Team sidebar entry");
		}

		expect(teamEntry.members).toHaveLength(2);
		expect(teamEntry.members.every((member) => !member.session)).toBe(true);
		expect(result.current.sessionList).toEqual([
			expect.objectContaining({ sessionId: "solo-session" }),
		]);
	});

	it("keeps worktree team rows grouped under the source workspace", () => {
		useChatStore.setState({
			sessions: {
				"leader-session": createSession("leader-session", {
					cwd: "/worktrees/team-ui",
					workspaceRootCwd: "/repo",
					worktreeSourceCwd: "/repo",
				}),
			},
		});
		useTeamStore.getState().replaceAgentTeams([createTeam()]);

		const { result } = renderHook(() =>
			useSessionList({
				activeSessionId: undefined,
				selectedMachineId: "machine-1",
				selectedWorkspaceByMachine: { "machine-1": "/repo" },
			}),
		);

		expect(result.current.workspaceList).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ cwd: "/repo", label: "repo" }),
			]),
		);
		expect(result.current.sidebarSessionList[0]).toMatchObject({
			kind: "agent-team",
		});
	});

	it("shows teams across machine and workspace boundaries without duplicating member sessions", () => {
		const remoteMember = {
			...createTeam().members[1]!,
			memberId: "remote-member",
			agentTeamId: "team-remote",
			sessionId: "remote-member-session",
			worktreeSourceCwd: "/remote/repo",
			worktreeBranch: "team/remote",
		};
		const remoteTeam = createTeam({
			agentTeamId: "team-remote",
			machineId: "machine-2",
			title: "Remote placement",
			workspaceRootCwd: "/remote/repo",
			leaderMemberId: "remote-member",
			members: [remoteMember],
			updatedAt: "2026-05-14T00:05:00.000Z",
		});
		const otherWorkspaceTeam = createTeam({
			agentTeamId: "team-other-workspace",
			title: "Other workspace",
			workspaceRootCwd: "/another/repo",
			members: [],
			updatedAt: "2026-05-14T00:04:00.000Z",
		});

		useChatStore.setState({
			sessions: {
				"remote-member-session": createSession("remote-member-session", {
					title: "Cross-machine member",
					machineId: "machine-1",
					cwd: "/remote/repo",
					worktreeSourceCwd: "/remote/repo",
					worktreeBranch: "team/remote",
				}),
				"solo-session": createSession("solo-session", {
					title: "Solo session",
				}),
			},
		});
		useTeamStore
			.getState()
			.replaceAgentTeams([createTeam(), remoteTeam, otherWorkspaceTeam]);

		const { result } = renderHook(() =>
			useSessionList({
				activeSessionId: undefined,
				selectedMachineId: "machine-1",
				selectedWorkspaceByMachine: { "machine-1": "/repo" },
			}),
		);

		expect(
			result.current.sidebarSessionList.flatMap((entry) =>
				entry.kind === "agent-team" ? [entry.team.agentTeamId] : [],
			),
		).toEqual(["team-remote", "team-other-workspace", "team-1"]);
		expect(result.current.sessionList).toEqual([
			expect.objectContaining({ sessionId: "solo-session" }),
		]);
		expect(result.current.workspaceList).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ cwd: "/remote/repo" }),
			]),
		);
	});

	it("ignores a persisted workspace that now belongs only to a Team member", () => {
		const remoteMember = {
			...createTeam().members[1]!,
			memberId: "remote-member",
			agentTeamId: "team-remote",
			sessionId: "remote-member-session",
			worktreeSourceCwd: "/remote/repo",
		};
		useChatStore.setState({
			sessions: {
				"remote-member-session": createSession("remote-member-session", {
					machineId: "machine-1",
					cwd: "/remote/repo",
					worktreeSourceCwd: "/remote/repo",
				}),
				"solo-session": createSession("solo-session", {
					cwd: "/repo",
				}),
			},
		});
		useTeamStore.getState().replaceAgentTeams([
			createTeam({
				agentTeamId: "team-remote",
				machineId: "machine-2",
				workspaceRootCwd: "/remote/repo",
				leaderMemberId: "remote-member",
				members: [remoteMember],
			}),
		]);

		const { result } = renderHook(() =>
			useSessionList({
				activeSessionId: undefined,
				selectedMachineId: "machine-1",
				selectedWorkspaceByMachine: { "machine-1": "/remote/repo" },
			}),
		);

		expect(result.current.selectedWorkspaceCwd).toBeUndefined();
		expect(result.current.effectiveWorkspaceCwd).toBe("/repo");
		expect(result.current.sessionList).toEqual([
			expect.objectContaining({ sessionId: "solo-session" }),
		]);
	});
});
