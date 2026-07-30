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
			isProjectionReady: false,
			isProjectionRefreshing: false,
			isProjectionUnavailable: false,
			isSessionProjectionRecoveryPending: false,
			isSessionProjectionSnapshotReady: false,
			sessionProjectionRecoveryGeneration: 0,
			lastAbortedSessionProjectionRecoveryGeneration: undefined,
			projectionSyncEpoch: 0,
			pendingAgentTeamChanges: [],
		});
	});

	it("opens projection reads only after an authoritative replacement", () => {
		expect(useTeamStore.getState().isProjectionReady).toBe(false);

		useTeamStore.getState().replaceAgentTeams([createTeam()]);
		expect(useTeamStore.getState().isProjectionReady).toBe(true);

		const epoch = useTeamStore.getState().beginAgentTeamProjectionSync();
		expect(useTeamStore.getState().isProjectionReady).toBe(true);
		expect(useTeamStore.getState().isProjectionRefreshing).toBe(true);

		useTeamStore.getState().handleAgentTeamsChanged({
			added: [],
			updated: [createTeam({ title: "Delta during resync" })],
			removed: [],
			machineId: "machine-1",
		});
		expect(useTeamStore.getState().teams["team-1"].title).toBe(
			"Delta during resync",
		);

		useTeamStore
			.getState()
			.completeAgentTeamProjectionSync(epoch, [createTeam()], ["machine-1"]);
		expect(useTeamStore.getState().isProjectionReady).toBe(true);
		expect(useTeamStore.getState().isProjectionRefreshing).toBe(false);
		expect(useTeamStore.getState().teams["team-1"].title).toBe(
			"Delta during resync",
		);
	});

	it("replays additions and removals received over an in-flight snapshot", () => {
		const epoch = useTeamStore.getState().beginAgentTeamProjectionSync();
		const added = createTeam({
			agentTeamId: "team-added",
			title: "Added after snapshot",
		});
		useTeamStore.getState().handleAgentTeamsChanged({
			added: [added],
			updated: [],
			removed: ["team-1"],
			machineId: "machine-1",
		});

		useTeamStore
			.getState()
			.completeAgentTeamProjectionSync(epoch, [createTeam()], ["machine-1"]);

		expect(useTeamStore.getState().teams["team-1"]).toBeUndefined();
		expect(useTeamStore.getState().teams["team-added"]?.title).toBe(
			"Added after snapshot",
		);
	});

	it("ignores a stale snapshot completion from a superseded sync epoch", () => {
		const staleEpoch = useTeamStore.getState().beginAgentTeamProjectionSync();
		const currentEpoch = useTeamStore.getState().beginAgentTeamProjectionSync();

		useTeamStore
			.getState()
			.completeAgentTeamProjectionSync(
				staleEpoch,
				[createTeam({ title: "Stale snapshot" })],
				["machine-1"],
			);
		expect(useTeamStore.getState().isProjectionReady).toBe(false);
		expect(useTeamStore.getState().teams).toEqual({});

		useTeamStore
			.getState()
			.completeAgentTeamProjectionSync(
				currentEpoch,
				[createTeam({ title: "Current snapshot" })],
				["machine-1"],
			);
		expect(useTeamStore.getState().isProjectionReady).toBe(true);
		expect(useTeamStore.getState().teams["team-1"].title).toBe(
			"Current snapshot",
		);
	});

	it("keeps the last good projection when a refresh fails", () => {
		useTeamStore
			.getState()
			.replaceAgentTeams([createTeam({ title: "Last good snapshot" })]);
		const epoch = useTeamStore.getState().beginAgentTeamProjectionSync();

		useTeamStore.getState().failAgentTeamProjectionSync(epoch);

		expect(useTeamStore.getState().isProjectionReady).toBe(true);
		expect(useTeamStore.getState().isProjectionRefreshing).toBe(false);
		expect(useTeamStore.getState().teams["team-1"].title).toBe(
			"Last good snapshot",
		);
	});

	it("marks an unavailable initial projection without treating it as authoritative", () => {
		const epoch = useTeamStore.getState().beginAgentTeamProjectionSync();

		useTeamStore.getState().failAgentTeamProjectionSync(epoch);

		expect(useTeamStore.getState().isProjectionReady).toBe(false);
		expect(useTeamStore.getState().isProjectionUnavailable).toBe(true);
		expect(useTeamStore.getState().isProjectionRefreshing).toBe(false);
	});

	it("replaces only covered leader-machine slices", () => {
		const offlineLeaderTeam = createTeam({
			agentTeamId: "team-offline",
			machineId: "machine-offline",
			title: "Offline leader facts",
		});
		const staleCoveredTeam = createTeam({
			agentTeamId: "team-stale",
			machineId: "machine-online",
			title: "Stale covered facts",
		});
		useTeamStore
			.getState()
			.replaceAgentTeams([offlineLeaderTeam, staleCoveredTeam]);
		const epoch = useTeamStore.getState().beginAgentTeamProjectionSync();
		const currentCoveredTeam = createTeam({
			agentTeamId: "team-current",
			machineId: "machine-online",
			title: "Current covered facts",
		});

		useTeamStore
			.getState()
			.completeAgentTeamProjectionSync(
				epoch,
				[currentCoveredTeam],
				["machine-online"],
			);

		expect(useTeamStore.getState().teams).toEqual({
			"team-offline": offlineLeaderTeam,
			"team-current": currentCoveredTeam,
		});
	});

	it("does not let a covered snapshot overwrite an uncovered source collision", () => {
		const uncoveredLastGood = createTeam({
			agentTeamId: "shared-team-id",
			machineId: "machine-uncovered",
			title: "Uncovered last good",
		});
		useTeamStore.getState().replaceAgentTeams([uncoveredLastGood]);
		const epoch = useTeamStore.getState().beginAgentTeamProjectionSync();

		useTeamStore.getState().completeAgentTeamProjectionSync(
			epoch,
			[
				createTeam({
					agentTeamId: "shared-team-id",
					machineId: "machine-covered",
					title: "Cross-source collision",
				}),
			],
			["machine-covered"],
		);

		expect(useTeamStore.getState().teams["shared-team-id"]).toMatchObject({
			machineId: "machine-uncovered",
			title: "Uncovered last good",
		});
	});

	it("rejects a snapshot ID claimed by two covered sources", () => {
		const epoch = useTeamStore.getState().beginAgentTeamProjectionSync();

		useTeamStore.getState().completeAgentTeamProjectionSync(
			epoch,
			[
				createTeam({
					agentTeamId: "shared-team-id",
					machineId: "machine-a",
					title: "Machine A claim",
				}),
				createTeam({
					agentTeamId: "shared-team-id",
					machineId: "machine-b",
					title: "Machine B claim",
				}),
			],
			["machine-a", "machine-b"],
		);

		expect(useTeamStore.getState().teams["shared-team-id"]).toBeUndefined();
	});

	it("preserves last-good facts when covered sources conflict in one snapshot", () => {
		const lastGood = createTeam({
			agentTeamId: "shared-team-id",
			machineId: "machine-a",
			title: "Last good",
		});
		useTeamStore.getState().replaceAgentTeams([lastGood]);
		const epoch = useTeamStore.getState().beginAgentTeamProjectionSync();

		useTeamStore.getState().completeAgentTeamProjectionSync(
			epoch,
			[
				createTeam({
					agentTeamId: "shared-team-id",
					machineId: "machine-a",
					title: "Machine A candidate",
				}),
				createTeam({
					agentTeamId: "shared-team-id",
					machineId: "machine-b",
					title: "Machine B candidate",
				}),
			],
			["machine-a", "machine-b"],
		);

		expect(useTeamStore.getState().teams["shared-team-id"]).toMatchObject({
			machineId: "machine-a",
			title: "Last good",
		});
	});

	it("releases session recovery only for the current ready generation", () => {
		const staleGeneration = useTeamStore
			.getState()
			.beginSessionProjectionRecovery();
		useTeamStore.getState().markSessionProjectionSnapshotReady(staleGeneration);
		expect(useTeamStore.getState().isSessionProjectionSnapshotReady).toBe(true);

		const currentGeneration = useTeamStore
			.getState()
			.beginSessionProjectionRecovery();
		expect(useTeamStore.getState().isSessionProjectionRecoveryPending).toBe(
			true,
		);
		expect(useTeamStore.getState().isSessionProjectionSnapshotReady).toBe(
			false,
		);
		expect(currentGeneration).toBe(staleGeneration + 1);

		useTeamStore.getState().markSessionProjectionSnapshotReady(staleGeneration);
		useTeamStore.getState().completeSessionProjectionRecovery(staleGeneration);
		useTeamStore.getState().abortSessionProjectionRecovery(staleGeneration);
		expect(useTeamStore.getState().isSessionProjectionRecoveryPending).toBe(
			true,
		);
		expect(useTeamStore.getState().isSessionProjectionSnapshotReady).toBe(
			false,
		);

		useTeamStore
			.getState()
			.markSessionProjectionSnapshotReady(currentGeneration);
		expect(useTeamStore.getState().isSessionProjectionSnapshotReady).toBe(true);
		useTeamStore
			.getState()
			.completeSessionProjectionRecovery(currentGeneration);
		expect(useTeamStore.getState().isSessionProjectionRecoveryPending).toBe(
			false,
		);
		expect(useTeamStore.getState().isSessionProjectionSnapshotReady).toBe(
			false,
		);
		expect(
			useTeamStore.getState().lastAbortedSessionProjectionRecoveryGeneration,
		).toBeUndefined();
	});

	it("aborts and releases only the current recovery generation", () => {
		const generation = useTeamStore.getState().beginSessionProjectionRecovery();
		useTeamStore.getState().markSessionProjectionSnapshotReady(generation);

		useTeamStore.getState().abortSessionProjectionRecovery(generation + 1);
		expect(useTeamStore.getState().isSessionProjectionRecoveryPending).toBe(
			true,
		);
		expect(
			useTeamStore.getState().lastAbortedSessionProjectionRecoveryGeneration,
		).toBeUndefined();

		useTeamStore.getState().abortSessionProjectionRecovery(generation);
		expect(useTeamStore.getState().isSessionProjectionRecoveryPending).toBe(
			false,
		);
		expect(useTeamStore.getState().isSessionProjectionSnapshotReady).toBe(
			false,
		);
		expect(
			useTeamStore.getState().lastAbortedSessionProjectionRecoveryGeneration,
		).toBe(generation);
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

	it("does not roll a leader slice back to an older same-source projection", () => {
		const current = createTeam({
			title: "Current projection",
			updatedAt: "2026-05-13T00:02:00.000Z",
		});
		useTeamStore.getState().replaceAgentTeams([current]);

		useTeamStore.getState().handleAgentTeamsChanged({
			machineId: current.machineId,
			added: [
				createTeam({
					title: "Stale create response",
					updatedAt: "2026-05-13T00:01:00.000Z",
				}),
			],
			updated: [
				createTeam({
					title: "Stale socket update",
					updatedAt: "2026-05-13T00:00:00.000Z",
				}),
			],
			removed: [],
		});

		expect(useTeamStore.getState().teams[current.agentTeamId]).toEqual(current);
	});

	it("applies deltas only to the declared leader-machine source slice", () => {
		const sourceUpdated = createTeam({
			agentTeamId: "team-source-updated",
			title: "Source old",
		});
		const sourceRemoved = createTeam({
			agentTeamId: "team-source-removed",
		});
		const foreignRemoved = createTeam({
			agentTeamId: "team-foreign-removed",
			machineId: "machine-2",
			title: "Foreign retained",
		});
		const foreignUpdated = createTeam({
			agentTeamId: "team-foreign-updated",
			machineId: "machine-2",
			title: "Foreign old",
		});
		const addCollision = createTeam({
			agentTeamId: "team-add-collision",
			machineId: "machine-2",
			title: "Foreign add collision",
		});
		const updateCollision = createTeam({
			agentTeamId: "team-update-collision",
			machineId: "machine-2",
			title: "Foreign update collision",
		});
		useTeamStore
			.getState()
			.replaceAgentTeams([
				sourceUpdated,
				sourceRemoved,
				foreignRemoved,
				foreignUpdated,
				addCollision,
				updateCollision,
			]);

		useTeamStore.getState().handleAgentTeamsChanged({
			machineId: "machine-1",
			removed: ["team-source-removed", "team-foreign-removed"],
			added: [
				createTeam({
					agentTeamId: "team-source-added",
					title: "Source added",
				}),
				createTeam({
					agentTeamId: "team-foreign-added",
					machineId: "machine-2",
					title: "Foreign payload",
				}),
				createTeam({
					agentTeamId: "team-add-collision",
					title: "Must not replace foreign add collision",
				}),
			],
			updated: [
				createTeam({
					agentTeamId: "team-source-updated",
					title: "Source updated",
				}),
				createTeam({
					agentTeamId: "team-foreign-updated",
					machineId: "machine-2",
					title: "Must not update from foreign payload",
				}),
				createTeam({
					agentTeamId: "team-update-collision",
					title: "Must not replace foreign update collision",
				}),
			],
		});

		const teams = useTeamStore.getState().teams;
		expect(teams["team-source-removed"]).toBeUndefined();
		expect(teams["team-source-added"]?.title).toBe("Source added");
		expect(teams["team-source-updated"]?.title).toBe("Source updated");
		expect(teams["team-foreign-removed"]).toEqual(foreignRemoved);
		expect(teams["team-foreign-updated"]).toEqual(foreignUpdated);
		expect(teams["team-foreign-added"]).toBeUndefined();
		expect(teams["team-add-collision"]).toEqual(addCollision);
		expect(teams["team-update-collision"]).toEqual(updateCollision);
	});

	it("fails closed when a delta has no leader-machine source", () => {
		const existing = createTeam({ title: "Existing" });
		useTeamStore.getState().replaceAgentTeams([existing]);
		const epoch = useTeamStore.getState().beginAgentTeamProjectionSync();

		useTeamStore.getState().handleAgentTeamsChanged({
			removed: ["team-1"],
			added: [
				createTeam({
					agentTeamId: "team-added-without-source",
				}),
			],
			updated: [createTeam({ title: "Updated without source" })],
		});

		expect(useTeamStore.getState().teams).toEqual({ "team-1": existing });
		expect(useTeamStore.getState().pendingAgentTeamChanges).toEqual([]);
		useTeamStore
			.getState()
			.completeAgentTeamProjectionSync(epoch, [existing], ["machine-1"]);
		expect(useTeamStore.getState().teams).toEqual({ "team-1": existing });
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
			/messages|transcript|body_local_json|mailboxBody|taskBody|summaryBody|providerToken|masterSecret|dek|secret|appError|isProjectionReady|isProjectionRefreshing|isProjectionUnavailable|isSessionProjectionRecoveryPending|isSessionProjectionSnapshotReady|sessionProjectionRecoveryGeneration|lastAbortedSessionProjectionRecoveryGeneration|projectionSyncEpoch|pendingAgentTeamChanges/i,
		);
	});
});
