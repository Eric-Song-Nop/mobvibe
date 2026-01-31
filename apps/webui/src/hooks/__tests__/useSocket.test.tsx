import type { ChatSession } from "@mobvibe/core";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatStoreActions } from "../useSessionMutations";
import { useSocket } from "../useSocket";

const handlers = vi.hoisted(
	() => ({}) as Record<string, ((payload?: unknown) => void) | undefined>,
);

const mockGatewaySocket = vi.hoisted(() => ({
	connect: vi.fn(),
	disconnect: vi.fn(),
	subscribeToSession: vi.fn(),
	unsubscribeFromSession: vi.fn(),
	onSessionUpdate: vi.fn(),
	onSessionError: vi.fn(),
	onPermissionRequest: vi.fn(),
	onPermissionResult: vi.fn(),
	onTerminalOutput: vi.fn(),
	onSessionsChanged: vi.fn(),
	onSessionAttached: vi.fn(),
	onSessionDetached: vi.fn(),
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

vi.mock("react-i18next", async (importOriginal) => {
	const actual = await importOriginal<typeof import("react-i18next")>();
	return {
		...actual,
		useTranslation: () => ({ t: (key: string) => key }),
	};
});

const createStore = (): ChatStoreActions =>
	({
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
	}) as unknown as ChatStoreActions;

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
		for (const key of Object.keys(handlers)) {
			delete handlers[key];
		}
		mockGatewaySocket.connect.mockReset();
		mockGatewaySocket.disconnect.mockReset();
		mockGatewaySocket.subscribeToSession.mockReset();
		mockGatewaySocket.unsubscribeFromSession.mockReset();

		mockGatewaySocket.onSessionUpdate.mockImplementation(
			(handler: () => void) => {
				handlers.sessionUpdate = handler;
				return () => {
					handlers.sessionUpdate = undefined;
				};
			},
		);
		mockGatewaySocket.onSessionError.mockImplementation(
			(handler: () => void) => {
				handlers.sessionError = handler;
				return () => {
					handlers.sessionError = undefined;
				};
			},
		);
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
		mockGatewaySocket.onTerminalOutput.mockImplementation(
			(handler: () => void) => {
				handlers.terminalOutput = handler;
				return () => {
					handlers.terminalOutput = undefined;
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
			(handler: (reason: string) => void) => {
				handlers.disconnect = handler;
				return () => {
					handlers.disconnect = undefined;
				};
			},
		);
		mockGatewaySocket.onConnect.mockImplementation((handler: () => void) => {
			handlers.connect = handler;
			return () => {
				handlers.connect = undefined;
			};
		});
	});

	it("subscribes to sessions that are attached or loading", async () => {
		const store = createStore();
		const sessions = {
			"session-1": buildSession({ sessionId: "session-1", isAttached: true }),
			"session-2": buildSession({ sessionId: "session-2", isLoading: true }),
		};

		const { rerender } = renderHook(
			(props: { sessions: Record<string, ChatSession> }) =>
				useSocket({
					sessions: props.sessions,
					appendAssistantChunk: store.appendAssistantChunk,
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
});
