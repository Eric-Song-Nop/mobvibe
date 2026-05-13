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
					};
				}),
			handleAgentTeamsChanged: (payload) =>
				set((state) => {
					const nextTeams = { ...state.teams };
					for (const removedId of payload.removed) {
						delete nextTeams[removedId];
					}
					for (const added of payload.added) {
						nextTeams[added.agentTeamId] = sanitizeTeamProjection(added);
					}
					for (const updated of payload.updated) {
						nextTeams[updated.agentTeamId] = sanitizeTeamProjection(updated);
					}
					return {
						teams: nextTeams,
						activeAgentTeamId: getNextActiveAgentTeamId(
							state.activeAgentTeamId,
							nextTeams,
						),
						lastSyncAt: new Date().toISOString(),
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
