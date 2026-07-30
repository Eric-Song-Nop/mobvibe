import type { TeamRelayCallInput } from "./team-relay-client.js";
import { TeamRelayRemoteError } from "./team-relay-protocol.js";
import type {
	ClaimedTeamRuntimeOutboxEntry,
	TeamRelayStore,
} from "./team-relay-store.js";
import {
	createTeamTurnCompletedRelayPayload,
	parseTeamRuntimeRelayAck,
} from "./team-runtime-relay.js";

const DEFAULT_CLAIM_LIMIT = 1;
const DEFAULT_LEASE_DURATION_MS = 120_000;
const DEFAULT_RETRY_BASE_DELAY_MS = 1_000;
const DEFAULT_UNKNOWN_OUTCOME_RETRY_BASE_DELAY_MS = 30_000;
const DEFAULT_RETRY_MAX_DELAY_MS = 300_000;
const STORE_RETRY_DELAY_MS = 1_000;

type RuntimeOutboxStore = Pick<
	TeamRelayStore,
	| "claimDueRuntimeOutbox"
	| "failRuntimeOutbox"
	| "getNextRuntimeOutboxDueAt"
	| "markRuntimeOutboxDelivered"
	| "rescheduleRuntimeOutbox"
>;

type RuntimeRelayClient = {
	call(input: TeamRelayCallInput): Promise<unknown>;
};

export type TeamRuntimeOutboxFailureDisposition = "failed" | "retry";

export type TeamRuntimeOutboxFailure = {
	entry: ClaimedTeamRuntimeOutboxEntry;
	error: unknown;
	errorCode: string;
	disposition: TeamRuntimeOutboxFailureDisposition;
};

export type TeamRuntimeOutboxDispatcherOptions = {
	store: RuntimeOutboxStore;
	relay: RuntimeRelayClient;
	now?: () => number;
	setTimer?: (callback: () => void, delayMs: number) => unknown;
	clearTimer?: (handle: unknown) => void;
	onFailure?: (failure: TeamRuntimeOutboxFailure) => void;
	onInternalError?: (error: unknown) => void;
	claimLimit?: number;
	leaseDurationMs?: number;
	retryBaseDelayMs?: number;
	unknownOutcomeRetryBaseDelayMs?: number;
	retryMaxDelayMs?: number;
};

export class TeamRuntimeOutboxDispatcher {
	private readonly store: RuntimeOutboxStore;
	private readonly relay: RuntimeRelayClient;
	private readonly now: () => number;
	private readonly setTimer: (callback: () => void, delayMs: number) => unknown;
	private readonly clearTimer: (handle: unknown) => void;
	private readonly onFailure?: (failure: TeamRuntimeOutboxFailure) => void;
	private readonly onInternalError?: (error: unknown) => void;
	private readonly claimLimit: number;
	private readonly leaseDurationMs: number;
	private readonly retryBaseDelayMs: number;
	private readonly unknownOutcomeRetryBaseDelayMs: number;
	private readonly retryMaxDelayMs: number;
	private started = false;
	private stopped = false;
	private drainRequested = false;
	private drainPromise?: Promise<void>;
	private timerHandle?: unknown;

	constructor(options: TeamRuntimeOutboxDispatcherOptions) {
		this.store = options.store;
		this.relay = options.relay;
		this.now = options.now ?? Date.now;
		this.setTimer =
			options.setTimer ??
			((callback, delayMs) => setTimeout(callback, delayMs));
		this.clearTimer =
			options.clearTimer ?? ((handle) => clearTimeout(handle as Timer));
		this.onFailure = options.onFailure;
		this.onInternalError = options.onInternalError;
		this.claimLimit = parsePositiveInteger(
			options.claimLimit ?? DEFAULT_CLAIM_LIMIT,
			"Runtime outbox claim limit",
		);
		this.leaseDurationMs = parsePositiveInteger(
			options.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS,
			"Runtime outbox lease duration",
		);
		this.retryBaseDelayMs = parsePositiveInteger(
			options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS,
			"Runtime outbox retry delay",
		);
		this.unknownOutcomeRetryBaseDelayMs = parsePositiveInteger(
			options.unknownOutcomeRetryBaseDelayMs ??
				DEFAULT_UNKNOWN_OUTCOME_RETRY_BASE_DELAY_MS,
			"Runtime outbox unknown-outcome retry delay",
		);
		this.retryMaxDelayMs = parsePositiveInteger(
			options.retryMaxDelayMs ?? DEFAULT_RETRY_MAX_DELAY_MS,
			"Runtime outbox maximum retry delay",
		);
	}

	start(): Promise<void> {
		if (this.stopped) {
			return Promise.resolve();
		}
		this.started = true;
		return this.wake();
	}

	wake(): Promise<void> {
		if (!this.isActive()) {
			return Promise.resolve();
		}
		this.drainRequested = true;
		this.clearScheduledTimer();
		if (this.drainPromise) {
			return this.drainPromise;
		}

		let trackedDrain: Promise<void>;
		trackedDrain = this.drain().finally(() => {
			if (this.drainPromise === trackedDrain) {
				this.drainPromise = undefined;
			}
			if (this.isActive() && this.drainRequested) {
				void this.wake();
			}
		});
		this.drainPromise = trackedDrain;
		return trackedDrain;
	}

	stop(): void {
		if (this.stopped) {
			return;
		}
		this.stopped = true;
		this.drainRequested = false;
		this.clearScheduledTimer();
	}

	private async drain(): Promise<void> {
		while (this.isActive()) {
			this.drainRequested = false;
			let entries: ClaimedTeamRuntimeOutboxEntry[];
			try {
				const now = this.currentTime();
				entries = this.store.claimDueRuntimeOutbox({
					now: now.iso,
					leaseExpiresAt: new Date(
						now.milliseconds + this.leaseDurationMs,
					).toISOString(),
					limit: this.claimLimit,
				});
			} catch (error) {
				this.reportInternalError(error);
				this.scheduleAfter(STORE_RETRY_DELAY_MS);
				return;
			}

			if (entries.length === 0) {
				if (this.drainRequested) {
					continue;
				}
				this.scheduleNextDue();
				return;
			}

			for (const entry of entries) {
				if (!this.isActive()) {
					return;
				}
				try {
					await this.dispatch(entry);
				} catch (error) {
					this.reportInternalError(error);
					this.scheduleAfter(STORE_RETRY_DELAY_MS);
					return;
				}
			}
		}
	}

	private async dispatch(entry: ClaimedTeamRuntimeOutboxEntry): Promise<void> {
		let payload: ReturnType<typeof createTeamTurnCompletedRelayPayload>;
		try {
			payload = createTeamTurnCompletedRelayPayload({
				agentTeamId: entry.agentTeamId,
				memberId: entry.memberId,
				sessionId: entry.sourceSessionId,
				revision: entry.sourceRevision,
				seq: entry.sourceSeq,
			});
			if (payload.operationId !== entry.operationId) {
				throw new Error("Runtime outbox operation identity changed");
			}
		} catch (error) {
			if (this.isActive()) {
				this.fail(entry, "INVALID_RUNTIME_RELAY_PAYLOAD", error);
			}
			return;
		}

		let rawAck: unknown;
		try {
			rawAck = await this.relay.call({
				operationId: entry.operationId,
				operation: "member.runtime",
				targetMachineId: entry.targetMachineId,
				payload,
			});
		} catch (error) {
			if (this.isActive()) {
				this.handleCallFailure(entry, error);
			}
			return;
		}
		if (!this.isActive()) {
			return;
		}

		try {
			parseTeamRuntimeRelayAck(rawAck, entry.operationId);
		} catch (error) {
			this.fail(entry, "INVALID_RUNTIME_RELAY_ACK", error);
			return;
		}
		if (!this.isActive()) {
			return;
		}
		const deliveredAt = this.currentTime().iso;
		this.store.markRuntimeOutboxDelivered({
			id: entry.id,
			leaseId: entry.leaseId,
			deliveredAt,
		});
	}

	private handleCallFailure(
		entry: ClaimedTeamRuntimeOutboxEntry,
		error: unknown,
	): void {
		if (!(error instanceof TeamRelayRemoteError)) {
			this.reschedule(
				entry,
				"TEAM_RELAY_TRANSPORT_FAILED",
				error,
				this.retryBaseDelayMs,
			);
			return;
		}
		if (error.detail.code === "MESSAGE_OUTCOME_UNKNOWN") {
			this.reschedule(
				entry,
				error.detail.code,
				error,
				this.unknownOutcomeRetryBaseDelayMs,
			);
			return;
		}
		if (error.detail.retryable) {
			this.reschedule(entry, error.detail.code, error, this.retryBaseDelayMs);
			return;
		}
		this.fail(entry, error.detail.code, error);
	}

	private reschedule(
		entry: ClaimedTeamRuntimeOutboxEntry,
		errorCode: string,
		error: unknown,
		baseDelayMs: number,
	): void {
		const now = this.currentTime();
		const retryDelayMs = calculateBackoff(
			baseDelayMs,
			this.retryMaxDelayMs,
			entry.attemptCount,
		);
		this.store.rescheduleRuntimeOutbox({
			id: entry.id,
			leaseId: entry.leaseId,
			nextAttemptAt: new Date(now.milliseconds + retryDelayMs).toISOString(),
			errorCode,
			rescheduledAt: now.iso,
		});
		this.reportFailure({
			entry,
			error,
			errorCode,
			disposition: "retry",
		});
	}

	private fail(
		entry: ClaimedTeamRuntimeOutboxEntry,
		errorCode: string,
		error: unknown,
	): void {
		this.store.failRuntimeOutbox({
			id: entry.id,
			leaseId: entry.leaseId,
			errorCode,
			failedAt: this.currentTime().iso,
		});
		this.reportFailure({
			entry,
			error,
			errorCode,
			disposition: "failed",
		});
	}

	private scheduleNextDue(): void {
		if (!this.isActive()) {
			return;
		}
		try {
			const dueAt = this.store.getNextRuntimeOutboxDueAt();
			if (dueAt === undefined) {
				return;
			}
			this.scheduleAt(Date.parse(dueAt));
		} catch (error) {
			this.reportInternalError(error);
			this.scheduleAfter(STORE_RETRY_DELAY_MS);
		}
	}

	private scheduleAfter(delayMs: number): void {
		this.scheduleAt(this.currentTime().milliseconds + delayMs);
	}

	private scheduleAt(timestamp: number): void {
		if (!this.isActive()) {
			return;
		}
		this.clearScheduledTimer();
		const delayMs = Math.max(0, timestamp - this.currentTime().milliseconds);
		let handle: unknown;
		handle = this.setTimer(() => {
			if (this.timerHandle !== handle) {
				return;
			}
			this.timerHandle = undefined;
			void this.wake();
		}, delayMs);
		this.timerHandle = handle;
		unrefTimer(handle);
	}

	private clearScheduledTimer(): void {
		if (this.timerHandle === undefined) {
			return;
		}
		this.clearTimer(this.timerHandle);
		this.timerHandle = undefined;
	}

	private currentTime(): { milliseconds: number; iso: string } {
		const milliseconds = this.now();
		if (!Number.isFinite(milliseconds)) {
			throw new Error("Runtime outbox clock returned an invalid time");
		}
		return {
			milliseconds,
			iso: new Date(milliseconds).toISOString(),
		};
	}

	private isActive(): boolean {
		return this.started && !this.stopped;
	}

	private reportFailure(failure: TeamRuntimeOutboxFailure): void {
		try {
			this.onFailure?.(failure);
		} catch (error) {
			this.reportInternalError(error);
		}
	}

	private reportInternalError(error: unknown): void {
		try {
			this.onInternalError?.(error);
		} catch {
			// Logging must never affect durable dispatch.
		}
	}
}

const calculateBackoff = (
	baseDelayMs: number,
	maxDelayMs: number,
	attemptCount: number,
): number => {
	const exponent = Math.max(0, attemptCount - 1);
	return Math.min(baseDelayMs * 2 ** exponent, maxDelayMs);
};

const parsePositiveInteger = (value: number, label: string): number => {
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new Error(`${label} must be a positive integer`);
	}
	return value;
};

const unrefTimer = (handle: unknown): void => {
	if (
		typeof handle === "object" &&
		handle !== null &&
		"unref" in handle &&
		typeof handle.unref === "function"
	) {
		handle.unref();
	}
};
