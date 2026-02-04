import { useEffect, useRef } from "react";
import type {
	CliStatusPayload,
	PermissionDecisionPayload,
	PermissionRequestPayload,
	SessionAttachedPayload,
	SessionDetachedPayload,
	SessionEvent,
	SessionNotification,
	StreamErrorPayload,
	TerminalOutputEvent,
	ToolCallUpdate,
} from "../api/types";
import {
	extractAvailableCommandsUpdate,
	extractSessionInfoUpdate,
	extractSessionModeUpdate,
} from "../api/types";
import type { GatewaySocket } from "../socket/gateway-socket";
import type { ChatSession } from "../stores/chat-store";
import { createFallbackError, isErrorDetail, normalizeError } from "../utils";

type UseSocketOptions = {
	gatewaySocket: GatewaySocket;
	sessions: Record<string, ChatSession>;
	t: (key: string) => string;
	appendAssistantChunk: (sessionId: string, text: string) => void;
	appendUserChunk: (sessionId: string, text: string) => void;
	updateSessionMeta: (sessionId: string, payload: Partial<ChatSession>) => void;
	setStreamError: (
		sessionId: string,
		error?: ChatSession["streamError"],
	) => void;
	addPermissionRequest: (
		sessionId: string,
		payload: {
			requestId: string;
			toolCall?: PermissionRequestPayload["toolCall"];
			options: PermissionRequestPayload["options"];
		},
	) => void;
	setPermissionDecisionState: (
		sessionId: string,
		requestId: string,
		state: "idle" | "submitting",
	) => void;
	setPermissionOutcome: (
		sessionId: string,
		requestId: string,
		outcome: PermissionDecisionPayload["outcome"],
	) => void;
	addToolCall: (sessionId: string, payload: ToolCallUpdate) => void;
	updateToolCall: (sessionId: string, payload: ToolCallUpdate) => void;
	appendTerminalOutput: (
		sessionId: string,
		payload: {
			terminalId: string;
			delta: string;
			truncated: boolean;
			output?: string;
			exitStatus?: { exitCode?: number | null; signal?: string | null };
		},
	) => void;
	updateMachine: (payload: CliStatusPayload) => void;
	markSessionAttached: (payload: SessionAttachedPayload) => void;
	markSessionDetached: (
		payload: Omit<SessionDetachedPayload, "machineId"> & { machineId?: string },
	) => void;
	onPermissionRequest?: (payload: PermissionRequestPayload) => void;
	onSessionError?: (payload: StreamErrorPayload) => void;
	/** Called when a session:event is received (for cursor tracking) */
	onSessionEvent?: (event: SessionEvent) => void;
};

export function useSocket({
	gatewaySocket,
	sessions,
	t,
	appendAssistantChunk,
	appendUserChunk,
	updateSessionMeta,
	setStreamError,
	addPermissionRequest,
	setPermissionDecisionState,
	setPermissionOutcome,
	addToolCall,
	updateToolCall,
	appendTerminalOutput,
	updateMachine,
	markSessionAttached,
	markSessionDetached,
	onPermissionRequest,
	onSessionError,
	onSessionEvent,
}: UseSocketOptions) {
	const subscribedSessionsRef = useRef<Set<string>>(new Set());
	const sessionsRef = useRef(sessions);
	sessionsRef.current = sessions;

	// Connect to gateway on mount
	useEffect(() => {
		const socket = gatewaySocket.connect();

		// Session update handler
		// Note: session:update is deprecated - content updates now come via session:event
		// This handler is kept for backwards compatibility with older CLI versions
		// and only processes meta updates (mode/info/commands)
		const handleSessionUpdate = (notification: SessionNotification) => {
			const session = sessionsRef.current[notification.sessionId];
			if (!session) return;

			try {
				// Only process meta updates - content updates go through session:event
				const modeUpdate = extractSessionModeUpdate(notification);
				if (modeUpdate) {
					const modeName = session.availableModes?.find(
						(mode) => mode.id === modeUpdate.modeId,
					)?.name;
					updateSessionMeta(notification.sessionId, {
						modeId: modeUpdate.modeId,
						modeName,
					});
				}

				const infoUpdate = extractSessionInfoUpdate(notification);
				if (infoUpdate) {
					updateSessionMeta(notification.sessionId, infoUpdate);
				}

				const availableCommands = extractAvailableCommandsUpdate(notification);
				if (availableCommands !== null) {
					updateSessionMeta(notification.sessionId, { availableCommands });
				}
			} catch (parseError) {
				setStreamError(
					notification.sessionId,
					normalizeError(
						parseError,
						createFallbackError(t("errors.streamParseFailed"), "stream"),
					),
				);
			}
		};

		// Session error handler
		const handleSessionError = (payload: StreamErrorPayload) => {
			if (isErrorDetail(payload.error)) {
				setStreamError(payload.sessionId, payload.error);
				onSessionError?.(payload);
			}
		};

		const handleSessionAttached = (payload: SessionAttachedPayload) => {
			markSessionAttached(payload);
		};

		const handleSessionDetached = (payload: SessionDetachedPayload) => {
			markSessionDetached(payload);
		};

		// Permission request handler
		const handlePermissionRequest = (payload: PermissionRequestPayload) => {
			addPermissionRequest(payload.sessionId, {
				requestId: payload.requestId,
				toolCall: payload.toolCall,
				options: payload.options ?? [],
			});
			onPermissionRequest?.(payload);
		};

		// Permission result handler
		const handlePermissionResult = (payload: PermissionDecisionPayload) => {
			setPermissionOutcome(
				payload.sessionId,
				payload.requestId,
				payload.outcome,
			);
			setPermissionDecisionState(payload.sessionId, payload.requestId, "idle");
		};

		// Terminal output handler
		const handleTerminalOutput = (payload: TerminalOutputEvent) => {
			appendTerminalOutput(payload.sessionId, {
				terminalId: payload.terminalId,
				delta: payload.delta,
				truncated: payload.truncated,
				output: payload.output,
				exitStatus: payload.exitStatus ?? undefined,
			});
		};

		// CLI status handler
		const handleCliStatus = (payload: CliStatusPayload) => {
			updateMachine(payload);
		};

		// Session event handler (WAL-persisted events)
		const handleSessionEvent = (event: SessionEvent) => {
			onSessionEvent?.(event);
		};

		// Set up listeners
		const unsubUpdate = gatewaySocket.onSessionUpdate(handleSessionUpdate);
		const unsubError = gatewaySocket.onSessionError(handleSessionError);
		const unsubPermReq = gatewaySocket.onPermissionRequest(
			handlePermissionRequest,
		);
		const unsubPermRes = gatewaySocket.onPermissionResult(
			handlePermissionResult,
		);
		const unsubTerminal = gatewaySocket.onTerminalOutput(handleTerminalOutput);
		const unsubCliStatus = gatewaySocket.onCliStatus(handleCliStatus);
		const unsubSessionAttached = gatewaySocket.onSessionAttached(
			handleSessionAttached,
		);
		const unsubSessionDetached = gatewaySocket.onSessionDetached(
			handleSessionDetached,
		);
		const unsubSessionEvent = gatewaySocket.onSessionEvent(handleSessionEvent);

		const handleDisconnect = () => {
			const now = new Date().toISOString();
			for (const session of Object.values(sessionsRef.current)) {
				if (session.isAttached) {
					markSessionDetached({
						sessionId: session.sessionId,
						machineId: session.machineId,
						detachedAt: now,
						reason: "gateway_disconnect",
					});
				}
			}
		};

		socket.on("disconnect", handleDisconnect);

		return () => {
			socket.off("disconnect", handleDisconnect);
			unsubUpdate();
			unsubError();
			unsubPermReq();
			unsubPermRes();
			unsubTerminal();
			unsubCliStatus();
			unsubSessionAttached();
			unsubSessionDetached();
			unsubSessionEvent();
			gatewaySocket.disconnect();
		};
	}, [
		gatewaySocket,
		addPermissionRequest,
		appendTerminalOutput,
		markSessionAttached,
		markSessionDetached,
		setPermissionDecisionState,
		setPermissionOutcome,
		setStreamError,
		t,
		updateMachine,
		updateSessionMeta,
		onPermissionRequest,
		onSessionError,
		onSessionEvent,
	]);

	// Subscribe to sessions while attached or loading (load replays history)
	useEffect(() => {
		const subscribableSessions = Object.values(sessions).filter(
			(session) => session.isAttached || session.isLoading,
		);
		const subscribableIds = new Set(
			subscribableSessions.map((s) => s.sessionId),
		);

		// Subscribe to new sessions that can stream (attached/loading)
		for (const sessionId of subscribableIds) {
			if (!subscribedSessionsRef.current.has(sessionId)) {
				gatewaySocket.subscribeToSession(sessionId);
				subscribedSessionsRef.current.add(sessionId);
				setStreamError(sessionId, undefined);
			}
		}

		// Unsubscribe from sessions that are no longer streaming
		for (const sessionId of subscribedSessionsRef.current) {
			if (!subscribableIds.has(sessionId)) {
				gatewaySocket.unsubscribeFromSession(sessionId);
				subscribedSessionsRef.current.delete(sessionId);
			}
		}
	}, [sessions, setStreamError, gatewaySocket]);
}
