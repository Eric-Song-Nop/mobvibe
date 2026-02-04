import { useCallback, useRef } from "react";
import type { SessionEvent, SessionEventsResponse } from "../api/types";

type BackfillState = {
	sessionId: string;
	revision: number;
	afterSeq: number;
	abortController: AbortController;
	/** P0-3: Generation token to detect stale backfills */
	generation: number;
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
 * Handles paginated fetching, cancellation, and error handling.
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
	// P0-3: Global generation counter for detecting stale backfills
	const backfillGenerationRef = useRef(0);

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
			// Cancel any existing backfill for this session
			const existing = activeBackfills.current.get(sessionId);
			if (existing) {
				existing.abortController.abort();
			}

			// P0-3: Assign unique generation to this backfill
			const generation = ++backfillGenerationRef.current;
			const abortController = new AbortController();
			const state: BackfillState = {
				sessionId,
				revision,
				afterSeq,
				abortController,
				generation,
			};
			activeBackfills.current.set(sessionId, state);

			let currentAfterSeq = afterSeq;
			let totalEvents = 0;

			try {
				while (true) {
					// P0-3: Check if this backfill is still current before each fetch
					const currentState = activeBackfills.current.get(sessionId);
					if (!currentState || currentState.generation !== generation) {
						// Stale backfill, abort silently
						return;
					}

					const response = await fetchEvents(
						sessionId,
						revision,
						currentAfterSeq,
						abortController.signal,
					);

					// P0-3: Check again after fetch completes
					const stateAfterFetch = activeBackfills.current.get(sessionId);
					if (!stateAfterFetch || stateAfterFetch.generation !== generation) {
						// Stale backfill, abort silently
						return;
					}

					// Check if revision changed (should reset and restart)
					if (response.revision !== revision) {
						// P0-3: Mismatch is termination, not completion
						// Cleanup state but don't call onComplete
						const cleanupState = activeBackfills.current.get(sessionId);
						if (cleanupState?.generation === generation) {
							activeBackfills.current.delete(sessionId);
						}
						// Notify caller about revision mismatch so they can reset and retry
						onRevisionMismatch?.(sessionId, response.revision);
						return; // Exit directly, don't trigger onComplete
					}

					if (response.events.length > 0) {
						onEvents(sessionId, response.events);
						totalEvents += response.events.length;
						currentAfterSeq = response.nextAfterSeq ?? currentAfterSeq;
					}

					if (!response.hasMore) {
						break;
					}
				}

				// P0-3: Only call onComplete if this backfill is still current
				const finalState = activeBackfills.current.get(sessionId);
				if (finalState?.generation === generation) {
					onComplete?.(sessionId, totalEvents);
				}
			} catch (error) {
				if (error instanceof Error && error.name === "AbortError") {
					// Backfill was cancelled, not an error
					return;
				}
				// P0-3: Only call onError if this backfill is still current
				const errorState = activeBackfills.current.get(sessionId);
				if (errorState?.generation === generation) {
					onError?.(
						sessionId,
						error instanceof Error ? error : new Error(String(error)),
					);
				}
			} finally {
				// P0-3: Only cleanup if this backfill is still current
				const cleanupState = activeBackfills.current.get(sessionId);
				if (cleanupState?.generation === generation) {
					activeBackfills.current.delete(sessionId);
				}
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
