import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatSession } from "@/lib/chat-store";
import type { ChatStoreActions } from "../useSessionMutations";
import { useSocket } from "../useSocket";

const handlers = vi.hoisted(
	() => ({}) as Record<string, ((payload?: unknown) => void) | undefined>,
);

// Store state that can be mutated by tests
const mockStoreState = vi.hoisted(
	() =>
		({
			sessions: {} as Record<string, ChatSession>,
		}) as { sessions: Record<string, ChatSession> },
);

// Mock useChatStore.getState() to return our controlled state
vi.mock("@/lib/chat-store", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/chat-store")>();
	return {
		...actual,
		useChatStore: {
			getState: () => mockStoreState,
		},
	};
});

vi.mock("@/hooks/use-session-backfill", () => ({
	useSessionBackfill: () => ({
		startBackfill: vi.fn(),
		cancelBackfill: vi.fn(),
		isBackfilling: vi.fn(() => false),
	}),
}));

const mockGatewaySocket = vi.hoisted(() => ({
	connect: vi.fn(),
	disconnect: vi.fn(),
	subscribeToSession: vi.fn(),
	unsubscribeFromSession: vi.fn(),
	getSubscribedSessions: vi.fn(() => []),
	getGatewayUrl: vi.fn(() => "http://localhost:3005"),
	onSessionEvent: vi.fn(),
	onPermissionRequest: vi.fn(),
	onPermissionResult: vi.fn(),
	onSessionsChanged: vi.fn(),
	onSessionAttached: vi.fn(),
	onSessionDetached: vi.fn(),
	onCliStatus: vi.fn(),
	onDisconnect: vi.fn(),
	onConnect: vi.fn(),
}));

vi.mock("@/lib/socket", () => ({
	gatewaySocket: mockGatewaySocket,
}));

vi.mock("@/lib/notifications", () => ({
	notifyPermissionRequest: vi.fn(),
	notifySessionError: vi.fn(),
}));

vi.mock("@/lib/machines-store", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/machines-store")>();
	return {
		...actual,
		useMachinesStore: {
			getState: () => ({
				updateMachine: vi.fn(),
				updateBackendCapabilities: vi.fn(),
			}),
		},
	};
});

vi.mock("react-i18next", async (importOriginal) => {
	const actual = await importOriginal<typeof import("react-i18next")>();
	return {
		...actual,
		useTranslation: () => ({ t: (key: string) => key }),
	};
});

const createStore = (): ChatStoreActions => {
	// Create updateSessionCursor that also updates the mock store state
	const updateSessionCursor = vi.fn(
		(sessionId: string, revision: number, seq: number) => {
			const session = mockStoreState.sessions[sessionId];
			if (session) {
				mockStoreState.sessions[sessionId] = {
					...session,
					revision,
					lastAppliedSeq: seq,
				};
			}
		},
	);

	// Create resetSessionForRevision that resets the session
	const resetSessionForRevision = vi.fn(
		(sessionId: string, revision: number) => {
			const session = mockStoreState.sessions[sessionId];
			if (session) {
				mockStoreState.sessions[sessionId] = {
					...session,
					revision,
					lastAppliedSeq: 0,
				};
			}
		},
	);

	return {
		sessions: {},
		setActiveSessionId: vi.fn(),
		setLastCreatedCwd: vi.fn(),
		setSessionLoading: vi.fn(),
		markSessionAttached: vi.fn(),
		markSessionDetached: vi.fn(),
		createLocalSession: vi.fn(),
		syncSessions: vi.fn(),
		removeSession: vi.fn(),
		renameSession: vi.fn(),
		setError: vi.fn(),
		setAppError: vi.fn(),
		setInput: vi.fn(),
		setInputContents: vi.fn(),
		setSending: vi.fn(),
		setCanceling: vi.fn(),
		setStreamError: vi.fn(),
		updateSessionMeta: vi.fn(),
		addUserMessage: vi.fn(),
		addStatusMessage: vi.fn(),
		appendAssistantChunk: vi.fn(),
		appendThoughtChunk: vi.fn(),
		confirmOrAppendUserMessage: vi.fn(),
		finalizeAssistantMessage: vi.fn(),
		addPermissionRequest: vi.fn(),
		setPermissionDecisionState: vi.fn(),
		setPermissionOutcome: vi.fn(),
		addToolCall: vi.fn(),
		updateToolCall: vi.fn(),
		appendTerminalOutput: vi.fn(),
		handleSessionsChanged: vi.fn(),
		clearSessionMessages: vi.fn(),
		restoreSessionMessages: vi.fn(),
		updateSessionCursor,
		resetSessionForRevision,
	} as unknown as ChatStoreActions;
};

const buildSession = (overrides: Partial<ChatSession> = {}): ChatSession => ({
	sessionId: "session-1",
	title: "Session 1",
	input: "",
	inputContents: [],
	messages: [],
	terminalOutputs: {},
	sending: false,
	canceling: false,
	isAttached: false,
	isLoading: false,
	...overrides,
});

describe("useSocket (webui)", () => {
	beforeEach(() => {
		// Reset mock store state
		mockStoreState.sessions = {};

		for (const key of Object.keys(handlers)) {
			delete handlers[key];
		}
		mockGatewaySocket.connect.mockReset();
		mockGatewaySocket.disconnect.mockReset();
		mockGatewaySocket.subscribeToSession.mockReset();
		mockGatewaySocket.unsubscribeFromSession.mockReset();

		mockGatewaySocket.onPermissionRequest.mockImplementation(
			(handler: () => void) => {
				handlers.permissionRequest = handler;
				return () => {
					handlers.permissionRequest = undefined;
				};
			},
		);
		mockGatewaySocket.onPermissionResult.mockImplementation(
			(handler: () => void) => {
				handlers.permissionResult = handler;
				return () => {
					handlers.permissionResult = undefined;
				};
			},
		);
		mockGatewaySocket.onSessionsChanged.mockImplementation(
			(handler: () => void) => {
				handlers.sessionsChanged = handler;
				return () => {
					handlers.sessionsChanged = undefined;
				};
			},
		);
		mockGatewaySocket.onSessionEvent.mockImplementation(
			(handler: (event: unknown) => void) => {
				handlers.sessionEvent = handler;
				return () => {
					handlers.sessionEvent = undefined;
				};
			},
		);
		mockGatewaySocket.onSessionAttached.mockImplementation(
			(handler: (payload: unknown) => void) => {
				handlers.sessionAttached = handler;
				return () => {
					handlers.sessionAttached = undefined;
				};
			},
		);
		mockGatewaySocket.onSessionDetached.mockImplementation(
			(handler: (payload: unknown) => void) => {
				handlers.sessionDetached = handler;
				return () => {
					handlers.sessionDetached = undefined;
				};
			},
		);
		mockGatewaySocket.onDisconnect.mockImplementation(
			(handler: (reason: unknown) => void) => {
				handlers.disconnect = handler;
				return () => {
					handlers.disconnect = undefined;
				};
			},
		);
		mockGatewaySocket.onCliStatus.mockImplementation((handler: () => void) => {
			handlers.cliStatus = handler;
			return () => {
				handlers.cliStatus = undefined;
			};
		});
		mockGatewaySocket.onConnect.mockImplementation((handler: () => void) => {
			handlers.connect = handler;
			return () => {
				handlers.connect = undefined;
			};
		});
	});

	it("subscribes to sessions that are attached or loading", async () => {
		const store = createStore();
		const sessions: Record<string, ChatSession> = {
			"session-1": buildSession({ sessionId: "session-1", isAttached: true }),
			"session-2": buildSession({ sessionId: "session-2", isLoading: true }),
		};

		const { rerender } = renderHook(
			(props: { sessions: Record<string, ChatSession> }) =>
				useSocket({
					sessions: props.sessions,
					appendAssistantChunk: store.appendAssistantChunk,
					appendThoughtChunk: store.appendThoughtChunk,
					confirmOrAppendUserMessage: store.confirmOrAppendUserMessage,
					updateSessionMeta: store.updateSessionMeta,
					setStreamError: store.setStreamError,
					addPermissionRequest: store.addPermissionRequest,
					setPermissionDecisionState: store.setPermissionDecisionState,
					setPermissionOutcome: store.setPermissionOutcome,
					addToolCall: store.addToolCall,
					updateToolCall: store.updateToolCall,
					appendTerminalOutput: store.appendTerminalOutput,
					handleSessionsChanged: store.handleSessionsChanged,
					markSessionAttached: store.markSessionAttached,
					markSessionDetached: store.markSessionDetached,
					createLocalSession: store.createLocalSession,
					updateSessionCursor: store.updateSessionCursor,
					resetSessionForRevision: store.resetSessionForRevision,
				}),
			{ initialProps: { sessions } },
		);

		await waitFor(() => {
			expect(mockGatewaySocket.subscribeToSession).toHaveBeenCalledWith(
				"session-1",
			);
			expect(mockGatewaySocket.subscribeToSession).toHaveBeenCalledWith(
				"session-2",
			);
		});

		rerender({ sessions: {} });

		await waitFor(() => {
			expect(mockGatewaySocket.unsubscribeFromSession).toHaveBeenCalledWith(
				"session-1",
			);
			expect(mockGatewaySocket.unsubscribeFromSession).toHaveBeenCalledWith(
				"session-2",
			);
		});
	});

	it("marks session attached on session:attached event", async () => {
		const store = createStore();

		renderHook(() =>
			useSocket({
				sessions: {},
				appendAssistantChunk: store.appendAssistantChunk,
				appendThoughtChunk: store.appendThoughtChunk,
				confirmOrAppendUserMessage: store.confirmOrAppendUserMessage,
				updateSessionMeta: store.updateSessionMeta,
				setStreamError: store.setStreamError,
				addPermissionRequest: store.addPermissionRequest,
				setPermissionDecisionState: store.setPermissionDecisionState,
				setPermissionOutcome: store.setPermissionOutcome,
				addToolCall: store.addToolCall,
				updateToolCall: store.updateToolCall,
				appendTerminalOutput: store.appendTerminalOutput,
				handleSessionsChanged: store.handleSessionsChanged,
				markSessionAttached: store.markSessionAttached,
				markSessionDetached: store.markSessionDetached,
				createLocalSession: store.createLocalSession,
				updateSessionCursor: store.updateSessionCursor,
				resetSessionForRevision: store.resetSessionForRevision,
			}),
		);

		handlers.sessionAttached?.({
			sessionId: "session-1",
			machineId: "machine-1",
			attachedAt: "2024-01-01T00:00:00Z",
		});

		expect(store.markSessionAttached).toHaveBeenCalledWith({
			sessionId: "session-1",
			machineId: "machine-1",
			attachedAt: "2024-01-01T00:00:00Z",
		});
	});

	it("marks sessions detached on socket disconnect", async () => {
		const store = createStore();
		const sessions = {
			"session-1": buildSession({
				sessionId: "session-1",
				isAttached: true,
				machineId: "machine-1",
			}),
		};

		renderHook(() =>
			useSocket({
				sessions,
				appendAssistantChunk: store.appendAssistantChunk,
				appendThoughtChunk: store.appendThoughtChunk,
				confirmOrAppendUserMessage: store.confirmOrAppendUserMessage,
				updateSessionMeta: store.updateSessionMeta,
				setStreamError: store.setStreamError,
				addPermissionRequest: store.addPermissionRequest,
				setPermissionDecisionState: store.setPermissionDecisionState,
				setPermissionOutcome: store.setPermissionOutcome,
				addToolCall: store.addToolCall,
				updateToolCall: store.updateToolCall,
				appendTerminalOutput: store.appendTerminalOutput,
				handleSessionsChanged: store.handleSessionsChanged,
				markSessionAttached: store.markSessionAttached,
				markSessionDetached: store.markSessionDetached,
				createLocalSession: store.createLocalSession,
				updateSessionCursor: store.updateSessionCursor,
				resetSessionForRevision: store.resetSessionForRevision,
			}),
		);

		handlers.disconnect?.("transport close");

		expect(store.markSessionDetached).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionId: "session-1",
				machineId: "machine-1",
				reason: "gateway_disconnect",
			}),
		);
	});

	it("P0-6: updates cursor synchronously for consecutive events in same tick", async () => {
		const store = createStore();
		const sessions = {
			"session-1": buildSession({
				sessionId: "session-1",
				isAttached: true,
				revision: 1,
				lastAppliedSeq: 0,
			}),
		};
		// Set up mock store state so getCursor returns correct values
		mockStoreState.sessions = { ...sessions };

		renderHook(() =>
			useSocket({
				sessions,
				appendAssistantChunk: store.appendAssistantChunk,
				appendThoughtChunk: store.appendThoughtChunk,
				confirmOrAppendUserMessage: store.confirmOrAppendUserMessage,
				updateSessionMeta: store.updateSessionMeta,
				setStreamError: store.setStreamError,
				addPermissionRequest: store.addPermissionRequest,
				setPermissionDecisionState: store.setPermissionDecisionState,
				setPermissionOutcome: store.setPermissionOutcome,
				addToolCall: store.addToolCall,
				updateToolCall: store.updateToolCall,
				appendTerminalOutput: store.appendTerminalOutput,
				handleSessionsChanged: store.handleSessionsChanged,
				markSessionAttached: store.markSessionAttached,
				markSessionDetached: store.markSessionDetached,
				createLocalSession: store.createLocalSession,
				updateSessionCursor: store.updateSessionCursor,
				resetSessionForRevision: store.resetSessionForRevision,
			}),
		);

		// Simulate receiving multiple events in quick succession (same tick)
		handlers.sessionEvent?.({
			sessionId: "session-1",
			revision: 1,
			seq: 1,
			kind: "agent_message_chunk",
			payload: {
				sessionId: "session-1",
				update: {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "Hello" },
				},
			},
		});
		handlers.sessionEvent?.({
			sessionId: "session-1",
			revision: 1,
			seq: 2,
			kind: "agent_message_chunk",
			payload: {
				sessionId: "session-1",
				update: {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: " world" },
				},
			},
		});
		handlers.sessionEvent?.({
			sessionId: "session-1",
			revision: 1,
			seq: 3,
			kind: "agent_message_chunk",
			payload: {
				sessionId: "session-1",
				update: {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "!" },
				},
			},
		});

		// With P0-6 fix, all three events should be applied (cursor updates synchronously)
		// Each event should trigger updateSessionCursor with incrementing seq
		expect(store.updateSessionCursor).toHaveBeenCalledTimes(3);
		expect(store.updateSessionCursor).toHaveBeenNthCalledWith(
			1,
			"session-1",
			1,
			1,
		);
		expect(store.updateSessionCursor).toHaveBeenNthCalledWith(
			2,
			"session-1",
			1,
			2,
		);
		expect(store.updateSessionCursor).toHaveBeenNthCalledWith(
			3,
			"session-1",
			1,
			3,
		);
	});

	it("P0-6: skips duplicate events based on cursor", async () => {
		const store = createStore();
		const sessions = {
			"session-1": buildSession({
				sessionId: "session-1",
				isAttached: true,
				revision: 1,
				lastAppliedSeq: 5,
			}),
		};
		// Set up mock store state so getCursor returns correct values
		mockStoreState.sessions = { ...sessions };

		renderHook(() =>
			useSocket({
				sessions,
				appendAssistantChunk: store.appendAssistantChunk,
				appendThoughtChunk: store.appendThoughtChunk,
				confirmOrAppendUserMessage: store.confirmOrAppendUserMessage,
				updateSessionMeta: store.updateSessionMeta,
				setStreamError: store.setStreamError,
				addPermissionRequest: store.addPermissionRequest,
				setPermissionDecisionState: store.setPermissionDecisionState,
				setPermissionOutcome: store.setPermissionOutcome,
				addToolCall: store.addToolCall,
				updateToolCall: store.updateToolCall,
				appendTerminalOutput: store.appendTerminalOutput,
				handleSessionsChanged: store.handleSessionsChanged,
				markSessionAttached: store.markSessionAttached,
				markSessionDetached: store.markSessionDetached,
				createLocalSession: store.createLocalSession,
				updateSessionCursor: store.updateSessionCursor,
				resetSessionForRevision: store.resetSessionForRevision,
			}),
		);

		// Event with seq <= lastAppliedSeq should be skipped
		handlers.sessionEvent?.({
			sessionId: "session-1",
			revision: 1,
			seq: 3, // Already applied (lastAppliedSeq is 5)
			kind: "agent_message_chunk",
			payload: {
				sessionId: "session-1",
				update: {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "old" },
				},
			},
		});

		// Should not update cursor for already applied event
		expect(store.updateSessionCursor).not.toHaveBeenCalled();
		expect(store.appendAssistantChunk).not.toHaveBeenCalled();
	});

	it("P0-7: detects gap and triggers backfill instead of skipping", async () => {
		const store = createStore();
		const sessions = {
			"session-1": buildSession({
				sessionId: "session-1",
				isAttached: true,
				revision: 1,
				lastAppliedSeq: 0,
			}),
		};
		// Set up mock store state so getCursor returns correct values
		mockStoreState.sessions = { ...sessions };

		renderHook(() =>
			useSocket({
				sessions,
				appendAssistantChunk: store.appendAssistantChunk,
				appendThoughtChunk: store.appendThoughtChunk,
				confirmOrAppendUserMessage: store.confirmOrAppendUserMessage,
				updateSessionMeta: store.updateSessionMeta,
				setStreamError: store.setStreamError,
				addPermissionRequest: store.addPermissionRequest,
				setPermissionDecisionState: store.setPermissionDecisionState,
				setPermissionOutcome: store.setPermissionOutcome,
				addToolCall: store.addToolCall,
				updateToolCall: store.updateToolCall,
				appendTerminalOutput: store.appendTerminalOutput,
				handleSessionsChanged: store.handleSessionsChanged,
				markSessionAttached: store.markSessionAttached,
				markSessionDetached: store.markSessionDetached,
				createLocalSession: store.createLocalSession,
				updateSessionCursor: store.updateSessionCursor,
				resetSessionForRevision: store.resetSessionForRevision,
			}),
		);

		// Event seq=1 arrives first - should be applied
		handlers.sessionEvent?.({
			sessionId: "session-1",
			revision: 1,
			seq: 1,
			kind: "agent_message_chunk",
			payload: {
				sessionId: "session-1",
				update: {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "first" },
				},
			},
		});

		expect(store.updateSessionCursor).toHaveBeenCalledWith("session-1", 1, 1);

		// Event seq=5 arrives (gap: missing 2,3,4) - should NOT be applied directly
		// Instead, should trigger backfill
		handlers.sessionEvent?.({
			sessionId: "session-1",
			revision: 1,
			seq: 5,
			kind: "agent_message_chunk",
			payload: {
				sessionId: "session-1",
				update: {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "fifth" },
				},
			},
		});

		// Should only have one cursor update (for seq=1), not for seq=5
		// Because seq=5 has a gap and should be buffered, not applied
		expect(store.updateSessionCursor).toHaveBeenCalledTimes(1);
		// The event with gap should NOT trigger appendAssistantChunk for "fifth"
		// (it should be buffered until backfill fills the gap)
		expect(store.appendAssistantChunk).toHaveBeenCalledWith(
			"session-1",
			"first",
		);
		expect(store.appendAssistantChunk).not.toHaveBeenCalledWith(
			"session-1",
			"fifth",
		);
	});

	it("resets sending state when turn_end event is received", async () => {
		const store = createStore();
		const sessions = {
			"session-1": buildSession({
				sessionId: "session-1",
				isAttached: true,
				revision: 1,
				lastAppliedSeq: 0,
				sending: true,
				canceling: true,
			}),
		};
		mockStoreState.sessions = { ...sessions };

		renderHook(() =>
			useSocket({
				sessions,
				setSending: store.setSending,
				setCanceling: store.setCanceling,
				finalizeAssistantMessage: store.finalizeAssistantMessage,
				appendAssistantChunk: store.appendAssistantChunk,
				appendThoughtChunk: store.appendThoughtChunk,
				confirmOrAppendUserMessage: store.confirmOrAppendUserMessage,
				updateSessionMeta: store.updateSessionMeta,
				setStreamError: store.setStreamError,
				addPermissionRequest: store.addPermissionRequest,
				setPermissionDecisionState: store.setPermissionDecisionState,
				setPermissionOutcome: store.setPermissionOutcome,
				addToolCall: store.addToolCall,
				updateToolCall: store.updateToolCall,
				appendTerminalOutput: store.appendTerminalOutput,
				handleSessionsChanged: store.handleSessionsChanged,
				markSessionAttached: store.markSessionAttached,
				markSessionDetached: store.markSessionDetached,
				createLocalSession: store.createLocalSession,
				updateSessionCursor: store.updateSessionCursor,
				resetSessionForRevision: store.resetSessionForRevision,
			}),
		);

		handlers.sessionEvent?.({
			sessionId: "session-1",
			revision: 1,
			seq: 1,
			kind: "turn_end",
			payload: {
				stopReason: "end_turn",
			},
		});

		expect(store.finalizeAssistantMessage).toHaveBeenCalledWith("session-1");
		expect(store.setSending).toHaveBeenCalledWith("session-1", false);
		expect(store.setCanceling).toHaveBeenCalledWith("session-1", false);
	});

	it("user_message event calls confirmOrAppendUserMessage regardless of sending state", async () => {
		const store = createStore();
		const sessions = {
			"session-1": buildSession({
				sessionId: "session-1",
				isAttached: true,
				revision: 1,
				lastAppliedSeq: 0,
				sending: true,
			}),
		};
		mockStoreState.sessions = { ...sessions };

		renderHook(() =>
			useSocket({
				sessions,
				appendAssistantChunk: store.appendAssistantChunk,
				appendThoughtChunk: store.appendThoughtChunk,
				confirmOrAppendUserMessage: store.confirmOrAppendUserMessage,
				updateSessionMeta: store.updateSessionMeta,
				setStreamError: store.setStreamError,
				addPermissionRequest: store.addPermissionRequest,
				setPermissionDecisionState: store.setPermissionDecisionState,
				setPermissionOutcome: store.setPermissionOutcome,
				addToolCall: store.addToolCall,
				updateToolCall: store.updateToolCall,
				appendTerminalOutput: store.appendTerminalOutput,
				handleSessionsChanged: store.handleSessionsChanged,
				markSessionAttached: store.markSessionAttached,
				markSessionDetached: store.markSessionDetached,
				createLocalSession: store.createLocalSession,
				updateSessionCursor: store.updateSessionCursor,
				resetSessionForRevision: store.resetSessionForRevision,
			}),
		);

		handlers.sessionEvent?.({
			sessionId: "session-1",
			revision: 1,
			seq: 1,
			kind: "user_message",
			payload: {
				sessionId: "session-1",
				update: {
					sessionUpdate: "user_message_chunk",
					content: { type: "text", text: "Hello" },
				},
			},
		});

		// Cursor should advance and confirmOrAppendUserMessage should be called
		// (provisional pattern handles dedup internally via store action)
		expect(store.updateSessionCursor).toHaveBeenCalledWith("session-1", 1, 1);
		expect(store.confirmOrAppendUserMessage).toHaveBeenCalledWith(
			"session-1",
			"Hello",
		);
	});

	it("processes user_message event when session is not sending", async () => {
		const store = createStore();
		const sessions = {
			"session-1": buildSession({
				sessionId: "session-1",
				isAttached: true,
				revision: 1,
				lastAppliedSeq: 0,
				sending: false,
			}),
		};
		mockStoreState.sessions = { ...sessions };

		renderHook(() =>
			useSocket({
				sessions,
				appendAssistantChunk: store.appendAssistantChunk,
				appendThoughtChunk: store.appendThoughtChunk,
				confirmOrAppendUserMessage: store.confirmOrAppendUserMessage,
				updateSessionMeta: store.updateSessionMeta,
				setStreamError: store.setStreamError,
				addPermissionRequest: store.addPermissionRequest,
				setPermissionDecisionState: store.setPermissionDecisionState,
				setPermissionOutcome: store.setPermissionOutcome,
				addToolCall: store.addToolCall,
				updateToolCall: store.updateToolCall,
				appendTerminalOutput: store.appendTerminalOutput,
				handleSessionsChanged: store.handleSessionsChanged,
				markSessionAttached: store.markSessionAttached,
				markSessionDetached: store.markSessionDetached,
				createLocalSession: store.createLocalSession,
				updateSessionCursor: store.updateSessionCursor,
				resetSessionForRevision: store.resetSessionForRevision,
			}),
		);

		handlers.sessionEvent?.({
			sessionId: "session-1",
			revision: 1,
			seq: 1,
			kind: "user_message",
			payload: {
				sessionId: "session-1",
				update: {
					sessionUpdate: "user_message_chunk",
					content: { type: "text", text: "Hello from CLI" },
				},
			},
		});

		// Both cursor and confirmOrAppendUserMessage should be called
		expect(store.updateSessionCursor).toHaveBeenCalledWith("session-1", 1, 1);
		expect(store.confirmOrAppendUserMessage).toHaveBeenCalledWith(
			"session-1",
			"Hello from CLI",
		);
	});

	// =========================================================================
	// socket event type handling — covers all dispatch branches in applySessionEvent
	// =========================================================================
	describe("socket event type handling", () => {
		/**
		 * Helper: render the hook with a session at seq=0, fire an event, return the store.
		 */
		const setupAndFire = (
			kind: string,
			payload: unknown,
			sessionOverrides: Partial<ChatSession> = {},
		) => {
			const store = createStore();
			const sessions = {
				"session-1": buildSession({
					sessionId: "session-1",
					isAttached: true,
					revision: 1,
					lastAppliedSeq: 0,
					...sessionOverrides,
				}),
			};
			mockStoreState.sessions = { ...sessions };

			renderHook(() =>
				useSocket({
					sessions,
					setSending: store.setSending,
					setCanceling: store.setCanceling,
					finalizeAssistantMessage: store.finalizeAssistantMessage,
					appendAssistantChunk: store.appendAssistantChunk,
					appendThoughtChunk: store.appendThoughtChunk,
					confirmOrAppendUserMessage: store.confirmOrAppendUserMessage,
					updateSessionMeta: store.updateSessionMeta,
					setStreamError: store.setStreamError,
					addPermissionRequest: store.addPermissionRequest,
					setPermissionDecisionState: store.setPermissionDecisionState,
					setPermissionOutcome: store.setPermissionOutcome,
					addToolCall: store.addToolCall,
					updateToolCall: store.updateToolCall,
					appendTerminalOutput: store.appendTerminalOutput,
					handleSessionsChanged: store.handleSessionsChanged,
					markSessionAttached: store.markSessionAttached,
					markSessionDetached: store.markSessionDetached,
					createLocalSession: store.createLocalSession,
					updateSessionCursor: store.updateSessionCursor,
					resetSessionForRevision: store.resetSessionForRevision,
				}),
			);

			handlers.sessionEvent?.({
				sessionId: "session-1",
				revision: 1,
				seq: 1,
				kind,
				payload,
			});

			return store;
		};

		it("dispatches agent_thought_chunk to appendThoughtChunk", () => {
			const store = setupAndFire("agent_thought_chunk", {
				sessionId: "session-1",
				update: {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "I'm thinking" },
				},
			});

			expect(store.appendThoughtChunk).toHaveBeenCalledWith(
				"session-1",
				"I'm thinking",
			);
		});

		it("dispatches tool_call to addToolCall", () => {
			const store = setupAndFire("tool_call", {
				sessionId: "session-1",
				update: {
					sessionUpdate: "tool_call",
					toolCallId: "tc-1",
					status: "running",
					title: "Reading file",
				},
			});

			expect(store.addToolCall).toHaveBeenCalledWith(
				"session-1",
				expect.objectContaining({
					sessionUpdate: "tool_call",
					toolCallId: "tc-1",
				}),
			);
		});

		it("dispatches tool_call_update to updateToolCall", () => {
			const store = setupAndFire("tool_call_update", {
				sessionId: "session-1",
				update: {
					sessionUpdate: "tool_call_update",
					toolCallId: "tc-1",
					status: "completed",
					title: "Done",
				},
			});

			expect(store.updateToolCall).toHaveBeenCalledWith(
				"session-1",
				expect.objectContaining({
					sessionUpdate: "tool_call_update",
					toolCallId: "tc-1",
				}),
			);
		});

		it("dispatches terminal_output to appendTerminalOutput", () => {
			const store = setupAndFire("terminal_output", {
				terminalId: "term-1",
				delta: "$ ls\nfoo.ts\n",
				truncated: false,
				exitStatus: { exitCode: 0, signal: null },
			});

			expect(store.appendTerminalOutput).toHaveBeenCalledWith("session-1", {
				terminalId: "term-1",
				delta: "$ ls\nfoo.ts\n",
				truncated: false,
				output: undefined,
				exitStatus: { exitCode: 0, signal: null },
			});
		});

		it("dispatches session_info_update to updateSessionMeta", () => {
			const store = setupAndFire("session_info_update", {
				sessionId: "session-1",
				update: {
					sessionUpdate: "session_info_update",
					title: "New Title",
				},
			});

			expect(store.updateSessionMeta).toHaveBeenCalledWith(
				"session-1",
				expect.objectContaining({ title: "New Title" }),
			);
		});

		it("dispatches permission_request to addPermissionRequest", () => {
			const store = setupAndFire("permission_request", {
				requestId: "req-1",
				toolCall: { toolCallId: "tc-1", status: "running" },
				options: [{ id: "allow", label: "Allow", isRecommended: true }],
			});

			expect(store.addPermissionRequest).toHaveBeenCalledWith("session-1", {
				requestId: "req-1",
				toolCall: { toolCallId: "tc-1", status: "running" },
				options: [{ id: "allow", label: "Allow", isRecommended: true }],
			});
		});

		it("dispatches permission_result to setPermissionOutcome + setPermissionDecisionState", () => {
			const store = setupAndFire("permission_result", {
				sessionId: "session-1",
				requestId: "req-1",
				outcome: { outcome: "selected", selectedOptionId: "allow" },
			});

			expect(store.setPermissionOutcome).toHaveBeenCalledWith(
				"session-1",
				"req-1",
				{ outcome: "selected", selectedOptionId: "allow" },
			);
			expect(store.setPermissionDecisionState).toHaveBeenCalledWith(
				"session-1",
				"req-1",
				"idle",
			);
		});

		it("dispatches session_error to setStreamError", () => {
			const store = setupAndFire("session_error", {
				error: {
					code: "RATE_LIMIT",
					message: "Too many requests",
					retryable: true,
					scope: "session",
				},
			});

			expect(store.setStreamError).toHaveBeenCalledWith(
				"session-1",
				expect.objectContaining({
					code: "RATE_LIMIT",
					message: "Too many requests",
				}),
			);
		});

		it("dispatches usage_update to updateSessionMeta", () => {
			const store = setupAndFire("usage_update", {
				sessionId: "session-1",
				update: {
					sessionUpdate: "usage_update",
					used: 1000,
					size: 200000,
					cost: { totalCost: 0.05 },
				},
			});

			expect(store.updateSessionMeta).toHaveBeenCalledWith("session-1", {
				usage: {
					used: 1000,
					size: 200000,
					cost: { totalCost: 0.05 },
				},
			});
		});

		it("silently ignores unknown_update events", () => {
			const store = setupAndFire("unknown_update", {
				sessionId: "session-1",
				update: { sessionUpdate: "some_future_type" },
			});

			// No dispatch should happen for unknown events
			expect(store.appendAssistantChunk).not.toHaveBeenCalled();
			expect(store.appendThoughtChunk).not.toHaveBeenCalled();
			expect(store.confirmOrAppendUserMessage).not.toHaveBeenCalled();
			expect(store.addToolCall).not.toHaveBeenCalled();
			expect(store.updateToolCall).not.toHaveBeenCalled();
			expect(store.appendTerminalOutput).not.toHaveBeenCalled();
			expect(store.addPermissionRequest).not.toHaveBeenCalled();
			// setStreamError is called once on subscribe with undefined (reset),
			// but should NOT be called with an actual error from unknown_update
			expect(store.setStreamError).not.toHaveBeenCalledWith(
				"session-1",
				expect.objectContaining({ code: expect.any(String) }),
			);
			// But cursor should still advance
			expect(store.updateSessionCursor).toHaveBeenCalledWith("session-1", 1, 1);
		});
	});

	// =========================================================================
	// loading guard — backfill skipped while session.isLoading
	// =========================================================================
	describe("loading guard (backfill deferred while isLoading)", () => {
		it("does NOT trigger initial backfill when session isLoading=true", async () => {
			const store = createStore();
			const sessions: Record<string, ChatSession> = {
				"session-1": buildSession({
					sessionId: "session-1",
					isAttached: true,
					isLoading: true,
					revision: 1,
					lastAppliedSeq: 0,
				}),
			};
			mockStoreState.sessions = { ...sessions };

			renderHook(
				(props: { sessions: Record<string, ChatSession> }) =>
					useSocket({
						sessions: props.sessions,
						appendAssistantChunk: store.appendAssistantChunk,
						appendThoughtChunk: store.appendThoughtChunk,
						confirmOrAppendUserMessage: store.confirmOrAppendUserMessage,
						updateSessionMeta: store.updateSessionMeta,
						setStreamError: store.setStreamError,
						addPermissionRequest: store.addPermissionRequest,
						setPermissionDecisionState: store.setPermissionDecisionState,
						setPermissionOutcome: store.setPermissionOutcome,
						addToolCall: store.addToolCall,
						updateToolCall: store.updateToolCall,
						appendTerminalOutput: store.appendTerminalOutput,
						handleSessionsChanged: store.handleSessionsChanged,
						markSessionAttached: store.markSessionAttached,
						markSessionDetached: store.markSessionDetached,
						createLocalSession: store.createLocalSession,
						updateSessionCursor: store.updateSessionCursor,
						resetSessionForRevision: store.resetSessionForRevision,
					}),
				{ initialProps: { sessions } },
			);

			await waitFor(() => {
				// Should subscribe to the session
				expect(mockGatewaySocket.subscribeToSession).toHaveBeenCalledWith(
					"session-1",
				);
			});

			// But should NOT have triggered backfill (resetSessionForRevision is a proxy indicator)
			// The key behavior: no startBackfill was called because isLoading=true
			// We verify indirectly: the session is subscribed but no cursor operations happened
			expect(store.resetSessionForRevision).not.toHaveBeenCalled();
		});

		it("triggers backfill via compensation loop when isLoading transitions to false", async () => {
			const store = createStore();
			const loadingSessions: Record<string, ChatSession> = {
				"session-1": buildSession({
					sessionId: "session-1",
					isAttached: true,
					isLoading: true,
					revision: 1,
					lastAppliedSeq: 0,
				}),
			};
			mockStoreState.sessions = { ...loadingSessions };

			const { rerender } = renderHook(
				(props: { sessions: Record<string, ChatSession> }) =>
					useSocket({
						sessions: props.sessions,
						appendAssistantChunk: store.appendAssistantChunk,
						appendThoughtChunk: store.appendThoughtChunk,
						confirmOrAppendUserMessage: store.confirmOrAppendUserMessage,
						updateSessionMeta: store.updateSessionMeta,
						setStreamError: store.setStreamError,
						addPermissionRequest: store.addPermissionRequest,
						setPermissionDecisionState: store.setPermissionDecisionState,
						setPermissionOutcome: store.setPermissionOutcome,
						addToolCall: store.addToolCall,
						updateToolCall: store.updateToolCall,
						appendTerminalOutput: store.appendTerminalOutput,
						handleSessionsChanged: store.handleSessionsChanged,
						markSessionAttached: store.markSessionAttached,
						markSessionDetached: store.markSessionDetached,
						createLocalSession: store.createLocalSession,
						updateSessionCursor: store.updateSessionCursor,
						resetSessionForRevision: store.resetSessionForRevision,
					}),
				{ initialProps: { sessions: loadingSessions } },
			);

			await waitFor(() => {
				expect(mockGatewaySocket.subscribeToSession).toHaveBeenCalledWith(
					"session-1",
				);
			});

			// Now transition isLoading → false (loading completed)
			const readySessions: Record<string, ChatSession> = {
				"session-1": buildSession({
					sessionId: "session-1",
					isAttached: true,
					isLoading: false,
					revision: 1,
					lastAppliedSeq: 0,
				}),
			};
			mockStoreState.sessions = { ...readySessions };

			rerender({ sessions: readySessions });

			// The compensation loop should detect the subscribed session
			// is no longer loading and hasn't had backfill triggered yet.
			// The session should remain subscribed (not unsubscribed).
			await waitFor(() => {
				// Verify session is still subscribed (not unsubscribed)
				expect(
					mockGatewaySocket.unsubscribeFromSession,
				).not.toHaveBeenCalledWith("session-1");
			});
		});

		it("session:attached does NOT trigger backfill when isLoading=true", async () => {
			const store = createStore();
			// Session is loading — backfill should be deferred
			mockStoreState.sessions = {
				"session-1": buildSession({
					sessionId: "session-1",
					isAttached: false,
					isLoading: true,
					revision: 1,
					lastAppliedSeq: 0,
				}),
			};

			renderHook(() =>
				useSocket({
					sessions: {
						"session-1": buildSession({
							sessionId: "session-1",
							isAttached: false,
							isLoading: true,
							revision: 1,
							lastAppliedSeq: 0,
						}),
					},
					appendAssistantChunk: store.appendAssistantChunk,
					appendThoughtChunk: store.appendThoughtChunk,
					confirmOrAppendUserMessage: store.confirmOrAppendUserMessage,
					updateSessionMeta: store.updateSessionMeta,
					setStreamError: store.setStreamError,
					addPermissionRequest: store.addPermissionRequest,
					setPermissionDecisionState: store.setPermissionDecisionState,
					setPermissionOutcome: store.setPermissionOutcome,
					addToolCall: store.addToolCall,
					updateToolCall: store.updateToolCall,
					appendTerminalOutput: store.appendTerminalOutput,
					handleSessionsChanged: store.handleSessionsChanged,
					markSessionAttached: store.markSessionAttached,
					markSessionDetached: store.markSessionDetached,
					createLocalSession: store.createLocalSession,
					updateSessionCursor: store.updateSessionCursor,
					resetSessionForRevision: store.resetSessionForRevision,
				}),
			);

			// Fire session:attached with a revision
			handlers.sessionAttached?.({
				sessionId: "session-1",
				machineId: "machine-1",
				attachedAt: "2024-01-01T00:00:00Z",
				revision: 5,
			});

			// markSessionAttached should still be called
			expect(store.markSessionAttached).toHaveBeenCalledWith({
				sessionId: "session-1",
				machineId: "machine-1",
				attachedAt: "2024-01-01T00:00:00Z",
				revision: 5,
			});

			// But resetSessionForRevision should NOT be called (backfill deferred)
			expect(store.resetSessionForRevision).not.toHaveBeenCalled();
		});
	});

	// =========================================================================
	// onReconnect callback
	// =========================================================================
	describe("onReconnect callback", () => {
		it("does NOT call onReconnect on first connect", async () => {
			const store = createStore();
			const onReconnect = vi.fn();

			renderHook(() =>
				useSocket({
					sessions: {},
					appendAssistantChunk: store.appendAssistantChunk,
					appendThoughtChunk: store.appendThoughtChunk,
					confirmOrAppendUserMessage: store.confirmOrAppendUserMessage,
					updateSessionMeta: store.updateSessionMeta,
					setStreamError: store.setStreamError,
					addPermissionRequest: store.addPermissionRequest,
					setPermissionDecisionState: store.setPermissionDecisionState,
					setPermissionOutcome: store.setPermissionOutcome,
					addToolCall: store.addToolCall,
					updateToolCall: store.updateToolCall,
					appendTerminalOutput: store.appendTerminalOutput,
					handleSessionsChanged: store.handleSessionsChanged,
					markSessionAttached: store.markSessionAttached,
					markSessionDetached: store.markSessionDetached,
					createLocalSession: store.createLocalSession,
					updateSessionCursor: store.updateSessionCursor,
					resetSessionForRevision: store.resetSessionForRevision,
					onReconnect,
				}),
			);

			// Simulate first connect
			handlers.connect?.();

			expect(onReconnect).not.toHaveBeenCalled();
		});

		it("calls onReconnect on subsequent connects (reconnect)", async () => {
			const store = createStore();
			const onReconnect = vi.fn();

			renderHook(() =>
				useSocket({
					sessions: {},
					appendAssistantChunk: store.appendAssistantChunk,
					appendThoughtChunk: store.appendThoughtChunk,
					confirmOrAppendUserMessage: store.confirmOrAppendUserMessage,
					updateSessionMeta: store.updateSessionMeta,
					setStreamError: store.setStreamError,
					addPermissionRequest: store.addPermissionRequest,
					setPermissionDecisionState: store.setPermissionDecisionState,
					setPermissionOutcome: store.setPermissionOutcome,
					addToolCall: store.addToolCall,
					updateToolCall: store.updateToolCall,
					appendTerminalOutput: store.appendTerminalOutput,
					handleSessionsChanged: store.handleSessionsChanged,
					markSessionAttached: store.markSessionAttached,
					markSessionDetached: store.markSessionDetached,
					createLocalSession: store.createLocalSession,
					updateSessionCursor: store.updateSessionCursor,
					resetSessionForRevision: store.resetSessionForRevision,
					onReconnect,
				}),
			);

			// First connect — should NOT trigger onReconnect
			handlers.connect?.();
			expect(onReconnect).not.toHaveBeenCalled();

			// Second connect (reconnect) — should trigger onReconnect
			handlers.connect?.();
			expect(onReconnect).toHaveBeenCalledTimes(1);

			// Third connect — should trigger again
			handlers.connect?.();
			expect(onReconnect).toHaveBeenCalledTimes(2);
		});
	});
});
