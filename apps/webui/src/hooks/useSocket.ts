import { isEncryptedPayload, type SessionSummary } from "@mobvibe/shared";
import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useSessionBackfill } from "@/hooks/use-session-backfill";
import type { ChatStoreActions } from "@/hooks/useSessionMutations";
import {
	type CliStatusPayload,
	extractAvailableCommandsUpdate,
	extractConfigOptionUpdate,
	extractPlanUpdate,
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
import {
	type ChatMessage,
	type ChatSession,
	type SessionRestoreSnapshot,
	useChatStore,
} from "@/lib/chat-store";
import { bootstrapSessionE2EE, e2ee } from "@/lib/e2ee";
import { createFallbackError, isErrorDetail } from "@/lib/error-utils";
import { useMachinesStore } from "@/lib/machines-store";
import {
	notifyPermissionRequest,
	notifyResponseCompleted,
	notifySessionError,
} from "@/lib/notifications";
import { gatewaySocket } from "@/lib/socket";

type UseSocketOptions = {
	// Legacy compatibility for older tests; the hook now reads sessions from the store.
	sessions?: Record<string, ChatSession>;
	syncSessions?: ChatStoreActions["syncSessions"];
	setSending?: ChatStoreActions["setSending"];
	setCanceling?: ChatStoreActions["setCanceling"];
	finalizeAssistantMessage?: ChatStoreActions["finalizeAssistantMessage"];
	/** Called on socket reconnect (not the initial connect) */
	onReconnect?: () => void;
} & Pick<
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
	| "handleSessionsChanged"
	| "markSessionAttached"
	| "markSessionDetached"
	| "createLocalSession"
	| "updateSessionCursor"
	| "resetSessionForRevision"
>;

type EventSource = "live" | "backfill";

type BufferedEncryptedEvent = {
	event: SessionEvent;
	source: EventSource;
};

// Helper to get cursor from store directly (unified source of truth)
const getCursor = (sessionId: string) => {
	const session = useChatStore.getState().sessions[sessionId];
	return {
		revision: session?.revision,
		lastAppliedSeq: session?.lastAppliedSeq ?? 0,
	};
};

/** Dedup-aware permission request handler — shared by WAL backfill and live socket paths. */
function processPermissionRequest(
	sessionId: string,
	payload: PermissionRequestPayload,
	sessionsRef: { current: Record<string, ChatSession> },
	addPermissionRequest: ChatStoreActions["addPermissionRequest"],
) {
	const currentSession = useChatStore.getState().sessions[sessionId];
	const alreadyExists = currentSession?.messages.some(
		(m) => m.kind === "permission" && m.requestId === payload.requestId,
	);
	addPermissionRequest(sessionId, {
		requestId: payload.requestId,
		toolCall: payload.toolCall,
		options: payload.options ?? [],
	});
	if (!alreadyExists) {
		notifyPermissionRequest(payload, { sessions: sessionsRef.current });
	}
}

export function useSocket({
	syncSessions,
	setSending,
	setCanceling,
	finalizeAssistantMessage,
	appendAssistantChunk,
	appendThoughtChunk,
	confirmOrAppendUserMessage,
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
	onReconnect,
}: UseSocketOptions) {
	const { t } = useTranslation();
	const subscribedSessionsRef = useRef<Set<string>>(new Set());
	const recoverableSessionsRef = useRef<Set<string>>(new Set());
	const sessionsRef = useRef(useChatStore.getState().sessions);

	useEffect(
		() =>
			useChatStore.subscribe((state) => {
				sessionsRef.current = state.sessions;
			}),
		[],
	);

	// Pending events buffer for out-of-order events (local to hook)
	const pendingEventsRef = useRef<Map<string, SessionEvent[]>>(new Map());

	// Buffer for encrypted events received before DEK is ready
	const encryptedBufferRef = useRef<Map<string, BufferedEncryptedEvent[]>>(
		new Map(),
	);
	const syncBackupsRef = useRef<
		Map<
			string,
			{
				messages: ChatMessage[];
				snapshot: SessionRestoreSnapshot;
			}
		>
	>(new Map());

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
					confirmOrAppendUserMessage(event.sessionId, {
						text: textChunk.text,
						messageId: textChunk.messageId,
					});
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
					// Protect pinned titles from agent auto-update
					if (session?.isTitlePinned && infoUpdate.title !== undefined) {
						const { title: _ignored, ...rest } = infoUpdate;
						if (Object.keys(rest).length > 0) {
							updateSessionMeta(event.sessionId, rest);
						}
					} else {
						updateSessionMeta(event.sessionId, infoUpdate);
					}
				}
				const availableCommands = extractAvailableCommandsUpdate(notification);
				if (availableCommands !== null) {
					updateSessionMeta(event.sessionId, { availableCommands });
				}
				const planUpdate = extractPlanUpdate(notification);
				if (planUpdate) {
					updateSessionMeta(event.sessionId, { plan: planUpdate.entries });
				}
				const configOptionUpdate = extractConfigOptionUpdate(notification);
				if (configOptionUpdate) {
					updateSessionMeta(event.sessionId, {
						configOptions: configOptionUpdate.configOptions,
					});
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
				processPermissionRequest(
					event.sessionId,
					payload,
					sessionsRef,
					addPermissionRequest,
				);
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
				notifyResponseCompleted(
					{ sessionId: event.sessionId },
					{ sessions: sessionsRef.current },
				);
				finalizeAssistantMessage?.(event.sessionId);
				setSending?.(event.sessionId, false);
				setCanceling?.(event.sessionId, false);
				break;
			}
			default:
				// Forward-compatible: silently ignore unknown event kinds
				// so the UI doesn't crash when SDK introduces new event types
				break;
		}
	};

	// Flush pending events that are now in order
	const prunePendingEventsRef = useRef<
		((sessionId: string) => SessionEvent[]) | undefined
	>(undefined);
	prunePendingEventsRef.current = (sessionId: string) => {
		const cursor = getCursor(sessionId);
		const pending = pendingEventsRef.current.get(sessionId);
		if (!pending || pending.length === 0) {
			return [];
		}

		const pruned = pending.filter((event) => {
			if (cursor.revision !== undefined && event.revision !== cursor.revision) {
				return false;
			}
			return event.seq > cursor.lastAppliedSeq;
		});

		if (pruned.length > 0) {
			pendingEventsRef.current.set(sessionId, pruned);
		} else {
			pendingEventsRef.current.delete(sessionId);
		}

		return pruned;
	};

	const flushPendingEventsRef = useRef<
		((sessionId: string) => void) | undefined
	>(undefined);
	flushPendingEventsRef.current = (sessionId: string) => {
		const cursor = getCursor(sessionId);
		if (cursor.revision === undefined) return;

		let lastSeq = cursor.lastAppliedSeq;
		const validPending = prunePendingEventsRef.current?.(sessionId) ?? [];
		if (validPending.length === 0) return;

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
	const ingestSessionEventRef = useRef<
		((event: SessionEvent, source: EventSource) => void) | undefined
	>(undefined);

	// Setup backfill hook for gap recovery
	const { startBackfill, cancelBackfill, isBackfilling } = useSessionBackfill({
		gatewayUrl: gatewaySocket.getGatewayUrl(),
		onEvents: (sessionId, events) => {
			for (const rawEvent of [...events].sort((a, b) => a.seq - b.seq)) {
				ingestSessionEventRef.current?.(rawEvent, "backfill");
			}
			prunePendingEventsRef.current?.(sessionId);
			flushPendingEventsRef.current?.(sessionId);
		},
		onComplete: (_sessionId) => {
			syncBackupsRef.current.delete(_sessionId);
			const store = useChatStore.getState();
			store.setHistorySyncing(_sessionId, false);
			store.setHistorySyncWarning(_sessionId, undefined);
		},
		onError: (sessionId, error) => {
			console.error(`[backfill] Error for session ${sessionId}:`, error);
			const store = useChatStore.getState();
			// Fall back to applying pending events best effort
			const pending = pendingEventsRef.current.get(sessionId);
			if (pending && pending.length > 0) {
				const cursor = getCursor(sessionId);
				const sorted = pending
					.filter((e) =>
						cursor.revision === undefined
							? true
							: e.revision === cursor.revision,
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
			}

			const backup = syncBackupsRef.current.get(sessionId);
			if (backup) {
				const failedSession = store.sessions[sessionId];
				if (
					failedSession &&
					failedSession.messages.length === 0 &&
					(failedSession.lastAppliedSeq ?? 0) === 0
				) {
					store.restoreSessionMessages(
						sessionId,
						backup.messages,
						backup.snapshot,
					);
				}
				syncBackupsRef.current.delete(sessionId);
			}
			store.setHistorySyncing(sessionId, false);
			store.setHistorySyncWarning(sessionId, {
				...createFallbackError(t("session.historyMayBeStale"), "session"),
				detail: error.message,
			});
		},
		onRevisionMismatch: (sessionId, newRevision) => {
			console.log(
				`[backfill] Revision mismatch for ${sessionId}, resetting to revision ${newRevision}`,
			);
			resetSessionForRevision(sessionId, newRevision);
			pendingEventsRef.current.delete(sessionId);
			encryptedBufferRef.current.delete(sessionId);
			initialBackfillTriggeredRef.current.delete(sessionId);

			// Defer restart to avoid race conditions
			queueMicrotask(() => {
				startBackfill(sessionId, newRevision, 0);
			});
		},
	});

	const getRevisionResetSessionIds = useCallback(
		(
			summaries: Array<
				Pick<SessionSummary, "sessionId" | "isAttached" | "revision">
			>,
		) =>
			summaries
				.filter((summary) => {
					if (summary.isAttached !== true || summary.revision === undefined) {
						return false;
					}
					const current = sessionsRef.current[summary.sessionId];
					return current !== undefined && current.revision !== summary.revision;
				})
				.map((summary) => summary.sessionId),
		[],
	);

	const clearRevisionRuntimeState = useCallback(
		(sessionId: string) => {
			pendingEventsRef.current.delete(sessionId);
			encryptedBufferRef.current.delete(sessionId);
			syncBackupsRef.current.delete(sessionId);
			cancelBackfill(sessionId);
			initialBackfillTriggeredRef.current.delete(sessionId);
			setStreamError(sessionId, undefined);
		},
		[cancelBackfill, setStreamError],
	);

	const syncSessionSummaries = useCallback(
		(summaries: SessionSummary[]) => {
			for (const sessionId of getRevisionResetSessionIds(summaries)) {
				clearRevisionRuntimeState(sessionId);
			}
			syncSessions?.(summaries);
		},
		[clearRevisionRuntimeState, getRevisionResetSessionIds, syncSessions],
	);

	const clearTrackedSession = useCallback(
		(sessionId: string, options?: { unsubscribe?: boolean }) => {
			const { unsubscribe = true } = options ?? {};
			if (unsubscribe) {
				gatewaySocket.unsubscribeFromSession(sessionId);
			}
			subscribedSessionsRef.current.delete(sessionId);
			recoverableSessionsRef.current.delete(sessionId);
			pendingEventsRef.current.delete(sessionId);
			encryptedBufferRef.current.delete(sessionId);
			syncBackupsRef.current.delete(sessionId);
			cancelBackfill(sessionId);
			initialBackfillTriggeredRef.current.delete(sessionId);
		},
		[cancelBackfill],
	);

	const syncSessionHistory = useCallback(
		(sessionId: string) => {
			const session = useChatStore.getState().sessions[sessionId];
			if (!session || session.sending || session.historySyncing) return;

			useChatStore.getState().setHistorySyncing(sessionId, true);
			useChatStore.getState().setHistorySyncWarning(sessionId, undefined);
			const revision = session.revision ?? 1;
			syncBackupsRef.current.set(sessionId, {
				messages: [...session.messages],
				snapshot: {
					lastAppliedSeq: session.lastAppliedSeq,
					revision: session.revision,
					terminalOutputs: { ...session.terminalOutputs },
					streamingMessageId: session.streamingMessageId,
					streamingMessageRole: session.streamingMessageRole,
					streamingThoughtId: session.streamingThoughtId,
				},
			});

			// Full re-sync: clear all buffers, reset messages, replay from seq 0
			pendingEventsRef.current.delete(sessionId);
			encryptedBufferRef.current.delete(sessionId);
			resetSessionForRevision(sessionId, revision);
			startBackfill(sessionId, revision, 0);
		},
		[startBackfill, resetSessionForRevision],
	);

	// Trigger backfill helper — delegates directly to startBackfill which
	// already handles cancel-and-restart when a backfill is in progress.
	triggerBackfillRef.current = (
		sessionId: string,
		revision: number,
		afterSeq: number,
	) => {
		startBackfill(sessionId, revision, afterSeq);
	};
	ingestSessionEventRef.current = (
		incomingEvent: SessionEvent,
		source: EventSource,
	) => {
		if (
			isEncryptedPayload(incomingEvent.payload) &&
			!e2ee.hasSessionDek(incomingEvent.sessionId)
		) {
			const buffered =
				encryptedBufferRef.current.get(incomingEvent.sessionId) ?? [];
			buffered.push({ event: incomingEvent, source });
			encryptedBufferRef.current.set(incomingEvent.sessionId, buffered);
			return;
		}

		const event = e2ee.decryptEvent(incomingEvent);

		let session = sessionsRef.current[event.sessionId];
		if (!session) {
			createLocalSession(event.sessionId);
			session = sessionsRef.current[event.sessionId];
		}

		const cursor = getCursor(event.sessionId);
		const currentRevision = cursor.revision;

		if (currentRevision === undefined) {
			updateSessionCursor(event.sessionId, event.revision, 0);
		} else if (event.revision < currentRevision) {
			return;
		} else if (event.revision > currentRevision) {
			if (source === "backfill") {
				pendingEventsRef.current.delete(event.sessionId);
				resetSessionForRevision(event.sessionId, event.revision);
			} else {
				clearRevisionRuntimeState(event.sessionId);
				resetSessionForRevision(event.sessionId, event.revision);
				const pending = pendingEventsRef.current.get(event.sessionId) ?? [];
				pending.push(event);
				pendingEventsRef.current.set(event.sessionId, pending);
				triggerBackfillRef.current?.(event.sessionId, event.revision, 0);
				return;
			}
		}

		const { lastAppliedSeq } = getCursor(event.sessionId);
		if (event.seq <= lastAppliedSeq) {
			return;
		}

		if (source === "backfill") {
			applySessionEventRef.current?.(event);
			updateSessionCursor(event.sessionId, event.revision, event.seq);
			return;
		}

		if (event.seq === lastAppliedSeq + 1) {
			applySessionEventRef.current?.(event);
			updateSessionCursor(event.sessionId, event.revision, event.seq);
			prunePendingEventsRef.current?.(event.sessionId);
			flushPendingEventsRef.current?.(event.sessionId);
			return;
		}

		const pending = pendingEventsRef.current.get(event.sessionId) ?? [];
		if (pending.length >= MAX_PENDING_SIZE) {
			console.warn(
				`[socket] Pending overflow for ${event.sessionId}, forcing reset`,
			);
			pendingEventsRef.current.delete(event.sessionId);
			encryptedBufferRef.current.delete(event.sessionId);
			resetSessionForRevision(event.sessionId, event.revision);
			triggerBackfillRef.current?.(event.sessionId, event.revision, 0);
			return;
		}

		pending.push(event);
		pendingEventsRef.current.set(event.sessionId, pending);
		if (!isBackfilling(event.sessionId)) {
			triggerBackfillRef.current?.(
				event.sessionId,
				event.revision,
				lastAppliedSeq,
			);
		}
	};

	// Update handler refs
	handleSessionAttachedRef.current = (payload: SessionAttachedPayload) => {
		const currentSession = useChatStore.getState().sessions[payload.sessionId];
		const shouldResetForRevision =
			currentSession !== undefined &&
			payload.revision !== undefined &&
			currentSession.revision !== payload.revision;

		recoverableSessionsRef.current.add(payload.sessionId);
		markSessionAttached(payload);

		if (shouldResetForRevision && payload.revision !== undefined) {
			clearRevisionRuntimeState(payload.sessionId);
			resetSessionForRevision(payload.sessionId, payload.revision);
		}

		// If revision is provided, trigger backfill (skip if still loading)
		if (payload.revision !== undefined) {
			const isLoading =
				useChatStore.getState().sessions[payload.sessionId]?.isLoading;
			if (
				!isLoading &&
				(!initialBackfillTriggeredRef.current.has(payload.sessionId) ||
					shouldResetForRevision)
			) {
				initialBackfillTriggeredRef.current.add(payload.sessionId);
				const afterSeq = shouldResetForRevision
					? 0
					: getCursor(payload.sessionId).lastAppliedSeq;
				triggerBackfillRef.current?.(
					payload.sessionId,
					payload.revision,
					afterSeq,
				);
			}
		}
	};

	handleSessionDetachedRef.current = (payload: SessionDetachedPayload) => {
		if (payload.reason === "gateway_disconnect") {
			recoverableSessionsRef.current.add(payload.sessionId);
		} else {
			clearTrackedSession(payload.sessionId);
		}
		markSessionDetached(payload);
	};

	handlePermissionRequestRef.current = (payload: PermissionRequestPayload) => {
		processPermissionRequest(
			payload.sessionId,
			payload,
			sessionsRef,
			addPermissionRequest,
		);
	};

	handlePermissionResultRef.current = (payload: PermissionDecisionPayload) => {
		setPermissionOutcome(payload.sessionId, payload.requestId, payload.outcome);
		setPermissionDecisionState(payload.sessionId, payload.requestId, "idle");
	};

	handleSessionsChangedRef.current = (payload: SessionsChangedPayload) => {
		const addedOrUpdated = [...payload.added, ...payload.updated];
		for (const sessionId of getRevisionResetSessionIds(addedOrUpdated)) {
			clearRevisionRuntimeState(sessionId);
		}
		handleSessionsChanged(payload);

		// Bootstrap session DEKs and keep runtime E2EE status in sync.
		const { setSessionE2EEStatus } = useChatStore.getState();
		for (const session of addedOrUpdated) {
			setSessionE2EEStatus(
				session.sessionId,
				bootstrapSessionE2EE(session.sessionId, session.wrappedDek),
			);
		}

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
		ingestSessionEventRef.current?.(incomingEvent, "live");
	};

	// Flush buffered encrypted events once a DEK becomes available
	useEffect(() => {
		const unsubDekReady = e2ee.onDekReady((sessionId) => {
			const buffered = encryptedBufferRef.current.get(sessionId);
			if (!buffered || buffered.length === 0) return;
			encryptedBufferRef.current.delete(sessionId);

			// Re-process each buffered event through the original ingest path.
			for (const bufferedEvent of buffered) {
				ingestSessionEventRef.current?.(
					bufferedEvent.event,
					bufferedEvent.source,
				);
			}
		});
		return unsubDekReady;
	}, []);

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

		// Cross-tab cursor sync: when another tab writes to localStorage,
		// merge cursors using max(local, remote) to prevent regression.
		// (storage event only fires for *other* tabs, not the current one)
		const handleStorageChange = (e: StorageEvent) => {
			if (e.key !== "mobvibe.chat-store" || !e.newValue) return;
			try {
				const external = JSON.parse(e.newValue)?.state?.sessions as
					| Record<string, { revision?: number; lastAppliedSeq?: number }>
					| undefined;
				if (!external) return;
				for (const [sessionId, ext] of Object.entries(external)) {
					if (ext.revision !== undefined && ext.lastAppliedSeq !== undefined) {
						// updateSessionCursor has monotonic guard — only advances
						useChatStore
							.getState()
							.updateSessionCursor(sessionId, ext.revision, ext.lastAppliedSeq);
					}
				}
			} catch {
				// Malformed storage data — ignore
			}
		};
		window.addEventListener("storage", handleStorageChange);

		return () => {
			unsubCliStatus();
			unsubSessionAttached();
			unsubSessionDetached();
			unsubPermReq();
			unsubPermRes();
			unsubSessionsChanged();
			unsubSessionEvent();
			unsubDisconnect();
			window.removeEventListener("storage", handleStorageChange);
			gatewaySocket.destroy();
		};
	}, []);

	// Subscribe to sessions while attached or loading without re-rendering the app shell
	useEffect(() => {
		const syncSubscribedSessions = (sessions: Record<string, ChatSession>) => {
			for (const sessionId of gatewaySocket.getSubscribedSessions()) {
				if (!subscribedSessionsRef.current.has(sessionId)) {
					subscribedSessionsRef.current.add(sessionId);
				}
				if (sessions[sessionId]) {
					recoverableSessionsRef.current.add(sessionId);
				}
			}

			for (const sessionId of Array.from(recoverableSessionsRef.current)) {
				if (!sessions[sessionId]) {
					recoverableSessionsRef.current.delete(sessionId);
				}
			}

			const subscribableIds = new Set<string>();
			for (const [sessionId, session] of Object.entries(sessions)) {
				const isLiveSession =
					session.isAttached || session.isLoading || session.sending;
				if (isLiveSession) {
					recoverableSessionsRef.current.add(sessionId);
					subscribableIds.add(sessionId);
					continue;
				}

				if (
					session.detachedReason === "gateway_disconnect" &&
					recoverableSessionsRef.current.has(sessionId)
				) {
					subscribableIds.add(sessionId);
					continue;
				}

				recoverableSessionsRef.current.delete(sessionId);
			}

			// Subscribe to new sessions
			for (const sessionId of subscribableIds) {
				if (!subscribedSessionsRef.current.has(sessionId)) {
					gatewaySocket.subscribeToSession(sessionId);
					subscribedSessionsRef.current.add(sessionId);
					recoverableSessionsRef.current.add(sessionId);
					setStreamError(sessionId, undefined);

					// Trigger initial backfill on subscription (skip if still loading)
					const session = sessions[sessionId];
					if (
						session &&
						gatewaySocket.isConnected() &&
						!session.isLoading &&
						!initialBackfillTriggeredRef.current.has(sessionId)
					) {
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

			// Cancel backfill for sessions that entered loading state (re-activation)
			for (const sessionId of subscribedSessionsRef.current) {
				const session = sessions[sessionId];
				if (session?.isLoading) {
					cancelBackfill(sessionId);
					initialBackfillTriggeredRef.current.delete(sessionId);
				}
			}

			// Unsubscribe from sessions no longer streaming
			for (const sessionId of Array.from(subscribedSessionsRef.current)) {
				if (!subscribableIds.has(sessionId)) {
					clearTrackedSession(sessionId);
				}
			}

			// Compensate: trigger backfill for subscribed sessions that finished loading
			// but haven't had their initial backfill yet (were skipped due to isLoading)
			for (const sessionId of subscribedSessionsRef.current) {
				if (!subscribableIds.has(sessionId)) continue;
				const session = sessions[sessionId];
				if (
					session &&
					gatewaySocket.isConnected() &&
					!session.isLoading &&
					!initialBackfillTriggeredRef.current.has(sessionId)
				) {
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
		};

		syncSubscribedSessions(sessionsRef.current);
		return useChatStore.subscribe((state) => {
			sessionsRef.current = state.sessions;
			syncSubscribedSessions(state.sessions);
		});
	}, [setStreamError, cancelBackfill, clearTrackedSession]);

	// Stable ref for onReconnect callback
	const onReconnectRef = useRef(onReconnect);
	onReconnectRef.current = onReconnect;

	// Re-subscribe on reconnect
	useEffect(() => {
		let hasConnectedOnce = false;
		const handleConnect = () => {
			const connectedSessionIds = new Set([
				...subscribedSessionsRef.current,
				...recoverableSessionsRef.current,
			]);

			if (!hasConnectedOnce) {
				hasConnectedOnce = true;
				for (const sessionId of connectedSessionIds) {
					const session = sessionsRef.current[sessionId];
					if (!session) {
						clearTrackedSession(sessionId, { unsubscribe: false });
						continue;
					}

					subscribedSessionsRef.current.add(sessionId);
					recoverableSessionsRef.current.add(sessionId);
					gatewaySocket.subscribeToSession(sessionId);

					const isLoading =
						useChatStore.getState().sessions[sessionId]?.isLoading;
					if (
						!isLoading &&
						!initialBackfillTriggeredRef.current.has(sessionId)
					) {
						initialBackfillTriggeredRef.current.add(sessionId);
						const revision = session.revision ?? 1;
						const afterSeq = session.lastAppliedSeq ?? 0;
						triggerBackfillRef.current?.(sessionId, revision, afterSeq);
					}
				}
				return;
			}

			// Reset backfill tracking — stale refs from previous connection
			// would block session:attached from triggering fresh backfill
			for (const sessionId of connectedSessionIds) {
				initialBackfillTriggeredRef.current.delete(sessionId);
			}

			for (const sessionId of connectedSessionIds) {
				const session = sessionsRef.current[sessionId];
				if (!session) {
					clearTrackedSession(sessionId, { unsubscribe: false });
					continue;
				}

				subscribedSessionsRef.current.add(sessionId);
				recoverableSessionsRef.current.add(sessionId);
				gatewaySocket.subscribeToSession(sessionId);

				// Trigger backfill on reconnect (skip sessions currently loading)
				const isLoading =
					useChatStore.getState().sessions[sessionId]?.isLoading;
				if (!isLoading) {
					const revision = session.revision ?? 1;
					const afterSeq = session.lastAppliedSeq ?? 0;
					triggerBackfillRef.current?.(sessionId, revision, afterSeq);
				}
			}

			onReconnectRef.current?.();
		};

		const unsubscribe = gatewaySocket.onConnect(handleConnect);
		return unsubscribe;
	}, [clearTrackedSession]);

	return {
		syncSessionSummaries,
		syncSessionHistory,
		isBackfilling,
	};
}
