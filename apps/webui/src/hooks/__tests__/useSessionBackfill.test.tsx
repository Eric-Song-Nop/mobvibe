import type { SessionEventsResponse } from "@mobvibe/shared";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionBackfill } from "@/hooks/use-session-backfill";

const mockFetch = vi.hoisted(() => vi.fn());
const envState = vi.hoisted(() => ({
	isTauri: false,
	authToken: null as string | null,
}));

vi.mock("@/lib/auth", () => ({
	isInTauri: () => envState.isTauri,
}));

vi.mock("@/lib/auth-token", () => ({
	getAuthToken: () => envState.authToken,
}));

vi.mock("@/lib/tauri-fetch", () => ({
	platformFetch: mockFetch,
}));

describe("useSessionBackfill", () => {
	beforeEach(() => {
		mockFetch.mockReset();
		envState.isTauri = false;
		envState.authToken = null;
	});

	it("P0-3: does not call onComplete when revision mismatch occurs", async () => {
		const onEvents = vi.fn();
		const onComplete = vi.fn();
		const onError = vi.fn();
		const onRevisionMismatch = vi.fn();

		// Mock fetch to return a revision mismatch (requested revision=1, response revision=2)
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: () =>
				Promise.resolve({
					sessionId: "session-1",
					machineId: "machine-1",
					revision: 2, // Different from requested revision=1
					events: [],
					hasMore: false,
				}),
		});

		const { result } = renderHook(() =>
			useSessionBackfill({
				gatewayUrl: "http://localhost:3005",
				onEvents,
				onComplete,
				onError,
				onRevisionMismatch,
			}),
		);

		await act(async () => {
			await result.current.startBackfill("session-1", 1, 0);
		});

		// onRevisionMismatch should be called with the new revision
		expect(onRevisionMismatch).toHaveBeenCalledWith("session-1", 2);

		// P0-3: onComplete should NOT be called when revision mismatch occurs
		expect(onComplete).not.toHaveBeenCalled();

		// onError should not be called either (mismatch is not an error)
		expect(onError).not.toHaveBeenCalled();
	});

	it("calls onComplete when backfill succeeds without mismatch", async () => {
		const onEvents = vi.fn();
		const onComplete = vi.fn();
		const onError = vi.fn();
		const onRevisionMismatch = vi.fn();

		// Mock fetch to return matching revision with events
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: () =>
				Promise.resolve({
					sessionId: "session-1",
					machineId: "machine-1",
					revision: 1, // Matches requested revision
					events: [
						{
							sessionId: "session-1",
							revision: 1,
							seq: 1,
							kind: "user_message",
							payload: {},
						},
						{
							sessionId: "session-1",
							revision: 1,
							seq: 2,
							kind: "agent_message_chunk",
							payload: {},
						},
					],
					nextAfterSeq: 2,
					hasMore: false,
				}),
		});

		const { result } = renderHook(() =>
			useSessionBackfill({
				gatewayUrl: "http://localhost:3005",
				onEvents,
				onComplete,
				onError,
				onRevisionMismatch,
			}),
		);

		await act(async () => {
			await result.current.startBackfill("session-1", 1, 0);
		});

		// onEvents should be called with the events
		expect(onEvents).toHaveBeenCalledWith("session-1", expect.any(Array));

		// onComplete should be called with total events count
		expect(onComplete).toHaveBeenCalledWith("session-1", 2);

		// No mismatch or error
		expect(onRevisionMismatch).not.toHaveBeenCalled();
		expect(onError).not.toHaveBeenCalled();
	});

	it("calls onError when fetch fails", async () => {
		const onEvents = vi.fn();
		const onComplete = vi.fn();
		const onError = vi.fn();
		const onRevisionMismatch = vi.fn();

		// Mock fetch to fail
		mockFetch.mockResolvedValueOnce({
			ok: false,
			status: 500,
			text: () => Promise.resolve("Internal Server Error"),
		});

		const { result } = renderHook(() =>
			useSessionBackfill({
				gatewayUrl: "http://localhost:3005",
				onEvents,
				onComplete,
				onError,
				onRevisionMismatch,
			}),
		);

		await act(async () => {
			await result.current.startBackfill("session-1", 1, 0);
		});

		// onError should be called
		expect(onError).toHaveBeenCalledWith("session-1", expect.any(Error));

		// onComplete should not be called
		expect(onComplete).not.toHaveBeenCalled();
	});

	it("times out a stalled backfill request and surfaces the error", async () => {
		vi.useFakeTimers();
		const onEvents = vi.fn();
		const onComplete = vi.fn();
		const onError = vi.fn();

		mockFetch.mockImplementationOnce(
			(_input: RequestInfo | URL, init?: RequestInit) =>
				new Promise((_resolve, reject) => {
					const signal = init?.signal as AbortSignal | undefined;
					signal?.addEventListener("abort", () => {
						const abortError = new Error("Aborted");
						abortError.name = "AbortError";
						reject(abortError);
					});
				}),
		);

		const { result } = renderHook(() =>
			useSessionBackfill({
				gatewayUrl: "http://localhost:3005",
				onEvents,
				onComplete,
				onError,
			}),
		);

		try {
			await act(async () => {
				const pending = result.current.startBackfill("session-1", 1, 0);
				await vi.advanceTimersByTimeAsync(15_000);
				await pending;
			});

			expect(onEvents).not.toHaveBeenCalled();
			expect(onComplete).not.toHaveBeenCalled();
			expect(onError).toHaveBeenCalledWith(
				"session-1",
				expect.objectContaining({
					message: "Backfill request timed out after 15000ms",
				}),
			);
		} finally {
			vi.useRealTimers();
		}
	});

	it("fetches multiple pages until hasMore is false", async () => {
		const onEvents = vi.fn();
		const onComplete = vi.fn();

		mockFetch
			.mockResolvedValueOnce({
				ok: true,
				json: () =>
					Promise.resolve({
						sessionId: "session-1",
						machineId: "machine-1",
						revision: 1,
						events: [
							{
								sessionId: "session-1",
								revision: 1,
								seq: 1,
								kind: "user_message",
								payload: {},
							},
						],
						nextAfterSeq: 1,
						hasMore: true,
					}),
			})
			.mockResolvedValueOnce({
				ok: true,
				json: () =>
					Promise.resolve({
						sessionId: "session-1",
						machineId: "machine-1",
						revision: 1,
						events: [
							{
								sessionId: "session-1",
								revision: 1,
								seq: 2,
								kind: "agent_message_chunk",
								payload: {},
							},
						],
						nextAfterSeq: 2,
						hasMore: false,
					}),
			});

		const { result } = renderHook(() =>
			useSessionBackfill({
				gatewayUrl: "http://localhost:3005",
				onEvents,
				onComplete,
			}),
		);

		await act(async () => {
			await result.current.startBackfill("session-1", 1, 0);
		});

		expect(onEvents).toHaveBeenNthCalledWith(
			1,
			"session-1",
			expect.arrayContaining([expect.objectContaining({ seq: 1 })]),
		);
		expect(onEvents).toHaveBeenNthCalledWith(
			2,
			"session-1",
			expect.arrayContaining([expect.objectContaining({ seq: 2 })]),
		);
		expect(onComplete).toHaveBeenCalledWith("session-1", 2);
		expect(mockFetch).toHaveBeenCalledTimes(2);
	});

	it("P0-3: starting new backfill cancels previous one (generation check)", async () => {
		const onEvents = vi.fn();
		const onComplete = vi.fn();
		const onError = vi.fn();

		// First fetch will be slow
		let resolveFirst: (value: unknown) => void;
		const firstPromise = new Promise((resolve) => {
			resolveFirst = resolve;
		});
		mockFetch.mockImplementationOnce(() => firstPromise);

		// Second fetch returns immediately
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: () =>
				Promise.resolve({
					sessionId: "session-1",
					machineId: "machine-1",
					revision: 2,
					events: [
						{
							sessionId: "session-1",
							revision: 2,
							seq: 1,
							kind: "user_message",
							payload: {},
						},
					],
					hasMore: false,
				}),
		});

		const { result } = renderHook(() =>
			useSessionBackfill({
				gatewayUrl: "http://localhost:3005",
				onEvents,
				onComplete,
				onError,
			}),
		);

		// Start first backfill (revision 1)
		let firstBackfill: Promise<void>;
		await act(async () => {
			firstBackfill = result.current.startBackfill("session-1", 1, 0);
			await Promise.resolve();
		});

		// Immediately start second backfill (revision 2) - should cancel first
		await act(async () => {
			await result.current.startBackfill("session-1", 2, 0);
		});

		// Now resolve the first fetch (but it should be ignored due to generation mismatch)
		resolveFirst!({
			ok: true,
			json: () =>
				Promise.resolve({
					sessionId: "session-1",
					machineId: "machine-1",
					revision: 1,
					events: [
						{
							sessionId: "session-1",
							revision: 1,
							seq: 1,
							kind: "user_message",
							payload: {},
						},
					],
					hasMore: false,
				}),
		});

		await firstBackfill!;

		// Only the second backfill's onComplete should be called
		// (first is cancelled due to abort or generation mismatch)
		await waitFor(() => {
			expect(onComplete).toHaveBeenCalledTimes(1);
			expect(onComplete).toHaveBeenCalledWith("session-1", 1);
		});
	});

	it("does not call onError or onComplete when a backfill is aborted", async () => {
		const onEvents = vi.fn();
		const onComplete = vi.fn();
		const onError = vi.fn();

		let abortSignal: AbortSignal | undefined;
		mockFetch.mockImplementationOnce(
			(_input: RequestInfo | URL, init?: RequestInit) => {
				abortSignal = init?.signal as AbortSignal | undefined;
				return new Promise((_resolve, reject) => {
					abortSignal?.addEventListener("abort", () => {
						const abortError = new Error("Aborted");
						abortError.name = "AbortError";
						reject(abortError);
					});
				});
			},
		);

		const { result } = renderHook(() =>
			useSessionBackfill({
				gatewayUrl: "http://localhost:3005",
				onEvents,
				onComplete,
				onError,
			}),
		);

		void result.current.startBackfill("session-1", 1, 0);

		await act(async () => {
			result.current.cancelBackfill("session-1");
			await Promise.resolve();
		});

		expect(abortSignal?.aborted).toBe(true);
		expect(onEvents).not.toHaveBeenCalled();
		expect(onError).not.toHaveBeenCalled();
		expect(onComplete).not.toHaveBeenCalled();
	});

	it("updates isBackfilling when an empty backfill starts and completes", async () => {
		const onEvents = vi.fn();
		let resolveFetch:
			| ((value: {
					ok: boolean;
					json: () => Promise<SessionEventsResponse>;
			  }) => void)
			| undefined;

		mockFetch.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveFetch = resolve;
				}),
		);

		const { result } = renderHook(() =>
			useSessionBackfill({
				gatewayUrl: "http://localhost:3005",
				onEvents,
			}),
		);

		act(() => {
			void result.current.startBackfill("session-1", 1, 2);
		});

		await waitFor(() =>
			expect(result.current.isBackfilling("session-1")).toBe(true),
		);

		await act(async () => {
			resolveFetch?.({
				ok: true,
				json: () =>
					Promise.resolve({
						sessionId: "session-1",
						machineId: "machine-1",
						revision: 1,
						events: [],
						hasMore: false,
					}),
			});
		});

		await waitFor(() =>
			expect(result.current.isBackfilling("session-1")).toBe(false),
		);
		expect(onEvents).not.toHaveBeenCalled();
	});

	it("uses the stored Tauri auth token for backfill requests", async () => {
		envState.isTauri = true;
		envState.authToken = "tauri-test-token";

		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: () =>
				Promise.resolve({
					sessionId: "session-1",
					machineId: "machine-1",
					revision: 1,
					events: [],
					hasMore: false,
				}),
		});

		const { result } = renderHook(() =>
			useSessionBackfill({
				gatewayUrl: "http://localhost:3005",
				onEvents: vi.fn(),
			}),
		);

		await act(async () => {
			await result.current.startBackfill("session-1", 1, 0);
		});

		expect(mockFetch).toHaveBeenCalledWith(
			"http://localhost:3005/acp/session/events?sessionId=session-1&revision=1&afterSeq=0&limit=100",
			expect.objectContaining({
				credentials: "omit",
				headers: expect.objectContaining({
					Authorization: "Bearer tauri-test-token",
				}),
			}),
		);
	});
});
