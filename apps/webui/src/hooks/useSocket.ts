import { useCallback, useEffect, useRef } from "react";
import { useSessionBackfill } from "@/hooks/use-session-backfill";
import type { ChatStoreActions } from "@/hooks/useSessionMutations";
import {
	type CliStatusPayload,
	extractAvailableCommandsUpdate,
	extractSessionInfoUpdate,
	extractSessionModeUpdate,
	extractTextChunk,
	extractToolCallUpdate,
	type PermissionDecisionPayload,
	type PermissionOutcome,
	type PermissionRequestPayload,
	type SessionAttachedPayload,
	type SessionDetachedPayload,
	type SessionEvent,
	type SessionNotification,
	type SessionsChangedPayload,
	type TerminalOutputEvent,
} from "@/lib/acp";
import { type ChatSession, useChatStore } from "@/lib/chat-store";
import { e2ee } from "@/lib/e2ee";
import { isErrorDetail } from "@/lib/error-utils";
import { useMachinesStore } from "@/lib/machines-store";
import {
	notifyPermissionRequest,
	notifySessionError,
} from "@/lib/notifications";
import { gatewaySocket } from "@/lib/socket";

type UseSocketOptions = {
	sessions: Record<string, ChatSession>;
	setSending?: ChatStoreActions["setSending"];
	setCanceling?: ChatStoreActions["setCanceling"];
	finalizeAssistantMessage?: ChatStoreActions["finalizeAssistantMessage"];
} & Pick<
	ChatStoreActions,
	| "appendAssistantChunk"
	| "appendThoughtChunk"
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
	| "createLocalSession"
	| "updateSessionCursor"
	| "resetSessionForRevision"
>;

// Helper to get cursor from store directly (unified source of truth)
const getCursor = (sessionId: string) => {
	const session = useChatStore.getState().sessions[sessionId];
	return {
		revision: session?.revision,
		lastAppliedSeq: session?.lastAppliedSeq ?? 0,
	};
};

export function useSocket({
	sessions,
	setSending,
	setCanceling,
	finalizeAssistantMessage,
	appendAssistantChunk,
	appendThoughtChunk,
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
	createLocalSession,
	updateSessionCursor,
	resetSessionForRevision,
}: UseSocketOptions) {
	const subscribedSessionsRef = useRef<Set<string>>(new Set());
	const sessionsRef = useRef(sessions);
	sessionsRef.current = sessions;

	// Pending events buffer for out-of-order events (local to hook)
	const pendingEventsRef = useRef<Map<string, SessionEvent[]>>(new Map());

	// Track which sessions have triggered initial backfill
	const initialBackfillTriggeredRef = useRef<Set<string>>(new Set());

	// Max pending queue size before forcing reset
	const MAX_PENDING_SIZE = 1000;

	// Handler refs for stable listener registration
	const handleSessionAttachedRef = useRef<
		((p: SessionAttachedPayload) => void) | undefined
	>(undefined);
	const handleSessionDetachedRef = useRef<
		((p: SessionDetachedPayload) => void) | undefined
	>(undefined);
	const handlePermissionRequestRef = useRef<
		((p: PermissionRequestPayload) => void) | undefined
	>(undefined);
	const handlePermissionResultRef = useRef<
		((p: PermissionDecisionPayload) => void) | undefined
	>(undefined);
	const handleSessionsChangedRef = useRef<
		((p: SessionsChangedPayload) => void) | undefined
	>(undefined);
	const handleSessionEventRef = useRef<((e: SessionEvent) => void) | undefined>(
		undefined,
	);
	const triggerBackfillRef = useRef<
		| ((sessionId: string, revision: number, afterSeq: number) => void)
		| undefined
	>(undefined);

	// Apply a session:event to the chat store
	const applySessionEventRef = useRef<
		((event: SessionEvent) => void) | undefined
	>(undefined);
	applySessionEventRef.current = (event: SessionEvent) => {
		const session = sessionsRef.current[event.sessionId];

		switch (event.kind) {
			case "user_message": {
				const notification = event.payload as SessionNotification;
				const textChunk = extractTextChunk(notification);
				if (textChunk?.role === "user") {
					appendUserChunk(event.sessionId, textChunk.text);
				}
				break;
			}
			case "agent_message_chunk": {
				const notification = event.payload as SessionNotification;
				const textChunk = extractTextChunk(notification);
				if (textChunk?.role === "assistant") {
					appendAssistantChunk(event.sessionId, textChunk.text);
				}
				break;
			}
			case "agent_thought_chunk": {
				const notification = event.payload as SessionNotification;
				const textChunk = extractTextChunk(notification);
				if (textChunk) {
					appendThoughtChunk(event.sessionId, textChunk.text);
				}
				break;
			}
			case "tool_call":
			case "tool_call_update": {
				const notification = event.payload as SessionNotification;
				const toolCallUpdate = extractToolCallUpdate(notification);
				if (toolCallUpdate) {
					if (toolCallUpdate.sessionUpdate === "tool_call") {
						addToolCall(event.sessionId, toolCallUpdate);
					} else {
						updateToolCall(event.sessionId, toolCallUpdate);
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
					updateSessionMeta(event.sessionId, {
						modeId: modeUpdate.modeId,
						modeName,
					});
				}
				const infoUpdate = extractSessionInfoUpdate(notification);
				if (infoUpdate) {
					updateSessionMeta(event.sessionId, infoUpdate);
				}
				const availableCommands = extractAvailableCommandsUpdate(notification);
				if (availableCommands !== null) {
					updateSessionMeta(event.sessionId, { availableCommands });
				}
				break;
			}
			case "terminal_output": {
				const payload = event.payload as TerminalOutputEvent;
				appendTerminalOutput(event.sessionId, {
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
				addPermissionRequest(event.sessionId, {
					requestId: payload.requestId,
					toolCall: payload.toolCall,
					options: payload.options ?? [],
				});
				break;
			}
			case "permission_result": {
				const payload = event.payload as {
					sessionId: string;
					requestId: string;
					outcome: PermissionOutcome;
				};
				setPermissionOutcome(
					event.sessionId,
					payload.requestId,
					payload.outcome,
				);
				setPermissionDecisionState(event.sessionId, payload.requestId, "idle");
				break;
			}
			case "session_error": {
				const payload = event.payload as { error: unknown };
				if (isErrorDetail(payload.error)) {
					setStreamError(event.sessionId, payload.error);
					notifySessionError(
						{ sessionId: event.sessionId, error: payload.error },
						{ sessions: sessionsRef.current },
					);
				}
				break;
			}
			case "usage_update": {
				const notification = event.payload as SessionNotification;
				const update = notification.update;
				if (update.sessionUpdate === "usage_update") {
					updateSessionMeta(event.sessionId, {
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
				finalizeAssistantMessage?.(event.sessionId);
				setSending?.(event.sessionId, false);
				setCanceling?.(event.sessionId, false);
				break;
			}
			case "unknown_update":
			default:
				// Forward-compatible: silently ignore unknown event kinds
				// so the UI doesn't crash when SDK introduces new event types
				break;
		}
	};

	// Flush pending events that are now in order
	const flushPendingEventsRef = useRef<
		((sessionId: string) => void) | undefined
	>(undefined);
	flushPendingEventsRef.current = (sessionId: string) => {
		const cursor = getCursor(sessionId);
		if (cursor.revision === undefined) return;

		const pending = pendingEventsRef.current.get(sessionId);
		if (!pending || pending.length === 0) return;

		let lastSeq = cursor.lastAppliedSeq;
		const currentRevision = cursor.revision;

		// Filter out stale events (seq <= lastSeq or wrong revision)
		const validPending = pending.filter(
			(e) => e.seq > lastSeq && e.revision === currentRevision,
		);

		// Sort by seq
		validPending.sort((a, b) => a.seq - b.seq);

		// Apply consecutive events
		const remaining: SessionEvent[] = [];
		for (const event of validPending) {
			if (event.seq === lastSeq + 1) {
				applySessionEventRef.current?.(event);
				lastSeq = event.seq;
				updateSessionCursor(sessionId, event.revision, event.seq);
			} else {
				remaining.push(event);
			}
		}

		if (remaining.length > 0) {
			pendingEventsRef.current.set(sessionId, remaining);
		} else {
			pendingEventsRef.current.delete(sessionId);
		}
	};

	// Setup backfill hook for gap recovery
	const { startBackfill, cancelBackfill, isBackfilling } = useSessionBackfill({
		gatewayUrl: gatewaySocket.getGatewayUrl(),
		onEvents: (sessionId, events) => {
			for (const rawEvent of events) {
				// Decrypt event payload if encrypted
				const event = e2ee.decryptEvent(rawEvent);

				const cursor = getCursor(sessionId);
				const lastSeq = cursor.lastAppliedSeq;

				// Skip already applied
				if (event.seq <= lastSeq) continue;

				// Apply if next in sequence
				if (event.seq === lastSeq + 1) {
					applySessionEventRef.current?.(event);
					updateSessionCursor(sessionId, event.revision, event.seq);
				}
			}
			// Flush any pending events
			flushPendingEventsRef.current?.(sessionId);
		},
		onComplete: (_sessionId) => {
			// Backfill complete - nothing special needed
		},
		onError: (sessionId, error) => {
			console.error(`[backfill] Error for session ${sessionId}:`, error);
			// Fall back to applying pending events best effort
			const pending = pendingEventsRef.current.get(sessionId);
			if (!pending || pending.length === 0) return;

			const cursor = getCursor(sessionId);
			const sorted = pending
				.filter((e) =>
					cursor.revision === undefined ? true : e.revision === cursor.revision,
				)
				.sort((a, b) => a.seq - b.seq);

			let lastSeq = cursor.lastAppliedSeq;
			for (const event of sorted) {
				if (event.seq <= lastSeq) continue;
				if (event.seq !== lastSeq + 1) break;
				applySessionEventRef.current?.(event);
				lastSeq = event.seq;
				updateSessionCursor(sessionId, event.revision, event.seq);
			}
			pendingEventsRef.current.delete(sessionId);
		},
		onRevisionMismatch: (sessionId, newRevision) => {
			console.log(
				`[backfill] Revision mismatch for ${sessionId}, resetting to revision ${newRevision}`,
			);
			resetSessionForRevision(sessionId, newRevision);
			pendingEventsRef.current.delete(sessionId);

			// Defer restart to avoid race conditions
			queueMicrotask(() => {
				startBackfill(sessionId, newRevision, 0);
			});
		},
	});

	const syncSessionHistory = useCallback(
		(sessionId: string, options?: { fromStart?: boolean }) => {
			const session = useChatStore.getState().sessions[sessionId];
			if (!session) {
				return;
			}
			const revision = session.revision ?? 1;
			const afterSeq = options?.fromStart ? 0 : (session.lastAppliedSeq ?? 0);
			startBackfill(sessionId, revision, afterSeq);
		},
		[startBackfill],
	);

	// Trigger backfill helper
	triggerBackfillRef.current = (
		sessionId: string,
		revision: number,
		afterSeq: number,
	) => {
		if (isBackfilling(sessionId)) return;
		startBackfill(sessionId, revision, afterSeq);
	};

	// Update handler refs
	handleSessionAttachedRef.current = (payload: SessionAttachedPayload) => {
		markSessionAttached(payload);

		// If revision is provided, trigger backfill
		if (payload.revision !== undefined) {
			const session = sessionsRef.current[payload.sessionId];
			if (
				session &&
				!initialBackfillTriggeredRef.current.has(payload.sessionId)
			) {
				initialBackfillTriggeredRef.current.add(payload.sessionId);
				const { lastAppliedSeq } = getCursor(payload.sessionId);
				triggerBackfillRef.current?.(
					payload.sessionId,
					payload.revision,
					lastAppliedSeq,
				);
			}
		}
	};

	handleSessionDetachedRef.current = (payload: SessionDetachedPayload) => {
		markSessionDetached(payload);
	};

	handlePermissionRequestRef.current = (payload: PermissionRequestPayload) => {
		addPermissionRequest(payload.sessionId, {
			requestId: payload.requestId,
			toolCall: payload.toolCall,
			options: payload.options ?? [],
		});
		notifyPermissionRequest(payload, { sessions: sessionsRef.current });
	};

	handlePermissionResultRef.current = (payload: PermissionDecisionPayload) => {
		setPermissionOutcome(payload.sessionId, payload.requestId, payload.outcome);
		setPermissionDecisionState(payload.sessionId, payload.requestId, "idle");
	};

	handleSessionsChangedRef.current = (payload: SessionsChangedPayload) => {
		// Unwrap DEKs from new/updated sessions
		if (e2ee.isEnabled()) {
			for (const session of [...payload.added, ...payload.updated]) {
				if (session.wrappedDek) {
					e2ee.unwrapSessionDek(session.sessionId, session.wrappedDek);
				}
			}
		}
		handleSessionsChanged(payload);

		// Extract per-backend capabilities if present
		if (payload.backendCapabilities) {
			const machineId =
				payload.added[0]?.machineId ?? payload.updated[0]?.machineId;
			if (machineId) {
				useMachinesStore
					.getState()
					.updateBackendCapabilities(machineId, payload.backendCapabilities);
			}
		}
	};

	handleSessionEventRef.current = (incomingEvent: SessionEvent) => {
		// Decrypt event payload if encrypted
		const event = e2ee.decryptEvent(incomingEvent);

		let session = sessionsRef.current[event.sessionId];
		if (!session) {
			createLocalSession(event.sessionId);
			session = sessionsRef.current[event.sessionId];
		}

		const cursor = getCursor(event.sessionId);
		const currentRevision = cursor.revision;

		// Case 1: First revision initialization
		if (currentRevision === undefined) {
			updateSessionCursor(event.sessionId, event.revision, 0);
		}
		// Case 2: Revision bump (session reload)
		else if (event.revision > currentRevision) {
			resetSessionForRevision(event.sessionId, event.revision);
			pendingEventsRef.current.delete(event.sessionId);
			// Buffer current event for after backfill
			const pending = pendingEventsRef.current.get(event.sessionId) ?? [];
			pending.push(event);
			pendingEventsRef.current.set(event.sessionId, pending);
			triggerBackfillRef.current?.(event.sessionId, event.revision, 0);
			return;
		}
		// Case 3: Event from old revision - ignore
		else if (event.revision < currentRevision) {
			return;
		}

		// Re-read cursor after potential update
		const updatedCursor = getCursor(event.sessionId);
		const lastSeq = updatedCursor.lastAppliedSeq;

		// Skip already applied events
		if (event.seq <= lastSeq) {
			return;
		}

		// Apply if next expected event
		if (event.seq === lastSeq + 1) {
			applySessionEventRef.current?.(event);
			updateSessionCursor(event.sessionId, event.revision, event.seq);
			flushPendingEventsRef.current?.(event.sessionId);
		} else if (event.seq > lastSeq + 1) {
			// Gap detected - buffer and trigger backfill
			const pending = pendingEventsRef.current.get(event.sessionId) ?? [];

			// Check pending overflow
			if (pending.length >= MAX_PENDING_SIZE) {
				console.warn(
					`[socket] Pending overflow for ${event.sessionId}, forcing reset`,
				);
				pendingEventsRef.current.delete(event.sessionId);
				resetSessionForRevision(event.sessionId, event.revision);
				triggerBackfillRef.current?.(event.sessionId, event.revision, 0);
				return;
			}

			pending.push(event);
			pendingEventsRef.current.set(event.sessionId, pending);
			triggerBackfillRef.current?.(event.sessionId, event.revision, lastSeq);
		}
	};

	// Connect to gateway and register listeners on mount
	useEffect(() => {
		gatewaySocket.connect();

		// Stable wrapper functions
		const onCliStatus = (p: CliStatusPayload) => {
			useMachinesStore.getState().updateMachine(p);
		};
		const onSessionAttached = (p: SessionAttachedPayload) =>
			handleSessionAttachedRef.current?.(p);
		const onSessionDetached = (p: SessionDetachedPayload) =>
			handleSessionDetachedRef.current?.(p);
		const onPermissionRequest = (p: PermissionRequestPayload) =>
			handlePermissionRequestRef.current?.(p);
		const onPermissionResult = (p: PermissionDecisionPayload) =>
			handlePermissionResultRef.current?.(p);
		const onSessionsChanged = (p: SessionsChangedPayload) =>
			handleSessionsChangedRef.current?.(p);
		const onSessionEvent = (e: SessionEvent) =>
			handleSessionEventRef.current?.(e);

		// Register listeners
		const unsubCliStatus = gatewaySocket.onCliStatus(onCliStatus);
		const unsubSessionAttached =
			gatewaySocket.onSessionAttached(onSessionAttached);
		const unsubSessionDetached =
			gatewaySocket.onSessionDetached(onSessionDetached);
		const unsubPermReq = gatewaySocket.onPermissionRequest(onPermissionRequest);
		const unsubPermRes = gatewaySocket.onPermissionResult(onPermissionResult);
		const unsubSessionsChanged =
			gatewaySocket.onSessionsChanged(onSessionsChanged);
		const unsubSessionEvent = gatewaySocket.onSessionEvent(onSessionEvent);

		const unsubDisconnect = gatewaySocket.onDisconnect(() => {
			const now = new Date().toISOString();
			for (const session of Object.values(sessionsRef.current)) {
				if (session.isAttached && session.machineId) {
					handleSessionDetachedRef.current?.({
						sessionId: session.sessionId,
						machineId: session.machineId,
						detachedAt: now,
						reason: "gateway_disconnect",
					});
				}
			}
		});

		return () => {
			unsubCliStatus();
			unsubSessionAttached();
			unsubSessionDetached();
			unsubPermReq();
			unsubPermRes();
			unsubSessionsChanged();
			unsubSessionEvent();
			unsubDisconnect();
			gatewaySocket.disconnect();
		};
	}, []);

	// Subscribe to sessions while attached or loading
	useEffect(() => {
		for (const sessionId of gatewaySocket.getSubscribedSessions()) {
			if (!subscribedSessionsRef.current.has(sessionId)) {
				subscribedSessionsRef.current.add(sessionId);
			}
		}

		const subscribableSessions = Object.values(sessions).filter(
			(session) => session.isAttached || session.isLoading,
		);
		const subscribableIds = new Set(
			subscribableSessions.map((s) => s.sessionId),
		);

		// Subscribe to new sessions
		for (const sessionId of subscribableIds) {
			if (!subscribedSessionsRef.current.has(sessionId)) {
				gatewaySocket.subscribeToSession(sessionId);
				subscribedSessionsRef.current.add(sessionId);
				setStreamError(sessionId, undefined);

				// Trigger initial backfill on subscription
				const session = sessions[sessionId];
				if (session && !initialBackfillTriggeredRef.current.has(sessionId)) {
					initialBackfillTriggeredRef.current.add(sessionId);
					const cursor = getCursor(sessionId);
					const revision = cursor.revision ?? 1;
					triggerBackfillRef.current?.(
						sessionId,
						revision,
						cursor.lastAppliedSeq,
					);
				}
			}
		}

		// Unsubscribe from sessions no longer streaming
		for (const sessionId of subscribedSessionsRef.current) {
			if (!subscribableIds.has(sessionId)) {
				gatewaySocket.unsubscribeFromSession(sessionId);
				subscribedSessionsRef.current.delete(sessionId);
				cancelBackfill(sessionId);
				initialBackfillTriggeredRef.current.delete(sessionId);
			}
		}
	}, [sessions, setStreamError, cancelBackfill]);

	// Re-subscribe on reconnect
	useEffect(() => {
		const handleConnect = () => {
			for (const sessionId of subscribedSessionsRef.current) {
				gatewaySocket.subscribeToSession(sessionId);

				// Trigger backfill on reconnect
				const session = sessionsRef.current[sessionId];
				if (session) {
					const revision = session.revision ?? 1;
					const afterSeq = session.lastAppliedSeq ?? 0;
					triggerBackfillRef.current?.(sessionId, revision, afterSeq);
				}
			}
		};

		const unsubscribe = gatewaySocket.onConnect(handleConnect);
		return unsubscribe;
	}, []);

	return {
		syncSessionHistory,
		isBackfilling,
	};
}
