import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionBackfill } from "@/hooks/use-session-backfill";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("useSessionBackfill", () => {
	beforeEach(() => {
		mockFetch.mockReset();
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
		const firstBackfill = act(async () => {
			await result.current.startBackfill("session-1", 1, 0);
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

		await firstBackfill;

		// Only the second backfill's onComplete should be called
		// (first is cancelled due to abort or generation mismatch)
		await waitFor(() => {
			expect(onComplete).toHaveBeenCalledTimes(1);
			expect(onComplete).toHaveBeenCalledWith("session-1", 1);
		});
	});
});
