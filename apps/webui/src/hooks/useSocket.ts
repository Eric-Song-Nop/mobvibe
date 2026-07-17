import { isEncryptedPayload, type SessionSummary } from "@mobvibe/shared";
import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
	applyContiguousPendingEvents,
	createSessionSyncBackup,
	restoreBackupIfSessionWasReset,
	type SessionSyncBackup,
} from "@/hooks/backfill-manager";
import {
	createEncryptedEventBuffer,
	type EventSource,
} from "@/hooks/encrypted-event-buffer";
import {
	applyPermissionRequest,
	applySessionEvent,
	type SessionEventReducerActions,
} from "@/hooks/session-event-reducer";
import { createSubscriptionManager } from "@/hooks/subscription-manager";
import { useSessionBackfill } from "@/hooks/use-session-backfill";
import type { ChatStoreActions } from "@/hooks/useSessionMutations";
import {
	type CliStatusPayload,
	type PermissionDecisionPayload,
	type PermissionRequestPayload,
	type SessionAttachedPayload,
	type SessionDetachedPayload,
	type SessionEvent,
	type SessionsChangedPayload,
} from "@/lib/acp";
import { type ChatSession, useChatStore } from "@/lib/chat-store";
import { bootstrapSessionE2EE, e2ee } from "@/lib/e2ee";
import { createFallbackError } from "@/lib/error-utils";
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

// Helper to get cursor from store directly (unified source of truth)
const getCursor = (sessionId: string) => {
	const session = useChatStore.getState().sessions[sessionId];
	return {
		revision: session?.revision,
		lastAppliedSeq: session?.lastAppliedSeq ?? 0,
	};
};

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
	resetSessionForRevision,
	onReconnect,
}: UseSocketOptions) {
	const { t } = useTranslation();
	const subscriptionManager = useRef(createSubscriptionManager()).current;
	const {
		clearSession: clearManagedSession,
		initialBackfillTriggered,
		recoverableSessions,
		resetInitialBackfill,
		subscribedSessions,
	} = subscriptionManager;
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
	const encryptedBufferRef = useRef(createEncryptedEventBuffer());
	const syncBackupsRef = useRef<Map<string, SessionSyncBackup>>(new Map());

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
		| ((event: SessionEvent, actions?: SessionEventReducerActions) => void)
		| undefined
	>(undefined);
	applySessionEventRef.current = (
		event: SessionEvent,
		actions: SessionEventReducerActions = {
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
			finalizeAssistantMessage,
			setSending,
			setCanceling,
		},
	) => {
		applySessionEvent({
			event,
			session: sessionsRef.current[event.sessionId],
			sessions: sessionsRef.current,
			actions,
			notifications: {
				notifyPermissionRequest,
				notifyResponseCompleted,
				notifySessionError,
			},
		});
	};
	const applySessionEventAtomicallyRef = useRef<
		((event: SessionEvent) => void) | undefined
	>(undefined);
	applySessionEventAtomicallyRef.current = (event) => {
		useChatStore
			.getState()
			.applySessionEventTransaction(event, (actions) =>
				applySessionEventRef.current?.(event, actions),
			);
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
				applySessionEventAtomicallyRef.current?.(event);
				lastSeq = event.seq;
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
				const remaining = applyContiguousPendingEvents({
					pending,
					revision: cursor.revision,
					lastAppliedSeq: cursor.lastAppliedSeq,
					applyEvent: (event) =>
						applySessionEventAtomicallyRef.current?.(event),
				});
				if (remaining.length > 0) {
					pendingEventsRef.current.set(sessionId, remaining);
				} else {
					pendingEventsRef.current.delete(sessionId);
				}
			}

			const backup = syncBackupsRef.current.get(sessionId);
			if (backup) {
				restoreBackupIfSessionWasReset({ store, sessionId, backup });
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
			encryptedBufferRef.current.clear(sessionId);
			resetInitialBackfill(sessionId);

			// Defer restart to avoid race conditions
			queueMicrotask(() => {
				startBackfill(sessionId, newRevision, 0);
			});
		},
	});

	const getRevisionResetSessions = useCallback(
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
				.map((summary) => ({
					sessionId: summary.sessionId,
					revision: summary.revision!,
				})),
		[],
	);

	const clearRevisionRuntimeState = useCallback(
		(sessionId: string, preserveEncryptedRevision?: number) => {
			pendingEventsRef.current.delete(sessionId);
			if (preserveEncryptedRevision === undefined) {
				encryptedBufferRef.current.clear(sessionId);
			} else {
				encryptedBufferRef.current.retainRevision(
					sessionId,
					preserveEncryptedRevision,
				);
			}
			syncBackupsRef.current.delete(sessionId);
			cancelBackfill(sessionId);
			resetInitialBackfill(sessionId);
			setStreamError(sessionId, undefined);
		},
		[cancelBackfill, resetInitialBackfill, setStreamError],
	);

	const syncSessionSummaries = useCallback(
		(summaries: SessionSummary[]) => {
			for (const reset of getRevisionResetSessions(summaries)) {
				clearRevisionRuntimeState(reset.sessionId, reset.revision);
			}
			syncSessions?.(summaries);
		},
		[clearRevisionRuntimeState, getRevisionResetSessions, syncSessions],
	);

	const clearTrackedSession = useCallback(
		(sessionId: string, options?: { unsubscribe?: boolean }) => {
			const { unsubscribe = true } = options ?? {};
			if (unsubscribe) {
				gatewaySocket.unsubscribeFromSession(sessionId);
			}
			pendingEventsRef.current.delete(sessionId);
			encryptedBufferRef.current.clear(sessionId);
			syncBackupsRef.current.delete(sessionId);
			cancelBackfill(sessionId);
			clearManagedSession(sessionId);
		},
		[cancelBackfill, clearManagedSession],
	);

	const syncSessionHistory = useCallback(
		(sessionId: string) => {
			const session = useChatStore.getState().sessions[sessionId];
			if (!session || session.sending || session.historySyncing) return;

			useChatStore.getState().setHistorySyncing(sessionId, true);
			useChatStore.getState().setHistorySyncWarning(sessionId, undefined);
			const revision = session.revision ?? 1;
			syncBackupsRef.current.set(sessionId, createSessionSyncBackup(session));

			// Full re-sync: clear all buffers, reset messages, replay from seq 0
			pendingEventsRef.current.delete(sessionId);
			encryptedBufferRef.current.clear(sessionId);
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
			!e2ee.hasSessionDek(incomingEvent.sessionId, incomingEvent.revision)
		) {
			encryptedBufferRef.current.push(incomingEvent.sessionId, {
				event: incomingEvent,
				source,
			});
			return;
		}

		let event: SessionEvent;
		try {
			event = e2ee.decryptEvent(incomingEvent);
		} catch (error) {
			console.error(
				`[E2EE] Failed to decrypt event for ${incomingEvent.sessionId} revision ${incomingEvent.revision}`,
				error,
			);
			encryptedBufferRef.current.push(incomingEvent.sessionId, {
				event: incomingEvent,
				source,
			});
			useChatStore
				.getState()
				.setSessionE2EEStatus(incomingEvent.sessionId, "missing_key");
			return;
		}

		let session = sessionsRef.current[event.sessionId];
		if (!session) {
			createLocalSession(event.sessionId);
			session = sessionsRef.current[event.sessionId];
		}

		const cursor = getCursor(event.sessionId);
		const currentRevision = cursor.revision;

		if (currentRevision !== undefined && event.revision < currentRevision) {
			return;
		} else if (
			currentRevision !== undefined &&
			event.revision > currentRevision
		) {
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
			applySessionEventAtomicallyRef.current?.(event);
			prunePendingEventsRef.current?.(event.sessionId);
			flushPendingEventsRef.current?.(event.sessionId);
			return;
		}

		if (event.seq === lastAppliedSeq + 1) {
			applySessionEventAtomicallyRef.current?.(event);
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
			encryptedBufferRef.current.clear(event.sessionId);
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

		recoverableSessions.add(payload.sessionId);
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
				(!initialBackfillTriggered.has(payload.sessionId) ||
					shouldResetForRevision)
			) {
				initialBackfillTriggered.add(payload.sessionId);
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
			recoverableSessions.add(payload.sessionId);
		} else {
			clearTrackedSession(payload.sessionId);
		}
		markSessionDetached(payload);
	};

	handlePermissionRequestRef.current = (payload: PermissionRequestPayload) => {
		applyPermissionRequest({
			sessionId: payload.sessionId,
			payload,
			session: sessionsRef.current[payload.sessionId],
			sessions: sessionsRef.current,
			actions: { addPermissionRequest },
			notifications: { notifyPermissionRequest },
		});
	};

	handlePermissionResultRef.current = (payload: PermissionDecisionPayload) => {
		setPermissionOutcome(payload.sessionId, payload.requestId, payload.outcome);
		setPermissionDecisionState(payload.sessionId, payload.requestId, "idle");
	};

	handleSessionsChangedRef.current = (payload: SessionsChangedPayload) => {
		const addedOrUpdated = [...payload.added, ...payload.updated];
		for (const reset of getRevisionResetSessions(addedOrUpdated)) {
			clearRevisionRuntimeState(reset.sessionId, reset.revision);
		}
		handleSessionsChanged(payload);

		// Bootstrap session DEKs and keep runtime E2EE status in sync.
		const { setSessionE2EEStatus } = useChatStore.getState();
		for (const session of addedOrUpdated) {
			setSessionE2EEStatus(
				session.sessionId,
				bootstrapSessionE2EE(
					session.sessionId,
					session.wrappedDek,
					session.revision,
				),
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
		const unsubDekReady = e2ee.onDekReady((sessionId, revision) => {
			const buffered = encryptedBufferRef.current.drain(sessionId, revision);
			if (buffered.length === 0) return;

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

		return () => {
			unsubCliStatus();
			unsubSessionAttached();
			unsubSessionDetached();
			unsubPermReq();
			unsubPermRes();
			unsubSessionsChanged();
			unsubSessionEvent();
			unsubDisconnect();
			gatewaySocket.destroy();
		};
	}, []);

	// Subscribe to sessions while attached or loading without re-rendering the app shell
	useEffect(() => {
		const syncSubscribedSessions = (sessions: Record<string, ChatSession>) => {
			for (const sessionId of gatewaySocket.getSubscribedSessions()) {
				if (!subscribedSessions.has(sessionId)) {
					subscribedSessions.add(sessionId);
				}
				if (sessions[sessionId]) {
					recoverableSessions.add(sessionId);
				}
			}

			for (const sessionId of Array.from(recoverableSessions)) {
				if (!sessions[sessionId]) {
					recoverableSessions.delete(sessionId);
				}
			}

			const subscribableIds = new Set<string>();
			for (const [sessionId, session] of Object.entries(sessions)) {
				const isLiveSession =
					session.isAttached || session.isLoading || session.sending;
				if (isLiveSession) {
					recoverableSessions.add(sessionId);
					subscribableIds.add(sessionId);
					continue;
				}

				if (
					session.detachedReason === "gateway_disconnect" &&
					recoverableSessions.has(sessionId)
				) {
					subscribableIds.add(sessionId);
					continue;
				}

				recoverableSessions.delete(sessionId);
			}

			// Subscribe to new sessions
			for (const sessionId of subscribableIds) {
				if (!subscribedSessions.has(sessionId)) {
					gatewaySocket.subscribeToSession(sessionId);
					subscribedSessions.add(sessionId);
					recoverableSessions.add(sessionId);
					setStreamError(sessionId, undefined);

					// Trigger initial backfill on subscription (skip if still loading)
					const session = sessions[sessionId];
					if (
						session &&
						gatewaySocket.isConnected() &&
						!session.isLoading &&
						!initialBackfillTriggered.has(sessionId)
					) {
						initialBackfillTriggered.add(sessionId);
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
			for (const sessionId of subscribedSessions) {
				const session = sessions[sessionId];
				if (session?.isLoading) {
					cancelBackfill(sessionId);
					resetInitialBackfill(sessionId);
				}
			}

			// Unsubscribe from sessions no longer streaming
			for (const sessionId of Array.from(subscribedSessions)) {
				if (!subscribableIds.has(sessionId)) {
					clearTrackedSession(sessionId);
				}
			}

			// Compensate: trigger backfill for subscribed sessions that finished loading
			// but haven't had their initial backfill yet (were skipped due to isLoading)
			for (const sessionId of subscribedSessions) {
				if (!subscribableIds.has(sessionId)) continue;
				const session = sessions[sessionId];
				if (
					session &&
					gatewaySocket.isConnected() &&
					!session.isLoading &&
					!initialBackfillTriggered.has(sessionId)
				) {
					initialBackfillTriggered.add(sessionId);
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
	}, [
		cancelBackfill,
		clearTrackedSession,
		initialBackfillTriggered,
		recoverableSessions,
		resetInitialBackfill,
		setStreamError,
		subscribedSessions,
	]);

	// Stable ref for onReconnect callback
	const onReconnectRef = useRef(onReconnect);
	onReconnectRef.current = onReconnect;

	// Re-subscribe on reconnect
	useEffect(() => {
		let hasConnectedOnce = false;
		const handleConnect = () => {
			const connectedSessionIds = new Set([
				...subscribedSessions,
				...recoverableSessions,
			]);

			if (!hasConnectedOnce) {
				hasConnectedOnce = true;
				for (const sessionId of connectedSessionIds) {
					const session = sessionsRef.current[sessionId];
					if (!session) {
						clearTrackedSession(sessionId, { unsubscribe: false });
						continue;
					}

					subscribedSessions.add(sessionId);
					recoverableSessions.add(sessionId);
					gatewaySocket.subscribeToSession(sessionId);

					const isLoading =
						useChatStore.getState().sessions[sessionId]?.isLoading;
					if (!isLoading && !initialBackfillTriggered.has(sessionId)) {
						initialBackfillTriggered.add(sessionId);
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
				resetInitialBackfill(sessionId);
			}

			for (const sessionId of connectedSessionIds) {
				const session = sessionsRef.current[sessionId];
				if (!session) {
					clearTrackedSession(sessionId, { unsubscribe: false });
					continue;
				}

				subscribedSessions.add(sessionId);
				recoverableSessions.add(sessionId);
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
	}, [
		clearTrackedSession,
		initialBackfillTriggered,
		recoverableSessions,
		resetInitialBackfill,
		subscribedSessions,
	]);

	return {
		syncSessionSummaries,
		syncSessionHistory,
		isBackfilling,
	};
}
