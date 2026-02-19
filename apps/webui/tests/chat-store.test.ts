import type { SessionSummary, SessionsChangedPayload } from "@mobvibe/shared";
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
});
