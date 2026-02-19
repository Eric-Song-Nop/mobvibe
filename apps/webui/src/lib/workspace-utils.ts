import type { ChatSession } from "@/lib/chat-store";

export type WorkspaceSummary = {
	machineId: string;
	cwd: string;
	label: string;
	updatedAt?: string;
};

export const getWorkspaceLabel = (cwd: string): string => {
	const parts = cwd.split(/[\\/]/).filter(Boolean);
	return parts.length > 0 ? parts[parts.length - 1] : cwd;
};

const compareWorkspaceUpdatedAt = (left?: string, right?: string) => {
	const leftStamp = left ?? "";
	const rightStamp = right ?? "";
	return rightStamp.localeCompare(leftStamp);
};

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
		const updatedAt = session.updatedAt ?? session.createdAt;
		const existing = byCwd.get(session.cwd);
		if (!existing) {
			byCwd.set(session.cwd, {
				machineId: session.machineId,
				cwd: session.cwd,
				label: getWorkspaceLabel(session.cwd),
				updatedAt,
			});
			continue;
		}

		if (compareWorkspaceUpdatedAt(existing.updatedAt, updatedAt) > 0) {
			byCwd.set(session.cwd, {
				...existing,
				updatedAt,
			});
		}
	}

	return Array.from(byCwd.values()).sort((left, right) =>
		compareWorkspaceUpdatedAt(left.updatedAt, right.updatedAt),
	);
};
