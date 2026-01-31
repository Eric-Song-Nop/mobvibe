import type { ChatSession } from "@mobvibe/core";
import type { TFunction } from "i18next";

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
