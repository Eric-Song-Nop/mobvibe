import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewaySocket } from "../../socket/gateway-socket";
import type { ChatSession } from "../../stores/chat-store";
import { useSocket } from "../use-socket";

const handlers: Record<string, ((payload?: unknown) => void) | undefined> = {};

const socketMock = {
	on: vi.fn(),
	off: vi.fn(),
};

const gatewaySocket = {
	connect: vi.fn(() => socketMock),
	disconnect: vi.fn(),
	subscribeToSession: vi.fn(),
	unsubscribeFromSession: vi.fn(),
	onSessionUpdate: vi.fn(),
	onSessionError: vi.fn(),
	onPermissionRequest: vi.fn(),
	onPermissionResult: vi.fn(),
	onTerminalOutput: vi.fn(),
	onCliStatus: vi.fn(),
	onSessionAttached: vi.fn(),
	onSessionDetached: vi.fn(),
};

const gatewaySocketTyped = gatewaySocket as unknown as GatewaySocket;

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

describe("useSocket (core)", () => {
	beforeEach(() => {
		for (const key of Object.keys(handlers)) {
			delete handlers[key];
		}
		socketMock.on.mockReset();
		socketMock.off.mockReset();
		gatewaySocket.connect.mockClear();
		gatewaySocket.subscribeToSession.mockClear();
		gatewaySocket.unsubscribeFromSession.mockClear();

		socketMock.on.mockImplementation((event: string, handler: () => void) => {
			if (event === "disconnect") {
				handlers.disconnect = handler;
			}
		});

		gatewaySocket.onSessionUpdate.mockImplementation(() => () => undefined);
		gatewaySocket.onSessionError.mockImplementation(() => () => undefined);
		gatewaySocket.onPermissionRequest.mockImplementation(() => () => undefined);
		gatewaySocket.onPermissionResult.mockImplementation(() => () => undefined);
		gatewaySocket.onTerminalOutput.mockImplementation(() => () => undefined);
		gatewaySocket.onCliStatus.mockImplementation(() => () => undefined);
		gatewaySocket.onSessionAttached.mockImplementation(
			(handler: (payload: unknown) => void) => {
				handlers.sessionAttached = handler;
				return () => {
					handlers.sessionAttached = undefined;
				};
			},
		);
		gatewaySocket.onSessionDetached.mockImplementation(
			(handler: (payload: unknown) => void) => {
				handlers.sessionDetached = handler;
				return () => {
					handlers.sessionDetached = undefined;
				};
			},
		);
	});

	it("subscribes to sessions that are attached or loading", async () => {
		const sessions: Record<string, ChatSession> = {
			"session-1": buildSession({ sessionId: "session-1", isAttached: true }),
			"session-2": buildSession({ sessionId: "session-2", isLoading: true }),
		};

		const { rerender } = renderHook(
			(props: { sessions: Record<string, ChatSession> }) =>
				useSocket({
					gatewaySocket: gatewaySocketTyped,
					sessions: props.sessions,
					t: (key) => key,
					appendAssistantChunk: vi.fn(),
					appendUserChunk: vi.fn(),
					updateSessionMeta: vi.fn(),
					setStreamError: vi.fn(),
					addPermissionRequest: vi.fn(),
					setPermissionDecisionState: vi.fn(),
					setPermissionOutcome: vi.fn(),
					addToolCall: vi.fn(),
					updateToolCall: vi.fn(),
					appendTerminalOutput: vi.fn(),
					updateMachine: vi.fn(),
					markSessionAttached: vi.fn(),
					markSessionDetached: vi.fn(),
				}),
			{ initialProps: { sessions } },
		);

		await waitFor(() => {
			expect(gatewaySocket.subscribeToSession).toHaveBeenCalledWith(
				"session-1",
			);
			expect(gatewaySocket.subscribeToSession).toHaveBeenCalledWith(
				"session-2",
			);
		});

		rerender({ sessions: {} });

		await waitFor(() => {
			expect(gatewaySocket.unsubscribeFromSession).toHaveBeenCalledWith(
				"session-1",
			);
			expect(gatewaySocket.unsubscribeFromSession).toHaveBeenCalledWith(
				"session-2",
			);
		});
	});

	it("marks session attached when event received", () => {
		const markSessionAttached = vi.fn();

		renderHook(() =>
			useSocket({
				gatewaySocket: gatewaySocketTyped,
				sessions: {},
				t: (key) => key,
				appendAssistantChunk: vi.fn(),
				appendUserChunk: vi.fn(),
				updateSessionMeta: vi.fn(),
				setStreamError: vi.fn(),
				addPermissionRequest: vi.fn(),
				setPermissionDecisionState: vi.fn(),
				setPermissionOutcome: vi.fn(),
				addToolCall: vi.fn(),
				updateToolCall: vi.fn(),
				appendTerminalOutput: vi.fn(),
				updateMachine: vi.fn(),
				markSessionAttached,
				markSessionDetached: vi.fn(),
			}),
		);

		handlers.sessionAttached?.({
			sessionId: "session-1",
			machineId: "machine-1",
			attachedAt: "2024-01-01T00:00:00Z",
		});

		expect(markSessionAttached).toHaveBeenCalledWith({
			sessionId: "session-1",
			machineId: "machine-1",
			attachedAt: "2024-01-01T00:00:00Z",
		});
	});

	it("marks attached sessions detached on socket disconnect", () => {
		const markSessionDetached = vi.fn();
		const sessions: Record<string, ChatSession> = {
			"session-1": buildSession({
				sessionId: "session-1",
				isAttached: true,
				machineId: "machine-1",
			}),
		};

		renderHook(() =>
			useSocket({
				gatewaySocket: gatewaySocketTyped,
				sessions,
				t: (key) => key,
				appendAssistantChunk: vi.fn(),
				appendUserChunk: vi.fn(),
				updateSessionMeta: vi.fn(),
				setStreamError: vi.fn(),
				addPermissionRequest: vi.fn(),
				setPermissionDecisionState: vi.fn(),
				setPermissionOutcome: vi.fn(),
				addToolCall: vi.fn(),
				updateToolCall: vi.fn(),
				appendTerminalOutput: vi.fn(),
				updateMachine: vi.fn(),
				markSessionAttached: vi.fn(),
				markSessionDetached,
			}),
		);

		handlers.disconnect?.();

		expect(markSessionDetached).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionId: "session-1",
				machineId: "machine-1",
				reason: "gateway_disconnect",
			}),
		);
	});
});
