import type { ChatSession } from "@mobvibe/core";
import type { TFunction } from "i18next";

/**
 * Maps a session state to a badge variant.
 * Consolidated from App.tsx and SessionSidebar.tsx.
 */
export const getStatusVariant = (
	state?: string,
): "default" | "destructive" | "secondary" | "outline" => {
	switch (state) {
		case "ready":
			return "default";
		case "error":
			return "destructive";
		case "connecting":
			return "secondary";
		case "stopped":
		case "idle":
			return "outline";
		default:
			return "outline";
	}
};

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
