import type { ErrorDetail } from "@mobvibe/shared";
import type { ChatStoreActions } from "@/hooks/useSessionMutations";
import {
	extractAvailableCommandsUpdate,
	extractPlanUpdate,
	extractSessionInfoUpdate,
	extractSessionModeUpdate,
	extractToolCallUpdate,
	type PermissionOutcome,
	type PermissionRequestPayload,
	type SessionEvent,
	type SessionNotification,
	type TerminalOutputEvent,
} from "@/lib/acp";
import type { ChatSession } from "@/lib/chat-store";
import { isErrorDetail } from "@/lib/error-utils";

export type SessionEventReducerActions = Pick<
	ChatStoreActions,
	| "appendAssistantChunk"
	| "appendThoughtChunk"
	| "confirmOrAppendUserMessage"
	| "updateSessionMeta"
	| "setStreamError"
	| "addPermissionRequest"
	| "setPermissionDecisionState"
	| "setPermissionOutcome"
	| "addToolCall"
	| "updateToolCall"
	| "appendTerminalOutput"
> & {
	finalizeAssistantMessage?: ChatStoreActions["finalizeAssistantMessage"];
	setSending?: ChatStoreActions["setSending"];
	setCanceling?: ChatStoreActions["setCanceling"];
};

export type SessionEventNotifications = {
	notifyPermissionRequest: (
		payload: PermissionRequestPayload,
		context: { sessions: Record<string, ChatSession> },
	) => void;
	notifyResponseCompleted: (
		payload: { sessionId: string },
		context: { sessions: Record<string, ChatSession> },
	) => void;
	notifySessionError: (
		payload: { sessionId: string; error: ErrorDetail },
		context: { sessions: Record<string, ChatSession> },
	) => void;
};

type ApplySessionEventOptions = {
	event: SessionEvent;
	session?: ChatSession;
	sessions: Record<string, ChatSession>;
	actions: SessionEventReducerActions;
	notifications: SessionEventNotifications;
};

export function applyPermissionRequest({
	sessionId,
	payload,
	session,
	sessions,
	actions,
	notifications,
}: {
	sessionId: string;
	payload: PermissionRequestPayload;
	session?: ChatSession;
	sessions: Record<string, ChatSession>;
	actions: Pick<SessionEventReducerActions, "addPermissionRequest">;
	notifications: Pick<SessionEventNotifications, "notifyPermissionRequest">;
}) {
	const alreadyExists = session?.messages.some(
		(m) => m.kind === "permission" && m.requestId === payload.requestId,
	);
	actions.addPermissionRequest(sessionId, {
		requestId: payload.requestId,
		toolCall: payload.toolCall,
		options: payload.options ?? [],
	});
	if (!alreadyExists) {
		notifications.notifyPermissionRequest(payload, { sessions });
	}
}

export function applySessionEvent({
	event,
	session,
	sessions,
	actions,
	notifications,
}: ApplySessionEventOptions) {
	switch (event.kind) {
		case "user_message": {
			// This top-level field is Mobvibe's send/idempotency key. ACP's
			// update.messageId is a content boundary and must not confirm a send.
			const notification = event.payload as SessionNotification & {
				messageId?: string;
			};
			if (notification.update.sessionUpdate === "user_message_chunk") {
				actions.confirmOrAppendUserMessage(
					event.sessionId,
					notification.update.content,
					notification.messageId,
					event.seq,
					resolveProtocolMessageId(event, notification),
				);
			}
			break;
		}
		case "agent_message_chunk": {
			const notification = event.payload as SessionNotification;
			if (notification.update.sessionUpdate === "agent_message_chunk") {
				const protocolMessageId = resolveProtocolMessageId(event, notification);
				if (protocolMessageId !== undefined) {
					actions.appendAssistantChunk(
						event.sessionId,
						notification.update.content,
						protocolMessageId,
					);
				} else {
					actions.appendAssistantChunk(
						event.sessionId,
						notification.update.content,
					);
				}
			}
			break;
		}
		case "agent_thought_chunk": {
			const notification = event.payload as SessionNotification;
			if (notification.update.sessionUpdate === "agent_thought_chunk") {
				const protocolMessageId = resolveProtocolMessageId(event, notification);
				if (protocolMessageId !== undefined) {
					actions.appendThoughtChunk(
						event.sessionId,
						notification.update.content,
						protocolMessageId,
					);
				} else {
					actions.appendThoughtChunk(
						event.sessionId,
						notification.update.content,
					);
				}
			}
			break;
		}
		case "tool_call":
		case "tool_call_update": {
			const notification = event.payload as SessionNotification;
			const toolCallUpdate = extractToolCallUpdate(notification);
			if (toolCallUpdate) {
				if (toolCallUpdate.sessionUpdate === "tool_call") {
					actions.addToolCall(event.sessionId, toolCallUpdate);
				} else {
					actions.updateToolCall(event.sessionId, toolCallUpdate);
				}
			}
			break;
		}
		case "session_info_update": {
			const notification = event.payload as SessionNotification;
			const modeUpdate = extractSessionModeUpdate(notification);
			if (modeUpdate) {
				const modeName = session?.availableModes?.find(
					(mode) => mode.id === modeUpdate.modeId,
				)?.name;
				actions.updateSessionMeta(event.sessionId, {
					modeId: modeUpdate.modeId,
					modeName,
				});
			}

			const infoUpdate = extractSessionInfoUpdate(notification);
			if (infoUpdate) {
				if (session?.isTitlePinned && infoUpdate.title !== undefined) {
					const { title: _ignored, ...rest } = infoUpdate;
					if (Object.keys(rest).length > 0) {
						actions.updateSessionMeta(event.sessionId, rest);
					}
				} else {
					actions.updateSessionMeta(event.sessionId, infoUpdate);
				}
			}

			const availableCommands = extractAvailableCommandsUpdate(notification);
			if (availableCommands !== null) {
				actions.updateSessionMeta(event.sessionId, { availableCommands });
			}

			const planUpdate = extractPlanUpdate(notification);
			if (planUpdate) {
				actions.updateSessionMeta(event.sessionId, {
					plan: planUpdate.entries,
				});
			}
			break;
		}
		case "terminal_output": {
			const payload = event.payload as TerminalOutputEvent;
			actions.appendTerminalOutput(event.sessionId, {
				terminalId: payload.terminalId,
				delta: payload.delta,
				truncated: payload.truncated,
				output: payload.output,
				exitStatus: payload.exitStatus ?? undefined,
			});
			break;
		}
		case "permission_request": {
			const payload = event.payload as PermissionRequestPayload;
			applyPermissionRequest({
				sessionId: event.sessionId,
				payload,
				session,
				sessions,
				actions,
				notifications,
			});
			break;
		}
		case "permission_result": {
			const payload = event.payload as {
				sessionId: string;
				requestId: string;
				outcome: PermissionOutcome;
			};
			actions.setPermissionOutcome(
				event.sessionId,
				payload.requestId,
				payload.outcome,
			);
			actions.setPermissionDecisionState(
				event.sessionId,
				payload.requestId,
				"idle",
			);
			break;
		}
		case "session_error": {
			const payload = event.payload as { error: unknown };
			if (isErrorDetail(payload.error)) {
				actions.setStreamError(event.sessionId, payload.error);
				notifications.notifySessionError(
					{ sessionId: event.sessionId, error: payload.error },
					{ sessions },
				);
			}
			break;
		}
		case "usage_update": {
			const notification = event.payload as SessionNotification;
			const update = notification.update;
			if (update.sessionUpdate === "usage_update") {
				actions.updateSessionMeta(event.sessionId, {
					usage: {
						used: update.used,
						size: update.size,
						cost: update.cost ?? undefined,
					},
				});
			}
			break;
		}
		case "turn_end": {
			notifications.notifyResponseCompleted(
				{ sessionId: event.sessionId },
				{ sessions },
			);
			actions.finalizeAssistantMessage?.(event.sessionId);
			actions.setSending?.(event.sessionId, false);
			actions.setCanceling?.(event.sessionId, false);
			break;
		}
		default:
			break;
	}
}

function resolveProtocolMessageId(
	event: SessionEvent,
	notification: SessionNotification,
): string | undefined {
	if (event.protocolMessageId !== undefined) {
		return event.protocolMessageId;
	}
	const messageId = (notification.update as { messageId?: unknown }).messageId;
	return typeof messageId === "string" ? messageId : undefined;
}
