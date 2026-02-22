import { useMemo } from "react";
import type { ChatSession } from "@/lib/chat-store";
import {
	collectWorkspaces,
	type WorkspaceSummary,
} from "@/lib/workspace-utils";

export type UseSessionListParams = {
	sessions: Record<string, ChatSession>;
	activeSessionId: string | undefined;
	selectedMachineId: string | null;
	selectedWorkspaceByMachine: Record<string, string>;
};

export type UseSessionListReturn = {
	workspaceList: WorkspaceSummary[];
	activeSession: ChatSession | undefined;
	activeWorkspaceCwd: string | undefined;
	selectedWorkspaceCwd: string | undefined;
	effectiveWorkspaceCwd: string | undefined;
	sessionList: ChatSession[];
};

/** Get the workspace group key for a session (worktree sessions group under the source repo) */
const getSessionGroupCwd = (session: ChatSession): string | undefined =>
	session.worktreeSourceCwd || session.cwd;

export function useSessionList({
	sessions,
	activeSessionId,
	selectedMachineId,
	selectedWorkspaceByMachine,
}: UseSessionListParams): UseSessionListReturn {
	const workspaceList = useMemo(
		() => collectWorkspaces(sessions, selectedMachineId),
		[sessions, selectedMachineId],
	);

	const activeSession = activeSessionId ? sessions[activeSessionId] : undefined;

	const activeWorkspaceCwd =
		activeSession?.machineId === selectedMachineId
			? getSessionGroupCwd(activeSession)
			: undefined;

	const selectedWorkspaceCwd = selectedMachineId
		? selectedWorkspaceByMachine[selectedMachineId]
		: undefined;

	const effectiveWorkspaceCwd =
		activeWorkspaceCwd ?? selectedWorkspaceCwd ?? workspaceList[0]?.cwd;

	const sessionList = useMemo(() => {
		const allSessions = Object.values(sessions);
		const filtered = selectedMachineId
			? allSessions.filter((s) => {
					if (s.machineId !== selectedMachineId) {
						return false;
					}
					if (effectiveWorkspaceCwd) {
						return getSessionGroupCwd(s) === effectiveWorkspaceCwd;
					}
					return true;
				})
			: [];
		return filtered.sort((left, right) => {
			const leftStamp = left.updatedAt ?? left.createdAt ?? "";
			const rightStamp = right.updatedAt ?? right.createdAt ?? "";
			return rightStamp.localeCompare(leftStamp);
		});
	}, [effectiveWorkspaceCwd, sessions, selectedMachineId]);

	return {
		workspaceList,
		activeSession,
		activeWorkspaceCwd,
		selectedWorkspaceCwd,
		effectiveWorkspaceCwd,
		sessionList,
	};
}
