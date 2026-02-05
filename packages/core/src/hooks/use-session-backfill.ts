import { useCallback, useRef } from "react";
import type { SessionEvent, SessionEventsResponse } from "../api/types";

type BackfillState = {
	sessionId: string;
	revision: number;
	afterSeq: number;
	abortController: AbortController;
};

type BackfillOptions = {
	/** Gateway URL for fetching events */
	gatewayUrl: string;
	/** Auth token for API requests */
	authToken?: string;
	/** Called when events are fetched (for applying to chat store) */
	onEvents: (sessionId: string, events: SessionEvent[]) => void;
	/** Called when backfill completes */
	onComplete?: (sessionId: string, totalEvents: number) => void;
	/** Called on error */
	onError?: (sessionId: string, error: Error) => void;
	/** Called when revision mismatch detected (session was reloaded) */
	onRevisionMismatch?: (sessionId: string, newRevision: number) => void;
	/** Page size for fetching events */
	pageSize?: number;
};

/**
 * Hook for managing session event backfill.
 * Uses AbortController for cancellation and handles paginated fetching.
 */
export function useSessionBackfill({
	gatewayUrl,
	authToken,
	onEvents,
	onComplete,
	onError,
	onRevisionMismatch,
	pageSize = 100,
}: BackfillOptions) {
	const activeBackfills = useRef<Map<string, BackfillState>>(new Map());

	/**
	 * Fetch events from the gateway REST API.
	 */
	const fetchEvents = useCallback(
		async (
			sessionId: string,
			revision: number,
			afterSeq: number,
			signal: AbortSignal,
		): Promise<SessionEventsResponse> => {
			const url = new URL(`${gatewayUrl}/acp/session/events`);
			url.searchParams.set("sessionId", sessionId);
			url.searchParams.set("revision", String(revision));
			url.searchParams.set("afterSeq", String(afterSeq));
			url.searchParams.set("limit", String(pageSize));

			const headers: Record<string, string> = {
				"Content-Type": "application/json",
			};
			if (authToken) {
				headers.Authorization = `Bearer ${authToken}`;
			}

			const response = await fetch(url.toString(), {
				method: "GET",
				headers,
				signal,
				credentials: "include",
			});

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(
					`Failed to fetch events: ${response.status} ${errorText}`,
				);
			}

			return response.json() as Promise<SessionEventsResponse>;
		},
		[gatewayUrl, authToken, pageSize],
	);

	/**
	 * Start backfill for a session.
	 * Will fetch events in pages until all events are retrieved.
	 */
	const startBackfill = useCallback(
		async (
			sessionId: string,
			revision: number,
			afterSeq: number,
		): Promise<void> => {
			console.log("[backfill] startBackfill called", {
				sessionId,
				revision,
				afterSeq,
			});
			// Cancel any existing backfill for this session
			const existing = activeBackfills.current.get(sessionId);
			if (existing) {
				console.log("[backfill] cancelling existing backfill", { sessionId });
				existing.abortController.abort();
				activeBackfills.current.delete(sessionId);
			}

			const abortController = new AbortController();
			const state: BackfillState = {
				sessionId,
				revision,
				afterSeq,
				abortController,
			};
			activeBackfills.current.set(sessionId, state);

			let currentAfterSeq = afterSeq;
			let totalEvents = 0;

			try {
				while (true) {
					// Check if aborted before each fetch
					if (abortController.signal.aborted) {
						return;
					}

					console.log("[backfill] fetching events", {
						sessionId,
						revision,
						afterSeq: currentAfterSeq,
					});
					const response = await fetchEvents(
						sessionId,
						revision,
						currentAfterSeq,
						abortController.signal,
					);
					console.log("[backfill] fetch response", {
						sessionId,
						responseRevision: response.revision,
						eventCount: response.events.length,
						hasMore: response.hasMore,
						nextAfterSeq: response.nextAfterSeq,
					});

					// Check if aborted after fetch
					if (abortController.signal.aborted) {
						console.log("[backfill] aborted after fetch", { sessionId });
						return;
					}

					// Check if revision changed (session was reloaded)
					if (response.revision !== revision) {
						console.log("[backfill] revision mismatch", {
							sessionId,
							expected: revision,
							actual: response.revision,
						});
						activeBackfills.current.delete(sessionId);
						onRevisionMismatch?.(sessionId, response.revision);
						return;
					}

					if (response.events.length > 0) {
						console.log("[backfill] applying events", {
							sessionId,
							eventCount: response.events.length,
							eventKinds: response.events.map((e) => e.kind),
						});
						onEvents(sessionId, response.events);
						totalEvents += response.events.length;
						currentAfterSeq = response.nextAfterSeq ?? currentAfterSeq;
					}

					// Guard against infinite loops
					if (!response.hasMore || response.events.length === 0) {
						console.log("[backfill] no more events", {
							sessionId,
							hasMore: response.hasMore,
						});
						break;
					}
				}

				console.log("[backfill] complete", { sessionId, totalEvents });
				onComplete?.(sessionId, totalEvents);
			} catch (error) {
				if (error instanceof Error && error.name === "AbortError") {
					// Backfill was cancelled, not an error
					console.log("[backfill] cancelled (abort)", { sessionId });
					return;
				}
				console.error("[backfill] error", { sessionId, error });
				onError?.(
					sessionId,
					error instanceof Error ? error : new Error(String(error)),
				);
			} finally {
				activeBackfills.current.delete(sessionId);
			}
		},
		[fetchEvents, onEvents, onComplete, onError, onRevisionMismatch],
	);

	/**
	 * Cancel backfill for a session.
	 */
	const cancelBackfill = useCallback((sessionId: string): void => {
		const state = activeBackfills.current.get(sessionId);
		if (state) {
			state.abortController.abort();
			activeBackfills.current.delete(sessionId);
		}
	}, []);

	/**
	 * Check if backfill is active for a session.
	 */
	const isBackfilling = useCallback((sessionId: string): boolean => {
		return activeBackfills.current.has(sessionId);
	}, []);

	/**
	 * Cancel all active backfills.
	 */
	const cancelAll = useCallback((): void => {
		for (const state of activeBackfills.current.values()) {
			state.abortController.abort();
		}
		activeBackfills.current.clear();
	}, []);

	return {
		startBackfill,
		cancelBackfill,
		isBackfilling,
		cancelAll,
	};
}
