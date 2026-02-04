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

	// P0-6: Synchronous cursor state for correct reads within same tick
	// sessionsRef updates only on re-render, which can cause stale reads
	// cursorRef is updated synchronously alongside store updates
	const cursorRef = useRef<
		Map<string, { revision: number | undefined; lastAppliedSeq: number }>
	>(new Map());

	// Helper to update cursor both synchronously (cursorRef) and in store
	const updateCursorSync = (
		sessionId: string,
		revision: number,
		seq: number,
	) => {
		cursorRef.current.set(sessionId, { revision, lastAppliedSeq: seq });
		updateSessionCursor(sessionId, revision, seq);
	};

	// Helper to get current cursor (sync version)
	const getCursor = (sessionId: string) => {
		const syncCursor = cursorRef.current.get(sessionId);
		if (syncCursor) return syncCursor;
		// Fall back to store state (for initial load)
		const session = sessionsRef.current[sessionId];
		return {
			revision: session?.revision,
			lastAppliedSeq: session?.lastAppliedSeq ?? 0,
		};
	};

	// Pending events buffer for out-of-order events
	const pendingEventsRef = useRef<Map<string, SessionEvent[]>>(new Map());
	const applyPendingEventsBestEffort = (sessionId: string) => {
		const pending = pendingEventsRef.current.get(sessionId);
		if (!pending || pending.length === 0) {
			return;
		}

		// P0-6: Use getCursor for synchronous cursor reads
		const cursor = getCursor(sessionId);
		const currentRevision = cursor.revision;
		const sorted = pending
			.filter((event) =>
				currentRevision === undefined
					? true
					: event.revision === currentRevision,
			)
			.sort((a, b) => a.seq - b.seq);

		let lastSeq = cursor.lastAppliedSeq;
		const remaining: SessionEvent[] = [];

		for (const event of sorted) {
			if (event.seq <= lastSeq) {
				continue;
			}

			// P0-7: Only apply consecutive events, stop at gaps
			if (event.seq !== lastSeq + 1) {
				remaining.push(event);
				continue; // Keep events after gap for later
			}

			applySessionEventRef.current?.(event);
			lastSeq = event.seq;
			// P0-6: Use updateCursorSync for synchronous updates
			updateCursorSync(sessionId, event.revision, event.seq);
		}

		// P0-7: Preserve events that couldn't be applied (after gap)
		if (remaining.length > 0) {
			pendingEventsRef.current.set(sessionId, remaining);
		} else {
			pendingEventsRef.current.delete(sessionId);
		}
	};

	// Track revision mismatch retry counts to prevent infinite loops
	const revisionMismatchRetryRef = useRef<Map<string, number>>(new Map());
	const MAX_REVISION_MISMATCH_RETRIES = 3;

	// Handler refs for stable listener registration
	const handleSessionUpdateRef = useRef<
		((n: SessionNotification) => void) | undefined
	>(undefined);
	const handleSessionErrorRef = useRef<
		((p: StreamErrorPayload) => void) | undefined
	>(undefined);
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
	const handleTerminalOutputRef = useRef<
		((p: TerminalOutputEvent) => void) | undefined
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

	// Apply a session:event to the chat store (ref for stable access)
	const applySessionEventRef = useRef<
		((event: SessionEvent) => void) | undefined
	>(undefined);
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
	const flushPendingEventsRef = useRef<
		((sessionId: string) => void) | undefined
	>(undefined);
	flushPendingEventsRef.current = (sessionId: string) => {
		// P0-6: Use getCursor for synchronous cursor reads
		const cursor = getCursor(sessionId);
		if (cursor.revision === undefined) return;

		const pending = pendingEventsRef.current.get(sessionId);
		if (!pending || pending.length === 0) return;

		let lastSeq = cursor.lastAppliedSeq;
		const currentRevision = cursor.revision;

		// P0-5: Filter out stale events (seq <= lastSeq or wrong revision)
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
				// P0-6: Use updateCursorSync for synchronous updates
				updateCursorSync(sessionId, event.revision, event.seq);
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
				// P0-6: Use getCursor for synchronous cursor reads
				const cursor = getCursor(sessionId);
				const lastSeq = cursor.lastAppliedSeq;

				// Skip already applied
				if (event.seq <= lastSeq) continue;

				// Apply if next in sequence
				if (event.seq === lastSeq + 1) {
					applySessionEventRef.current?.(event);
					// P0-6: Use updateCursorSync for synchronous updates
					updateCursorSync(sessionId, event.revision, event.seq);
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
			// Fall back to applying pending events so the stream can continue
			applyPendingEventsBestEffort(sessionId);
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
				// Apply pending events to avoid stalling the stream
				applyPendingEventsBestEffort(sessionId);
				return;
			}

			console.log(
				`[backfill] Revision mismatch for ${sessionId}, resetting to revision ${newRevision} (retry ${retryCount}/${MAX_REVISION_MISMATCH_RETRIES})`,
			);
			resetSessionForRevision(sessionId, newRevision);
			pendingEventsRef.current.delete(sessionId);
			// P0-6: Clear cursorRef on reset, will re-init from store/new revision
			cursorRef.current.delete(sessionId);

			// P0-3: Defer restart to let old backfill's cleanup complete
			// This prevents race condition where old backfill's finally block
			// could interfere with the new backfill's state
			queueMicrotask(() => {
				setSessionBackfilling(sessionId, true);
				startBackfill(sessionId, newRevision, 0);
			});
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
	// Note: session:update is deprecated - content updates now come via session:event
	// This handler is kept for backwards compatibility with older CLI versions
	// and only processes meta updates (mode/info/commands)
	handleSessionUpdateRef.current = (notification: SessionNotification) => {
		const session = sessionsRef.current[notification.sessionId];
		if (!session) {
			// Skip notifications for unknown sessions since we can't process meta updates
			// without an existing session context
			return;
		}

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

	// Note: terminal:output is deprecated - terminal output now comes via session:event
	// This handler is kept for backwards compatibility with older CLI versions
	handleTerminalOutputRef.current = (payload: TerminalOutputEvent) => {
		// Skip in eventlog sync mode (terminal output comes via session:event)
		const session = sessionsRef.current[payload.sessionId];
		if (session?.revision !== undefined) return;

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

	// P0-5: Max pending queue size before forcing reset
	const MAX_PENDING_SIZE = 1000;

	handleSessionEventRef.current = (event: SessionEvent) => {
		let session = sessionsRef.current[event.sessionId];
		if (!session) {
			createLocalSession(event.sessionId);
			session = sessionsRef.current[event.sessionId];
		}

		// P0-6: Use getCursor for synchronous cursor reads
		let cursor = getCursor(event.sessionId);
		const currentRevision = cursor.revision;

		// Case 1: First revision initialization (from undefined to a value)
		// This happens for new sessions - just initialize the cursor and continue
		if (currentRevision === undefined) {
			// Initialize cursor without reset, then continue normal seq processing
			// P0-6: Use updateCursorSync for synchronous updates
			updateCursorSync(event.sessionId, event.revision, 0);
			// Re-read cursor after update
			cursor = getCursor(event.sessionId);
		}
		// Case 2: Revision bump (e.g., session reload/load with new revision)
		else if (event.revision > currentRevision) {
			// Reset session state for new revision
			resetSessionForRevision(event.sessionId, event.revision);
			pendingEventsRef.current.delete(event.sessionId);
			// P0-6: Clear cursorRef on reset
			cursorRef.current.delete(event.sessionId);
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

		const lastSeq = cursor.lastAppliedSeq;

		// Skip already applied events (deduplication)
		if (event.seq <= lastSeq) {
			return;
		}

		// Check if this is the next expected event
		if (event.seq === lastSeq + 1) {
			// Apply directly
			applySessionEventRef.current?.(event);
			// P0-6: Use updateCursorSync for synchronous updates
			updateCursorSync(event.sessionId, event.revision, event.seq);
			// Try to flush any pending events that are now in order
			flushPendingEventsRef.current?.(event.sessionId);
		} else if (event.seq > lastSeq + 1) {
			// P0-4 & P0-5: Gap detected - buffer the event and trigger backfill
			const pending = pendingEventsRef.current.get(event.sessionId) ?? [];

			// P0-5: Check pending overflow - force reset if too large
			if (pending.length >= MAX_PENDING_SIZE) {
				console.warn(
					`[socket] Pending overflow for ${event.sessionId}, forcing reset`,
				);
				pendingEventsRef.current.delete(event.sessionId);
				resetSessionForRevision(event.sessionId, event.revision);
				// P0-6: Clear cursorRef on reset
				cursorRef.current.delete(event.sessionId);
				triggerBackfillRef.current?.(event.sessionId, event.revision, 0);
				return;
			}

			pending.push(event);
			pendingEventsRef.current.set(event.sessionId, pending);

			// P0-4: Trigger backfill to fill the gap (throttled by isBackfillActive check)
			triggerBackfillRef.current?.(event.sessionId, event.revision, lastSeq);
		}
		// else: seq <= lastSeq, already applied, ignore (handled above)
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
