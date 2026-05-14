import type { AgentTeamSummary } from "@mobvibe/shared";
import { renderHook } from "@testing-library/react";
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
		});
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
		useTeamStore.setState({ teams: { "team-1": createTeam() } });

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
		useTeamStore.setState({ teams: { "team-1": createTeam() } });

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
});
