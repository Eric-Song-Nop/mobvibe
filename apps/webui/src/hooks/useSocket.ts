import { type ChatSession, useSessionBackfill } from "@mobvibe/core";
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
	type PermissionOutcome,
	type PermissionRequestPayload,
	type SessionAttachedPayload,
	type SessionDetachedPayload,
	type SessionEvent,
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
	| "createLocalSession"
	| "updateSessionCursor"
	| "setSessionBackfilling"
	| "resetSessionForRevision"
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
	createLocalSession,
	updateSessionCursor,
	setSessionBackfilling,
	resetSessionForRevision,
}: UseSocketOptions) {
	const { t } = useTranslation();
	const subscribedSessionsRef = useRef<Set<string>>(new Set());
	const sessionsRef = useRef(sessions);
	sessionsRef.current = sessions;

	// Pending events buffer for out-of-order events
	const pendingEventsRef = useRef<Map<string, SessionEvent[]>>(new Map());

	// Track revision mismatch retry counts to prevent infinite loops
	const revisionMismatchRetryRef = useRef<Map<string, number>>(new Map());
	const MAX_REVISION_MISMATCH_RETRIES = 3;

	// Handler refs for stable listener registration
	const handleSessionUpdateRef = useRef<(n: SessionNotification) => void>();
	const handleSessionErrorRef = useRef<(p: StreamErrorPayload) => void>();
	const handleSessionAttachedRef =
		useRef<(p: SessionAttachedPayload) => void>();
	const handleSessionDetachedRef =
		useRef<(p: SessionDetachedPayload) => void>();
	const handlePermissionRequestRef =
		useRef<(p: PermissionRequestPayload) => void>();
	const handlePermissionResultRef =
		useRef<(p: PermissionDecisionPayload) => void>();
	const handleTerminalOutputRef = useRef<(p: TerminalOutputEvent) => void>();
	const handleSessionsChangedRef =
		useRef<(p: SessionsChangedPayload) => void>();
	const handleSessionEventRef = useRef<(e: SessionEvent) => void>();
	const triggerBackfillRef =
		useRef<(sessionId: string, revision: number, afterSeq: number) => void>();

	// Apply a session:event to the chat store (ref for stable access)
	const applySessionEventRef = useRef<(event: SessionEvent) => void>();
	applySessionEventRef.current = (event: SessionEvent) => {
		// Process event based on kind
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
				const session = sessionsRef.current[event.sessionId];
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
				const payload = event.payload as {
					sessionId: string;
					requestId: string;
					options: Array<{
						optionId: string;
						label: string;
						description?: string | null;
					}>;
					toolCall?: {
						toolCallId: string;
						name?: string | null;
						title: string;
						command?: string | null;
						args?: string[] | null;
					};
				};
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
				}
				break;
			}
		}
	};

	// Flush pending events that are now in order (ref for stable access)
	const flushPendingEventsRef = useRef<(sessionId: string) => void>();
	flushPendingEventsRef.current = (sessionId: string) => {
		const session = sessionsRef.current[sessionId];
		if (!session) return;

		const pending = pendingEventsRef.current.get(sessionId);
		if (!pending || pending.length === 0) return;

		let lastSeq = session.lastAppliedSeq ?? 0;

		// Sort by seq
		pending.sort((a, b) => a.seq - b.seq);

		// Apply consecutive events
		const remaining: SessionEvent[] = [];
		for (const event of pending) {
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

	// Setup backfill hook for gap recovery (must be before the main useEffect)
	const {
		startBackfill,
		cancelBackfill,
		isBackfilling: isBackfillActive,
	} = useSessionBackfill({
		gatewayUrl: gatewaySocket.getGatewayUrl(),
		onEvents: (sessionId, events) => {
			// Apply backfilled events in order
			for (const event of events) {
				const session = sessionsRef.current[sessionId];
				const lastSeq = session?.lastAppliedSeq ?? 0;

				// Skip already applied
				if (event.seq <= lastSeq) continue;

				// Apply if next in sequence
				if (event.seq === lastSeq + 1) {
					applySessionEventRef.current?.(event);
					updateSessionCursor(sessionId, event.revision, event.seq);
				}
			}
			// Try to flush any pending events
			flushPendingEventsRef.current?.(sessionId);
		},
		onComplete: (sessionId) => {
			setSessionBackfilling(sessionId, false);
			// Reset retry count on successful completion
			revisionMismatchRetryRef.current.delete(sessionId);
		},
		onError: (sessionId, error) => {
			console.error(`[backfill] Error for session ${sessionId}:`, error);
			setSessionBackfilling(sessionId, false);
		},
		onRevisionMismatch: (sessionId, newRevision) => {
			// Track retry count to prevent infinite loops
			const retryCount =
				(revisionMismatchRetryRef.current.get(sessionId) ?? 0) + 1;
			revisionMismatchRetryRef.current.set(sessionId, retryCount);

			if (retryCount > MAX_REVISION_MISMATCH_RETRIES) {
				console.error(
					`[backfill] Max revision mismatch retries exceeded for session ${sessionId}`,
				);
				setSessionBackfilling(sessionId, false);
				return;
			}

			console.log(
				`[backfill] Revision mismatch for ${sessionId}, resetting to revision ${newRevision} (retry ${retryCount}/${MAX_REVISION_MISMATCH_RETRIES})`,
			);
			resetSessionForRevision(sessionId, newRevision);
			pendingEventsRef.current.delete(sessionId);
			// Restart backfill with new revision from the beginning
			setSessionBackfilling(sessionId, true);
			startBackfill(sessionId, newRevision, 0);
		},
	});

	// Track which sessions have triggered initial backfill
	const initialBackfillTriggeredRef = useRef<Set<string>>(new Set());

	// Trigger backfill helper (ref for stable access in event handlers)
	triggerBackfillRef.current = (
		sessionId: string,
		revision: number,
		afterSeq: number,
	) => {
		if (isBackfillActive(sessionId)) return;
		setSessionBackfilling(sessionId, true);
		startBackfill(sessionId, revision, afterSeq);
	};

	// Update handler refs on each render (handlers always use latest closures)
	handleSessionUpdateRef.current = (notification: SessionNotification) => {
		let session = sessionsRef.current[notification.sessionId];
		if (!session) {
			createLocalSession(notification.sessionId);
			session = sessionsRef.current[notification.sessionId];
		}

		// If session has entered eventlog sync mode (revision is defined),
		// skip content-level updates - they come via session:event + backfill
		const useEventlogSync = session?.revision !== undefined;

		try {
			// Only process content updates in non-eventlog mode
			if (!useEventlogSync) {
				const textChunk = extractTextChunk(notification);
				if (textChunk?.role === "assistant") {
					appendAssistantChunk(notification.sessionId, textChunk.text);
				} else if (textChunk?.role === "user") {
					appendUserChunk(notification.sessionId, textChunk.text);
				}

				const toolCallUpdate = extractToolCallUpdate(notification);
				if (toolCallUpdate) {
					if (toolCallUpdate.sessionUpdate === "tool_call") {
						addToolCall(notification.sessionId, toolCallUpdate);
					} else {
						updateToolCall(notification.sessionId, toolCallUpdate);
					}
				}
			}

			// Meta updates are always processed (mode/info/commands don't duplicate)
			const modeUpdate = extractSessionModeUpdate(notification);
			if (modeUpdate) {
				const modeName = session?.availableModes?.find(
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

	handleSessionErrorRef.current = (payload: StreamErrorPayload) => {
		if (isErrorDetail(payload.error)) {
			setStreamError(payload.sessionId, payload.error);
			notifySessionError(
				{ sessionId: payload.sessionId, error: payload.error },
				{ sessions: sessionsRef.current },
			);
		}
	};

	handleSessionAttachedRef.current = (payload: SessionAttachedPayload) => {
		markSessionAttached(payload);
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

	handleTerminalOutputRef.current = (payload: TerminalOutputEvent) => {
		appendTerminalOutput(payload.sessionId, {
			terminalId: payload.terminalId,
			delta: payload.delta,
			truncated: payload.truncated,
			output: payload.output,
			exitStatus: payload.exitStatus ?? undefined,
		});
	};

	handleSessionsChangedRef.current = (payload: SessionsChangedPayload) => {
		handleSessionsChanged(payload);
	};

	handleSessionEventRef.current = (event: SessionEvent) => {
		let session = sessionsRef.current[event.sessionId];
		if (!session) {
			createLocalSession(event.sessionId);
			session = sessionsRef.current[event.sessionId];
		}

		const currentRevision = session?.revision;

		// Case 1: First revision initialization (from undefined to a value)
		// This happens for new sessions - just initialize the cursor and continue
		if (currentRevision === undefined) {
			// Initialize cursor without reset, then continue normal seq processing
			updateSessionCursor(event.sessionId, event.revision, 0);
			// Re-read session after cursor update
			session = sessionsRef.current[event.sessionId];
		}
		// Case 2: Revision bump (e.g., session reload/load with new revision)
		else if (event.revision > currentRevision) {
			// Reset session state for new revision
			resetSessionForRevision(event.sessionId, event.revision);
			pendingEventsRef.current.delete(event.sessionId);
			// Buffer current event for after backfill completes
			const pending = pendingEventsRef.current.get(event.sessionId) ?? [];
			pending.push(event);
			pendingEventsRef.current.set(event.sessionId, pending);
			// Trigger backfill from the beginning of new revision
			triggerBackfillRef.current?.(event.sessionId, event.revision, 0);
			return;
		}
		// Case 3: Event from old revision - ignore
		else if (event.revision < currentRevision) {
			return;
		}

		const lastSeq = session?.lastAppliedSeq ?? 0;

		// Skip already applied events (deduplication)
		if (event.seq <= lastSeq) {
			return;
		}

		// Check if this is the next expected event
		if (event.seq === lastSeq + 1) {
			// Apply directly
			applySessionEventRef.current?.(event);
			updateSessionCursor(event.sessionId, event.revision, event.seq);
			// Try to flush any pending events that are now in order
			flushPendingEventsRef.current?.(event.sessionId);
		} else {
			// Gap detected - buffer the event
			const pending = pendingEventsRef.current.get(event.sessionId) ?? [];
			pending.push(event);
			pendingEventsRef.current.set(event.sessionId, pending);
			// Note: Backfill will be triggered by the subscription effect
		}
	};

	// Connect to gateway and register listeners on mount only
	useEffect(() => {
		gatewaySocket.connect();

		// Stable wrapper functions that delegate to refs
		const onSessionUpdate = (n: SessionNotification) =>
			handleSessionUpdateRef.current?.(n);
		const onSessionError = (p: StreamErrorPayload) =>
			handleSessionErrorRef.current?.(p);
		const onSessionAttached = (p: SessionAttachedPayload) =>
			handleSessionAttachedRef.current?.(p);
		const onSessionDetached = (p: SessionDetachedPayload) =>
			handleSessionDetachedRef.current?.(p);
		const onPermissionRequest = (p: PermissionRequestPayload) =>
			handlePermissionRequestRef.current?.(p);
		const onPermissionResult = (p: PermissionDecisionPayload) =>
			handlePermissionResultRef.current?.(p);
		const onTerminalOutput = (p: TerminalOutputEvent) =>
			handleTerminalOutputRef.current?.(p);
		const onSessionsChanged = (p: SessionsChangedPayload) =>
			handleSessionsChangedRef.current?.(p);
		const onSessionEvent = (e: SessionEvent) =>
			handleSessionEventRef.current?.(e);

		// Register listeners once
		const unsubUpdate = gatewaySocket.onSessionUpdate(onSessionUpdate);
		const unsubError = gatewaySocket.onSessionError(onSessionError);
		const unsubSessionAttached =
			gatewaySocket.onSessionAttached(onSessionAttached);
		const unsubSessionDetached =
			gatewaySocket.onSessionDetached(onSessionDetached);
		const unsubPermReq = gatewaySocket.onPermissionRequest(onPermissionRequest);
		const unsubPermRes = gatewaySocket.onPermissionResult(onPermissionResult);
		const unsubTerminal = gatewaySocket.onTerminalOutput(onTerminalOutput);
		const unsubSessionsChanged =
			gatewaySocket.onSessionsChanged(onSessionsChanged);
		const unsubSessionEvent = gatewaySocket.onSessionEvent(onSessionEvent);

		const unsubDisconnect = gatewaySocket.onDisconnect(() => {
			const now = new Date().toISOString();
			for (const session of Object.values(sessionsRef.current)) {
				if (session.isAttached) {
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
			unsubUpdate();
			unsubError();
			unsubSessionAttached();
			unsubSessionDetached();
			unsubPermReq();
			unsubPermRes();
			unsubTerminal();
			unsubSessionsChanged();
			unsubSessionEvent();
			unsubDisconnect();
			gatewaySocket.disconnect();
		};
	}, []); // Empty dependency array - only run on mount/unmount

	// Subscribe to sessions while attached or loading (load replays history)
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

		// Subscribe to new sessions that can stream (attached/loading)
		for (const sessionId of subscribableIds) {
			if (!subscribedSessionsRef.current.has(sessionId)) {
				gatewaySocket.subscribeToSession(sessionId);
				subscribedSessionsRef.current.add(sessionId);
				setStreamError(sessionId, undefined);

				// Trigger initial backfill on subscription
				const session = sessions[sessionId];
				if (session && !initialBackfillTriggeredRef.current.has(sessionId)) {
					initialBackfillTriggeredRef.current.add(sessionId);
					const revision = session.revision ?? 1;
					const afterSeq = session.lastAppliedSeq ?? 0;
					triggerBackfillRef.current?.(sessionId, revision, afterSeq);
				}
			}
		}

		// Unsubscribe from sessions that are no longer streaming
		for (const sessionId of subscribedSessionsRef.current) {
			if (!subscribableIds.has(sessionId)) {
				gatewaySocket.unsubscribeFromSession(sessionId);
				subscribedSessionsRef.current.delete(sessionId);
				cancelBackfill(sessionId);
				initialBackfillTriggeredRef.current.delete(sessionId);
			}
		}
	}, [sessions, setStreamError, cancelBackfill]);

	// Re-subscribe to all sessions when socket connects/reconnects
	useEffect(() => {
		const handleConnect = () => {
			for (const sessionId of subscribedSessionsRef.current) {
				gatewaySocket.subscribeToSession(sessionId);

				// Trigger backfill on reconnect to catch up on missed events
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
	}, []); // Empty dependency array - uses refs for callbacks
}
