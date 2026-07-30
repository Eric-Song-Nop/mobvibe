import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { runMigrations } from "../wal/migrations.js";

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

function serializeLocalJson(value: unknown, label: string): string {
	const serialized = JSON.stringify(value);
	if (serialized === undefined) {
		throw new Error(`${label} is not JSON-serializable`);
	}
	return serialized;
}
