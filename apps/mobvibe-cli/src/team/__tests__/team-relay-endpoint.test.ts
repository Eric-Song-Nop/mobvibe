import { Database } from "bun:sqlite";
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	mock,
	test,
} from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	AppError,
	createErrorDetail,
	initCrypto,
	type TeamRelayExecuteRpcParams,
} from "@mobvibe/shared";
import { CliCryptoService } from "../../e2ee/crypto-service.js";
import { AgentTeamStore } from "../agent-team-store.js";
import { TeamRelayEndpoint } from "../team-relay-endpoint.js";
import {
	TeamRelayProtocol,
	TeamRelayRemoteError,
	type VerifiedTeamRelayRequest,
} from "../team-relay-protocol.js";
import { TeamRelayStore } from "../team-relay-store.js";
import { TeamRuntime } from "../team-runtime.js";
import {
	createLeaderTeamRuntimeRelayHandler,
	createTeamTurnCompletedRelayPayload,
	isRecoverableTeamTurnCompletedRelayRequest,
} from "../team-runtime-relay.js";

beforeAll(async () => {
	await initCrypto();
});

const createProtocol = (machineId: string, seed: number) =>
	new TeamRelayProtocol({
		machineId,
		cryptoService: new CliCryptoService(new Uint8Array(32).fill(seed)),
	});

describe("TeamRelayEndpoint", () => {
	let tempDir: string;
	let dbPath: string;
	let store: TeamRelayStore;
	let agentTeamStore: AgentTeamStore | undefined;
	let runtimes: TeamRuntime[];
	let leader: TeamRelayProtocol;
	let worker: TeamRelayProtocol;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "team-relay-endpoint-"));
		dbPath = path.join(tempDir, "events.db");
		store = new TeamRelayStore(dbPath);
		runtimes = [];
		leader = createProtocol("leader-machine", 1);
		worker = createProtocol("worker-machine", 2);
	});

	afterEach(() => {
		for (const runtime of runtimes) runtime.stop();
		agentTeamStore?.close();
		store.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	const createExecuteParams = (
		payload: unknown,
		operationId = "operation-1",
	): TeamRelayExecuteRpcParams => {
		const request = leader.sealRequest({
			operationId,
			operation: "member.bootstrap",
			targetMachineId: worker.machineId,
			targetRelayKey: worker.relayKey,
			payload,
		});
		return {
			operationId,
			sourceMachineId: leader.machineId,
			sourceRelayKey: leader.relayKey,
			ciphertext: request.ciphertext,
		};
	};

	const openResponse = (
		response: Awaited<ReturnType<TeamRelayEndpoint["handle"]>>,
		operationId = "operation-1",
	) =>
		leader.openResponse({
			operationId,
			operation: "member.bootstrap",
			targetMachineId: worker.machineId,
			targetRelayKey: worker.relayKey,
			ciphertext: response.ciphertext,
		});

	const createRuntimeParams = (input: {
		agentTeamId: string;
		memberId: string;
		sessionId: string;
		revision?: number;
		seq?: number;
	}): {
		params: TeamRelayExecuteRpcParams;
		operationId: string;
		turnId: string;
	} => {
		const payload = createTeamTurnCompletedRelayPayload({
			agentTeamId: input.agentTeamId,
			memberId: input.memberId,
			sessionId: input.sessionId,
			revision: input.revision ?? 1,
			seq: input.seq ?? 1,
		});
		const request = worker.sealRequest({
			operationId: payload.operationId,
			operation: "member.runtime",
			targetMachineId: leader.machineId,
			targetRelayKey: leader.relayKey,
			payload,
		});
		return {
			params: {
				operationId: payload.operationId,
				sourceMachineId: worker.machineId,
				sourceRelayKey: worker.relayKey,
				ciphertext: request.ciphertext,
			},
			operationId: payload.operationId,
			turnId: payload.turnId,
		};
	};

	const openRuntimeResponse = (
		response: Awaited<ReturnType<TeamRelayEndpoint["handle"]>>,
		operationId: string,
	) =>
		worker.openResponse({
			operationId,
			operation: "member.runtime",
			targetMachineId: leader.machineId,
			targetRelayKey: leader.relayKey,
			ciphertext: response.ciphertext,
		});

	const createLeaderTeam = () => {
		agentTeamStore = new AgentTeamStore(dbPath);
		const created = agentTeamStore.createAgentTeam({
			machineId: leader.machineId,
			workspaceRootCwd: "/workspace",
			backendId: "backend-leader",
			title: "Runtime recovery team",
			leaderName: "Leader",
		});
		const memberId = agentTeamStore.addTeamMember({
			agentTeamId: created.team.agentTeamId,
			backendId: "backend-worker",
			name: "Worker",
			role: "member",
		}).memberId;
		const sessionId = "worker-session";
		agentTeamStore.updateTeamMemberRuntimeState({
			agentTeamId: created.team.agentTeamId,
			memberId,
			sessionId,
			lifecycle: "running",
		});
		agentTeamStore.bindTeamMemberExecution({
			agentTeamId: created.team.agentTeamId,
			memberId,
			executionMachineId: worker.machineId,
			workerRelayKeyId: worker.relayKey.keyId,
			bootstrapOperationId: "bootstrap-worker",
		});
		return {
			agentTeamId: created.team.agentTeamId,
			leaderMemberId: created.team.leaderMemberId,
			memberId,
			sessionId,
		};
	};

	const countRuntimeFacts = (turnId: string) => {
		const db = new Database(dbPath, { readonly: true });
		try {
			const inbox = db
				.query(
					"SELECT COUNT(*) AS count FROM agent_team_runtime_inbox WHERE turn_id = ?",
				)
				.get(turnId) as { count: number };
			const notifications = db
				.query(`
					SELECT COUNT(*) AS count
					FROM agent_team_mailbox_messages
					WHERE json_extract(body_local_json, '$.type') = 'idle_notification'
				`)
				.get() as { count: number };
			return {
				inbox: inbox.count,
				notifications: notifications.count,
			};
		} finally {
			db.close();
		}
	};

	const readRelayOperation = (operationId: string) => {
		const db = new Database(dbPath, { readonly: true });
		try {
			return db
				.query(`
					SELECT status, claim_owner_id AS claimOwnerId
					FROM team_relay_operations
					WHERE operation_id = ?
				`)
				.get(operationId) as {
				status: string;
				claimOwnerId: string;
			};
		} finally {
			db.close();
		}
	};

	test("persists and replays a completed result without repeating the side effect", async () => {
		const bootstrap = mock(
			async (_request: VerifiedTeamRelayRequest) =>
				({ sessionId: "session-1" }) as const,
		);
		const endpoint = new TeamRelayEndpoint({
			protocol: worker,
			store,
			handlers: { "member.bootstrap": bootstrap },
		});
		const params = createExecuteParams({
			agentTeamId: "team-1",
			memberId: "member-1",
		});

		expect(openResponse(await endpoint.handle(params))).toEqual({
			sessionId: "session-1",
		});
		expect(openResponse(await endpoint.handle(params))).toEqual({
			sessionId: "session-1",
		});
		expect(bootstrap).toHaveBeenCalledTimes(1);
	});

	test("uses a canonical digest so reordered object keys replay the same operation", async () => {
		const bootstrap = mock(async () => ({ sessionId: "session-1" }));
		const endpoint = new TeamRelayEndpoint({
			protocol: worker,
			store,
			handlers: { "member.bootstrap": bootstrap },
		});

		await endpoint.handle(
			createExecuteParams({ agentTeamId: "team-1", memberId: "member-1" }),
		);
		expect(
			openResponse(
				await endpoint.handle(
					createExecuteParams({
						memberId: "member-1",
						agentTeamId: "team-1",
					}),
				),
			),
		).toEqual({ sessionId: "session-1" });
		expect(bootstrap).toHaveBeenCalledTimes(1);
	});

	test("rejects a conflicting payload without running the handler again", async () => {
		const bootstrap = mock(async () => ({ sessionId: "session-1" }));
		const endpoint = new TeamRelayEndpoint({
			protocol: worker,
			store,
			handlers: { "member.bootstrap": bootstrap },
		});

		await endpoint.handle(createExecuteParams({ memberId: "member-1" }));
		const response = await endpoint.handle(
			createExecuteParams({ memberId: "member-spoofed" }),
		);
		expect(() => openResponse(response)).toThrow(TeamRelayRemoteError);
		try {
			openResponse(response);
		} catch (error) {
			expect((error as TeamRelayRemoteError).detail.code).toBe(
				"REQUEST_VALIDATION_FAILED",
			);
		}
		expect(bootstrap).toHaveBeenCalledTimes(1);
	});

	test("never reclaims an in-progress operation after restart", async () => {
		store.claimOperation({
			sourceMachineId: leader.machineId,
			operationId: "operation-1",
			requestDigest: TeamRelayEndpoint.digestRequest(
				worker.openRequest(createExecuteParams({ memberId: "member-1" })),
				worker.relayKey.keyId,
			),
		});
		store.close();
		store = new TeamRelayStore(path.join(tempDir, "events.db"));
		const bootstrap = mock(async () => ({ sessionId: "session-2" }));
		const endpoint = new TeamRelayEndpoint({
			protocol: worker,
			store,
			handlers: { "member.bootstrap": bootstrap },
		});

		const response = await endpoint.handle(
			createExecuteParams({ memberId: "member-1" }),
		);
		try {
			openResponse(response);
			throw new Error("Expected outcome unknown");
		} catch (error) {
			expect(error).toBeInstanceOf(TeamRelayRemoteError);
			expect((error as TeamRelayRemoteError).detail.code).toBe(
				"MESSAGE_OUTCOME_UNKNOWN",
			);
		}
		expect(bootstrap).not.toHaveBeenCalled();
	});

	test("recovers an abandoned operation only through an explicit policy", async () => {
		const params = createExecuteParams({ memberId: "member-1" });
		store.claimOperation({
			sourceMachineId: leader.machineId,
			operationId: "operation-1",
			requestDigest: TeamRelayEndpoint.digestRequest(
				worker.openRequest(params),
				worker.relayKey.keyId,
			),
		});
		store.close();
		store = new TeamRelayStore(path.join(tempDir, "events.db"));
		const bootstrap = mock(async () => ({ sessionId: "session-recovered" }));
		const recoverAbandoned = mock(() => true);
		const endpoint = new TeamRelayEndpoint({
			protocol: worker,
			store,
			handlers: { "member.bootstrap": bootstrap },
			recoverAbandoned,
		});

		expect(openResponse(await endpoint.handle(params))).toEqual({
			sessionId: "session-recovered",
		});
		expect(recoverAbandoned).toHaveBeenCalledTimes(1);
		expect(bootstrap).toHaveBeenCalledTimes(1);
	});

	test("takes over an abandoned runtime claim after its leader-local fact committed", async () => {
		const team = createLeaderTeam();
		const runtimeRequest = createRuntimeParams(team);
		const verifiedRequest = leader.openRequest(runtimeRequest.params);
		store.claimOperation({
			sourceMachineId: worker.machineId,
			operationId: runtimeRequest.operationId,
			requestDigest: TeamRelayEndpoint.digestRequest(
				verifiedRequest,
				leader.relayKey.keyId,
			),
		});
		const runtimeBeforeCrash = new TeamRuntime({
			store: agentTeamStore as AgentTeamStore,
		});
		runtimes.push(runtimeBeforeCrash);
		await runtimeBeforeCrash.onMemberTurnCompleted(
			team.agentTeamId,
			team.memberId,
			runtimeRequest.turnId,
		);
		expect(countRuntimeFacts(runtimeRequest.turnId)).toEqual({
			inbox: 1,
			notifications: 1,
		});
		const abandonedClaim = readRelayOperation(runtimeRequest.operationId);
		expect(abandonedClaim.status).toBe("in_progress");

		runtimeBeforeCrash.stop();
		agentTeamStore?.close();
		agentTeamStore = undefined;
		store.close();
		store = new TeamRelayStore(dbPath);
		agentTeamStore = new AgentTeamStore(dbPath);
		const runtimeAfterRestart = new TeamRuntime({ store: agentTeamStore });
		runtimes.push(runtimeAfterRestart);
		const endpoint = new TeamRelayEndpoint({
			protocol: leader,
			store,
			handlers: {
				"member.runtime": createLeaderTeamRuntimeRelayHandler({
					store: agentTeamStore,
					runtime: runtimeAfterRestart,
				}),
			},
			recoverAbandoned: isRecoverableTeamTurnCompletedRelayRequest,
		});

		for (const response of [
			await endpoint.handle(runtimeRequest.params),
			await endpoint.handle(runtimeRequest.params),
		]) {
			expect(openRuntimeResponse(response, runtimeRequest.operationId)).toEqual(
				{
					operationId: runtimeRequest.operationId,
					accepted: true,
				},
			);
		}
		expect(
			agentTeamStore
				.listTeamMembers(team.agentTeamId)
				.find((member) => member.member_id === team.memberId)?.lifecycle,
		).toBe("completed");
		expect(countRuntimeFacts(runtimeRequest.turnId)).toEqual({
			inbox: 1,
			notifications: 1,
		});
		const completedClaim = readRelayOperation(runtimeRequest.operationId);
		expect(completedClaim.status).toBe("completed");
		expect(completedClaim.claimOwnerId).not.toBe(abandonedClaim.claimOwnerId);
	});

	test("projection listener failure cannot persist a terminal runtime relay failure", async () => {
		const team = createLeaderTeam();
		const runtimeRequest = createRuntimeParams(team);
		const projectionListener = mock(() => {
			throw new Error("projection listener unavailable");
		});
		const runtime = new TeamRuntime({
			store: agentTeamStore as AgentTeamStore,
			onAgentTeamChanged: projectionListener,
		});
		runtimes.push(runtime);
		const endpoint = new TeamRelayEndpoint({
			protocol: leader,
			store,
			handlers: {
				"member.runtime": createLeaderTeamRuntimeRelayHandler({
					store: agentTeamStore as AgentTeamStore,
					runtime,
				}),
			},
			recoverAbandoned: isRecoverableTeamTurnCompletedRelayRequest,
		});

		for (const response of [
			await endpoint.handle(runtimeRequest.params),
			await endpoint.handle(runtimeRequest.params),
		]) {
			expect(openRuntimeResponse(response, runtimeRequest.operationId)).toEqual(
				{
					operationId: runtimeRequest.operationId,
					accepted: true,
				},
			);
		}
		expect(projectionListener).toHaveBeenCalledTimes(1);
		expect(countRuntimeFacts(runtimeRequest.turnId)).toEqual({
			inbox: 1,
			notifications: 1,
		});
		expect(readRelayOperation(runtimeRequest.operationId).status).toBe(
			"completed",
		);
	});

	test("persists a sanitized handler failure and replays it exactly", async () => {
		const bootstrap = mock(async () => {
			throw new AppError(
				createErrorDetail({
					code: "ACP_CONNECT_FAILED",
					message: "Remote ACP failed",
					retryable: true,
					scope: "session",
					detail: "/private/worker/path",
				}),
			);
		});
		const endpoint = new TeamRelayEndpoint({
			protocol: worker,
			store,
			handlers: { "member.bootstrap": bootstrap },
		});
		const params = createExecuteParams({ memberId: "member-1" });

		for (const response of [
			await endpoint.handle(params),
			await endpoint.handle(params),
		]) {
			try {
				openResponse(response);
				throw new Error("Expected remote failure");
			} catch (error) {
				expect((error as TeamRelayRemoteError).detail).toEqual({
					code: "ACP_CONNECT_FAILED",
					message: "Remote ACP failed",
					retryable: true,
					scope: "session",
				});
			}
			expect(JSON.stringify(response)).not.toContain("/private/worker/path");
		}
		expect(bootstrap).toHaveBeenCalledTimes(1);
	});

	test("leaves a non-serializable completed side effect in progress", async () => {
		const circular: { self?: unknown } = {};
		circular.self = circular;
		const bootstrap = mock(async () => circular);
		const endpoint = new TeamRelayEndpoint({
			protocol: worker,
			store,
			handlers: { "member.bootstrap": bootstrap },
		});
		const params = createExecuteParams({ memberId: "member-1" });

		for (const response of [
			await endpoint.handle(params),
			await endpoint.handle(params),
		]) {
			try {
				openResponse(response);
				throw new Error("Expected outcome unknown");
			} catch (error) {
				expect((error as TeamRelayRemoteError).detail.code).toBe(
					"MESSAGE_OUTCOME_UNKNOWN",
				);
			}
		}
		expect(bootstrap).toHaveBeenCalledTimes(1);
	});

	test("keeps invalid ciphertext and routing failures outside the business response", async () => {
		const endpoint = new TeamRelayEndpoint({
			protocol: worker,
			store,
			handlers: {
				"member.bootstrap": async () => ({ sessionId: "session-1" }),
			},
		});
		const params = createExecuteParams({ memberId: "member-1" });

		await expect(
			endpoint.handle({
				...params,
				sourceMachineId: "machine-spoofed",
			}),
		).rejects.toThrow("Invalid Team relay request binding");
	});
});
