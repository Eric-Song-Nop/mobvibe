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
import { TeamRelayEndpoint } from "../team-relay-endpoint.js";
import {
	TeamRelayProtocol,
	TeamRelayRemoteError,
	type VerifiedTeamRelayRequest,
} from "../team-relay-protocol.js";
import { TeamRelayStore } from "../team-relay-store.js";

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
	let store: TeamRelayStore;
	let leader: TeamRelayProtocol;
	let worker: TeamRelayProtocol;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "team-relay-endpoint-"));
		store = new TeamRelayStore(path.join(tempDir, "events.db"));
		leader = createProtocol("leader-machine", 1);
		worker = createProtocol("worker-machine", 2);
	});

	afterEach(() => {
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
