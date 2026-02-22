import type {
	SessionSummary,
	SessionsChangedPayload,
	ToolCallUpdate,
} from "@mobvibe/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { useChatStore } from "@/lib/chat-store";

const resetStore = () => {
	useChatStore.setState({
		sessions: {},
		activeSessionId: undefined,
		appError: undefined,
		syncStatus: "idle",
		lastSyncAt: undefined,
	});
};

const createMockSessionSummary = (
	overrides: Partial<SessionSummary> = {},
): SessionSummary => ({
	sessionId: `session-${Math.random().toString(36).slice(2, 8)}`,
	title: "Test Session",
	backendId: "backend-1",
	backendLabel: "Claude Code",
	createdAt: new Date().toISOString(),
	updatedAt: new Date().toISOString(),
	...overrides,
});

describe("useChatStore", () => {
	beforeEach(() => {
		useChatStore.persist.clearStorage();
		resetStore();
	});

	it("creates a local session when missing", () => {
		useChatStore.getState().createLocalSession("session-1", {
			title: "Test conversation",
		});

		const session = useChatStore.getState().sessions["session-1"];
		expect(session).toBeTruthy();
		expect(session.title).toBe("Test conversation");
		expect(session.isAttached).toBe(false);
	});

	it("sets loading state for a session", () => {
		useChatStore.getState().createLocalSession("session-1", {
			title: "Test conversation",
		});

		useChatStore.getState().setSessionLoading("session-1", true);

		const session = useChatStore.getState().sessions["session-1"];
		expect(session.isLoading).toBe(true);
	});

	it("marks session attached and detached", () => {
		const store = useChatStore.getState();
		store.markSessionAttached({
			sessionId: "session-1",
			machineId: "machine-1",
			attachedAt: "2024-01-01T00:00:00Z",
		});
		store.appendAssistantChunk("session-1", "streaming");
		store.setSending("session-1", true);
		store.setCanceling("session-1", true);

		let session = useChatStore.getState().sessions["session-1"];
		expect(session.isAttached).toBe(true);
		expect(session.machineId).toBe("machine-1");
		expect(session.attachedAt).toBe("2024-01-01T00:00:00Z");
		expect(session.sending).toBe(true);
		expect(session.canceling).toBe(true);
		expect(session.streamingMessageId).toBeTruthy();
		expect(session.messages[0]?.isStreaming).toBe(true);

		store.markSessionDetached({
			sessionId: "session-1",
			machineId: "machine-1",
			detachedAt: "2024-01-01T01:00:00Z",
			reason: "cli_disconnect",
		});

		session = useChatStore.getState().sessions["session-1"];
		expect(session.isAttached).toBe(false);
		expect(session.detachedAt).toBe("2024-01-01T01:00:00Z");
		expect(session.detachedReason).toBe("cli_disconnect");
		expect(session.sending).toBe(false);
		expect(session.canceling).toBe(false);
		expect(session.streamingMessageId).toBeUndefined();
		expect(session.streamingThoughtId).toBeUndefined();
		expect(session.messages[0]?.isStreaming).toBe(false);
	});

	it("streams assistant messages and finalizes", () => {
		const store = useChatStore.getState();
		store.addUserMessage("session-1", "Hello");
		store.appendAssistantChunk("session-1", "Hello, I am ");
		store.appendAssistantChunk("session-1", "your assistant");
		store.finalizeAssistantMessage("session-1");

		const session = useChatStore.getState().sessions["session-1"];
		expect(session.messages).toHaveLength(2);
		expect(session.messages[0].role).toBe("user");
		expect(session.messages[0].isStreaming).toBe(false);
		expect(session.messages[1].role).toBe("assistant");
		if (session.messages[1].kind === "text") {
			expect(session.messages[1].content).toBe("Hello, I am your assistant");
		}
		expect(session.messages[1].isStreaming).toBe(false);
		expect(session.streamingMessageId).toBeUndefined();
	});

	it("removes missing sessions during sync", () => {
		useChatStore.getState().createLocalSession("session-1", {
			title: "Old conversation",
		});

		useChatStore.getState().syncSessions([]);

		expect(useChatStore.getState().sessions["session-1"]).toBeUndefined();
	});

	describe("handleSessionsChanged", () => {
		it("adds new sessions from payload", () => {
			const newSession = createMockSessionSummary({
				sessionId: "new-session-1",
				title: "New Session",
				cwd: "/home/user/project",
				machineId: "machine-1",
			});

			useChatStore.getState().handleSessionsChanged({
				added: [newSession],
				updated: [],
				removed: [],
			});

			const session = useChatStore.getState().sessions["new-session-1"];
			expect(session).toBeTruthy();
			expect(session.title).toBe("New Session");
			expect(session.cwd).toBe("/home/user/project");
			expect(session.machineId).toBe("machine-1");
		});

		it("merges added session with existing local session", () => {
			// Create local session with messages
			const store = useChatStore.getState();
			store.createLocalSession("session-1", {
				title: "Local Title",
			});
			store.addUserMessage("session-1", "Hello from user");

			// Add session from server with different metadata
			const serverSession = createMockSessionSummary({
				sessionId: "session-1",
				title: "Server Title",
				cwd: "/home/user/project",
				modelId: "claude-3",
				modelName: "Claude 3",
				machineId: "machine-1",
			});

			useChatStore.getState().handleSessionsChanged({
				added: [serverSession],
				updated: [],
				removed: [],
			});

			const session = useChatStore.getState().sessions["session-1"];
			// Server metadata should be merged
			expect(session.title).toBe("Server Title");
			expect(session.cwd).toBe("/home/user/project");
			expect(session.modelId).toBe("claude-3");
			expect(session.machineId).toBe("machine-1");
			// Local messages should be preserved
			expect(session.messages).toHaveLength(1);
			expect(session.messages[0].role).toBe("user");
		});

		it("updates existing session metadata", () => {
			useChatStore.getState().createLocalSession("session-1", {
				title: "Original Title",
				modelId: "claude-2",
			});

			const updatedSession = createMockSessionSummary({
				sessionId: "session-1",
				title: "Updated Title",
				modelId: "claude-3",
				modelName: "Claude 3 Opus",
				cwd: "/updated/path",
			});

			useChatStore.getState().handleSessionsChanged({
				added: [],
				updated: [updatedSession],
				removed: [],
			});

			const session = useChatStore.getState().sessions["session-1"];
			expect(session.title).toBe("Updated Title");
			expect(session.modelId).toBe("claude-3");
			expect(session.modelName).toBe("Claude 3 Opus");
			expect(session.cwd).toBe("/updated/path");
		});

		it("ignores update for non-existent session", () => {
			const initialSessionCount = Object.keys(
				useChatStore.getState().sessions,
			).length;

			const updatedSession = createMockSessionSummary({
				sessionId: "non-existent-session",
				title: "Should Not Appear",
			});

			useChatStore.getState().handleSessionsChanged({
				added: [],
				updated: [updatedSession],
				removed: [],
			});

			const finalSessionCount = Object.keys(
				useChatStore.getState().sessions,
			).length;
			expect(finalSessionCount).toBe(initialSessionCount);
			expect(
				useChatStore.getState().sessions["non-existent-session"],
			).toBeUndefined();
		});

		it("removes sessions listed in removed payload", () => {
			useChatStore.getState().createLocalSession("session-1", {
				title: "Active Session",
			});

			useChatStore.getState().handleSessionsChanged({
				added: [],
				updated: [],
				removed: ["session-1"],
			});

			expect(useChatStore.getState().sessions["session-1"]).toBeUndefined();
		});

		it("removes sessions even if they had errors", () => {
			const customError = {
				code: "CUSTOM_ERROR",
				message: "Session crashed",
				retryable: false,
				scope: "session" as const,
			};

			useChatStore.getState().createLocalSession("session-1", {
				title: "Session With Error",
			});
			useChatStore.getState().setError("session-1", customError);

			useChatStore.getState().handleSessionsChanged({
				added: [],
				updated: [],
				removed: ["session-1"],
			});

			expect(useChatStore.getState().sessions["session-1"]).toBeUndefined();
		});

		it("handles add + update + remove in single payload", () => {
			// Setup: create two existing sessions
			useChatStore.getState().createLocalSession("session-to-update", {
				title: "Will Update",
			});
			useChatStore.getState().createLocalSession("session-to-remove", {
				title: "Will Remove",
			});

			const payload: SessionsChangedPayload = {
				added: [
					createMockSessionSummary({
						sessionId: "session-new",
						title: "Newly Added",
					}),
				],
				updated: [
					createMockSessionSummary({
						sessionId: "session-to-update",
						title: "Updated Title",
						modelId: "claude-4",
					}),
				],
				removed: ["session-to-remove"],
			};

			useChatStore.getState().handleSessionsChanged(payload);

			const sessions = useChatStore.getState().sessions;

			// New session should exist
			expect(sessions["session-new"]).toBeTruthy();
			expect(sessions["session-new"].title).toBe("Newly Added");

			// Updated session should have new metadata
			expect(sessions["session-to-update"].title).toBe("Updated Title");
			expect(sessions["session-to-update"].modelId).toBe("claude-4");

			// Removed session should no longer exist
			expect(sessions["session-to-remove"]).toBeUndefined();
		});

		it("handles empty payload gracefully", () => {
			useChatStore.getState().createLocalSession("session-1", {
				title: "Existing",
			});

			const beforeState = useChatStore.getState().sessions["session-1"];

			useChatStore.getState().handleSessionsChanged({
				added: [],
				updated: [],
				removed: [],
			});

			const afterState = useChatStore.getState().sessions["session-1"];
			expect(afterState.title).toBe(beforeState.title);
			expect(afterState.isAttached).toBe(beforeState.isAttached);
		});

		it("updates lastSyncAt timestamp", () => {
			expect(useChatStore.getState().lastSyncAt).toBeUndefined();

			const before = new Date().toISOString();

			useChatStore.getState().handleSessionsChanged({
				added: [createMockSessionSummary({ sessionId: "new-session" })],
				updated: [],
				removed: [],
			});

			const after = new Date().toISOString();
			const lastSyncAt = useChatStore.getState().lastSyncAt;

			expect(lastSyncAt).toBeTruthy();
			expect(lastSyncAt! >= before).toBe(true);
			expect(lastSyncAt! <= after).toBe(true);
		});

		it("preserves local messages when merging", () => {
			// Create session with multiple messages
			const store = useChatStore.getState();
			store.createLocalSession("session-1", {
				title: "Chat Session",
			});
			store.addUserMessage("session-1", "First message");
			store.appendAssistantChunk("session-1", "Response 1");
			store.finalizeAssistantMessage("session-1");
			store.addUserMessage("session-1", "Second message");

			const messagesBefore =
				useChatStore.getState().sessions["session-1"].messages;
			expect(messagesBefore).toHaveLength(3);

			// Update session metadata via handleSessionsChanged
			const updatedSession = createMockSessionSummary({
				sessionId: "session-1",
				title: "Updated Title",
				modelId: "claude-3",
			});

			useChatStore.getState().handleSessionsChanged({
				added: [],
				updated: [updatedSession],
				removed: [],
			});

			const session = useChatStore.getState().sessions["session-1"];
			expect(session.title).toBe("Updated Title");
			expect(session.modelId).toBe("claude-3");
			// Messages should be preserved
			expect(session.messages).toHaveLength(3);
			expect(session.messages[0].role).toBe("user");
			expect(session.messages[1].role).toBe("assistant");
			expect(session.messages[2].role).toBe("user");
		});

		it("preserves runtime flags when updating sessions", () => {
			const store = useChatStore.getState();
			store.createLocalSession("session-1", {
				title: "Local Title",
			});
			store.setSessionLoading("session-1", true);
			store.markSessionAttached({
				sessionId: "session-1",
				machineId: "machine-1",
				attachedAt: "2024-01-01T00:00:00Z",
			});

			useChatStore.getState().handleSessionsChanged({
				added: [],
				updated: [
					createMockSessionSummary({
						sessionId: "session-1",
						title: "Updated Title",
					}),
				],
				removed: [],
			});

			const session = useChatStore.getState().sessions["session-1"];
			expect(session.isLoading).toBe(true);
			expect(session.isAttached).toBe(true);
			expect(session.attachedAt).toBe("2024-01-01T00:00:00Z");
		});
	});

	describe("syncSessions (extended)", () => {
		it("updates existing session with new metadata", () => {
			useChatStore.getState().createLocalSession("session-1", {
				title: "Original Title",
				modelId: "claude-2",
			});

			const serverSession = createMockSessionSummary({
				sessionId: "session-1",
				title: "Server Title",
				modelId: "claude-3",
				modelName: "Claude 3",
				cwd: "/new/path",
				machineId: "machine-1",
			});

			useChatStore.getState().syncSessions([serverSession]);

			const session = useChatStore.getState().sessions["session-1"];
			expect(session.title).toBe("Server Title");
			expect(session.modelId).toBe("claude-3");
			expect(session.modelName).toBe("Claude 3");
			expect(session.cwd).toBe("/new/path");
			expect(session.machineId).toBe("machine-1");
		});

		it("preserves runtime flags when syncing sessions", () => {
			useChatStore.getState().createLocalSession("session-1", {
				title: "Local Session",
			});
			useChatStore.getState().setSessionLoading("session-1", true);
			useChatStore.getState().markSessionAttached({
				sessionId: "session-1",
				machineId: "machine-1",
				attachedAt: "2024-01-01T00:00:00Z",
			});

			const serverSession = createMockSessionSummary({
				sessionId: "session-1",
				title: "Server Session",
			});

			useChatStore.getState().syncSessions([serverSession]);

			const session = useChatStore.getState().sessions["session-1"];
			expect(session.isLoading).toBe(true);
			expect(session.isAttached).toBe(true);
			expect(session.attachedAt).toBe("2024-01-01T00:00:00Z");
		});

		it("creates new sessions from server list", () => {
			const serverSessions = [
				createMockSessionSummary({
					sessionId: "server-session-1",
					title: "Server Session 1",
					machineId: "machine-1",
				}),
				createMockSessionSummary({
					sessionId: "server-session-2",
					title: "Server Session 2",
					machineId: "machine-2",
				}),
			];

			useChatStore.getState().syncSessions(serverSessions);

			const sessions = useChatStore.getState().sessions;
			expect(sessions["server-session-1"]).toBeTruthy();
			expect(sessions["server-session-1"].title).toBe("Server Session 1");
			expect(sessions["server-session-1"].machineId).toBe("machine-1");

			expect(sessions["server-session-2"]).toBeTruthy();
			expect(sessions["server-session-2"].title).toBe("Server Session 2");
			expect(sessions["server-session-2"].machineId).toBe("machine-2");
		});

		it("preserves messages when updating existing sessions", () => {
			const store = useChatStore.getState();
			store.createLocalSession("session-1", {
				title: "Local Session",
			});
			store.addUserMessage("session-1", "Hello");
			store.appendAssistantChunk("session-1", "Hi there!");
			store.finalizeAssistantMessage("session-1");

			const serverSession = createMockSessionSummary({
				sessionId: "session-1",
				title: "Updated from Server",
			});

			useChatStore.getState().syncSessions([serverSession]);

			const session = useChatStore.getState().sessions["session-1"];
			expect(session.title).toBe("Updated from Server");
			expect(session.messages).toHaveLength(2);
		});
	});

	// =========================================================================
	// 1.1 addStatusMessage
	// =========================================================================
	describe("addStatusMessage", () => {
		it("adds info status message", () => {
			const store = useChatStore.getState();
			store.createLocalSession("session-1", { title: "Test" });
			store.addStatusMessage("session-1", {
				title: "Build succeeded",
				variant: "info",
			});

			const session = useChatStore.getState().sessions["session-1"];
			expect(session.messages).toHaveLength(1);
			const msg = session.messages[0];
			expect(msg.kind).toBe("status");
			expect(msg.role).toBe("assistant");
			expect(msg.isStreaming).toBe(false);
			if (msg.kind === "status") {
				expect(msg.variant).toBe("info");
				expect(msg.title).toBe("Build succeeded");
				expect(msg.description).toBeUndefined();
			}
		});

		it("adds warning status message with description", () => {
			const store = useChatStore.getState();
			store.createLocalSession("session-1", { title: "Test" });
			store.addStatusMessage("session-1", {
				title: "Deprecated API",
				description: "Please migrate to v2",
				variant: "warning",
			});

			const session = useChatStore.getState().sessions["session-1"];
			const msg = session.messages[0];
			if (msg.kind === "status") {
				expect(msg.variant).toBe("warning");
				expect(msg.description).toBe("Please migrate to v2");
			}
		});

		it("defaults variant to info when omitted", () => {
			const store = useChatStore.getState();
			store.createLocalSession("session-1", { title: "Test" });
			store.addStatusMessage("session-1", {
				title: "Default variant",
			});

			const session = useChatStore.getState().sessions["session-1"];
			const msg = session.messages[0];
			if (msg.kind === "status") {
				expect(msg.variant).toBe("info");
			}
		});

		it("adds status message to non-existent session (auto-creates)", () => {
			useChatStore.getState().addStatusMessage("new-session", {
				title: "Auto created",
				variant: "success",
			});

			const session = useChatStore.getState().sessions["new-session"];
			expect(session).toBeTruthy();
			expect(session.messages).toHaveLength(1);
			expect(session.messages[0].kind).toBe("status");
		});
	});

	// =========================================================================
	// 1.2 appendThoughtChunk
	// =========================================================================
	describe("appendThoughtChunk", () => {
		it("creates new thought message on first chunk", () => {
			const store = useChatStore.getState();
			store.createLocalSession("session-1", { title: "Test" });
			store.appendThoughtChunk("session-1", "Thinking about ");

			const session = useChatStore.getState().sessions["session-1"];
			expect(session.messages).toHaveLength(1);
			const msg = session.messages[0];
			expect(msg.kind).toBe("thought");
			expect(msg.role).toBe("assistant");
			expect(msg.isStreaming).toBe(true);
			if (msg.kind === "thought") {
				expect(msg.content).toBe("Thinking about ");
			}
			expect(session.streamingThoughtId).toBe(msg.id);
		});

		it("appends to existing thought message on subsequent chunks", () => {
			const store = useChatStore.getState();
			store.createLocalSession("session-1", { title: "Test" });
			store.appendThoughtChunk("session-1", "Part 1 ");
			store.appendThoughtChunk("session-1", "Part 2");

			const session = useChatStore.getState().sessions["session-1"];
			expect(session.messages).toHaveLength(1);
			if (session.messages[0].kind === "thought") {
				expect(session.messages[0].content).toBe("Part 1 Part 2");
			}
		});

		it("sets streamingThoughtId on session", () => {
			const store = useChatStore.getState();
			store.createLocalSession("session-1", { title: "Test" });
			store.appendThoughtChunk("session-1", "thinking");

			const session = useChatStore.getState().sessions["session-1"];
			expect(session.streamingThoughtId).toBeDefined();
			expect(session.streamingThoughtId).toBe(session.messages[0].id);
		});

		it("creates independent thought stream from assistant stream", () => {
			const store = useChatStore.getState();
			store.createLocalSession("session-1", { title: "Test" });

			// Start assistant streaming
			store.appendAssistantChunk("session-1", "Hello ");
			// Start thought streaming
			store.appendThoughtChunk("session-1", "I should think ");

			const session = useChatStore.getState().sessions["session-1"];
			expect(session.messages).toHaveLength(2);
			expect(session.messages[0].kind).toBe("text");
			expect(session.messages[0].role).toBe("assistant");
			expect(session.messages[1].kind).toBe("thought");
			// Both IDs should be distinct
			expect(session.streamingMessageId).toBeDefined();
			expect(session.streamingThoughtId).toBeDefined();
			expect(session.streamingMessageId).not.toBe(session.streamingThoughtId);
		});

		it("returns unchanged state when thought message not found (stale streamingThoughtId)", () => {
			const store = useChatStore.getState();
			store.createLocalSession("session-1", { title: "Test" });

			// Manually set a stale streamingThoughtId
			useChatStore.setState((state) => ({
				sessions: {
					...state.sessions,
					"session-1": {
						...state.sessions["session-1"],
						streamingThoughtId: "non-existent-id",
					},
				},
			}));

			// This should return state unchanged since the message is not found
			store.appendThoughtChunk("session-1", "chunk");

			const session = useChatStore.getState().sessions["session-1"];
			// Should remain empty because the stale ID prevented append
			expect(session.messages).toHaveLength(0);
		});
	});

	// =========================================================================
	// 1.3 appendUserChunk
	// =========================================================================
	describe("appendUserChunk", () => {
		it("creates new user message on first chunk", () => {
			const store = useChatStore.getState();
			store.createLocalSession("session-1", { title: "Test" });
			store.appendUserChunk("session-1", "Hello ");

			const session = useChatStore.getState().sessions["session-1"];
			expect(session.messages).toHaveLength(1);
			expect(session.messages[0].role).toBe("user");
			expect(session.messages[0].kind).toBe("text");
			expect(session.messages[0].isStreaming).toBe(true);
			if (session.messages[0].kind === "text") {
				expect(session.messages[0].content).toBe("Hello ");
			}
			expect(session.streamingMessageRole).toBe("user");
		});

		it("appends to existing user streaming message", () => {
			const store = useChatStore.getState();
			store.createLocalSession("session-1", { title: "Test" });
			store.appendUserChunk("session-1", "Hello ");
			store.appendUserChunk("session-1", "world");

			const session = useChatStore.getState().sessions["session-1"];
			expect(session.messages).toHaveLength(1);
			if (session.messages[0].kind === "text") {
				expect(session.messages[0].content).toBe("Hello world");
			}
		});

		it("switches from assistant stream to new user stream", () => {
			const store = useChatStore.getState();
			store.createLocalSession("session-1", { title: "Test" });

			// Start assistant stream
			store.appendAssistantChunk("session-1", "I am assistant");
			let session = useChatStore.getState().sessions["session-1"];
			expect(session.streamingMessageRole).toBe("assistant");

			// Start user chunk — should create new message
			store.appendUserChunk("session-1", "User input");

			session = useChatStore.getState().sessions["session-1"];
			expect(session.messages).toHaveLength(2);
			expect(session.messages[0].role).toBe("assistant");
			expect(session.messages[1].role).toBe("user");
			expect(session.streamingMessageRole).toBe("user");
		});

		it("updates contentBlocks text in sync with content", () => {
			const store = useChatStore.getState();
			store.createLocalSession("session-1", { title: "Test" });
			store.appendUserChunk("session-1", "Hello ");
			store.appendUserChunk("session-1", "world");

			const session = useChatStore.getState().sessions["session-1"];
			const msg = session.messages[0];
			if (msg.kind === "text") {
				expect(msg.content).toBe("Hello world");
				const textBlock = msg.contentBlocks.find((b) => b.type === "text");
				expect(textBlock).toBeDefined();
				if (textBlock?.type === "text") {
					expect(textBlock.text).toBe("Hello world");
				}
			}
		});

		it("auto-creates session for unknown sessionId", () => {
			useChatStore.getState().appendUserChunk("auto-session", "First chunk");

			const session = useChatStore.getState().sessions["auto-session"];
			expect(session).toBeTruthy();
			expect(session.messages).toHaveLength(1);
			expect(session.messages[0].role).toBe("user");
		});
	});

	// =========================================================================
	// 1.4 permission workflow
	// =========================================================================
	describe("permission workflow", () => {
		describe("addPermissionRequest", () => {
			it("adds permission message with requestId, toolCall, options", () => {
				const store = useChatStore.getState();
				store.createLocalSession("session-1", { title: "Test" });
				store.addPermissionRequest("session-1", {
					requestId: "req-1",
					toolCall: {
						toolCallId: "tc-1",
						status: "running",
						title: "Write file",
					},
					options: [
						{
							id: "allow",
							label: "Allow",
							isRecommended: true,
						},
						{
							id: "deny",
							label: "Deny",
							isRecommended: false,
						},
					],
				});

				const session = useChatStore.getState().sessions["session-1"];
				expect(session.messages).toHaveLength(1);
				const msg = session.messages[0];
				expect(msg.kind).toBe("permission");
				if (msg.kind === "permission") {
					expect(msg.requestId).toBe("req-1");
					expect(msg.toolCall?.toolCallId).toBe("tc-1");
					expect(msg.options).toHaveLength(2);
					expect(msg.decisionState).toBe("idle");
					expect(msg.outcome).toBeUndefined();
					expect(msg.isStreaming).toBe(false);
				}
			});

			it("deduplicates: skips if requestId already exists", () => {
				const store = useChatStore.getState();
				store.createLocalSession("session-1", { title: "Test" });

				const payload = {
					requestId: "req-1",
					options: [{ id: "allow", label: "Allow", isRecommended: true }],
				};

				store.addPermissionRequest("session-1", payload);
				store.addPermissionRequest("session-1", payload);

				const session = useChatStore.getState().sessions["session-1"];
				expect(session.messages).toHaveLength(1);
			});

			it("adds multiple permission requests with different requestIds", () => {
				const store = useChatStore.getState();
				store.createLocalSession("session-1", { title: "Test" });

				store.addPermissionRequest("session-1", {
					requestId: "req-1",
					options: [{ id: "allow", label: "Allow", isRecommended: true }],
				});
				store.addPermissionRequest("session-1", {
					requestId: "req-2",
					options: [{ id: "deny", label: "Deny", isRecommended: false }],
				});

				const session = useChatStore.getState().sessions["session-1"];
				expect(session.messages).toHaveLength(2);
				if (
					session.messages[0].kind === "permission" &&
					session.messages[1].kind === "permission"
				) {
					expect(session.messages[0].requestId).toBe("req-1");
					expect(session.messages[1].requestId).toBe("req-2");
				}
			});
		});

		describe("setPermissionDecisionState", () => {
			it("updates decisionState for matching permission message", () => {
				const store = useChatStore.getState();
				store.createLocalSession("session-1", { title: "Test" });
				store.addPermissionRequest("session-1", {
					requestId: "req-1",
					options: [{ id: "allow", label: "Allow", isRecommended: true }],
				});

				store.setPermissionDecisionState("session-1", "req-1", "submitting");

				const session = useChatStore.getState().sessions["session-1"];
				if (session.messages[0].kind === "permission") {
					expect(session.messages[0].decisionState).toBe("submitting");
				}
			});

			it("no-op for non-existent session", () => {
				const before = useChatStore.getState();
				useChatStore
					.getState()
					.setPermissionDecisionState("no-session", "req-1", "submitting");
				const after = useChatStore.getState();
				expect(after.sessions).toEqual(before.sessions);
			});

			it("no-op for non-matching requestId", () => {
				const store = useChatStore.getState();
				store.createLocalSession("session-1", { title: "Test" });
				store.addPermissionRequest("session-1", {
					requestId: "req-1",
					options: [{ id: "allow", label: "Allow", isRecommended: true }],
				});

				store.setPermissionDecisionState(
					"session-1",
					"wrong-req",
					"submitting",
				);

				const session = useChatStore.getState().sessions["session-1"];
				if (session.messages[0].kind === "permission") {
					expect(session.messages[0].decisionState).toBe("idle");
				}
			});
		});

		describe("setPermissionOutcome", () => {
			it("sets outcome on matching permission message", () => {
				const store = useChatStore.getState();
				store.createLocalSession("session-1", { title: "Test" });
				store.addPermissionRequest("session-1", {
					requestId: "req-1",
					options: [{ id: "allow", label: "Allow", isRecommended: true }],
				});

				const outcome = {
					outcome: "selected" as const,
					selectedOptionId: "allow",
				};
				store.setPermissionOutcome("session-1", "req-1", outcome);

				const session = useChatStore.getState().sessions["session-1"];
				if (session.messages[0].kind === "permission") {
					expect(session.messages[0].outcome).toEqual(outcome);
				}
			});

			it("no-op for non-existent session", () => {
				const before = useChatStore.getState();
				useChatStore.getState().setPermissionOutcome("no-session", "req-1", {
					outcome: "cancelled",
				});
				const after = useChatStore.getState();
				expect(after.sessions).toEqual(before.sessions);
			});
		});
	});

	// =========================================================================
	// 1.5 tool call workflow
	// =========================================================================
	describe("tool call workflow", () => {
		const makeToolCallPayload = (
			overrides: Partial<ToolCallUpdate> = {},
		): ToolCallUpdate => ({
			toolCallId: "tc-1",
			sessionUpdate: "tool_call",
			...overrides,
		});

		describe("addToolCall", () => {
			it("creates new tool_call message with correct fields", () => {
				const store = useChatStore.getState();
				store.createLocalSession("session-1", { title: "Test" });
				store.addToolCall(
					"session-1",
					makeToolCallPayload({
						status: "running",
						title: "Reading file",
						rawInput: { name: "Read", command: "cat foo.ts" },
					}),
				);

				const session = useChatStore.getState().sessions["session-1"];
				expect(session.messages).toHaveLength(1);
				const msg = session.messages[0];
				expect(msg.kind).toBe("tool_call");
				if (msg.kind === "tool_call") {
					expect(msg.toolCallId).toBe("tc-1");
					expect(msg.status).toBe("running");
					expect(msg.title).toBe("Reading file");
					expect(msg.name).toBe("Read");
					expect(msg.command).toBe("cat foo.ts");
					expect(msg.isStreaming).toBe(false);
				}
			});

			it("merges into existing tool_call with same toolCallId", () => {
				const store = useChatStore.getState();
				store.createLocalSession("session-1", { title: "Test" });
				store.addToolCall(
					"session-1",
					makeToolCallPayload({
						status: "running",
						title: "First",
					}),
				);
				store.addToolCall(
					"session-1",
					makeToolCallPayload({
						status: "completed",
						title: "Updated",
					}),
				);

				const session = useChatStore.getState().sessions["session-1"];
				// Should still be 1 message (merged)
				expect(session.messages).toHaveLength(1);
				if (session.messages[0].kind === "tool_call") {
					expect(session.messages[0].status).toBe("completed");
					expect(session.messages[0].title).toBe("Updated");
				}
			});

			it("resolves snapshot fields from rawInput (name, command, args)", () => {
				const store = useChatStore.getState();
				store.createLocalSession("session-1", { title: "Test" });
				store.addToolCall(
					"session-1",
					makeToolCallPayload({
						rawInput: {
							name: "Bash",
							command: "ls -la",
							args: ["-a", "-l"],
						},
					}),
				);

				const session = useChatStore.getState().sessions["session-1"];
				if (session.messages[0].kind === "tool_call") {
					expect(session.messages[0].name).toBe("Bash");
					expect(session.messages[0].command).toBe("ls -la");
					expect(session.messages[0].args).toEqual(["-a", "-l"]);
				}
			});

			it("auto-creates session for unknown sessionId", () => {
				useChatStore
					.getState()
					.addToolCall("auto-session", makeToolCallPayload());

				const session = useChatStore.getState().sessions["auto-session"];
				expect(session).toBeTruthy();
				expect(session.messages).toHaveLength(1);
				expect(session.messages[0].kind).toBe("tool_call");
			});
		});

		describe("updateToolCall", () => {
			it("updates existing tool_call message fields", () => {
				const store = useChatStore.getState();
				store.createLocalSession("session-1", { title: "Test" });
				store.addToolCall(
					"session-1",
					makeToolCallPayload({ status: "running", title: "Running" }),
				);
				store.updateToolCall(
					"session-1",
					makeToolCallPayload({
						sessionUpdate: "tool_call_update",
						status: "completed",
						title: "Done",
					}),
				);

				const session = useChatStore.getState().sessions["session-1"];
				expect(session.messages).toHaveLength(1);
				if (session.messages[0].kind === "tool_call") {
					expect(session.messages[0].status).toBe("completed");
					expect(session.messages[0].title).toBe("Done");
				}
			});

			it("creates new tool_call if toolCallId not found (fallback)", () => {
				const store = useChatStore.getState();
				store.createLocalSession("session-1", { title: "Test" });
				store.updateToolCall(
					"session-1",
					makeToolCallPayload({
						toolCallId: "tc-new",
						sessionUpdate: "tool_call_update",
						status: "completed",
					}),
				);

				const session = useChatStore.getState().sessions["session-1"];
				expect(session.messages).toHaveLength(1);
				if (session.messages[0].kind === "tool_call") {
					expect(session.messages[0].toolCallId).toBe("tc-new");
					expect(session.messages[0].status).toBe("completed");
				}
			});

			it("merges status, title, content, locations", () => {
				const store = useChatStore.getState();
				store.createLocalSession("session-1", { title: "Test" });
				store.addToolCall(
					"session-1",
					makeToolCallPayload({
						status: "running",
						title: "Original",
					}),
				);

				store.updateToolCall(
					"session-1",
					makeToolCallPayload({
						sessionUpdate: "tool_call_update",
						status: "completed",
						title: "Updated Title",
						content: [{ type: "text", text: "output result" }],
						locations: [{ path: "/src/foo.ts", startLine: 10 }],
					}),
				);

				const session = useChatStore.getState().sessions["session-1"];
				if (session.messages[0].kind === "tool_call") {
					expect(session.messages[0].status).toBe("completed");
					expect(session.messages[0].title).toBe("Updated Title");
					expect(session.messages[0].content).toEqual([
						{ type: "text", text: "output result" },
					]);
					expect(session.messages[0].locations).toEqual([
						{ path: "/src/foo.ts", startLine: 10 },
					]);
				}
			});

			it("no-op for non-existent session", () => {
				const before = useChatStore.getState();
				useChatStore
					.getState()
					.updateToolCall(
						"no-session",
						makeToolCallPayload({ sessionUpdate: "tool_call_update" }),
					);
				const after = useChatStore.getState();
				expect(after.sessions).toEqual(before.sessions);
			});
		});
	});

	// =========================================================================
	// 1.6 appendTerminalOutput
	// =========================================================================
	describe("appendTerminalOutput", () => {
		it("creates new terminal output entry on first call", () => {
			const store = useChatStore.getState();
			store.createLocalSession("session-1", { title: "Test" });
			store.appendTerminalOutput("session-1", {
				terminalId: "term-1",
				delta: "$ ls\n",
				truncated: false,
			});

			const session = useChatStore.getState().sessions["session-1"];
			expect(session.terminalOutputs["term-1"]).toBeDefined();
			expect(session.terminalOutputs["term-1"].output).toBe("$ ls\n");
			expect(session.terminalOutputs["term-1"].truncated).toBe(false);
		});

		it("accumulates delta when truncated=false", () => {
			const store = useChatStore.getState();
			store.createLocalSession("session-1", { title: "Test" });
			store.appendTerminalOutput("session-1", {
				terminalId: "term-1",
				delta: "line1\n",
				truncated: false,
			});
			store.appendTerminalOutput("session-1", {
				terminalId: "term-1",
				delta: "line2\n",
				truncated: false,
			});

			const session = useChatStore.getState().sessions["session-1"];
			expect(session.terminalOutputs["term-1"].output).toBe("line1\nline2\n");
		});

		it("replaces entire output when truncated=true", () => {
			const store = useChatStore.getState();
			store.createLocalSession("session-1", { title: "Test" });
			store.appendTerminalOutput("session-1", {
				terminalId: "term-1",
				delta: "old output\n",
				truncated: false,
			});
			store.appendTerminalOutput("session-1", {
				terminalId: "term-1",
				delta: "truncated replacement",
				truncated: true,
				output: "full replacement output",
			});

			const session = useChatStore.getState().sessions["session-1"];
			expect(session.terminalOutputs["term-1"].output).toBe(
				"full replacement output",
			);
			expect(session.terminalOutputs["term-1"].truncated).toBe(true);
		});

		it("stores exitStatus when provided", () => {
			const store = useChatStore.getState();
			store.createLocalSession("session-1", { title: "Test" });
			store.appendTerminalOutput("session-1", {
				terminalId: "term-1",
				delta: "done\n",
				truncated: false,
				exitStatus: { exitCode: 0, signal: null },
			});

			const session = useChatStore.getState().sessions["session-1"];
			expect(session.terminalOutputs["term-1"].exitStatus).toEqual({
				exitCode: 0,
				signal: null,
			});
		});

		it("handles multiple terminal IDs independently", () => {
			const store = useChatStore.getState();
			store.createLocalSession("session-1", { title: "Test" });
			store.appendTerminalOutput("session-1", {
				terminalId: "term-1",
				delta: "output-1",
				truncated: false,
			});
			store.appendTerminalOutput("session-1", {
				terminalId: "term-2",
				delta: "output-2",
				truncated: false,
			});

			const session = useChatStore.getState().sessions["session-1"];
			expect(session.terminalOutputs["term-1"].output).toBe("output-1");
			expect(session.terminalOutputs["term-2"].output).toBe("output-2");
		});

		it("no-op for non-existent session", () => {
			const before = useChatStore.getState();
			useChatStore.getState().appendTerminalOutput("no-session", {
				terminalId: "term-1",
				delta: "data",
				truncated: false,
			});
			const after = useChatStore.getState();
			expect(after.sessions).toEqual(before.sessions);
		});
	});

	// =========================================================================
	// 1.7 message backup/restore
	// =========================================================================
	describe("message backup/restore", () => {
		describe("clearSessionMessages", () => {
			it("clears messages, terminalOutputs, streaming state", () => {
				const store = useChatStore.getState();
				store.createLocalSession("session-1", { title: "Test" });
				store.addUserMessage("session-1", "Hello");
				store.appendAssistantChunk("session-1", "Response");
				store.appendThoughtChunk("session-1", "thinking");
				store.appendTerminalOutput("session-1", {
					terminalId: "term-1",
					delta: "output",
					truncated: false,
				});

				let session = useChatStore.getState().sessions["session-1"];
				expect(session.messages.length).toBeGreaterThan(0);
				expect(Object.keys(session.terminalOutputs).length).toBeGreaterThan(0);
				expect(session.streamingMessageId).toBeDefined();

				store.clearSessionMessages("session-1");

				session = useChatStore.getState().sessions["session-1"];
				expect(session.messages).toHaveLength(0);
				expect(session.terminalOutputs).toEqual({});
				expect(session.streamingMessageId).toBeUndefined();
				expect(session.streamingMessageRole).toBeUndefined();
				expect(session.streamingThoughtId).toBeUndefined();
			});

			it("resets lastAppliedSeq to 0", () => {
				const store = useChatStore.getState();
				store.createLocalSession("session-1", { title: "Test" });
				store.updateSessionCursor("session-1", 1, 42);

				store.clearSessionMessages("session-1");

				const session = useChatStore.getState().sessions["session-1"];
				expect(session.lastAppliedSeq).toBe(0);
			});

			it("no-op for non-existent session", () => {
				const before = useChatStore.getState();
				useChatStore.getState().clearSessionMessages("no-session");
				const after = useChatStore.getState();
				expect(after.sessions).toEqual(before.sessions);
			});
		});

		describe("restoreSessionMessages", () => {
			it("restores provided messages array", () => {
				const store = useChatStore.getState();
				store.createLocalSession("session-1", { title: "Test" });

				const messages = [
					{
						id: "msg-1",
						role: "user" as const,
						kind: "text" as const,
						content: "Restored msg",
						contentBlocks: [{ type: "text" as const, text: "Restored msg" }],
						createdAt: new Date().toISOString(),
						isStreaming: false,
					},
				];
				store.restoreSessionMessages("session-1", messages);

				const session = useChatStore.getState().sessions["session-1"];
				expect(session.messages).toHaveLength(1);
				expect(session.messages[0].id).toBe("msg-1");
				if (session.messages[0].kind === "text") {
					expect(session.messages[0].content).toBe("Restored msg");
				}
			});

			it("restores lastAppliedSeq from cursor", () => {
				const store = useChatStore.getState();
				store.createLocalSession("session-1", { title: "Test" });

				store.restoreSessionMessages("session-1", [], {
					lastAppliedSeq: 25,
				});

				const session = useChatStore.getState().sessions["session-1"];
				expect(session.lastAppliedSeq).toBe(25);
			});

			it("preserves other session fields", () => {
				const store = useChatStore.getState();
				store.createLocalSession("session-1", {
					title: "My Title",
					modelId: "claude-3",
				});
				store.setSending("session-1", true);

				store.restoreSessionMessages("session-1", []);

				const session = useChatStore.getState().sessions["session-1"];
				expect(session.title).toBe("My Title");
				expect(session.modelId).toBe("claude-3");
				expect(session.sending).toBe(true);
			});

			it("no-op for non-existent session", () => {
				const before = useChatStore.getState();
				useChatStore.getState().restoreSessionMessages("no-session", []);
				const after = useChatStore.getState();
				expect(after.sessions).toEqual(before.sessions);
			});
		});
	});

	// =========================================================================
	// 1.8 resetSessionForRevision
	// =========================================================================
	describe("resetSessionForRevision", () => {
		it("clears messages, terminalOutputs, streaming state", () => {
			const store = useChatStore.getState();
			store.createLocalSession("session-1", { title: "Test" });
			store.addUserMessage("session-1", "Hello");
			store.appendAssistantChunk("session-1", "Response");
			store.appendTerminalOutput("session-1", {
				terminalId: "term-1",
				delta: "output",
				truncated: false,
			});

			store.resetSessionForRevision("session-1", 5);

			const session = useChatStore.getState().sessions["session-1"];
			expect(session.messages).toHaveLength(0);
			expect(session.terminalOutputs).toEqual({});
			expect(session.streamingMessageId).toBeUndefined();
			expect(session.streamingMessageRole).toBeUndefined();
			expect(session.streamingThoughtId).toBeUndefined();
		});

		it("sets new revision and resets lastAppliedSeq to 0", () => {
			const store = useChatStore.getState();
			store.createLocalSession("session-1", { title: "Test" });
			store.updateSessionCursor("session-1", 1, 50);

			store.resetSessionForRevision("session-1", 3);

			const session = useChatStore.getState().sessions["session-1"];
			expect(session.revision).toBe(3);
			expect(session.lastAppliedSeq).toBe(0);
		});

		it("no-op for non-existent session", () => {
			const before = useChatStore.getState();
			useChatStore.getState().resetSessionForRevision("no-session", 5);
			const after = useChatStore.getState();
			expect(after.sessions).toEqual(before.sessions);
		});
	});

	// =========================================================================
	// 1.9 finalizeAssistantMessage (edge cases)
	// =========================================================================
	describe("finalizeAssistantMessage (edge cases)", () => {
		it("finalizes both streaming text and thought messages", () => {
			const store = useChatStore.getState();
			store.createLocalSession("session-1", { title: "Test" });
			store.appendAssistantChunk("session-1", "Hello");
			store.appendThoughtChunk("session-1", "Thinking");

			let session = useChatStore.getState().sessions["session-1"];
			expect(session.messages[0].isStreaming).toBe(true);
			expect(session.messages[1].isStreaming).toBe(true);

			store.finalizeAssistantMessage("session-1");

			session = useChatStore.getState().sessions["session-1"];
			expect(session.messages[0].isStreaming).toBe(false);
			expect(session.messages[1].isStreaming).toBe(false);
			expect(session.streamingMessageId).toBeUndefined();
			expect(session.streamingThoughtId).toBeUndefined();
		});

		it("no-op when no streaming message exists", () => {
			const store = useChatStore.getState();
			store.createLocalSession("session-1", { title: "Test" });
			store.addUserMessage("session-1", "Hello");

			const before = useChatStore.getState().sessions["session-1"];

			store.finalizeAssistantMessage("session-1");

			const after = useChatStore.getState().sessions["session-1"];
			// Messages should remain unchanged
			expect(after.messages).toEqual(before.messages);
		});

		it("clears streamingThoughtId along with streamingMessageId", () => {
			const store = useChatStore.getState();
			store.createLocalSession("session-1", { title: "Test" });
			store.appendAssistantChunk("session-1", "text");
			store.appendThoughtChunk("session-1", "thought");

			let session = useChatStore.getState().sessions["session-1"];
			expect(session.streamingMessageId).toBeDefined();
			expect(session.streamingThoughtId).toBeDefined();

			store.finalizeAssistantMessage("session-1");

			session = useChatStore.getState().sessions["session-1"];
			expect(session.streamingMessageId).toBeUndefined();
			expect(session.streamingThoughtId).toBeUndefined();
			expect(session.streamingMessageRole).toBeUndefined();
		});
	});

	// =========================================================================
	// 1.10 streaming role transitions
	// =========================================================================
	describe("streaming role transitions", () => {
		it("assistant→assistant: appends to same message", () => {
			const store = useChatStore.getState();
			store.createLocalSession("session-1", { title: "Test" });

			store.appendAssistantChunk("session-1", "Part 1 ");
			const firstId =
				useChatStore.getState().sessions["session-1"].streamingMessageId;

			store.appendAssistantChunk("session-1", "Part 2");
			const secondId =
				useChatStore.getState().sessions["session-1"].streamingMessageId;

			expect(firstId).toBe(secondId);
			const session = useChatStore.getState().sessions["session-1"];
			expect(session.messages).toHaveLength(1);
			if (session.messages[0].kind === "text") {
				expect(session.messages[0].content).toBe("Part 1 Part 2");
			}
		});

		it("assistant→user: creates new user message, resets streamingMessageId", () => {
			const store = useChatStore.getState();
			store.createLocalSession("session-1", { title: "Test" });

			store.appendAssistantChunk("session-1", "Assistant text");
			const assistantMsgId =
				useChatStore.getState().sessions["session-1"].streamingMessageId;

			store.appendUserChunk("session-1", "User text");
			const session = useChatStore.getState().sessions["session-1"];

			expect(session.messages).toHaveLength(2);
			expect(session.messages[0].role).toBe("assistant");
			expect(session.messages[1].role).toBe("user");
			expect(session.streamingMessageId).not.toBe(assistantMsgId);
			expect(session.streamingMessageRole).toBe("user");
		});

		it("user→assistant: creates new assistant message, resets streamingMessageId", () => {
			const store = useChatStore.getState();
			store.createLocalSession("session-1", { title: "Test" });

			store.appendUserChunk("session-1", "User text");
			const userMsgId =
				useChatStore.getState().sessions["session-1"].streamingMessageId;

			store.appendAssistantChunk("session-1", "Assistant text");
			const session = useChatStore.getState().sessions["session-1"];

			expect(session.messages).toHaveLength(2);
			expect(session.messages[0].role).toBe("user");
			expect(session.messages[1].role).toBe("assistant");
			expect(session.streamingMessageId).not.toBe(userMsgId);
			expect(session.streamingMessageRole).toBe("assistant");
		});

		it("finalize clears both streamingMessageId and streamingThoughtId", () => {
			const store = useChatStore.getState();
			store.createLocalSession("session-1", { title: "Test" });

			store.appendAssistantChunk("session-1", "text");
			store.appendThoughtChunk("session-1", "thought");
			store.finalizeAssistantMessage("session-1");

			const session = useChatStore.getState().sessions["session-1"];
			expect(session.streamingMessageId).toBeUndefined();
			expect(session.streamingThoughtId).toBeUndefined();
			expect(session.streamingMessageRole).toBeUndefined();
		});
	});
});
