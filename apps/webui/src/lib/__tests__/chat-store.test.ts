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

		it("restores terminal outputs and streaming markers from snapshot", () => {
			const store = useChatStore.getState();
			store.createLocalSession("s1");
			store.clearSessionMessages("s1");

			store.restoreSessionMessages("s1", [], {
				terminalOutputs: {
					term1: {
						terminalId: "term1",
						output: "restored",
						truncated: false,
					},
				},
				streamingMessageId: "assistant-1",
				streamingMessageRole: "assistant",
				streamingThoughtId: "thought-1",
			});

			const session = useChatStore.getState().sessions.s1;
			expect(session.terminalOutputs).toEqual({
				term1: {
					terminalId: "term1",
					output: "restored",
					truncated: false,
				},
			});
			expect(session.streamingMessageId).toBe("assistant-1");
			expect(session.streamingMessageRole).toBe("assistant");
			expect(session.streamingThoughtId).toBe("thought-1");
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
		it("confirms a provisional user message and clears failed state", () => {
			const {
				createLocalSession,
				addUserMessage,
				confirmOrAppendUserMessage,
				markUserMessageFailed,
			} = useChatStore.getState();
			createLocalSession("s1");
			addUserMessage("s1", "hello world", { provisional: true });
			const messageId = useChatStore.getState().sessions.s1.messages[0]?.id;
			if (messageId) {
				markUserMessageFailed("s1", messageId);
			}

			expect(useChatStore.getState().sessions.s1.messages[0]).toHaveProperty(
				"provisional",
				true,
			);

			confirmOrAppendUserMessage("s1", "hello world");

			const msg = useChatStore.getState().sessions.s1.messages[0];
			expect(msg).toHaveProperty("provisional", false);
			expect(msg).toHaveProperty("failed", false);
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

		it("confirms the oldest matching provisional after an uncertain retry", () => {
			const store = useChatStore.getState();
			store.createLocalSession("s1");
			store.addUserMessage("s1", "same prompt", {
				messageId: "uncertain-attempt",
				provisional: true,
			});
			store.markUserMessageFailed("s1", "uncertain-attempt");
			store.addUserMessage("s1", "same prompt", {
				messageId: "retry-attempt",
				provisional: true,
			});

			store.confirmOrAppendUserMessage("s1", "same prompt");

			const messages = useChatStore.getState().sessions.s1.messages;
			expect(messages).toHaveLength(2);
			expect(messages[0]).toMatchObject({
				id: "uncertain-attempt",
				provisional: false,
				failed: false,
			});
			expect(messages[1]).toMatchObject({
				id: "retry-attempt",
				provisional: true,
				failed: false,
			});
		});

		it("never confirms a newer provisional with different content", () => {
			const store = useChatStore.getState();
			store.createLocalSession("s1");
			store.addUserMessage("s1", "first prompt", {
				messageId: "first-attempt",
				provisional: true,
			});
			store.addUserMessage("s1", "second prompt", {
				messageId: "second-attempt",
				provisional: true,
			});

			store.confirmOrAppendUserMessage("s1", "first prompt");

			const messages = useChatStore.getState().sessions.s1.messages;
			expect(messages[0]).toMatchObject({
				id: "first-attempt",
				provisional: false,
			});
			expect(messages[1]).toMatchObject({
				id: "second-attempt",
				provisional: true,
			});
		});

		it("uses an explicit message id instead of falling back to matching content", () => {
			const store = useChatStore.getState();
			store.createLocalSession("s1");
			store.addUserMessage("s1", "same prompt", {
				messageId: "first-attempt",
				provisional: true,
			});
			store.addUserMessage("s1", "same prompt", {
				messageId: "second-attempt",
				provisional: true,
			});

			store.confirmOrAppendUserMessage("s1", "same prompt", "server-attempt");

			const messages = useChatStore.getState().sessions.s1.messages;
			expect(messages).toHaveLength(3);
			expect(messages[0]).toMatchObject({ provisional: true });
			expect(messages[1]).toMatchObject({ provisional: true });
			expect(messages[2]).toMatchObject({
				id: "server-attempt",
				content: "same prompt",
			});
			if (messages[2].kind === "text") {
				expect(messages[2].provisional).toBeUndefined();
			}
		});

		it("confirms the provisional selected by an explicit message id", () => {
			const store = useChatStore.getState();
			store.createLocalSession("s1");
			store.addUserMessage("s1", "same prompt", {
				messageId: "first-attempt",
				provisional: true,
			});
			store.addUserMessage("s1", "same prompt", {
				messageId: "second-attempt",
				provisional: true,
			});

			store.confirmOrAppendUserMessage("s1", "same prompt", "second-attempt");

			const messages = useChatStore.getState().sessions.s1.messages;
			expect(messages[0]).toMatchObject({ provisional: true });
			expect(messages[1]).toMatchObject({ provisional: false });
		});

		it("replays a confirmed message idempotently", () => {
			const store = useChatStore.getState();
			store.createLocalSession("s1");

			store.confirmOrAppendUserMessage("s1", "persisted prompt", "message-1");
			store.confirmOrAppendUserMessage("s1", "persisted prompt", "message-1");

			const messages = useChatStore.getState().sessions.s1.messages;
			expect(messages).toHaveLength(1);
			expect(messages[0]).toMatchObject({
				id: "message-1",
				content: "persisted prompt",
			});
		});

		it("does not append when an explicit id is already confirmed", () => {
			const store = useChatStore.getState();
			store.createLocalSession("s1");
			store.addUserMessage("s1", "persisted prompt", {
				messageId: "message-1",
			});

			store.confirmOrAppendUserMessage("s1", "persisted prompt", "message-1");

			expect(useChatStore.getState().sessions.s1.messages).toHaveLength(1);
		});

		it("joins streamed user chunks with the same message id during backfill", () => {
			const store = useChatStore.getState();
			store.createLocalSession("s1");

			store.confirmOrAppendUserMessage("s1", "ha", "message-stream", 1);
			store.confirmOrAppendUserMessage("s1", "ha", "message-stream", 2);

			const messages = useChatStore.getState().sessions.s1.messages;
			expect(messages).toHaveLength(1);
			expect(messages[0]).toMatchObject({
				id: "message-stream",
				content: "haha",
			});
		});

		it("preserves image-only and mixed user chunks during backfill", () => {
			const store = useChatStore.getState();
			store.createLocalSession("s1");
			const image = {
				type: "image" as const,
				data: "aW1hZ2U=",
				mimeType: "image/png",
			};

			store.confirmOrAppendUserMessage("s1", image, "message-media", 1);
			let messages = useChatStore.getState().sessions.s1.messages;
			expect(messages).toHaveLength(1);
			expect(messages[0]).toMatchObject({
				id: "message-media",
				content: "",
				contentBlocks: [image],
			});

			store.confirmOrAppendUserMessage(
				"s1",
				{ type: "text", text: "caption" },
				"message-media",
				2,
			);
			messages = useChatStore.getState().sessions.s1.messages;
			expect(messages).toHaveLength(1);
			expect(messages[0]).toMatchObject({
				content: "caption",
				contentBlocks: [image, { type: "text", text: "caption" }],
			});
		});

		it("confirms an optimistic image-only message without replacing its blocks", () => {
			const store = useChatStore.getState();
			store.createLocalSession("s1");
			const image = {
				type: "image" as const,
				data: "aW1hZ2U=",
				mimeType: "image/png",
			};
			store.addUserMessage("s1", "", {
				messageId: "message-image",
				contentBlocks: [image],
				provisional: true,
			});

			store.confirmOrAppendUserMessage("s1", image, "message-image", 1);

			expect(useChatStore.getState().sessions.s1.messages).toEqual([
				expect.objectContaining({
					id: "message-image",
					content: "",
					contentBlocks: [image],
					provisional: false,
					failed: false,
				}),
			]);
		});

		it("folds legacy text chunks into the oldest matching provisional", () => {
			const store = useChatStore.getState();
			store.createLocalSession("s1");
			const contentBlocks = [
				{ type: "text" as const, text: "hello " },
				{ type: "text" as const, text: "world" },
			];
			store.addUserMessage("s1", "hello world", {
				messageId: "oldest-provisional",
				contentBlocks,
				provisional: true,
			});
			store.addUserMessage("s1", "newer prompt", {
				messageId: "newer-provisional",
				provisional: true,
			});

			store.confirmOrAppendUserMessage("s1", contentBlocks[0], undefined, 1);
			store.confirmOrAppendUserMessage("s1", contentBlocks[1], undefined, 2);

			const messages = useChatStore.getState().sessions.s1.messages;
			expect(messages).toHaveLength(2);
			expect(messages[0]).toMatchObject({
				id: "oldest-provisional",
				content: "hello world",
				contentBlocks,
				provisional: false,
				failed: false,
			});
			expect(messages[1]).toMatchObject({
				id: "newer-provisional",
				provisional: true,
			});
		});

		it("folds legacy text and image chunks into one provisional message", () => {
			const store = useChatStore.getState();
			store.createLocalSession("s1");
			const image = {
				type: "image" as const,
				data: "aW1hZ2U=",
				mimeType: "image/png",
			};
			const contentBlocks = [{ type: "text" as const, text: "caption" }, image];
			store.addUserMessage("s1", "caption", {
				messageId: "mixed-provisional",
				contentBlocks,
				provisional: true,
			});

			store.confirmOrAppendUserMessage("s1", contentBlocks[0], undefined, 11);
			store.confirmOrAppendUserMessage("s1", contentBlocks[1], undefined, 12);

			expect(useChatStore.getState().sessions.s1.messages).toEqual([
				expect.objectContaining({
					id: "mixed-provisional",
					content: "caption",
					contentBlocks,
					provisional: false,
					failed: false,
				}),
			]);
		});

		it("does not merge independent legacy messages across a sequence gap", () => {
			const store = useChatStore.getState();
			store.createLocalSession("s1");

			store.confirmOrAppendUserMessage(
				"s1",
				{ type: "text", text: "first" },
				undefined,
				1,
			);
			store.confirmOrAppendUserMessage(
				"s1",
				{ type: "text", text: "second" },
				undefined,
				3,
			);

			const messages = useChatStore.getState().sessions.s1.messages;
			expect(messages).toHaveLength(2);
			expect(messages[0]).toMatchObject({ content: "first" });
			expect(messages[1]).toMatchObject({ content: "second" });
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

		it("defaults failed to false on optimistic messages", () => {
			const { createLocalSession, addUserMessage } = useChatStore.getState();
			createLocalSession("s1");
			addUserMessage("s1", "prov msg", { provisional: true });

			const msg = useChatStore.getState().sessions.s1.messages[0];
			expect(msg.kind).toBe("text");
			if (msg.kind === "text") {
				expect(msg.provisional).toBe(true);
				expect(msg.failed).toBe(false);
				expect(msg.isStreaming).toBe(false);
			}
		});

		it("marks a provisional user message as failed", () => {
			const { createLocalSession, addUserMessage, markUserMessageFailed } =
				useChatStore.getState();
			createLocalSession("s1");
			addUserMessage("s1", "hello", { provisional: true, messageId: "msg-1" });

			markUserMessageFailed("s1", "msg-1");

			const msg = useChatStore.getState().sessions.s1.messages[0];
			if (msg.kind === "text") {
				expect(msg.provisional).toBe(true);
				expect(msg.failed).toBe(true);
			}
		});

		it("reuses a failed optimistic message when retrying with the same id", () => {
			const { createLocalSession, addUserMessage, markUserMessageFailed } =
				useChatStore.getState();
			createLocalSession("s1");
			addUserMessage("s1", "hello", {
				provisional: true,
				messageId: "msg-1",
			});
			markUserMessageFailed("s1", "msg-1");

			addUserMessage("s1", "hello", {
				provisional: true,
				messageId: "msg-1",
			});

			const messages = useChatStore.getState().sessions.s1.messages;
			expect(messages).toHaveLength(1);
			expect(messages[0]).toMatchObject({
				id: "msg-1",
				provisional: true,
				failed: false,
			});
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

	describe("syncSessions (attached revision authority)", () => {
		it("atomically replaces session config options, including with an empty list", () => {
			const store = useChatStore.getState();
			store.createLocalSession("s1", {
				modelId: "model-old",
				modelName: "Old model",
				availableModels: [{ id: "model-old", name: "Old model" }],
				configOptions: [
					{
						type: "boolean",
						id: "safe-mode",
						name: "Safe mode",
						currentValue: true,
					},
				],
			});

			store.syncSessions([
				{
					sessionId: "s1",
					title: "Session",
					backendId: "backend-1",
					backendLabel: "Backend",
					createdAt: "2024-01-01T00:00:00Z",
					updatedAt: "2024-01-01T00:00:00Z",
					configOptions: [],
				},
			]);

			expect(useChatStore.getState().sessions.s1.configOptions).toEqual([]);
			expect(useChatStore.getState().sessions.s1.modelId).toBeUndefined();
			expect(useChatStore.getState().sessions.s1.modelName).toBeUndefined();
			expect(
				useChatStore.getState().sessions.s1.availableModels,
			).toBeUndefined();
		});

		it("clears legacy model projections when a config mutation removes them", () => {
			const store = useChatStore.getState();
			store.createLocalSession("s1", {
				modelId: "model-old",
				modelName: "Old model",
				availableModels: [{ id: "model-old", name: "Old model" }],
				configOptions: [
					{
						type: "select",
						id: "model",
						name: "Model",
						category: "model",
						currentValue: "model-old",
						options: [{ value: "model-old", name: "Old model" }],
					},
				],
			});

			store.updateSessionMeta("s1", { configOptions: [] });

			const session = useChatStore.getState().sessions.s1;
			expect(session.configOptions).toEqual([]);
			expect(session.modelId).toBeUndefined();
			expect(session.modelName).toBeUndefined();
			expect(session.availableModels).toBeUndefined();
		});

		it("resets attached transcript when the summary revision changes", () => {
			const store = useChatStore.getState();
			store.createLocalSession("s1", {
				title: "Attached Session",
				backendId: "backend-1",
				backendLabel: "Claude",
				machineId: "machine-1",
			});
			store.markSessionAttached({
				sessionId: "s1",
				machineId: "machine-1",
				attachedAt: "2024-01-01T00:00:00Z",
				revision: 1,
			});
			store.addUserMessage("s1", "stale");
			store.updateSessionCursor("s1", 1, 5);

			store.syncSessions([
				{
					sessionId: "s1",
					title: "Attached Session",
					backendId: "backend-1",
					backendLabel: "Claude",
					createdAt: "2024-01-01T00:00:00Z",
					updatedAt: "2024-01-01T00:00:00Z",
					machineId: "machine-1",
					revision: 3,
					isAttached: true,
				},
			]);

			const session = useChatStore.getState().sessions.s1;
			expect(session.revision).toBe(3);
			expect(session.lastAppliedSeq).toBe(0);
			expect(session.messages).toEqual([]);
			expect(session.isAttached).toBe(true);
		});

		it("preserves detached local history when only the summary revision changes", () => {
			const store = useChatStore.getState();
			store.createLocalSession("s1", {
				title: "Detached Session",
				backendId: "backend-1",
				backendLabel: "Claude",
				machineId: "machine-1",
			});
			store.addUserMessage("s1", "keep me");
			store.updateSessionCursor("s1", 1, 2);

			store.syncSessions([
				{
					sessionId: "s1",
					title: "Detached Session",
					backendId: "backend-1",
					backendLabel: "Claude",
					createdAt: "2024-01-01T00:00:00Z",
					updatedAt: "2024-01-01T00:00:00Z",
					machineId: "machine-1",
					revision: 4,
					isAttached: false,
				},
			]);

			const session = useChatStore.getState().sessions.s1;
			expect(session.revision).toBe(1);
			expect(session.lastAppliedSeq).toBe(2);
			expect(session.messages).toHaveLength(1);
			expect(session.isAttached).toBe(false);
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

		it("appends an unmatched confirmation instead of confirming the newest provisional", () => {
			const store = useChatStore.getState();
			store.createLocalSession("s1");
			store.addUserMessage("s1", "first prov", { provisional: true });
			store.addUserMessage("s1", "second prov", { provisional: true });

			store.confirmOrAppendUserMessage("s1", "confirm");

			const msgs = useChatStore.getState().sessions.s1.messages;
			expect(msgs).toHaveLength(3);
			if (msgs[0].kind === "text") {
				expect(msgs[0].provisional).toBe(true);
			}
			if (msgs[1].kind === "text") {
				expect(msgs[1].provisional).toBe(true);
			}
			if (msgs[2].kind === "text") {
				expect(msgs[2].content).toBe("confirm");
				expect(msgs[2].provisional).toBeUndefined();
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
	// ACP protocol message boundaries
	// ---------------------------------------------------------------------------
	describe("ACP protocol message boundaries", () => {
		it("keeps assistant chunks with the same messageId together", () => {
			const store = useChatStore.getState();
			store.createLocalSession("s1");
			store.appendAssistantChunk("s1", "Hello ", "assistant-1");
			store.appendAssistantChunk("s1", "world", "assistant-1");

			const messages = useChatStore.getState().sessions.s1.messages;
			expect(messages).toHaveLength(1);
			expect(messages[0]).toMatchObject({
				kind: "text",
				content: "Hello world",
				protocolMessageId: "assistant-1",
				isStreaming: true,
			});
		});

		it("starts a new assistant message when messageId changes", () => {
			const store = useChatStore.getState();
			store.createLocalSession("s1");
			store.appendAssistantChunk("s1", "First", "assistant-1");
			store.appendAssistantChunk("s1", "Second", "assistant-2");

			const messages = useChatStore.getState().sessions.s1.messages;
			expect(messages).toHaveLength(2);
			expect(messages[0]).toMatchObject({
				content: "First",
				protocolMessageId: "assistant-1",
				isStreaming: false,
			});
			expect(messages[1]).toMatchObject({
				content: "Second",
				protocolMessageId: "assistant-2",
				isStreaming: true,
			});
		});

		it("retains legacy chunk folding when the agent omits messageId", () => {
			const store = useChatStore.getState();
			store.createLocalSession("s1");
			store.appendAssistantChunk("s1", "legacy ");
			store.appendAssistantChunk("s1", "agent");

			const messages = useChatStore.getState().sessions.s1.messages;
			expect(messages).toHaveLength(1);
			expect(messages[0]).toMatchObject({
				content: "legacy agent",
			});
		});

		it("starts a new thought message when messageId changes", () => {
			const store = useChatStore.getState();
			store.createLocalSession("s1");
			store.appendThoughtChunk("s1", "First thought", "thought-1");
			store.appendThoughtChunk("s1", "Second thought", "thought-2");

			const messages = useChatStore.getState().sessions.s1.messages;
			expect(messages).toHaveLength(2);
			expect(messages[0]).toMatchObject({
				kind: "thought",
				content: "First thought",
				protocolMessageId: "thought-1",
				isStreaming: false,
			});
			expect(messages[1]).toMatchObject({
				kind: "thought",
				content: "Second thought",
				protocolMessageId: "thought-2",
				isStreaming: true,
			});
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
