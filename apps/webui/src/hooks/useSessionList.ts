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

const getTeamOwnedSessionIds = (teams: AgentTeamSummary[]) => {
	const owned = new Set<string>();
	for (const team of teams) {
		for (const member of team.members) {
			if (member.sessionId) {
				owned.add(member.sessionId);
			}
		}
	}
	return owned;
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
	const teamSignatures = useTeamStore(
		useShallow((state) => {
			if (!selectedMachineId) {
				return [];
			}
			return Object.values(state.teams)
				.filter((team) => team.machineId === selectedMachineId)
				.sort((left, right) =>
					(right.updatedAt ?? right.createdAt).localeCompare(
						left.updatedAt ?? left.createdAt,
					),
				)
				.map(serializeTeamSummary);
		}),
	);
	const teamList = useMemo(
		() => teamSignatures.map((value) => parseJson<AgentTeamSummary>(value)),
		[teamSignatures],
	);

	const workspaceSignatures = useChatStore(
		useShallow((state) =>
			collectWorkspaces(state.sessions, selectedMachineId, teamList).map(
				serializeWorkspaceSummary,
			),
		),
	);
	const workspaceList = useMemo(
		() =>
			workspaceSignatures.map((value) => parseJson<WorkspaceSummary>(value)),
		[workspaceSignatures],
	);

	const activeSession = useChatStore((state) =>
		activeSessionId ? state.sessions[activeSessionId] : undefined,
	);

	const selectedWorkspaceCwd = selectedMachineId
		? selectedWorkspaceByMachine[selectedMachineId]
		: undefined;

	const effectiveWorkspaceCwd = selectedWorkspaceCwd ?? workspaceList[0]?.cwd;
	const teamOwnedSessionIds = useMemo(
		() => getTeamOwnedSessionIds(teamList),
		[teamList],
	);

	const sessionSignatures = useChatStore(
		useShallow((state) => {
			if (!selectedMachineId) {
				return [];
			}
			const filtered = Object.values(state.sessions).filter((session) => {
				if (teamOwnedSessionIds.has(session.sessionId)) {
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

		const teamEntries: TeamSessionListEntry[] = teamList
			.filter((team) => {
				const workspaceCwd = getTeamGroupCwd(team);
				if (!workspaceCwd) {
					return false;
				}
				return effectiveWorkspaceCwd
					? workspaceCwd === effectiveWorkspaceCwd
					: true;
			})
			.map((team) => {
				const workspaceCwd = getTeamGroupCwd(team) ?? team.workspaceRootCwd;
				const members = team.members.map((member) => {
					const session = member.sessionId
						? useChatStore.getState().sessions[member.sessionId]
						: undefined;
					return {
						...member,
						session: session ? toSessionListEntry(session) : undefined,
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
	}, [effectiveWorkspaceCwd, sessionList, teamList]);

	return {
		workspaceList,
		activeSession,
		selectedWorkspaceCwd,
		effectiveWorkspaceCwd,
		sessionList,
		sidebarSessionList,
	};
}
