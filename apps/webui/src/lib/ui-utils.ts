import type { TFunction } from "i18next";
/**
 * Generates a default title for a new session based on the current session count.
 */
export const buildSessionTitle = (
	sessions: { length: number },
	translate: TFunction,
): string =>
	translate("session.newTitle", {
		count: sessions.length + 1,
	});

/** Format an ISO date string as a relative time (e.g. "2h ago"). */
export const formatRelativeTime = (isoString: string): string => {
	const diff = Date.now() - new Date(isoString).getTime();
	const minutes = Math.floor(diff / 60000);
	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	if (days < 30) return `${days}d ago`;
	return `${Math.floor(days / 30)}mo ago`;
};

/** Extract the last segment from a file path (cross-platform). */
export const getPathBasename = (path?: string): string | undefined => {
	if (!path) return undefined;
	const trimmed = path.replace(/[\\/]+$/, "");
	if (trimmed.length === 0) return undefined;
	const parts = trimmed.split(/[\\/]/);
	const tail = parts[parts.length - 1];
	return tail && tail.length > 0 ? tail : undefined;
};
