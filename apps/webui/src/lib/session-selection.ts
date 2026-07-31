import type { ChatSession } from "@/lib/chat-store";

type SessionSelectionTarget = Pick<
	ChatSession,
	"isAttached" | "isLoading" | "messages" | "terminalOutputs"
>;

type SidebarSessionAvailabilityEntry =
	| {
			kind: "session";
			session: { sessionId: string };
	  }
	| {
			kind: "agent-team";
			members: ReadonlyArray<{
				sessionId?: string;
				session?: { sessionId: string };
			}>;
	  };

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

export const sidebarEntryContainsAvailableSession = (
	entry: SidebarSessionAvailabilityEntry,
	sessionId: string,
): boolean => {
	if (entry.kind === "session") {
		return entry.session.sessionId === sessionId;
	}
	return entry.members.some(
		(member) => member.session?.sessionId === sessionId,
	);
};
