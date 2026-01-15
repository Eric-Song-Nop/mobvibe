import type { ChatSession } from "./chat-store";

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
export const buildSessionTitle = (sessions: ChatSession[]): string =>
	`对话 ${sessions.length + 1}`;
