import type {
	AgentTeamSummary,
	AgentTeamsChangedPayload,
	ErrorDetail,
} from "@mobvibe/shared";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { getStorageAdapter } from "./storage-adapter";

const STORAGE_KEY = "mobvibe.team-store";

const FORBIDDEN_PERSIST_KEYS = new Set([
	"messages",
	"transcript",
	"body_local_json",
	"mailboxBody",
	"taskBody",
	"summaryBody",
	"prompt",
	"content",
	"body",
	"description",
	"summaryText",
	"agentOutput",
	"providerToken",
	"masterSecret",
	"dek",
	"secret",
]);

export type TeamState = {
	teams: Record<string, AgentTeamSummary>;
	activeAgentTeamId?: string;
	lastSyncAt?: string;
	appError?: ErrorDetail;
	isProjectionReady: boolean;
	isProjectionRefreshing: boolean;
	isProjectionUnavailable: boolean;
	isSessionProjectionRecoveryPending: boolean;
	isSessionProjectionSnapshotReady: boolean;
	sessionProjectionRecoveryGeneration: number;
	lastAbortedSessionProjectionRecoveryGeneration?: number;
	projectionSyncEpoch: number;
	pendingAgentTeamChanges: AgentTeamsChangedPayload[];
	beginAgentTeamProjectionSync: () => number;
	beginSessionProjectionRecovery: () => number;
	completeAgentTeamProjectionSync: (
		epoch: number,
		teams: AgentTeamSummary[],
		coveredLeaderMachineIds: string[],
	) => void;
	markSessionProjectionSnapshotReady: (generation: number) => void;
	completeSessionProjectionRecovery: (generation: number) => void;
	abortSessionProjectionRecovery: (generation: number) => void;
	failAgentTeamProjectionSync: (epoch: number) => void;
	setActiveAgentTeamId: (value?: string) => void;
	setAppError: (value?: ErrorDetail) => void;
	replaceAgentTeams: (teams: AgentTeamSummary[]) => void;
	handleAgentTeamsChanged: (payload: AgentTeamsChangedPayload) => void;
};

type PersistedTeamState = Pick<
	TeamState,
	"teams" | "activeAgentTeamId" | "lastSyncAt"
>;

const stripForbiddenKeys = (value: unknown): unknown => {
	if (!value || typeof value !== "object") {
		return value;
	}
	if (Array.isArray(value)) {
		return value.map(stripForbiddenKeys);
	}

	const next: Record<string, unknown> = {};
	for (const [key, nested] of Object.entries(value)) {
		if (FORBIDDEN_PERSIST_KEYS.has(key)) {
			continue;
		}
		next[key] = stripForbiddenKeys(nested);
	}
	return next;
};

const sanitizeTeamProjection = (team: AgentTeamSummary): AgentTeamSummary =>
	stripForbiddenKeys(team) as AgentTeamSummary;

const toTeamRecord = (teams: AgentTeamSummary[]) =>
	teams.reduce<Record<string, AgentTeamSummary>>((acc, team) => {
		acc[team.agentTeamId] = sanitizeTeamProjection(team);
		return acc;
	}, {});

const sanitizeAgentTeamChanges = (
	payload: AgentTeamsChangedPayload,
): AgentTeamsChangedPayload => ({
	...payload,
	added: payload.added.map(sanitizeTeamProjection),
	updated: payload.updated.map(sanitizeTeamProjection),
	removed: [...payload.removed],
});

const isOlderTeamProjection = (
	incoming: AgentTeamSummary,
	existing: AgentTeamSummary,
) => {
	const incomingUpdatedAt = Date.parse(incoming.updatedAt);
	const existingUpdatedAt = Date.parse(existing.updatedAt);
	if (!Number.isFinite(existingUpdatedAt)) {
		return false;
	}
	return (
		!Number.isFinite(incomingUpdatedAt) || incomingUpdatedAt < existingUpdatedAt
	);
};

const applyAgentTeamChanges = (
	teams: Record<string, AgentTeamSummary>,
	payload: AgentTeamsChangedPayload,
) => {
	const sourceMachineId = payload.machineId;
	if (!sourceMachineId) {
		return teams;
	}

	const nextTeams = { ...teams };
	for (const removedId of payload.removed) {
		if (nextTeams[removedId]?.machineId === sourceMachineId) {
			delete nextTeams[removedId];
		}
	}
	for (const added of payload.added) {
		const existing = nextTeams[added.agentTeamId];
		if (
			added.machineId !== sourceMachineId ||
			(existing !== undefined &&
				(existing.machineId !== sourceMachineId ||
					isOlderTeamProjection(added, existing)))
		) {
			continue;
		}
		nextTeams[added.agentTeamId] = added;
	}
	for (const updated of payload.updated) {
		const existing = nextTeams[updated.agentTeamId];
		if (
			updated.machineId !== sourceMachineId ||
			(existing !== undefined &&
				(existing.machineId !== sourceMachineId ||
					isOlderTeamProjection(updated, existing)))
		) {
			continue;
		}
		nextTeams[updated.agentTeamId] = updated;
	}
	return nextTeams;
};

const replaceCoveredTeamSlices = (
	teams: Record<string, AgentTeamSummary>,
	snapshotTeams: AgentTeamSummary[],
	coveredLeaderMachineIds: string[],
) => {
	const covered = new Set(
		coveredLeaderMachineIds.filter((machineId) => machineId.length > 0),
	);
	const coveredSnapshotTeams = snapshotTeams
		.map(sanitizeTeamProjection)
		.filter((team) => covered.has(team.machineId));
	const candidateSourcesById = new Map<string, Set<string>>();
	for (const team of coveredSnapshotTeams) {
		const sources =
			candidateSourcesById.get(team.agentTeamId) ?? new Set<string>();
		sources.add(team.machineId);
		candidateSourcesById.set(team.agentTeamId, sources);
	}
	const conflictedTeamIds = new Set<string>();
	for (const [agentTeamId, sources] of candidateSourcesById) {
		const lastGood = teams[agentTeamId];
		if (
			sources.size > 1 ||
			(lastGood !== undefined && !sources.has(lastGood.machineId))
		) {
			conflictedTeamIds.add(agentTeamId);
		}
	}

	const nextTeams: Record<string, AgentTeamSummary> = {};
	for (const team of Object.values(teams)) {
		if (
			!covered.has(team.machineId) ||
			conflictedTeamIds.has(team.agentTeamId)
		) {
			nextTeams[team.agentTeamId] = team;
		}
	}
	for (const team of coveredSnapshotTeams) {
		if (conflictedTeamIds.has(team.agentTeamId)) {
			continue;
		}
		const existing = nextTeams[team.agentTeamId];
		if (existing !== undefined && existing.machineId !== team.machineId) {
			continue;
		}
		nextTeams[team.agentTeamId] = team;
	}
	return nextTeams;
};

const getNextActiveAgentTeamId = (
	activeAgentTeamId: string | undefined,
	teams: Record<string, AgentTeamSummary>,
) => {
	if (!activeAgentTeamId || teams[activeAgentTeamId]) {
		return activeAgentTeamId;
	}
	return undefined;
};

const partializeTeamState = (state: TeamState): PersistedTeamState => ({
	teams: toTeamRecord(Object.values(state.teams)),
	activeAgentTeamId: state.activeAgentTeamId,
	lastSyncAt: state.lastSyncAt,
});

export const useTeamStore = create<TeamState>()(
	persist(
		(set) => ({
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
			beginAgentTeamProjectionSync: () => {
				let nextEpoch = 0;
				set((state) => {
					nextEpoch = state.projectionSyncEpoch + 1;
					return {
						isProjectionRefreshing: true,
						projectionSyncEpoch: nextEpoch,
						pendingAgentTeamChanges: [],
					};
				});
				return nextEpoch;
			},
			beginSessionProjectionRecovery: () => {
				let nextGeneration = 0;
				set((state) => {
					nextGeneration = state.sessionProjectionRecoveryGeneration + 1;
					return {
						isSessionProjectionRecoveryPending: true,
						isSessionProjectionSnapshotReady: false,
						sessionProjectionRecoveryGeneration: nextGeneration,
					};
				});
				return nextGeneration;
			},
			completeAgentTeamProjectionSync: (
				epoch,
				teams,
				coveredLeaderMachineIds,
			) =>
				set((state) => {
					if (epoch !== state.projectionSyncEpoch) {
						return state;
					}
					let nextTeams = replaceCoveredTeamSlices(
						state.teams,
						teams,
						coveredLeaderMachineIds,
					);
					for (const payload of state.pendingAgentTeamChanges) {
						nextTeams = applyAgentTeamChanges(nextTeams, payload);
					}
					return {
						teams: nextTeams,
						activeAgentTeamId: getNextActiveAgentTeamId(
							state.activeAgentTeamId,
							nextTeams,
						),
						lastSyncAt: new Date().toISOString(),
						isProjectionReady: true,
						isProjectionRefreshing: false,
						isProjectionUnavailable: false,
						pendingAgentTeamChanges: [],
					};
				}),
			markSessionProjectionSnapshotReady: (generation) =>
				set((state) =>
					generation === state.sessionProjectionRecoveryGeneration &&
					state.isSessionProjectionRecoveryPending
						? { isSessionProjectionSnapshotReady: true }
						: state,
				),
			completeSessionProjectionRecovery: (generation) =>
				set((state) =>
					generation === state.sessionProjectionRecoveryGeneration &&
					state.isSessionProjectionRecoveryPending &&
					state.isSessionProjectionSnapshotReady
						? {
								isSessionProjectionRecoveryPending: false,
								isSessionProjectionSnapshotReady: false,
							}
						: state,
				),
			abortSessionProjectionRecovery: (generation) =>
				set((state) =>
					generation === state.sessionProjectionRecoveryGeneration &&
					state.isSessionProjectionRecoveryPending
						? {
								isSessionProjectionRecoveryPending: false,
								isSessionProjectionSnapshotReady: false,
								lastAbortedSessionProjectionRecoveryGeneration: generation,
							}
						: state,
				),
			failAgentTeamProjectionSync: (epoch) =>
				set((state) =>
					epoch === state.projectionSyncEpoch
						? {
								isProjectionRefreshing: false,
								isProjectionUnavailable: !state.isProjectionReady,
								pendingAgentTeamChanges: [],
							}
						: state,
				),
			setActiveAgentTeamId: (value?: string) =>
				set({ activeAgentTeamId: value }),
			setAppError: (value?: ErrorDetail) => set({ appError: value }),
			replaceAgentTeams: (teams) =>
				set((state) => {
					const nextTeams = toTeamRecord(teams);
					return {
						teams: nextTeams,
						activeAgentTeamId: getNextActiveAgentTeamId(
							state.activeAgentTeamId,
							nextTeams,
						),
						lastSyncAt: new Date().toISOString(),
						isProjectionReady: true,
						isProjectionRefreshing: false,
						isProjectionUnavailable: false,
						projectionSyncEpoch: state.projectionSyncEpoch + 1,
						pendingAgentTeamChanges: [],
					};
				}),
			handleAgentTeamsChanged: (payload) =>
				set((state) => {
					if (!payload.machineId) {
						return state;
					}
					const sanitizedPayload = sanitizeAgentTeamChanges(payload);
					const nextTeams = applyAgentTeamChanges(
						state.teams,
						sanitizedPayload,
					);
					return {
						teams: nextTeams,
						activeAgentTeamId: getNextActiveAgentTeamId(
							state.activeAgentTeamId,
							nextTeams,
						),
						lastSyncAt: new Date().toISOString(),
						pendingAgentTeamChanges: state.isProjectionRefreshing
							? [...state.pendingAgentTeamChanges, sanitizedPayload]
							: state.pendingAgentTeamChanges,
					};
				}),
		}),
		{
			name: STORAGE_KEY,
			version: 1,
			partialize: partializeTeamState,
			storage: {
				getItem: (name) => {
					const value = getStorageAdapter().getItem(name);
					if (!value) return null;
					try {
						return JSON.parse(value);
					} catch {
						getStorageAdapter().removeItem(name);
						return null;
					}
				},
				setItem: (name, value) => {
					getStorageAdapter().setItem(name, JSON.stringify(value));
				},
				removeItem: (name) => {
					getStorageAdapter().removeItem(name);
				},
			},
		},
	),
);
