import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { WalStore } from "../../wal/wal-store.js";
import type { TeamRelayCallInput } from "../team-relay-client.js";
import { TeamRelayRemoteError } from "../team-relay-protocol.js";
import { TeamRelayStore } from "../team-relay-store.js";
import { TeamRuntimeOutboxDispatcher } from "../team-runtime-outbox-dispatcher.js";

type TestTimer = {
	callback: () => void;
	delayMs: number;
	cleared: boolean;
};

describe("TeamRuntimeOutboxDispatcher", () => {
	let tempDir: string;
	let store: TeamRelayStore;
	let walStore: WalStore;
	let dispatcher: TeamRuntimeOutboxDispatcher | undefined;
	let now: number;
	let timers: TestTimer[];
	let calls: TeamRelayCallInput[];
	let relayCall: (input: TeamRelayCallInput) => Promise<unknown>;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(
			path.join(os.tmpdir(), "team-runtime-dispatcher-"),
		);
		const dbPath = path.join(tempDir, "events.db");
		walStore = new WalStore(dbPath);
		store = new TeamRelayStore(dbPath);
		now = Date.parse("2099-01-01T00:00:00.000Z");
		timers = [];
		calls = [];
		relayCall = async (input) => ({
			operationId: input.operationId,
			accepted: true,
		});
		activateRemoteSession();
	});

	afterEach(() => {
		dispatcher?.stop();
		store.close();
		walStore.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	const activateRemoteSession = () => {
		const sessionId = "remote-session-1";
		const serverId = `mobvibe-team:team-1:member-1:${sessionId}`;
		walStore.ensureSession({
			sessionId,
			machineId: "worker-machine",
			backendId: "backend-1",
		});
		store.createRemoteSessionBinding({
			serverId,
			agentTeamId: "team-1",
			memberId: "member-1",
			leaderMachineId: "leader-machine",
			backendId: "backend-1",
		});
		store.activateRemoteSessionBinding({ serverId, sessionId });
	};

	const appendTurnEnd = () =>
		walStore.appendEvent({
			sessionId: "remote-session-1",
			revision: 1,
			kind: "turn_end",
			payload: { stopReason: "end_turn" },
		});

	const createDispatcher = () => {
		dispatcher = new TeamRuntimeOutboxDispatcher({
			store,
			relay: {
				call: async (input) => {
					calls.push(input);
					return relayCall(input);
				},
			},
			now: () => now,
			setTimer: (callback, delayMs) => {
				const timer = { callback, delayMs, cleared: false };
				timers.push(timer);
				return timer;
			},
			clearTimer: (handle) => {
				(handle as TestTimer).cleared = true;
			},
		});
		return dispatcher;
	};

	const activeTimers = () => timers.filter((timer) => !timer.cleared);

	const fireTimer = (timer: TestTimer) => {
		timer.cleared = true;
		timer.callback();
	};

	test("marks an entry delivered only after a strict runtime ACK", async () => {
		const terminalEvent = appendTurnEnd();
		await createDispatcher().start();

		const [entry] = store.listRuntimeOutbox();
		expect(entry).toEqual(
			expect.objectContaining({
				status: "delivered",
				attemptCount: 1,
				deliveredAt: new Date(now).toISOString(),
			}),
		);
		expect(calls).toHaveLength(1);
		expect(calls[0]).toEqual({
			operationId: entry?.operationId,
			operation: "member.runtime",
			targetMachineId: "leader-machine",
			payload: {
				version: 1,
				type: "turn_completed",
				operationId: entry?.operationId,
				agentTeamId: "team-1",
				memberId: "member-1",
				turnId: entry?.operationId.replace("team-runtime:v1:", ""),
			},
		});
		expect(entry?.sourceSeq).toBe(terminalEvent.seq);
		expect(activeTimers()).toHaveLength(0);
	});

	test("parks a malformed ACK as a permanent protocol failure", async () => {
		appendTurnEnd();
		relayCall = async (input) => ({
			operationId: input.operationId,
			accepted: true,
			unexpected: true,
		});

		await createDispatcher().start();

		expect(store.listRuntimeOutbox()[0]).toEqual(
			expect.objectContaining({
				status: "failed",
				attemptCount: 1,
				lastErrorCode: "INVALID_RUNTIME_RELAY_ACK",
			}),
		);
		expect(calls).toHaveLength(1);
		expect(activeTimers()).toHaveLength(0);
	});

	test("retries an ambiguous transport failure with the exact operation", async () => {
		appendTurnEnd();
		appendTurnEnd();
		let attempt = 0;
		relayCall = async (input) => {
			attempt += 1;
			if (attempt === 1) {
				throw new Error("socket disconnected after send");
			}
			return { operationId: input.operationId, accepted: true };
		};

		await createDispatcher().start();

		const [deferred, blocked] = store.listRuntimeOutbox();
		expect(deferred).toEqual(
			expect.objectContaining({
				status: "pending",
				attemptCount: 1,
				nextAttemptAt: "2099-01-01T00:00:01.000Z",
				lastErrorCode: "TEAM_RELAY_TRANSPORT_FAILED",
				updatedAt: "2099-01-01T00:00:00.000Z",
			}),
		);
		expect(blocked).toEqual(
			expect.objectContaining({ status: "pending", attemptCount: 0 }),
		);
		expect(calls).toHaveLength(1);
		expect(activeTimers()).toEqual([
			expect.objectContaining({ delayMs: 1_000, cleared: false }),
		]);
		const originalCall = calls[0];

		now += 1_000;
		fireTimer(activeTimers()[0] as TestTimer);
		await dispatcher?.wake();

		const [deliveredFirst, deliveredSecond] = store.listRuntimeOutbox();
		expect(deliveredFirst).toEqual(
			expect.objectContaining({ status: "delivered", attemptCount: 2 }),
		);
		expect(deliveredSecond).toEqual(
			expect.objectContaining({ status: "delivered", attemptCount: 1 }),
		);
		expect(calls).toHaveLength(3);
		expect(calls[1]).toEqual(originalCall);
	});

	test("uses a slower same-operation retry for an unknown remote outcome", async () => {
		appendTurnEnd();
		relayCall = async () => {
			throw new TeamRelayRemoteError({
				code: "MESSAGE_OUTCOME_UNKNOWN",
				message: "Operation is still in progress",
				retryable: false,
				scope: "request",
			});
		};

		await createDispatcher().start();

		expect(store.listRuntimeOutbox()[0]).toEqual(
			expect.objectContaining({
				status: "pending",
				attemptCount: 1,
				nextAttemptAt: "2099-01-01T00:00:30.000Z",
				lastErrorCode: "MESSAGE_OUTCOME_UNKNOWN",
			}),
		);
		expect(activeTimers()).toEqual([
			expect.objectContaining({ delayMs: 30_000, cleared: false }),
		]);
	});

	test("retries retryable remote failures and parks non-retryable ones", async () => {
		appendTurnEnd();
		relayCall = async () => {
			throw new TeamRelayRemoteError({
				code: "SESSION_NOT_READY",
				message: "Remote session is not ready",
				retryable: true,
				scope: "session",
			});
		};
		const retryingDispatcher = createDispatcher();
		await retryingDispatcher.start();
		expect(store.listRuntimeOutbox()[0]).toEqual(
			expect.objectContaining({
				status: "pending",
				lastErrorCode: "SESSION_NOT_READY",
			}),
		);

		retryingDispatcher.stop();
		now += 1_000;
		relayCall = async () => {
			throw new TeamRelayRemoteError({
				code: "AUTHORIZATION_FAILED",
				message: "Remote operation was rejected",
				retryable: false,
				scope: "request",
			});
		};
		dispatcher = undefined;
		await createDispatcher().start();

		expect(store.listRuntimeOutbox()[0]).toEqual(
			expect.objectContaining({
				status: "failed",
				attemptCount: 2,
				lastErrorCode: "AUTHORIZATION_FAILED",
			}),
		);
		expect(activeTimers()).toHaveLength(0);
	});

	test("coalesces overlapping wakeups into one relay call", async () => {
		appendTurnEnd();
		let resolveRelay: ((value: unknown) => void) | undefined;
		relayCall = () =>
			new Promise((resolve) => {
				resolveRelay = resolve;
			});
		const currentDispatcher = createDispatcher();

		const started = currentDispatcher.start();
		const secondWake = currentDispatcher.wake();
		const thirdWake = currentDispatcher.wake();
		expect(calls).toHaveLength(1);

		resolveRelay?.({
			operationId: calls[0]?.operationId,
			accepted: true,
		});
		await Promise.all([started, secondWake, thirdWake]);

		expect(calls).toHaveLength(1);
		expect(store.listRuntimeOutbox()[0]?.status).toBe("delivered");
	});

	test("does not write a late relay result after stop", async () => {
		appendTurnEnd();
		let resolveRelay: ((value: unknown) => void) | undefined;
		relayCall = () =>
			new Promise((resolve) => {
				resolveRelay = resolve;
			});
		const currentDispatcher = createDispatcher();

		const started = currentDispatcher.start();
		expect(store.listRuntimeOutbox()[0]?.status).toBe("in_flight");
		currentDispatcher.stop();
		resolveRelay?.({
			operationId: calls[0]?.operationId,
			accepted: true,
		});
		await started;

		expect(store.listRuntimeOutbox()[0]).toEqual(
			expect.objectContaining({
				status: "in_flight",
				attemptCount: 1,
				deliveredAt: undefined,
			}),
		);
		expect(activeTimers()).toHaveLength(0);
	});

	test("schedules recovery for a persisted unexpired lease", async () => {
		appendTurnEnd();
		store.claimDueRuntimeOutbox({
			now: "2099-01-01T00:00:00.000Z",
			leaseExpiresAt: "2099-01-01T00:01:00.000Z",
		});
		now += 30_000;

		await createDispatcher().start();

		expect(calls).toHaveLength(0);
		expect(activeTimers()).toEqual([
			expect.objectContaining({ delayMs: 30_000, cleared: false }),
		]);
	});
});
