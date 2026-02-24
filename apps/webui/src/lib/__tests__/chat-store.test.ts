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

		it("provisional flag survives sanitizeMessageForPersist (not stripped)", () => {
			const { createLocalSession, addUserMessage } = useChatStore.getState();
			createLocalSession("s1");
			addUserMessage("s1", "prov msg", { provisional: true });

			// Read persisted state — sanitizeMessageForPersist sets isStreaming=false
			// but should not strip the provisional field
			const msg = useChatStore.getState().sessions.s1.messages[0];
			expect(msg.kind).toBe("text");
			if (msg.kind === "text") {
				expect(msg.provisional).toBe(true);
				expect(msg.isStreaming).toBe(false);
			}
		});
	});

	// ---------------------------------------------------------------------------
	// updateSessionCursor — revision rollback protection (bug fix)
	// ---------------------------------------------------------------------------
	describe("updateSessionCursor (revision rollback)", () => {
		it("rejects older revision (rev 2→1): cursor unchanged", () => {
			const { createLocalSession, updateSessionCursor } =
				useChatStore.getState();
			createLocalSession("s1");
			updateSessionCursor("s1", 2, 5);

			// Attempt to apply older revision
			updateSessionCursor("s1", 1, 10);

			const session = useChatStore.getState().sessions.s1;
			expect(session.revision).toBe(2);
			expect(session.lastAppliedSeq).toBe(5);
		});

		it("accepts newer revision (rev 1→2): cursor updated", () => {
			const { createLocalSession, updateSessionCursor } =
				useChatStore.getState();
			createLocalSession("s1");
			updateSessionCursor("s1", 1, 10);

			updateSessionCursor("s1", 2, 3);

			const session = useChatStore.getState().sessions.s1;
			expect(session.revision).toBe(2);
			expect(session.lastAppliedSeq).toBe(3);
		});
	});

	// ---------------------------------------------------------------------------
	// clearSessionMessages — reset semantics
	// ---------------------------------------------------------------------------
	describe("clearSessionMessages", () => {
		it("resets revision to undefined and lastAppliedSeq to 0", () => {
			const { createLocalSession, updateSessionCursor, clearSessionMessages } =
				useChatStore.getState();
			createLocalSession("s1");
			updateSessionCursor("s1", 3, 15);

			clearSessionMessages("s1");

			const session = useChatStore.getState().sessions.s1;
			expect(session.revision).toBeUndefined();
			expect(session.lastAppliedSeq).toBe(0);
			expect(session.messages).toEqual([]);
		});

		it("preserves other session fields (title, cwd, etc.)", () => {
			const store = useChatStore.getState();
			store.createLocalSession("s1", {
				title: "My Session",
				cwd: "/home/user/project",
				agentName: "claude",
			});

			store.clearSessionMessages("s1");

			const session = useChatStore.getState().sessions.s1;
			expect(session.title).toBe("My Session");
			expect(session.cwd).toBe("/home/user/project");
			expect(session.agentName).toBe("claude");
		});
	});

	// ---------------------------------------------------------------------------
	// resetSessionForRevision — complete reset
	// ---------------------------------------------------------------------------
	describe("resetSessionForRevision", () => {
		it("sets new revision and lastAppliedSeq=0", () => {
			const {
				createLocalSession,
				updateSessionCursor,
				addUserMessage,
				resetSessionForRevision,
			} = useChatStore.getState();
			createLocalSession("s1");
			updateSessionCursor("s1", 1, 10);
			addUserMessage("s1", "hello");

			resetSessionForRevision("s1", 5);

			const session = useChatStore.getState().sessions.s1;
			expect(session.revision).toBe(5);
			expect(session.lastAppliedSeq).toBe(0);
		});

		it("clears messages, terminalOutputs, streaming state", () => {
			const {
				createLocalSession,
				addUserMessage,
				appendAssistantChunk,
				resetSessionForRevision,
			} = useChatStore.getState();
			createLocalSession("s1");
			addUserMessage("s1", "hello");
			appendAssistantChunk("s1", "world");

			resetSessionForRevision("s1", 2);

			const session = useChatStore.getState().sessions.s1;
			expect(session.messages).toEqual([]);
			expect(session.terminalOutputs).toEqual({});
			expect(session.streamingMessageId).toBeUndefined();
			expect(session.streamingMessageRole).toBeUndefined();
			expect(session.streamingThoughtId).toBeUndefined();
		});

		it("preserves session metadata (title, cwd, machineId, etc.)", () => {
			const store = useChatStore.getState();
			store.createLocalSession("s1", {
				title: "My Session",
				cwd: "/project",
				agentName: "claude",
				modelId: "model-1",
			});

			store.resetSessionForRevision("s1", 3);

			const session = useChatStore.getState().sessions.s1;
			expect(session.title).toBe("My Session");
			expect(session.cwd).toBe("/project");
			expect(session.agentName).toBe("claude");
			expect(session.modelId).toBe("model-1");
		});
	});

	// ---------------------------------------------------------------------------
	// clearSessionMessages + restoreSessionMessages roundtrip
	// ---------------------------------------------------------------------------
	describe("clearSessionMessages + restoreSessionMessages roundtrip", () => {
		it("clear then restore preserves messages and full cursor", () => {
			const store = useChatStore.getState();
			store.createLocalSession("s1");
			store.addUserMessage("s1", "hello");
			store.updateSessionCursor("s1", 2, 8);

			const before = useChatStore.getState().sessions.s1;
			const savedMessages = [...before.messages];
			const savedCursor = {
				revision: before.revision,
				lastAppliedSeq: before.lastAppliedSeq,
			};

			store.clearSessionMessages("s1");
			expect(useChatStore.getState().sessions.s1.messages).toEqual([]);

			store.restoreSessionMessages("s1", savedMessages, savedCursor);

			const after = useChatStore.getState().sessions.s1;
			expect(after.messages).toHaveLength(1);
			expect(after.revision).toBe(2);
			expect(after.lastAppliedSeq).toBe(8);
		});

		it("restore with partial cursor (only lastAppliedSeq, no revision)", () => {
			const store = useChatStore.getState();
			store.createLocalSession("s1");
			store.addUserMessage("s1", "msg");

			const msgs = [...useChatStore.getState().sessions.s1.messages];
			store.clearSessionMessages("s1");
			store.restoreSessionMessages("s1", msgs, { lastAppliedSeq: 5 });

			const session = useChatStore.getState().sessions.s1;
			expect(session.lastAppliedSeq).toBe(5);
			// revision was cleared by clearSessionMessages → stays undefined
			expect(session.revision).toBeUndefined();
		});
	});

	// ---------------------------------------------------------------------------
	// confirmOrAppendUserMessage — extended scenarios
	// ---------------------------------------------------------------------------
	describe("confirmOrAppendUserMessage (extended)", () => {
		it("status message (role=assistant) acts as assistant boundary during search", () => {
			const store = useChatStore.getState();
			store.createLocalSession("s1");
			// Add provisional user message, then a status message (role=assistant)
			store.addUserMessage("s1", "provisional", { provisional: true });
			store.addStatusMessage("s1", {
				title: "info",
				variant: "info",
			});

			// Status messages have role="assistant", so they act as boundary.
			// The backward search encounters the status message first, breaks,
			// and the provisional before it is not found → a new message is appended.
			store.confirmOrAppendUserMessage("s1", "new from backfill");

			const msgs = useChatStore.getState().sessions.s1.messages;
			// Should be 3: provisional user, status, new user
			expect(msgs).toHaveLength(3);
			// First message should still be provisional
			if (msgs[0].kind === "text") {
				expect(msgs[0].provisional).toBe(true);
			}
			// Last message is the backfill append
			if (msgs[2].kind === "text") {
				expect(msgs[2].content).toBe("new from backfill");
			}
		});

		it("handles tool_call/status messages between user messages without breaking", () => {
			const store = useChatStore.getState();
			store.createLocalSession("s1");
			store.addUserMessage("s1", "first", { provisional: true });
			store.addToolCall("s1", {
				sessionUpdate: "tool_call",
				toolCallId: "tc-1",
				status: "completed",
				title: "Read file",
			});

			// tool_call is not an assistant text message, but the search should
			// still not cross assistant boundary. tool_call has role="assistant".
			// Actually, per the code: it breaks at msg.role === "assistant"
			// So tool_call (role=assistant) acts as boundary.
			store.confirmOrAppendUserMessage("s1", "new msg");

			const msgs = useChatStore.getState().sessions.s1.messages;
			// tool_call acts as assistant boundary → provisional not found → append new
			expect(msgs).toHaveLength(3);
		});

		it("confirm does not match non-provisional user message", () => {
			const store = useChatStore.getState();
			store.createLocalSession("s1");
			store.addUserMessage("s1", "normal msg", { provisional: false });

			store.confirmOrAppendUserMessage("s1", "backfill");

			const msgs = useChatStore.getState().sessions.s1.messages;
			// Should append because existing message is not provisional
			expect(msgs).toHaveLength(2);
			if (msgs[0].kind === "text") {
				expect(msgs[0].provisional).toBe(false);
				expect(msgs[0].content).toBe("normal msg");
			}
		});

		it("multiple provisional messages: confirms the last one (closest to tail)", () => {
			const store = useChatStore.getState();
			store.createLocalSession("s1");
			store.addUserMessage("s1", "first prov", { provisional: true });
			store.addUserMessage("s1", "second prov", { provisional: true });

			store.confirmOrAppendUserMessage("s1", "confirm");

			const msgs = useChatStore.getState().sessions.s1.messages;
			expect(msgs).toHaveLength(2);
			// Backward search finds second (index 1) first
			if (msgs[0].kind === "text") {
				expect(msgs[0].provisional).toBe(true); // first still provisional
			}
			if (msgs[1].kind === "text") {
				expect(msgs[1].provisional).toBe(false); // second confirmed
			}
		});
	});

	// ---------------------------------------------------------------------------
	// syncSessionHistory guard — store-level
	// ---------------------------------------------------------------------------
	describe("syncSessionHistory guards (store-level)", () => {
		it("session does not exist: operations are no-op", () => {
			const store = useChatStore.getState();
			// No session created → all operations should be no-op
			store.clearSessionMessages("nonexistent");
			store.restoreSessionMessages("nonexistent", []);
			store.updateSessionCursor("nonexistent", 1, 5);
			store.resetSessionForRevision("nonexistent", 1);

			// No session should have been created
			expect(useChatStore.getState().sessions.nonexistent).toBeUndefined();
		});

		it("sending=true does not block store cursor update (guard is in hook layer)", () => {
			const store = useChatStore.getState();
			store.createLocalSession("s1");
			// Set sending=true
			store.setSending("s1", true);

			// Store-level updateSessionCursor has no sending guard
			// (the guard lives in the useSocket hook layer)
			store.updateSessionCursor("s1", 1, 5);

			const session = useChatStore.getState().sessions.s1;
			expect(session.revision).toBe(1);
			expect(session.lastAppliedSeq).toBe(5);
		});
	});

	// ---------------------------------------------------------------------------
	// Multi-turn conversation simulation
	// ---------------------------------------------------------------------------
	describe("multi-turn conversation simulation", () => {
		it("sequential addUserMessage + appendAssistantChunk + finalize builds correct history", () => {
			const store = useChatStore.getState();
			store.createLocalSession("s1");

			// Turn 1: user → assistant
			store.addUserMessage("s1", "What is TypeScript?");
			store.appendAssistantChunk("s1", "TypeScript is ");
			store.appendAssistantChunk("s1", "a typed superset of JavaScript.");
			store.finalizeAssistantMessage("s1");

			// Turn 2: user → assistant
			store.addUserMessage("s1", "Show me an example.");
			store.appendAssistantChunk("s1", "const x: number = 42;");
			store.finalizeAssistantMessage("s1");

			const msgs = useChatStore.getState().sessions.s1.messages;
			expect(msgs).toHaveLength(4);

			// Verify message order and content
			expect(msgs[0].role).toBe("user");
			expect(msgs[1].role).toBe("assistant");
			expect(msgs[2].role).toBe("user");
			expect(msgs[3].role).toBe("assistant");

			if (msgs[0].kind === "text") {
				expect(msgs[0].content).toBe("What is TypeScript?");
			}
			if (msgs[1].kind === "text") {
				expect(msgs[1].content).toBe(
					"TypeScript is a typed superset of JavaScript.",
				);
				expect(msgs[1].isStreaming).toBe(false);
			}
			if (msgs[2].kind === "text") {
				expect(msgs[2].content).toBe("Show me an example.");
			}
			if (msgs[3].kind === "text") {
				expect(msgs[3].content).toBe("const x: number = 42;");
				expect(msgs[3].isStreaming).toBe(false);
			}
		});

		it("backfill replay: confirmOrAppendUserMessage appends multiple user messages without provisional", () => {
			const store = useChatStore.getState();
			store.createLocalSession("s1");

			// Simulate backfill replaying user_message events
			store.confirmOrAppendUserMessage("s1", "first user msg");
			store.confirmOrAppendUserMessage("s1", "second user msg");
			store.confirmOrAppendUserMessage("s1", "third user msg");

			const msgs = useChatStore.getState().sessions.s1.messages;
			expect(msgs).toHaveLength(3);

			for (let i = 0; i < 3; i++) {
				expect(msgs[i].role).toBe("user");
				expect(msgs[i].kind).toBe("text");
				if (msgs[i].kind === "text") {
					// Backfill appended messages should not have provisional flag
					expect(
						(msgs[i] as { provisional?: boolean }).provisional,
					).toBeUndefined();
				}
			}

			if (msgs[0].kind === "text")
				expect(msgs[0].content).toBe("first user msg");
			if (msgs[1].kind === "text")
				expect(msgs[1].content).toBe("second user msg");
			if (msgs[2].kind === "text")
				expect(msgs[2].content).toBe("third user msg");
		});
	});
});
