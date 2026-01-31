import type { ChatSession } from "@mobvibe/core";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { ChatStoreActions } from "@/hooks/useSessionMutations";
import {
	extractAvailableCommandsUpdate,
	extractSessionInfoUpdate,
	extractSessionModeUpdate,
	extractTextChunk,
	extractToolCallUpdate,
	type PermissionDecisionPayload,
	type PermissionRequestPayload,
	type SessionAttachedPayload,
	type SessionDetachedPayload,
	type SessionNotification,
	type SessionsChangedPayload,
	type StreamErrorPayload,
	type TerminalOutputEvent,
} from "@/lib/acp";
import {
	createFallbackError,
	isErrorDetail,
	normalizeError,
} from "@/lib/error-utils";
import {
	notifyPermissionRequest,
	notifySessionError,
} from "@/lib/notifications";
import { gatewaySocket } from "@/lib/socket";

type UseSocketOptions = {
	sessions: Record<string, ChatSession>;
} & Pick<
	ChatStoreActions,
	| "appendAssistantChunk"
	| "appendUserChunk"
	| "updateSessionMeta"
	| "setStreamError"
	| "addPermissionRequest"
	| "setPermissionDecisionState"
	| "setPermissionOutcome"
	| "addToolCall"
	| "updateToolCall"
	| "appendTerminalOutput"
	| "handleSessionsChanged"
	| "markSessionAttached"
	| "markSessionDetached"
>;

export function useSocket({
	sessions,
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
	handleSessionsChanged,
	markSessionAttached,
	markSessionDetached,
}: UseSocketOptions) {
	const { t } = useTranslation();
	const subscribedSessionsRef = useRef<Set<string>>(new Set());
	const sessionsRef = useRef(sessions);
	sessionsRef.current = sessions;

	// Connect to gateway on mount
	useEffect(() => {
		gatewaySocket.connect();

		// Session update handler
		const handleSessionUpdate = (notification: SessionNotification) => {
			const session = sessionsRef.current[notification.sessionId];
			if (!session) return;

			try {
				const textChunk = extractTextChunk(notification);
				if (textChunk?.role === "assistant") {
					appendAssistantChunk(notification.sessionId, textChunk.text);
				} else if (textChunk?.role === "user") {
					appendUserChunk(notification.sessionId, textChunk.text);
				}

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

				const toolCallUpdate = extractToolCallUpdate(notification);
				if (toolCallUpdate) {
					if (toolCallUpdate.sessionUpdate === "tool_call") {
						addToolCall(notification.sessionId, toolCallUpdate);
					} else {
						updateToolCall(notification.sessionId, toolCallUpdate);
					}
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
				notifySessionError(
					{ sessionId: payload.sessionId, error: payload.error },
					{ sessions: sessionsRef.current },
				);
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
			notifyPermissionRequest(payload, { sessions: sessionsRef.current });
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

		// Sessions changed handler (incremental sync)
		const handleSessionsChangedEvent = (payload: SessionsChangedPayload) => {
			handleSessionsChanged(payload);
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
		const unsubSessionAttached = gatewaySocket.onSessionAttached(
			handleSessionAttached,
		);
		const unsubSessionDetached = gatewaySocket.onSessionDetached(
			handleSessionDetached,
		);
		const unsubSessionsChanged = gatewaySocket.onSessionsChanged(
			handleSessionsChangedEvent,
		);
		const unsubDisconnect = gatewaySocket.onDisconnect(() => {
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
		});

		return () => {
			unsubUpdate();
			unsubError();
			unsubPermReq();
			unsubPermRes();
			unsubTerminal();
			unsubSessionAttached();
			unsubSessionDetached();
			unsubSessionsChanged();
			unsubDisconnect();
			gatewaySocket.disconnect();
		};
	}, [
		addPermissionRequest,
		addToolCall,
		appendAssistantChunk,
		appendUserChunk,
		appendTerminalOutput,
		handleSessionsChanged,
		markSessionAttached,
		markSessionDetached,
		setPermissionDecisionState,
		setPermissionOutcome,
		setStreamError,
		t,
		updateSessionMeta,
		updateToolCall,
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
	}, [sessions, setStreamError]);

	// Re-subscribe to all sessions when socket connects/reconnects
	useEffect(() => {
		const handleConnect = () => {
			for (const sessionId of subscribedSessionsRef.current) {
				gatewaySocket.subscribeToSession(sessionId);
			}
		};

		const unsubscribe = gatewaySocket.onConnect(handleConnect);
		return unsubscribe;
	}, []);
}
