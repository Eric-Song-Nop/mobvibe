import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import {
	type ChatSession,
	type SessionListEntry,
	toSessionListEntry,
	useChatStore,
} from "@/lib/chat-store";
import { compareSessionsByRecency } from "@/lib/session-order";
import {
	collectWorkspaces,
	type WorkspaceSummary,
} from "@/lib/workspace-utils";

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
};

/** Get the workspace group key for a session (worktree sessions group under the source repo) */
const getSessionGroupCwd = (session: ChatSession): string | undefined =>
	session.workspaceRootCwd || session.worktreeSourceCwd || session.cwd;

const serializeWorkspaceSummary = (workspace: WorkspaceSummary) =>
	JSON.stringify(workspace);

const serializeSessionEntry = (session: SessionListEntry) =>
	JSON.stringify(session);

const parseJson = <T>(value: string): T => JSON.parse(value) as T;

export function useSessionList({
	activeSessionId,
	selectedMachineId,
	selectedWorkspaceByMachine,
}: UseSessionListParams): UseSessionListReturn {
	const workspaceSignatures = useChatStore(
		useShallow((state) =>
			collectWorkspaces(state.sessions, selectedMachineId).map(
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

	const sessionSignatures = useChatStore(
		useShallow((state) => {
			if (!selectedMachineId) {
				return [];
			}
			const filtered = Object.values(state.sessions).filter((session) => {
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

	return {
		workspaceList,
		activeSession,
		selectedWorkspaceCwd,
		effectiveWorkspaceCwd,
		sessionList,
	};
}
