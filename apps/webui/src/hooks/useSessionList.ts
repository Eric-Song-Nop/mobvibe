import type { AgentTeamSummary, TeamMemberSummary } from "@mobvibe/shared";
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import {
	type ChatSession,
	type SessionListEntry,
	toSessionListEntry,
	useChatStore,
} from "@/lib/chat-store";
import { compareSessionsByRecency } from "@/lib/session-order";
import { useTeamStore } from "@/lib/team-store";
import {
	collectWorkspaces,
	type WorkspaceSummary,
} from "@/lib/workspace-utils";

export type TeamSessionMemberEntry = TeamMemberSummary & {
	session?: SessionListEntry;
};

export type TeamSessionListEntry = {
	kind: "agent-team";
	team: AgentTeamSummary;
	members: TeamSessionMemberEntry[];
	workspaceCwd: string;
	updatedAt?: string;
};

export type OrdinarySessionListEntry = {
	kind: "session";
	session: SessionListEntry;
};

export type SidebarSessionListEntry =
	| TeamSessionListEntry
	| OrdinarySessionListEntry;

export type UseSessionListParams = {
	activeSessionId: string | undefined;
	selectedMachineId: string | null;
	selectedWorkspaceByMachine: Record<string, string>;
};

export type UseSessionListReturn = {
	workspaceList: WorkspaceSummary[];
	activeSession: ChatSession | undefined;
	selectedWorkspaceCwd: string | undefined;
	effectiveWorkspaceCwd: string | undefined;
	sessionList: SessionListEntry[];
	sidebarSessionList: SidebarSessionListEntry[];
};

/** Get the workspace group key for a session (worktree sessions group under the source repo) */
const getSessionGroupCwd = (session: ChatSession): string | undefined =>
	session.workspaceRootCwd || session.worktreeSourceCwd || session.cwd;

const serializeWorkspaceSummary = (workspace: WorkspaceSummary) =>
	JSON.stringify(workspace);

const serializeSessionEntry = (session: SessionListEntry) =>
	JSON.stringify(session);

const serializeTeamSummary = (team: AgentTeamSummary) => JSON.stringify(team);

const parseJson = <T>(value: string): T => JSON.parse(value) as T;

const getTeamGroupCwd = (team: AgentTeamSummary): string | undefined =>
	team.workspaceRootCwd || team.members[0]?.worktreeSourceCwd;

const countTeamMemberRawSessionIds = (teams: AgentTeamSummary[]) => {
	const counts = new Map<string, number>();
	for (const team of teams) {
		for (const member of team.members) {
			if (member.sessionId) {
				counts.set(member.sessionId, (counts.get(member.sessionId) ?? 0) + 1);
			}
		}
	}
	return counts;
};

const getEntryUpdatedAt = (entry: SidebarSessionListEntry) =>
	entry.kind === "agent-team"
		? (entry.updatedAt ?? entry.team.updatedAt ?? entry.team.createdAt)
		: (entry.session.updatedAt ?? entry.session.createdAt);

const compareEntriesByRecency = (
	left: SidebarSessionListEntry,
	right: SidebarSessionListEntry,
) => {
	const leftStamp = getEntryUpdatedAt(left) ?? "";
	const rightStamp = getEntryUpdatedAt(right) ?? "";
	if (leftStamp !== rightStamp) {
		return rightStamp.localeCompare(leftStamp);
	}
	return left.kind.localeCompare(right.kind);
};

export function useSessionList({
	activeSessionId,
	selectedMachineId,
	selectedWorkspaceByMachine,
}: UseSessionListParams): UseSessionListReturn {
	const { isProjectionReady, isProjectionUnavailable } = useTeamStore(
		useShallow((state) => ({
			isProjectionReady: state.isProjectionReady,
			isProjectionUnavailable: state.isProjectionUnavailable,
		})),
	);
	const canRenderOrdinaryProjection =
		isProjectionReady || isProjectionUnavailable;
	const teamSignatures = useTeamStore(
		useShallow((state) =>
			state.isProjectionReady || state.isProjectionUnavailable
				? Object.values(state.teams)
						.sort((left, right) =>
							(right.updatedAt ?? right.createdAt).localeCompare(
								left.updatedAt ?? left.createdAt,
							),
						)
						.map(serializeTeamSummary)
				: [],
		),
	);
	const teamList = useMemo(
		() => teamSignatures.map((value) => parseJson<AgentTeamSummary>(value)),
		[teamSignatures],
	);
	const teamMemberRawSessionIdCounts = useMemo(
		() => countTeamMemberRawSessionIds(teamList),
		[teamList],
	);
	const teamOwnedSessionIds = useMemo(
		() => new Set(teamMemberRawSessionIdCounts.keys()),
		[teamMemberRawSessionIdCounts],
	);
	const workspaceTeamList = useMemo(
		() =>
			selectedMachineId
				? teamList.filter((team) => team.machineId === selectedMachineId)
				: [],
		[selectedMachineId, teamList],
	);

	const workspaceSignatures = useChatStore(
		useShallow((state) => {
			if (!canRenderOrdinaryProjection) {
				return [];
			}
			return collectWorkspaces(
				state.sessions,
				selectedMachineId,
				workspaceTeamList,
				teamOwnedSessionIds,
			).map(serializeWorkspaceSummary);
		}),
	);
	const workspaceList = useMemo(
		() =>
			workspaceSignatures.map((value) => parseJson<WorkspaceSummary>(value)),
		[workspaceSignatures],
	);

	const activeSession = useChatStore((state) =>
		activeSessionId ? state.sessions[activeSessionId] : undefined,
	);

	const persistedWorkspaceCwd = selectedMachineId
		? selectedWorkspaceByMachine[selectedMachineId]
		: undefined;
	const selectedWorkspaceCwd =
		persistedWorkspaceCwd &&
		workspaceList.some((workspace) => workspace.cwd === persistedWorkspaceCwd)
			? persistedWorkspaceCwd
			: undefined;

	const effectiveWorkspaceCwd = selectedWorkspaceCwd ?? workspaceList[0]?.cwd;
	const teamMemberSessionIds = useMemo(
		() =>
			Array.from(teamMemberRawSessionIdCounts)
				.flatMap(([sessionId, count]) => (count === 1 ? [sessionId] : []))
				.sort(),
		[teamMemberRawSessionIdCounts],
	);
	const teamMemberSessionSignatures = useChatStore(
		useShallow((state) =>
			teamMemberSessionIds.flatMap((sessionId) => {
				const session = state.sessions[sessionId];
				return session?.agentTeamOwned === true
					? [serializeSessionEntry(toSessionListEntry(session))]
					: [];
			}),
		),
	);
	const teamMemberSessionsById = useMemo(() => {
		const sessionsById = new Map<string, SessionListEntry>();
		for (const signature of teamMemberSessionSignatures) {
			const session = parseJson<SessionListEntry>(signature);
			sessionsById.set(session.sessionId, session);
		}
		return sessionsById;
	}, [teamMemberSessionSignatures]);

	const sessionSignatures = useChatStore(
		useShallow((state) => {
			if (!canRenderOrdinaryProjection || !selectedMachineId) {
				return [];
			}
			const filtered = Object.values(state.sessions).filter((session) => {
				if (
					session.agentTeamOwned ||
					teamOwnedSessionIds.has(session.sessionId)
				) {
					return false;
				}
				if (session.machineId !== selectedMachineId) {
					return false;
				}
				if (effectiveWorkspaceCwd) {
					return getSessionGroupCwd(session) === effectiveWorkspaceCwd;
				}
				return true;
			});
			return filtered
				.sort(compareSessionsByRecency)
				.map((session) => serializeSessionEntry(toSessionListEntry(session)));
		}),
	);
	const sessionList = useMemo(
		() => sessionSignatures.map((value) => parseJson<SessionListEntry>(value)),
		[sessionSignatures],
	);

	const sidebarSessionList = useMemo(() => {
		const ordinaryEntries: OrdinarySessionListEntry[] = sessionList.map(
			(session) => ({
				kind: "session",
				session,
			}),
		);

		const teamEntries: TeamSessionListEntry[] = teamList.map((team) => {
			const workspaceCwd = getTeamGroupCwd(team) ?? team.workspaceRootCwd;
			const members = team.members.map((member) => {
				return {
					...member,
					session: member.sessionId
						? teamMemberSessionsById.get(member.sessionId)
						: undefined,
				};
			});
			return {
				kind: "agent-team" as const,
				team,
				members,
				workspaceCwd,
				updatedAt: team.updatedAt ?? team.createdAt,
			};
		});

		return [...teamEntries, ...ordinaryEntries].sort(compareEntriesByRecency);
	}, [sessionList, teamList, teamMemberSessionsById]);

	return {
		workspaceList,
		activeSession,
		selectedWorkspaceCwd,
		effectiveWorkspaceCwd,
		sessionList,
		sidebarSessionList,
	};
}
