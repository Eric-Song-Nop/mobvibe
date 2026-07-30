import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { runMigrations } from "../wal/migrations.js";
import { createTeamTurnCompletedRelayPayload } from "./team-runtime-relay.js";

export type TeamRelayOperationClaim =
	| { status: "claimed"; claimId: string }
	| { status: "completed"; result: unknown }
	| { status: "failed"; error: unknown }
	| { status: "in_progress" }
	| { status: "conflict" };

export type RemoteTeamSessionBindingLifecycle =
	| "creating"
	| "active"
	| "failed"
	| "closed";

export type RemoteTeamSessionBinding = {
	serverId: string;
	agentTeamId: string;
	memberId: string;
	leaderMachineId: string;
	backendId: string;
	sessionId?: string;
	lifecycle: RemoteTeamSessionBindingLifecycle;
	createdAt: string;
	updatedAt: string;
};

export type TeamRuntimeOutboxStatus =
	| "pending"
	| "in_flight"
	| "delivered"
	| "failed";

export type TeamRuntimeOutboxEntry = {
	id: number;
	operationId: string;
	protocolVersion: 1;
	eventType: "turn_completed";
	agentTeamId: string;
	memberId: string;
	targetMachineId: string;
	sourceSessionId: string;
	sourceRevision: number;
	sourceSeq: number;
	status: TeamRuntimeOutboxStatus;
	attemptCount: number;
	nextAttemptAt?: string;
	leaseId?: string;
	leaseExpiresAt?: string;
	lastErrorCode?: string;
	lastAttemptAt?: string;
	deliveredAt?: string;
	createdAt: string;
	updatedAt: string;
};

export type ClaimedTeamRuntimeOutboxEntry = TeamRuntimeOutboxEntry & {
	status: "in_flight";
	leaseId: string;
	leaseExpiresAt: string;
};

type TeamRelayOperationRow = {
	source_machine_id: string;
	operation_id: string;
	request_digest: string;
	status: string;
	claim_id: string;
	result_local_json: string | null;
	error_local_json: string | null;
	claimed_at: string;
	completed_at: string | null;
};

type RemoteTeamSessionBindingRow = {
	server_id: string;
	agent_team_id: string;
	member_id: string;
	leader_machine_id: string;
	backend_id: string;
	session_id: string | null;
	lifecycle: string;
	created_at: string;
	updated_at: string;
};

type TeamRuntimeOutboxRow = {
	id: number;
	source_session_id: string;
	source_revision: number;
	source_seq: number;
	protocol_version: number;
	event_type: string;
	agent_team_id: string;
	member_id: string;
	target_machine_id: string;
	status: string;
	attempt_count: number;
	next_attempt_at: string | null;
	lease_id: string | null;
	lease_expires_at: string | null;
	last_error_code: string | null;
	last_attempt_at: string | null;
	delivered_at: string | null;
	created_at: string;
	updated_at: string;
};

export class TeamRelayStore {
	private readonly db: Database;

	constructor(dbPath: string) {
		const directory = path.dirname(dbPath);
		if (!fs.existsSync(directory)) {
			fs.mkdirSync(directory, { recursive: true });
		}
		this.db = new Database(dbPath);
		runMigrations(this.db);
	}

	claimOperation(params: {
		sourceMachineId: string;
		operationId: string;
		requestDigest: string;
	}): TeamRelayOperationClaim {
		const claim = this.db.transaction((): TeamRelayOperationClaim => {
			const existing = this.getOperation(
				params.sourceMachineId,
				params.operationId,
			);
			if (existing) {
				return operationRowToClaim(existing, params.requestDigest);
			}

			const claimId = randomUUID();
			const inserted = this.db
				.query(`
					INSERT OR IGNORE INTO team_relay_operations (
						source_machine_id, operation_id, request_digest, status,
						claim_id, claimed_at
					) VALUES (?, ?, ?, 'in_progress', ?, ?)
				`)
				.run(
					params.sourceMachineId,
					params.operationId,
					params.requestDigest,
					claimId,
					new Date().toISOString(),
				);
			if (inserted.changes === 1) {
				return { status: "claimed", claimId };
			}

			const raced = this.getOperation(
				params.sourceMachineId,
				params.operationId,
			);
			if (!raced) {
				throw new Error("Team relay operation claim was not persisted");
			}
			return operationRowToClaim(raced, params.requestDigest);
		});
		return claim.immediate();
	}

	completeOperation<Result>(params: {
		sourceMachineId: string;
		operationId: string;
		requestDigest: string;
		claimId: string;
		result: Result;
	}): Result {
		const resultLocalJson = serializeLocalJson(
			params.result,
			"Team relay operation result",
		);
		return this.db
			.transaction(() => {
				const updated = this.db
					.query(`
						UPDATE team_relay_operations
						SET status = 'completed',
								result_local_json = ?,
								completed_at = ?
						WHERE source_machine_id = ?
							AND operation_id = ?
							AND request_digest = ?
							AND claim_id = ?
							AND status = 'in_progress'
					`)
					.run(
						resultLocalJson,
						new Date().toISOString(),
						params.sourceMachineId,
						params.operationId,
						params.requestDigest,
						params.claimId,
					);
				if (updated.changes !== 1) {
					throw new Error("Team relay operation claim is no longer active");
				}
				return JSON.parse(resultLocalJson) as Result;
			})
			.immediate();
	}

	failOperation(params: {
		sourceMachineId: string;
		operationId: string;
		requestDigest: string;
		claimId: string;
		error: unknown;
	}): void {
		const errorLocalJson = serializeLocalJson(
			params.error,
			"Team relay operation error",
		);
		this.db
			.transaction(() => {
				const updated = this.db
					.query(`
						UPDATE team_relay_operations
						SET status = 'failed',
								error_local_json = ?,
								completed_at = ?
						WHERE source_machine_id = ?
							AND operation_id = ?
							AND request_digest = ?
							AND claim_id = ?
							AND status = 'in_progress'
					`)
					.run(
						errorLocalJson,
						new Date().toISOString(),
						params.sourceMachineId,
						params.operationId,
						params.requestDigest,
						params.claimId,
					);
				if (updated.changes !== 1) {
					throw new Error("Team relay operation claim is no longer active");
				}
			})
			.immediate();
	}

	createRemoteSessionBinding(params: {
		serverId: string;
		agentTeamId: string;
		memberId: string;
		leaderMachineId: string;
		backendId: string;
	}): RemoteTeamSessionBinding {
		const now = new Date().toISOString();
		this.db
			.query(`
				INSERT INTO remote_team_session_bindings (
					server_id, agent_team_id, member_id, leader_machine_id,
					backend_id, lifecycle, created_at, updated_at
				) VALUES (?, ?, ?, ?, ?, 'creating', ?, ?)
			`)
			.run(
				params.serverId,
				params.agentTeamId,
				params.memberId,
				params.leaderMachineId,
				params.backendId,
				now,
				now,
			);
		return this.requireRemoteSessionBinding(params.serverId);
	}

	getRemoteSessionBinding(params: {
		agentTeamId: string;
		memberId: string;
	}): RemoteTeamSessionBinding | undefined {
		const row = this.db
			.query(`
				SELECT *
				FROM remote_team_session_bindings
				WHERE agent_team_id = ? AND member_id = ?
			`)
			.get(
				params.agentTeamId,
				params.memberId,
			) as RemoteTeamSessionBindingRow | null;
		return row ? bindingRowToBinding(row) : undefined;
	}

	getRemoteSessionBindingByServerId(
		serverId: string,
	): RemoteTeamSessionBinding | undefined {
		const row = this.db
			.query(`
				SELECT *
				FROM remote_team_session_bindings
				WHERE server_id = ?
			`)
			.get(serverId) as RemoteTeamSessionBindingRow | null;
		return row ? bindingRowToBinding(row) : undefined;
	}

	getRemoteSessionBindingBySessionId(
		sessionId: string,
	): RemoteTeamSessionBinding | undefined {
		const row = this.db
			.query(`
				SELECT *
				FROM remote_team_session_bindings
				WHERE session_id = ?
			`)
			.get(sessionId) as RemoteTeamSessionBindingRow | null;
		return row ? bindingRowToBinding(row) : undefined;
	}

	listRemoteSessionBindings(): RemoteTeamSessionBinding[] {
		const rows = this.db
			.query(`
				SELECT *
				FROM remote_team_session_bindings
				ORDER BY created_at, server_id
			`)
			.all() as RemoteTeamSessionBindingRow[];
		return rows.map(bindingRowToBinding);
	}

	activateRemoteSessionBinding(params: {
		serverId: string;
		sessionId: string;
	}): RemoteTeamSessionBinding {
		return this.db
			.transaction(() => {
				const existing = this.requireRemoteSessionBinding(params.serverId);
				if (
					existing.lifecycle === "active" &&
					existing.sessionId === params.sessionId
				) {
					return existing;
				}
				if (existing.lifecycle !== "creating") {
					throw new Error(
						`Remote Team session binding cannot activate from ${existing.lifecycle}`,
					);
				}

				const updated = this.db
					.query(`
						UPDATE remote_team_session_bindings
						SET session_id = ?, lifecycle = 'active', updated_at = ?
						WHERE server_id = ? AND lifecycle = 'creating'
					`)
					.run(params.sessionId, new Date().toISOString(), params.serverId);
				if (updated.changes !== 1) {
					throw new Error("Remote Team session binding is no longer creating");
				}
				return this.requireRemoteSessionBinding(params.serverId);
			})
			.immediate();
	}

	failRemoteSessionBinding(serverId: string): RemoteTeamSessionBinding {
		return this.db
			.transaction(() => {
				const existing = this.requireRemoteSessionBinding(serverId);
				if (existing.lifecycle === "failed") {
					return existing;
				}
				if (existing.lifecycle === "closed") {
					throw new Error("Closed remote Team session binding cannot fail");
				}

				const updated = this.db
					.query(`
						UPDATE remote_team_session_bindings
						SET lifecycle = 'failed', updated_at = ?
						WHERE server_id = ? AND lifecycle IN ('creating', 'active')
					`)
					.run(new Date().toISOString(), serverId);
				if (updated.changes !== 1) {
					throw new Error("Remote Team session binding is no longer active");
				}
				return this.requireRemoteSessionBinding(serverId);
			})
			.immediate();
	}

	removeRemoteSessionBinding(serverId: string): boolean {
		return (
			this.db
				.query("DELETE FROM remote_team_session_bindings WHERE server_id = ?")
				.run(serverId).changes === 1
		);
	}

	listRuntimeOutbox(): TeamRuntimeOutboxEntry[] {
		const rows = this.db
			.query(`
				SELECT *
				FROM team_runtime_outbox
				ORDER BY source_session_id, source_revision, source_seq, id
			`)
			.all() as TeamRuntimeOutboxRow[];
		return rows.map(runtimeOutboxRowToEntry);
	}

	claimDueRuntimeOutbox(params: {
		now: string;
		leaseExpiresAt: string;
		limit?: number;
	}): ClaimedTeamRuntimeOutboxEntry[] {
		const now = parseIsoTimestamp(params.now, "Runtime outbox claim time");
		const leaseExpiresAt = parseIsoTimestamp(
			params.leaseExpiresAt,
			"Runtime outbox lease expiry",
		);
		if (leaseExpiresAt <= now) {
			throw new Error("Runtime outbox lease must expire after its claim");
		}
		const limit = parseClaimLimit(params.limit);
		return this.db
			.transaction(() => {
				const candidates = this.findDueRuntimeOutbox(now, limit);
				const claimed: ClaimedTeamRuntimeOutboxEntry[] = [];
				for (const candidate of candidates) {
					const leaseId = randomUUID();
					const updated = this.db
						.query(`
							UPDATE team_runtime_outbox
							SET status = 'in_flight',
									attempt_count = attempt_count + 1,
									next_attempt_at = NULL,
									lease_id = ?,
									lease_expires_at = ?,
									last_attempt_at = ?,
									updated_at = ?
							WHERE id = ?
								AND (
									(status = 'pending' AND next_attempt_at <= ?)
									OR (status = 'in_flight' AND lease_expires_at <= ?)
								)
						`)
						.run(leaseId, leaseExpiresAt, now, now, candidate.id, now, now);
					if (updated.changes !== 1) {
						continue;
					}
					const entry = this.requireRuntimeOutboxEntry(candidate.id);
					if (
						entry.status !== "in_flight" ||
						!entry.leaseId ||
						!entry.leaseExpiresAt
					) {
						throw new Error("Runtime outbox claim was not persisted");
					}
					claimed.push({
						...entry,
						status: "in_flight",
						leaseId: entry.leaseId,
						leaseExpiresAt: entry.leaseExpiresAt,
					});
				}
				return claimed;
			})
			.immediate();
	}

	markRuntimeOutboxDelivered(params: {
		id: number;
		leaseId: string;
		deliveredAt: string;
	}): TeamRuntimeOutboxEntry {
		const deliveredAt = parseIsoTimestamp(
			params.deliveredAt,
			"Runtime outbox delivery time",
		);
		this.updateClaimedRuntimeOutbox({
			id: params.id,
			leaseId: params.leaseId,
			sql: `
				UPDATE team_runtime_outbox
				SET status = 'delivered',
						next_attempt_at = NULL,
						lease_id = NULL,
						lease_expires_at = NULL,
						last_error_code = NULL,
						delivered_at = ?,
						updated_at = ?
				WHERE id = ? AND status = 'in_flight' AND lease_id = ?
			`,
			values: [deliveredAt, deliveredAt],
		});
		return this.requireRuntimeOutboxEntry(params.id);
	}

	rescheduleRuntimeOutbox(params: {
		id: number;
		leaseId: string;
		nextAttemptAt: string;
		errorCode: string;
	}): TeamRuntimeOutboxEntry {
		const nextAttemptAt = parseIsoTimestamp(
			params.nextAttemptAt,
			"Runtime outbox next attempt",
		);
		const errorCode = parseErrorCode(params.errorCode);
		this.updateClaimedRuntimeOutbox({
			id: params.id,
			leaseId: params.leaseId,
			sql: `
				UPDATE team_runtime_outbox
				SET status = 'pending',
						next_attempt_at = ?,
						lease_id = NULL,
						lease_expires_at = NULL,
						last_error_code = ?,
						delivered_at = NULL,
						updated_at = ?
				WHERE id = ? AND status = 'in_flight' AND lease_id = ?
			`,
			values: [nextAttemptAt, errorCode, new Date().toISOString()],
		});
		return this.requireRuntimeOutboxEntry(params.id);
	}

	failRuntimeOutbox(params: {
		id: number;
		leaseId: string;
		errorCode: string;
		failedAt: string;
	}): TeamRuntimeOutboxEntry {
		const failedAt = parseIsoTimestamp(
			params.failedAt,
			"Runtime outbox failure time",
		);
		const errorCode = parseErrorCode(params.errorCode);
		this.updateClaimedRuntimeOutbox({
			id: params.id,
			leaseId: params.leaseId,
			sql: `
				UPDATE team_runtime_outbox
				SET status = 'failed',
						next_attempt_at = NULL,
						lease_id = NULL,
						lease_expires_at = NULL,
						last_error_code = ?,
						delivered_at = NULL,
						updated_at = ?
				WHERE id = ? AND status = 'in_flight' AND lease_id = ?
			`,
			values: [errorCode, failedAt],
		});
		return this.requireRuntimeOutboxEntry(params.id);
	}

	close(): void {
		this.db.close();
	}

	private getOperation(
		sourceMachineId: string,
		operationId: string,
	): TeamRelayOperationRow | undefined {
		const row = this.db
			.query(`
				SELECT *
				FROM team_relay_operations
				WHERE source_machine_id = ? AND operation_id = ?
			`)
			.get(sourceMachineId, operationId) as TeamRelayOperationRow | null;
		return row ?? undefined;
	}

	private requireRemoteSessionBinding(
		serverId: string,
	): RemoteTeamSessionBinding {
		const binding = this.getRemoteSessionBindingByServerId(serverId);
		if (!binding) {
			throw new Error(`Remote Team session binding not found: ${serverId}`);
		}
		return binding;
	}

	private findDueRuntimeOutbox(
		now: string,
		limit: number,
	): TeamRuntimeOutboxRow[] {
		return this.db
			.query(`
				SELECT candidate.*
				FROM team_runtime_outbox AS candidate
				WHERE (
					(candidate.status = 'pending' AND candidate.next_attempt_at <= ?)
					OR (
						candidate.status = 'in_flight'
						AND candidate.lease_expires_at <= ?
					)
				)
				AND NOT EXISTS (
					SELECT 1
					FROM team_runtime_outbox AS earlier
					WHERE earlier.agent_team_id = candidate.agent_team_id
						AND earlier.member_id = candidate.member_id
						AND earlier.status IN ('pending', 'in_flight')
						AND earlier.id < candidate.id
				)
				ORDER BY candidate.created_at, candidate.id
				LIMIT ?
			`)
			.all(now, now, limit) as TeamRuntimeOutboxRow[];
	}

	private updateClaimedRuntimeOutbox(params: {
		id: number;
		leaseId: string;
		sql: string;
		values: readonly string[];
	}): void {
		const updated = this.db
			.query(params.sql)
			.run(...params.values, params.id, params.leaseId);
		if (updated.changes !== 1) {
			throw new Error("Team runtime outbox claim is no longer active");
		}
	}

	private requireRuntimeOutboxEntry(id: number): TeamRuntimeOutboxEntry {
		const row = this.db
			.query("SELECT * FROM team_runtime_outbox WHERE id = ?")
			.get(id) as TeamRuntimeOutboxRow | null;
		if (!row) {
			throw new Error(`Team runtime outbox entry not found: ${id}`);
		}
		return runtimeOutboxRowToEntry(row);
	}
}

function operationRowToClaim(
	row: TeamRelayOperationRow,
	requestDigest: string,
): TeamRelayOperationClaim {
	if (row.request_digest !== requestDigest) {
		return { status: "conflict" };
	}
	switch (row.status) {
		case "in_progress":
			return { status: "in_progress" };
		case "completed":
			if (row.result_local_json === null) {
				throw new Error("Completed Team relay operation result is missing");
			}
			return {
				status: "completed",
				result: JSON.parse(row.result_local_json) as unknown,
			};
		case "failed":
			if (row.error_local_json === null) {
				throw new Error("Failed Team relay operation error is missing");
			}
			return {
				status: "failed",
				error: JSON.parse(row.error_local_json) as unknown,
			};
		default:
			throw new Error(`Invalid Team relay operation status: ${row.status}`);
	}
}

function bindingRowToBinding(
	row: RemoteTeamSessionBindingRow,
): RemoteTeamSessionBinding {
	return {
		serverId: row.server_id,
		agentTeamId: row.agent_team_id,
		memberId: row.member_id,
		leaderMachineId: row.leader_machine_id,
		backendId: row.backend_id,
		sessionId: row.session_id ?? undefined,
		lifecycle: parseBindingLifecycle(row.lifecycle),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function parseBindingLifecycle(
	value: string,
): RemoteTeamSessionBindingLifecycle {
	switch (value) {
		case "creating":
		case "active":
		case "failed":
		case "closed":
			return value;
		default:
			throw new Error(`Invalid remote Team session lifecycle: ${value}`);
	}
}

function runtimeOutboxRowToEntry(
	row: TeamRuntimeOutboxRow,
): TeamRuntimeOutboxEntry {
	if (row.protocol_version !== 1 || row.event_type !== "turn_completed") {
		throw new Error("Unsupported Team runtime outbox protocol");
	}
	const payload = createTeamTurnCompletedRelayPayload({
		agentTeamId: row.agent_team_id,
		memberId: row.member_id,
		sessionId: row.source_session_id,
		revision: row.source_revision,
		seq: row.source_seq,
	});
	return {
		id: row.id,
		operationId: payload.operationId,
		protocolVersion: 1,
		eventType: "turn_completed",
		agentTeamId: payload.agentTeamId,
		memberId: payload.memberId,
		targetMachineId: parseStoredIdentifier(
			row.target_machine_id,
			"target machine",
		),
		sourceSessionId: row.source_session_id,
		sourceRevision: row.source_revision,
		sourceSeq: row.source_seq,
		status: parseRuntimeOutboxStatus(row.status),
		attemptCount: row.attempt_count,
		nextAttemptAt: row.next_attempt_at ?? undefined,
		leaseId: row.lease_id ?? undefined,
		leaseExpiresAt: row.lease_expires_at ?? undefined,
		lastErrorCode: row.last_error_code ?? undefined,
		lastAttemptAt: row.last_attempt_at ?? undefined,
		deliveredAt: row.delivered_at ?? undefined,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function parseRuntimeOutboxStatus(value: string): TeamRuntimeOutboxStatus {
	switch (value) {
		case "pending":
		case "in_flight":
		case "delivered":
		case "failed":
			return value;
		default:
			throw new Error(`Invalid Team runtime outbox status: ${value}`);
	}
}

function parseIsoTimestamp(value: string, label: string): string {
	const timestamp = new Date(value);
	if (
		!Number.isFinite(timestamp.getTime()) ||
		timestamp.toISOString() !== value
	) {
		throw new Error(`${label} must be a canonical ISO timestamp`);
	}
	return value;
}

function parseClaimLimit(value: number | undefined): number {
	const limit = value ?? 100;
	if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
		throw new Error("Runtime outbox claim limit must be between 1 and 100");
	}
	return limit;
}

function parseErrorCode(value: string): string {
	if (
		value.length < 1 ||
		Buffer.byteLength(value, "utf8") > 128 ||
		/[\p{Cc}\p{Cs}]/u.test(value)
	) {
		throw new Error("Invalid Team runtime outbox error code");
	}
	return value;
}

function parseStoredIdentifier(value: string, label: string): string {
	if (
		value.length < 1 ||
		Buffer.byteLength(value, "utf8") > 256 ||
		/[\p{Cc}\p{Cs}]/u.test(value)
	) {
		throw new Error(`Invalid Team runtime outbox ${label}`);
	}
	return value;
}

function serializeLocalJson(value: unknown, label: string): string {
	const serialized = JSON.stringify(value);
	if (serialized === undefined) {
		throw new Error(`${label} is not JSON-serializable`);
	}
	return serialized;
}
