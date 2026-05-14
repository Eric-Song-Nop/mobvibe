import type { AgentTeamSummary } from "@mobvibe/shared";
import type { ChatSession } from "@/lib/chat-store";
import { compareTimestampsByRecency } from "@/lib/session-order";
import { getPathBasename } from "@/lib/ui-utils";

export type WorkspaceSummary = {
	machineId: string;
	cwd: string;
	label: string;
	updatedAt?: string;
};

/**
 * Collect unique workspaces from sessions.
 * Groups sessions by `workspaceRootCwd || worktreeSourceCwd || cwd` so that
 * worktree sessions, subdirectory sessions, and their parent repo sessions
 * appear under one workspace entry.
 */
export const collectWorkspaces = (
	sessions: Record<string, ChatSession>,
	machineId?: string | null,
	teams: AgentTeamSummary[] = [],
): WorkspaceSummary[] => {
	const byCwd = new Map<string, WorkspaceSummary>();

	for (const session of Object.values(sessions)) {
		if (!session.machineId || !session.cwd) {
			continue;
		}
		if (machineId && session.machineId !== machineId) {
			continue;
		}

		const groupKey =
			session.workspaceRootCwd || session.worktreeSourceCwd || session.cwd;
		const updatedAt = session.updatedAt ?? session.createdAt;
		const existing = byCwd.get(groupKey);

		if (!existing) {
			byCwd.set(groupKey, {
				machineId: session.machineId,
				cwd: groupKey,
				label: getPathBasename(groupKey) ?? groupKey,
				updatedAt,
			});
			continue;
		}

		if (compareTimestampsByRecency(existing.updatedAt, updatedAt) > 0) {
			byCwd.set(groupKey, {
				...existing,
				updatedAt,
			});
		}
	}

	for (const team of teams) {
		if (!team.machineId || !team.workspaceRootCwd) {
			continue;
		}
		if (machineId && team.machineId !== machineId) {
			continue;
		}

		const groupKey = team.workspaceRootCwd;
		const updatedAt = team.updatedAt ?? team.createdAt;
		const existing = byCwd.get(groupKey);

		if (!existing) {
			byCwd.set(groupKey, {
				machineId: team.machineId,
				cwd: groupKey,
				label: getPathBasename(groupKey) ?? groupKey,
				updatedAt,
			});
			continue;
		}

		if (compareTimestampsByRecency(existing.updatedAt, updatedAt) > 0) {
			byCwd.set(groupKey, {
				...existing,
				updatedAt,
			});
		}
	}

	return Array.from(byCwd.values()).sort((left, right) =>
		compareTimestampsByRecency(left.updatedAt, right.updatedAt),
	);
};
