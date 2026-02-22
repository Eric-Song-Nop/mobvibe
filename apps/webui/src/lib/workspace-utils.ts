import type { ChatSession } from "@/lib/chat-store";

export type WorkspaceSummary = {
	machineId: string;
	cwd: string;
	label: string;
	updatedAt?: string;
	/** Number of worktree sessions under this workspace */
	worktreeSessions: number;
};

const getWorkspaceLabel = (cwd: string): string => {
	const parts = cwd.split(/[\\/]/).filter(Boolean);
	return parts.length > 0 ? parts[parts.length - 1] : cwd;
};

const compareWorkspaceUpdatedAt = (left?: string, right?: string) => {
	const leftStamp = left ?? "";
	const rightStamp = right ?? "";
	return rightStamp.localeCompare(leftStamp);
};

/**
 * Collect unique workspaces from sessions.
 * Groups sessions by `worktreeSourceCwd || cwd` so that worktree sessions
 * and their parent repo sessions appear under one workspace entry.
 */
export const collectWorkspaces = (
	sessions: Record<string, ChatSession>,
	machineId?: string | null,
): WorkspaceSummary[] => {
	const byCwd = new Map<string, WorkspaceSummary>();

	for (const session of Object.values(sessions)) {
		if (!session.machineId || !session.cwd) {
			continue;
		}
		if (machineId && session.machineId !== machineId) {
			continue;
		}

		// Group by original repo cwd for worktree sessions
		const groupKey = session.worktreeSourceCwd || session.cwd;
		const updatedAt = session.updatedAt ?? session.createdAt;
		const isWorktreeSession = Boolean(session.worktreeSourceCwd);
		const existing = byCwd.get(groupKey);

		if (!existing) {
			byCwd.set(groupKey, {
				machineId: session.machineId,
				cwd: groupKey,
				label: getWorkspaceLabel(groupKey),
				updatedAt,
				worktreeSessions: isWorktreeSession ? 1 : 0,
			});
			continue;
		}

		if (isWorktreeSession) {
			existing.worktreeSessions++;
		}

		if (compareWorkspaceUpdatedAt(existing.updatedAt, updatedAt) > 0) {
			byCwd.set(groupKey, {
				...existing,
				updatedAt,
			});
		}
	}

	return Array.from(byCwd.values()).sort((left, right) =>
		compareWorkspaceUpdatedAt(left.updatedAt, right.updatedAt),
	);
};
