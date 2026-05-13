import type { AgentTeamSummary } from "@mobvibe/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { type SyncStateStorage, setStorageAdapter } from "../storage-adapter";
import { useTeamStore } from "../team-store";

const createMemoryStorage = () => {
	const values = new Map<string, string>();
	const storage: SyncStateStorage = {
		getItem: (name) => values.get(name) ?? null,
		setItem: (name, value) => {
			values.set(name, value);
		},
		removeItem: (name) => {
			values.delete(name);
		},
	};
	return { storage, values };
};

const createTeam = (
	overrides: Partial<AgentTeamSummary> = {},
): AgentTeamSummary => ({
	agentTeamId: "team-1",
	machineId: "machine-1",
	title: "Team One",
	workspaceRootCwd: "/repo",
	workspaceMode: "shared_workspace",
	leaderMemberId: "member-1",
	lifecycle: "pending",
	members: [
		{
			memberId: "member-1",
			agentTeamId: "team-1",
			role: "leader",
			name: "Leader",
			backendId: "backend-1",
			lifecycle: "pending",
			health: "healthy",
			mailboxCounts: { unread: 1, wakePending: 0, wakeFailed: 0 },
			taskCounts: {
				todo: 1,
				inProgress: 0,
				blocked: 0,
				completed: 0,
				failed: 0,
				cancelled: 0,
			},
			pendingPermissionCount: 0,
			sourceRefs: [
				{
					type: "member_session",
					agentTeamId: "team-1",
					memberId: "member-1",
					sessionId: "session-1",
				},
			],
			createdAt: "2026-05-13T00:00:00.000Z",
			updatedAt: "2026-05-13T00:00:00.000Z",
		},
	],
	mailboxCounts: { unread: 1, wakePending: 0, wakeFailed: 0 },
	taskCounts: {
		todo: 1,
		inProgress: 0,
		blocked: 0,
		completed: 0,
		failed: 0,
		cancelled: 0,
	},
	sourceRefs: [
		{
			type: "mailbox_message",
			agentTeamId: "team-1",
			messageId: "message-1",
			fromMemberId: "member-1",
		},
		{
			type: "task",
			agentTeamId: "team-1",
			taskId: "task-1",
			ownerMemberId: "member-1",
		},
	],
	summaryRefs: [
		{
			summaryRefId: "summary-1",
			agentTeamId: "team-1",
			status: "ready",
			sourceRefs: [
				{
					type: "session_event",
					agentTeamId: "team-1",
					memberId: "member-1",
					sessionId: "session-1",
					revision: 1,
					seq: 2,
				},
			],
			createdAt: "2026-05-13T00:00:00.000Z",
			updatedAt: "2026-05-13T00:00:00.000Z",
		},
	],
	createdAt: "2026-05-13T00:00:00.000Z",
	updatedAt: "2026-05-13T00:00:00.000Z",
	...overrides,
});

describe("team-store", () => {
	let values: Map<string, string>;

	beforeEach(() => {
		const memory = createMemoryStorage();
		values = memory.values;
		setStorageAdapter(memory.storage);
		useTeamStore.setState({
			teams: {},
			activeAgentTeamId: undefined,
			lastSyncAt: undefined,
			appError: undefined,
		});
	});

	it("merges added and updated teams and removes deleted teams", () => {
		const teamOne = createTeam({ title: "Old title" });
		const teamTwo = createTeam({ agentTeamId: "team-2", title: "Team Two" });
		const removed = createTeam({ agentTeamId: "team-3", title: "Removed" });

		useTeamStore.getState().replaceAgentTeams([teamOne, removed]);
		useTeamStore.getState().setActiveAgentTeamId("team-3");
		useTeamStore.getState().handleAgentTeamsChanged({
			added: [teamTwo],
			updated: [createTeam({ title: "Updated title" })],
			removed: ["team-3"],
			machineId: "machine-1",
		});

		const state = useTeamStore.getState();
		expect(Object.keys(state.teams).sort()).toEqual(["team-1", "team-2"]);
		expect(state.teams["team-1"].title).toBe("Updated title");
		expect(state.teams["team-2"].title).toBe("Team Two");
		expect(state.activeAgentTeamId).toBeUndefined();
		expect(state.lastSyncAt).toBeDefined();
	});

	it("persists projection and source refs without content or secrets", () => {
		useTeamStore.getState().setAppError({
			code: "INTERNAL_ERROR",
			message: "runtime only",
			retryable: true,
			scope: "request",
		});
		useTeamStore.getState().replaceAgentTeams([createTeam()]);

		const raw = values.get("mobvibe.team-store");
		expect(raw).toBeDefined();
		const persistedText = JSON.stringify(JSON.parse(raw ?? "{}"));
		expect(persistedText).toContain("mailbox_message");
		expect(persistedText).toContain("member_session");
		expect(persistedText).not.toMatch(
			/messages|transcript|body_local_json|mailboxBody|taskBody|summaryBody|providerToken|masterSecret|dek|secret|appError/i,
		);
	});
});
