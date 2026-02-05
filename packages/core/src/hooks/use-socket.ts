import { useEffect, useRef } from "react";
import type {
	CliStatusPayload,
	PermissionDecisionPayload,
	PermissionRequestPayload,
	SessionAttachedPayload,
	SessionDetachedPayload,
	SessionEvent,
	ToolCallUpdate,
} from "../api/types";
import type { GatewaySocket } from "../socket/gateway-socket";
import type { ChatSession } from "../stores/chat-store";

type UseSocketOptions = {
	gatewaySocket: GatewaySocket;
	sessions: Record<string, ChatSession>;
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
	/** Called when a session:event is received (for cursor tracking) */
	onSessionEvent?: (event: SessionEvent) => void;
};

export function useSocket({
	gatewaySocket,
	sessions,
	setStreamError,
	addPermissionRequest,
	setPermissionDecisionState,
	setPermissionOutcome,
	appendTerminalOutput,
	updateMachine,
	markSessionAttached,
	markSessionDetached,
	onPermissionRequest,
	onSessionEvent,
}: UseSocketOptions) {
	const subscribedSessionsRef = useRef<Set<string>>(new Set());
	const sessionsRef = useRef(sessions);
	sessionsRef.current = sessions;

	// Connect to gateway on mount
	useEffect(() => {
		const socket = gatewaySocket.connect();

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

		// CLI status handler
		const handleCliStatus = (payload: CliStatusPayload) => {
			updateMachine(payload);
		};

		// Session event handler (WAL-persisted events with seq/revision)
		const handleSessionEvent = (event: SessionEvent) => {
			onSessionEvent?.(event);
		};

		// Set up listeners
		const unsubPermReq = gatewaySocket.onPermissionRequest(
			handlePermissionRequest,
		);
		const unsubPermRes = gatewaySocket.onPermissionResult(
			handlePermissionResult,
		);
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
			unsubPermReq();
			unsubPermRes();
			unsubCliStatus();
			unsubSessionAttached();
			unsubSessionDetached();
			unsubSessionEvent();
			gatewaySocket.disconnect();
		};
	}, [
		gatewaySocket,
		addPermissionRequest,
		markSessionAttached,
		markSessionDetached,
		setPermissionDecisionState,
		setPermissionOutcome,
		updateMachine,
		onPermissionRequest,
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
