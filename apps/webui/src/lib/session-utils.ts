import type { ChatSession } from "@/lib/chat-store";

export type SessionDisplayPhase =
	| "active"
	| "loading"
	| "history"
	| "error"
	| "detached";

export type SessionMutationsSnapshot = {
	loadSessionPending: boolean;
	loadSessionVariables?: { sessionId?: string };
	reloadSessionPending: boolean;
	reloadSessionVariables?: { sessionId?: string };
};

export function getSessionDisplayStatus(
	session: ChatSession,
	mutations: SessionMutationsSnapshot,
): SessionDisplayPhase {
	if (session.error) {
		return "error";
	}

	if (session.detachedReason) {
		return "detached";
	}

	const isLoading =
		session.isLoading ||
		(mutations.loadSessionPending &&
			mutations.loadSessionVariables?.sessionId === session.sessionId) ||
		(mutations.reloadSessionPending &&
			mutations.reloadSessionVariables?.sessionId === session.sessionId);

	if (isLoading) {
		return "loading";
	}

	if (session.isAttached) {
		return "active";
	}

	return "history";
}
