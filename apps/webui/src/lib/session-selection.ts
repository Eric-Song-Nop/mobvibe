import type { ChatSession } from "@/lib/chat-store";

type SessionSelectionTarget = Pick<
	ChatSession,
	"isAttached" | "isLoading" | "messages" | "terminalOutputs"
>;

export const hasCachedSessionHistory = (
	session: Pick<ChatSession, "messages" | "terminalOutputs">,
): boolean =>
	session.messages.length > 0 ||
	Object.keys(session.terminalOutputs).length > 0;

export const shouldActivateSessionOnSelect = (
	session: SessionSelectionTarget,
): boolean => {
	if (session.isAttached || session.isLoading) {
		return false;
	}

	return !hasCachedSessionHistory(session);
};
