import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { ChatStoreActions } from "@/hooks/useSessionMutations";
import {
	extractAvailableCommandsUpdate,
	extractSessionInfoUpdate,
	extractSessionModeUpdate,
	extractTextChunk,
	extractToolCallUpdate,
	type PermissionRequestNotification,
	type PermissionResultNotification,
	type SessionNotification,
	type TerminalOutputEvent,
} from "@/lib/acp";
import { createSessionEventSource } from "@/lib/api";
import type { ChatSession } from "@/lib/chat-store";
import {
	buildStreamDisconnectedError,
	createFallbackError,
	isErrorDetail,
	normalizeError,
} from "@/lib/error-utils";

type SessionEventSourceOptions = {
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

export function useSessionEventSources({
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
}: SessionEventSourceOptions) {
	const { t } = useTranslation();
	const sessionEventSourcesRef = useRef<Map<string, EventSource>>(new Map());

	useEffect(() => {
		return () => {
			for (const source of sessionEventSourcesRef.current.values()) {
				source.close();
			}
			sessionEventSourcesRef.current.clear();
		};
	}, []);

	useEffect(() => {
		const sources = sessionEventSourcesRef.current;
		const readySessions = Object.values(sessions).filter(
			(session) => session.state === "ready",
		);
		const readyIds = new Set(readySessions.map((session) => session.sessionId));

		for (const session of readySessions) {
			if (sources.has(session.sessionId)) {
				continue;
			}
			setStreamError(session.sessionId, undefined);
			const eventSource = createSessionEventSource(session.sessionId);
			const handleUpdate = (event: MessageEvent<string>) => {
				try {
					const payload = JSON.parse(event.data) as SessionNotification;
					const textChunk = extractTextChunk(payload);
					if (textChunk?.role === "assistant") {
						appendAssistantChunk(session.sessionId, textChunk.text);
					}
					const modeUpdate = extractSessionModeUpdate(payload);
					if (modeUpdate) {
						const modeName = session.availableModes?.find(
							(mode) => mode.id === modeUpdate.modeId,
						)?.name;
						updateSessionMeta(session.sessionId, {
							modeId: modeUpdate.modeId,
							modeName,
						});
					}
					const infoUpdate = extractSessionInfoUpdate(payload);
					if (infoUpdate) {
						updateSessionMeta(session.sessionId, infoUpdate);
					}
					const availableCommands = extractAvailableCommandsUpdate(payload);
					if (availableCommands !== null) {
						updateSessionMeta(session.sessionId, {
							availableCommands,
						});
					}
					const toolCallUpdate = extractToolCallUpdate(payload);
					if (toolCallUpdate) {
						if (toolCallUpdate.sessionUpdate === "tool_call") {
							addToolCall(session.sessionId, toolCallUpdate);
						} else {
							updateToolCall(session.sessionId, toolCallUpdate);
						}
					}
				} catch (parseError) {
					setStreamError(
						session.sessionId,
						normalizeError(
							parseError,
							createFallbackError(t("errors.streamParseFailed"), "stream"),
						),
					);
				}
			};

			const handlePermissionRequest = (event: MessageEvent<string>) => {
				try {
					const payload = JSON.parse(
						event.data,
					) as PermissionRequestNotification;
					addPermissionRequest(payload.sessionId, {
						requestId: payload.requestId,
						toolCall: payload.toolCall,
						options: payload.options ?? [],
					});
				} catch (parseError) {
					setStreamError(
						session.sessionId,
						normalizeError(
							parseError,
							createFallbackError(
								t("errors.permissionRequestParseFailed"),
								"stream",
							),
						),
					);
				}
			};

			const handlePermissionResult = (event: MessageEvent<string>) => {
				try {
					const payload = JSON.parse(
						event.data,
					) as PermissionResultNotification;
					setPermissionOutcome(
						payload.sessionId,
						payload.requestId,
						payload.outcome,
					);
					setPermissionDecisionState(
						payload.sessionId,
						payload.requestId,
						"idle",
					);
				} catch (parseError) {
					setStreamError(
						session.sessionId,
						normalizeError(
							parseError,
							createFallbackError(
								t("errors.permissionResultParseFailed"),
								"stream",
							),
						),
					);
				}
			};

			const handleTerminalOutput = (event: MessageEvent<string>) => {
				try {
					const payload = JSON.parse(event.data) as TerminalOutputEvent;
					appendTerminalOutput(payload.sessionId, {
						terminalId: payload.terminalId,
						delta: payload.delta,
						truncated: payload.truncated,
						output: payload.output,
						exitStatus: payload.exitStatus ?? undefined,
					});
				} catch (parseError) {
					setStreamError(
						session.sessionId,
						normalizeError(
							parseError,
							createFallbackError(
								t("errors.terminalOutputParseFailed"),
								"stream",
							),
						),
					);
				}
			};

			const handleStreamError = (event: MessageEvent<string>) => {
				try {
					const payload = JSON.parse(event.data) as { error?: unknown };
					if (isErrorDetail(payload.error)) {
						setStreamError(session.sessionId, payload.error);
						return;
					}
					setStreamError(
						session.sessionId,
						createFallbackError(t("errors.streamErrorParseFailed"), "stream"),
					);
				} catch (parseError) {
					setStreamError(
						session.sessionId,
						normalizeError(
							parseError,
							createFallbackError(t("errors.streamErrorParseFailed"), "stream"),
						),
					);
				}
			};

			eventSource.addEventListener("session_update", handleUpdate);
			eventSource.addEventListener(
				"permission_request",
				handlePermissionRequest,
			);
			eventSource.addEventListener("permission_result", handlePermissionResult);
			eventSource.addEventListener("terminal_output", handleTerminalOutput);
			eventSource.addEventListener("session_error", handleStreamError);
			eventSource.addEventListener("error", () => {
				setStreamError(session.sessionId, buildStreamDisconnectedError());
			});

			sources.set(session.sessionId, eventSource);
		}

		for (const [sessionId, source] of sources.entries()) {
			if (!readyIds.has(sessionId)) {
				source.close();
				sources.delete(sessionId);
			}
		}
	}, [
		addPermissionRequest,
		addToolCall,
		appendAssistantChunk,
		appendTerminalOutput,
		sessions,
		setPermissionDecisionState,
		setPermissionOutcome,
		setStreamError,
		t,
		updateSessionMeta,
		updateToolCall,
	]);
}
