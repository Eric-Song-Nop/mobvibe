import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { ChatStoreActions } from "@/hooks/useSessionMutations";
import {
	type CliStatusPayload,
	extractAvailableCommandsUpdate,
	extractSessionInfoUpdate,
	extractSessionModeUpdate,
	extractTextChunk,
	extractToolCallUpdate,
	type PermissionDecisionPayload,
	type PermissionRequestPayload,
	type SessionNotification,
	type StreamErrorPayload,
	type TerminalOutputEvent,
} from "@/lib/acp";
import type { ChatSession } from "@/lib/chat-store";
import {
	createFallbackError,
	isErrorDetail,
	normalizeError,
} from "@/lib/error-utils";
import { useMachinesStore } from "@/lib/machines-store";
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
	| "updateSessionMeta"
	| "setStreamError"
	| "addPermissionRequest"
	| "setPermissionDecisionState"
	| "setPermissionOutcome"
	| "addToolCall"
	| "updateToolCall"
	| "appendTerminalOutput"
>;

export function useSocket({
	sessions,
	appendAssistantChunk,
	updateSessionMeta,
	setStreamError,
	addPermissionRequest,
	setPermissionDecisionState,
	setPermissionOutcome,
	addToolCall,
	updateToolCall,
	appendTerminalOutput,
}: UseSocketOptions) {
	const { t } = useTranslation();
	const subscribedSessionsRef = useRef<Set<string>>(new Set());
	const sessionsRef = useRef(sessions);
	sessionsRef.current = sessions;

	// Get machines store actions
	const updateMachine = useMachinesStore((state) => state.updateMachine);

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

		// CLI status handler
		const handleCliStatus = (payload: CliStatusPayload) => {
			updateMachine(payload);
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

		return () => {
			unsubUpdate();
			unsubError();
			unsubPermReq();
			unsubPermRes();
			unsubTerminal();
			unsubCliStatus();
			gatewaySocket.disconnect();
		};
	}, [
		addPermissionRequest,
		addToolCall,
		appendAssistantChunk,
		appendTerminalOutput,
		setPermissionDecisionState,
		setPermissionOutcome,
		setStreamError,
		t,
		updateMachine,
		updateSessionMeta,
		updateToolCall,
	]);

	// Subscribe to ready sessions
	useEffect(() => {
		const readySessions = Object.values(sessions).filter(
			(session) => session.state === "ready",
		);
		const readyIds = new Set(readySessions.map((s) => s.sessionId));

		// Subscribe to new ready sessions
		for (const sessionId of readyIds) {
			if (!subscribedSessionsRef.current.has(sessionId)) {
				gatewaySocket.subscribeToSession(sessionId);
				subscribedSessionsRef.current.add(sessionId);
				setStreamError(sessionId, undefined);
			}
		}

		// Unsubscribe from sessions that are no longer ready
		for (const sessionId of subscribedSessionsRef.current) {
			if (!readyIds.has(sessionId)) {
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
