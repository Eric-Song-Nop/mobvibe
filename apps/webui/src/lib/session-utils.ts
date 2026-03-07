import type { SessionListEntry } from "@/lib/chat-store";

export type SessionDisplayPhase =
	| "active"
	| "loading"
	| "history"
	| "error"
	| "detached"
	| "creating";

export type SessionMutationsSnapshot = {
	loadSessionPending: boolean;
	loadSessionVariables?: { sessionId?: string };
	reloadSessionPending: boolean;
	reloadSessionVariables?: { sessionId?: string };
};

export function getSessionDisplayStatus(
	session: SessionListEntry,
	mutations: SessionMutationsSnapshot,
): SessionDisplayPhase {
	// Creating status has highest priority
	if (session.isCreating) {
		return "creating";
	}

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
