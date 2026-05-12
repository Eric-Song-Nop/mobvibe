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

/** Format an ISO date string as localized relative time. */
export const formatRelativeTime = (
	isoString: string,
	{
		locale,
		justNow,
	}: {
		locale: string;
		justNow: string;
	},
): string => {
	const diffMs = Date.now() - new Date(isoString).getTime();
	const absMinutes = Math.floor(Math.abs(diffMs) / 60000);
	if (absMinutes < 1) return justNow;

	const direction = diffMs >= 0 ? -1 : 1;
	const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
	if (absMinutes < 60) {
		return formatter.format(direction * absMinutes, "minute");
	}

	const absHours = Math.floor(absMinutes / 60);
	if (absHours < 24) {
		return formatter.format(direction * absHours, "hour");
	}

	const absDays = Math.floor(absHours / 24);
	if (absDays < 30) {
		return formatter.format(direction * absDays, "day");
	}

	return formatter.format(direction * Math.floor(absDays / 30), "month");
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
