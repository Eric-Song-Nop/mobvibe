import { beforeEach, describe, expect, it } from "vitest";
import { useChatStore } from "../chat-store";

/**
 * Reset Zustand store before each test.
 * We call setState directly to avoid side-effects from persist middleware.
 */
const resetStore = () => {
	useChatStore.setState({
		sessions: {},
		activeSessionId: undefined,
		lastCreatedCwd: {},
		appError: undefined,
		syncStatus: "idle",
		lastSyncAt: undefined,
	});
};

describe("chat-store", () => {
	beforeEach(resetStore);

	// ---------------------------------------------------------------------------
	// updateSessionCursor — monotonic guard
	// ---------------------------------------------------------------------------
	describe("updateSessionCursor (monotonic)", () => {
		it("advances cursor within same revision", () => {
			const { createLocalSession, updateSessionCursor } =
				useChatStore.getState();
			createLocalSession("s1");
			updateSessionCursor("s1", 1, 5);

			const session = useChatStore.getState().sessions.s1;
			expect(session.revision).toBe(1);
			expect(session.lastAppliedSeq).toBe(5);
		});

		it("rejects seq regression within same revision", () => {
			const { createLocalSession, updateSessionCursor } =
				useChatStore.getState();
			createLocalSession("s1");
			updateSessionCursor("s1", 1, 10);
			updateSessionCursor("s1", 1, 5);

			const session = useChatStore.getState().sessions.s1;
			expect(session.lastAppliedSeq).toBe(10);
		});

		it("rejects same seq within same revision", () => {
			const { createLocalSession, updateSessionCursor } =
				useChatStore.getState();
			createLocalSession("s1");
			updateSessionCursor("s1", 1, 7);
			updateSessionCursor("s1", 1, 7);

			expect(useChatStore.getState().sessions.s1.lastAppliedSeq).toBe(7);
		});

		it("allows cursor update when revision changes", () => {
			const { createLocalSession, updateSessionCursor } =
				useChatStore.getState();
			createLocalSession("s1");
			updateSessionCursor("s1", 1, 10);
			// Revision bump → seq can go back to 3
			updateSessionCursor("s1", 2, 3);

			const session = useChatStore.getState().sessions.s1;
			expect(session.revision).toBe(2);
			expect(session.lastAppliedSeq).toBe(3);
		});

		it("allows first cursor set when revision was undefined", () => {
			const { createLocalSession, updateSessionCursor } =
				useChatStore.getState();
			createLocalSession("s1");
			// New session → revision is undefined
			expect(useChatStore.getState().sessions.s1.revision).toBeUndefined();

			updateSessionCursor("s1", 1, 0);
			const session = useChatStore.getState().sessions.s1;
			expect(session.revision).toBe(1);
			expect(session.lastAppliedSeq).toBe(0);
		});
	});

	// ---------------------------------------------------------------------------
	// restoreSessionMessages — revision support
	// ---------------------------------------------------------------------------
	describe("restoreSessionMessages (revision)", () => {
		it("restores messages and cursor including revision", () => {
			const { createLocalSession, restoreSessionMessages } =
				useChatStore.getState();
			createLocalSession("s1");

			const msgs = [
				{
					id: "m1",
					role: "user" as const,
					kind: "text" as const,
					content: "hello",
					contentBlocks: [{ type: "text" as const, text: "hello" }],
					createdAt: "2024-01-01T00:00:00Z",
					isStreaming: false,
				},
			];

			restoreSessionMessages("s1", msgs, {
				lastAppliedSeq: 5,
				revision: 3,
			});

			const session = useChatStore.getState().sessions.s1;
			expect(session.messages).toHaveLength(1);
			expect(session.lastAppliedSeq).toBe(5);
			expect(session.revision).toBe(3);
		});

		it("restores without cursor (backward compat)", () => {
			const { createLocalSession, restoreSessionMessages } =
				useChatStore.getState();
			createLocalSession("s1");

			restoreSessionMessages("s1", []);
			const session = useChatStore.getState().sessions.s1;
			expect(session.messages).toEqual([]);
			// revision / lastAppliedSeq unchanged from defaults
		});
	});

	// ---------------------------------------------------------------------------
	// confirmOrAppendUserMessage
	// ---------------------------------------------------------------------------
	describe("confirmOrAppendUserMessage", () => {
		it("confirms a provisional user message", () => {
			const { createLocalSession, addUserMessage, confirmOrAppendUserMessage } =
				useChatStore.getState();
			createLocalSession("s1");
			addUserMessage("s1", "hello world", { provisional: true });

			expect(useChatStore.getState().sessions.s1.messages[0]).toHaveProperty(
				"provisional",
				true,
			);

			confirmOrAppendUserMessage("s1", "hello world");

			const msg = useChatStore.getState().sessions.s1.messages[0];
			expect(msg).toHaveProperty("provisional", false);
			// Should NOT add a second message
			expect(useChatStore.getState().sessions.s1.messages).toHaveLength(1);
		});

		it("appends new message when no provisional exists (backfill)", () => {
			const { createLocalSession, confirmOrAppendUserMessage } =
				useChatStore.getState();
			createLocalSession("s1");

			confirmOrAppendUserMessage("s1", "backfill message");

			const msgs = useChatStore.getState().sessions.s1.messages;
			expect(msgs).toHaveLength(1);
			expect(msgs[0].role).toBe("user");
			expect(msgs[0].kind).toBe("text");
			if (msgs[0].kind === "text") {
				expect(msgs[0].content).toBe("backfill message");
				expect(msgs[0].provisional).toBeUndefined();
			}
		});

		it("stops searching at assistant boundary", () => {
			const store = useChatStore.getState();
			store.createLocalSession("s1");
			// Add provisional user message, then assistant, then another user
			store.addUserMessage("s1", "first", { provisional: true });
			store.appendAssistantChunk("s1", "response");
			store.finalizeAssistantMessage("s1");

			// Now confirmOrAppendUserMessage should not find the provisional
			// (it's before the assistant boundary)
			store.confirmOrAppendUserMessage("s1", "new from backfill");

			const msgs = useChatStore.getState().sessions.s1.messages;
			// Should have 3: provisional user, assistant, new user
			expect(msgs).toHaveLength(3);
			// First message should still be provisional
			if (msgs[0].kind === "text") {
				expect(msgs[0].provisional).toBe(true);
			}
		});
	});

	// ---------------------------------------------------------------------------
	// addUserMessage — provisional flag
	// ---------------------------------------------------------------------------
	describe("addUserMessage (provisional)", () => {
		it("sets provisional: true when specified", () => {
			const { createLocalSession, addUserMessage } = useChatStore.getState();
			createLocalSession("s1");
			addUserMessage("s1", "hello", { provisional: true });

			const msg = useChatStore.getState().sessions.s1.messages[0];
			expect(msg.kind).toBe("text");
			if (msg.kind === "text") {
				expect(msg.provisional).toBe(true);
			}
		});

		it("defaults provisional to false", () => {
			const { createLocalSession, addUserMessage } = useChatStore.getState();
			createLocalSession("s1");
			addUserMessage("s1", "hello");

			const msg = useChatStore.getState().sessions.s1.messages[0];
			if (msg.kind === "text") {
				expect(msg.provisional).toBe(false);
			}
		});
	});
});
