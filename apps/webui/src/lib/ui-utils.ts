import type { TFunction } from "i18next";
import type { ChatSession } from "@/lib/chat-store";

/**
 * Generates a default title for a new session based on the current session count.
 */
export const buildSessionTitle = (
	sessions: ChatSession[],
	translate: TFunction,
): string =>
	translate("session.newTitle", {
		count: sessions.length + 1,
	});

/** Extract the last segment from a file path (cross-platform). */
export const getPathBasename = (path?: string): string | undefined => {
	if (!path) return undefined;
	const trimmed = path.replace(/[\\/]+$/, "");
	if (trimmed.length === 0) return undefined;
	const parts = trimmed.split(/[\\/]/);
	const tail = parts[parts.length - 1];
	return tail && tail.length > 0 ? tail : undefined;
};
