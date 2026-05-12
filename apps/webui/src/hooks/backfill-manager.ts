import type { ChatStoreActions } from "@/hooks/useSessionMutations";
import type { SessionEvent } from "@/lib/acp";
import type {
	ChatMessage,
	ChatSession,
	SessionRestoreSnapshot,
} from "@/lib/chat-store";

export type SessionSyncBackup = {
	messages: ChatMessage[];
	snapshot: SessionRestoreSnapshot;
};

export function createSessionSyncBackup(
	session: ChatSession,
): SessionSyncBackup {
	return {
		messages: [...session.messages],
		snapshot: {
			lastAppliedSeq: session.lastAppliedSeq,
			revision: session.revision,
			terminalOutputs: { ...session.terminalOutputs },
			streamingMessageId: session.streamingMessageId,
			streamingMessageRole: session.streamingMessageRole,
			streamingThoughtId: session.streamingThoughtId,
		},
	};
}

export function restoreBackupIfSessionWasReset({
	store,
	sessionId,
	backup,
}: {
	store: {
		sessions: Record<string, ChatSession>;
		restoreSessionMessages: ChatStoreActions["restoreSessionMessages"];
	};
	sessionId: string;
	backup: SessionSyncBackup;
}) {
	const failedSession = store.sessions[sessionId];
	if (
		failedSession &&
		failedSession.messages.length === 0 &&
		(failedSession.lastAppliedSeq ?? 0) === 0
	) {
		store.restoreSessionMessages(sessionId, backup.messages, backup.snapshot);
	}
}

export function applyContiguousPendingEvents({
	pending,
	revision,
	lastAppliedSeq,
	applyEvent,
	updateCursor,
}: {
	pending: SessionEvent[];
	revision?: number;
	lastAppliedSeq: number;
	applyEvent: (event: SessionEvent) => void;
	updateCursor: (sessionId: string, revision: number, seq: number) => void;
}) {
	const sorted = pending
		.filter((event) =>
			revision === undefined ? true : event.revision === revision,
		)
		.sort((a, b) => a.seq - b.seq);

	let lastSeq = lastAppliedSeq;
	for (const event of sorted) {
		if (event.seq <= lastSeq) continue;
		if (event.seq !== lastSeq + 1) break;
		applyEvent(event);
		lastSeq = event.seq;
		updateCursor(event.sessionId, event.revision, event.seq);
	}
}
