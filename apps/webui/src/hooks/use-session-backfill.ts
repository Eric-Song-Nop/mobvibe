import type { SessionEvent, SessionEventsResponse } from "@mobvibe/shared";
import { useCallback, useReducer, useRef } from "react";
import { isInTauri } from "@/lib/auth";
import { getAuthToken } from "@/lib/auth-token";
import { platformFetch } from "@/lib/tauri-fetch";

const BACKFILL_REQUEST_TIMEOUT_MS = 15_000;

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
	const [, bumpActiveVersion] = useReducer((count: number) => count + 1, 0);

	const trackActiveBackfill = useCallback(
		(sessionId: string, state: BackfillState) => {
			activeBackfills.current.set(sessionId, state);
			bumpActiveVersion();
		},
		[],
	);

	const untrackActiveBackfill = useCallback(
		(sessionId: string, state?: BackfillState) => {
			const current = activeBackfills.current.get(sessionId);
			if (!current) {
				return;
			}
			if (state && current !== state) {
				return;
			}
			activeBackfills.current.delete(sessionId);
			bumpActiveVersion();
		},
		[],
	);

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
			const tauriEnv = isInTauri();
			const token = authToken ?? (tauriEnv ? getAuthToken() : null);
			if (token) {
				headers.Authorization = `Bearer ${token}`;
			}

			const requestController = new AbortController();
			let didTimeout = false;
			const abortRequest = () => requestController.abort();
			signal.addEventListener("abort", abortRequest, { once: true });
			const timeoutId = setTimeout(() => {
				didTimeout = true;
				requestController.abort();
			}, BACKFILL_REQUEST_TIMEOUT_MS);

			let response: Response;
			try {
				response = await platformFetch(url.toString(), {
					method: "GET",
					headers,
					signal: requestController.signal,
					credentials: tauriEnv ? "omit" : "include",
				});
			} catch (error) {
				if (
					didTimeout &&
					error instanceof Error &&
					error.name === "AbortError"
				) {
					throw new Error(
						`Backfill request timed out after ${BACKFILL_REQUEST_TIMEOUT_MS}ms`,
					);
				}
				throw error;
			} finally {
				clearTimeout(timeoutId);
				signal.removeEventListener("abort", abortRequest);
			}

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
				untrackActiveBackfill(sessionId, existing);
			}

			const abortController = new AbortController();
			const state: BackfillState = {
				sessionId,
				revision,
				afterSeq,
				abortController,
			};
			trackActiveBackfill(sessionId, state);

			let currentAfterSeq = afterSeq;
			let totalEvents = 0;

			try {
				while (true) {
					// Check if aborted before each fetch
					if (abortController.signal.aborted) {
						return;
					}

					const response = await fetchEvents(
						sessionId,
						revision,
						currentAfterSeq,
						abortController.signal,
					);

					// Check if aborted after fetch
					if (abortController.signal.aborted) {
						return;
					}

					// Check if revision changed (session was reloaded)
					if (response.revision !== revision) {
						untrackActiveBackfill(sessionId, state);
						onRevisionMismatch?.(sessionId, response.revision);
						return;
					}

					if (response.events.length > 0) {
						onEvents(sessionId, response.events);
						totalEvents += response.events.length;
						currentAfterSeq = response.nextAfterSeq ?? currentAfterSeq;
					}

					// Guard against infinite loops
					if (!response.hasMore || response.events.length === 0) {
						break;
					}
				}

				onComplete?.(sessionId, totalEvents);
			} catch (error) {
				if (error instanceof Error && error.name === "AbortError") {
					// Backfill was cancelled, not an error
					return;
				}
				console.error("[backfill] error", { sessionId, error });
				onError?.(
					sessionId,
					error instanceof Error ? error : new Error(String(error)),
				);
			} finally {
				untrackActiveBackfill(sessionId, state);
			}
		},
		[
			fetchEvents,
			onEvents,
			onComplete,
			onError,
			onRevisionMismatch,
			trackActiveBackfill,
			untrackActiveBackfill,
		],
	);

	/**
	 * Cancel backfill for a session.
	 */
	const cancelBackfill = useCallback(
		(sessionId: string): void => {
			const state = activeBackfills.current.get(sessionId);
			if (state) {
				state.abortController.abort();
				untrackActiveBackfill(sessionId, state);
			}
		},
		[untrackActiveBackfill],
	);

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
		bumpActiveVersion();
	}, []);

	return {
		startBackfill,
		cancelBackfill,
		isBackfilling,
		cancelAll,
	};
}
