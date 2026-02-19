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
