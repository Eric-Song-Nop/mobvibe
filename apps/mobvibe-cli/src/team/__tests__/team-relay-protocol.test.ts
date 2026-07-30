import { beforeAll, describe, expect, test } from "bun:test";
import {
	AppError,
	createErrorDetail,
	initCrypto,
	type TeamRelayExecuteRpcParams,
} from "@mobvibe/shared";
import { CliCryptoService } from "../../e2ee/crypto-service.js";
import {
	TeamRelayProtocol,
	TeamRelayRemoteError,
} from "../team-relay-protocol.js";

beforeAll(async () => {
	await initCrypto();
});

const createProtocol = (machineId: string, seed: number) =>
	new TeamRelayProtocol({
		machineId,
		cryptoService: new CliCryptoService(new Uint8Array(32).fill(seed)),
	});

const createRequest = (source: TeamRelayProtocol, target: TeamRelayProtocol) =>
	source.sealRequest({
		operationId: "operation-1",
		operation: "member.bootstrap",
		targetMachineId: target.machineId,
		targetRelayKey: target.relayKey,
		payload: {
			agentTeamId: "team-secret",
			memberId: "member-secret",
		},
	});

const toExecuteParams = (
	source: TeamRelayProtocol,
	request: ReturnType<TeamRelayProtocol["sealRequest"]>,
): TeamRelayExecuteRpcParams => ({
	operationId: request.operationId,
	sourceMachineId: source.machineId,
	sourceRelayKey: source.relayKey,
	ciphertext: request.ciphertext,
});

describe("TeamRelayProtocol", () => {
	test("binds the Gateway canonical machine identity exactly once", () => {
		const cryptoService = new CliCryptoService(new Uint8Array(32).fill(1));
		const protocol = new TeamRelayProtocol({ cryptoService });
		const target = createProtocol("user-1:worker-machine", 2);

		expect(() => protocol.machineId).toThrow(
			"Team relay machine identity is not bound",
		);
		expect(() =>
			protocol.sealRequest({
				operationId: "operation-unregistered",
				operation: "member.bootstrap",
				targetMachineId: target.machineId,
				targetRelayKey: target.relayKey,
				payload: {},
			}),
		).toThrow("Team relay machine identity is not bound");

		protocol.bindMachineIdentity("user-1:leader-machine");
		protocol.bindMachineIdentity("user-1:leader-machine");
		expect(protocol.machineId).toBe("user-1:leader-machine");
		expect(() => protocol.bindMachineIdentity("user-2:leader-machine")).toThrow(
			"Team relay machine identity is already bound",
		);
	});

	test("round-trips encrypted requests and responses with reversed identity bindings", () => {
		const leader = createProtocol("leader-machine", 1);
		const worker = createProtocol("worker-machine", 2);
		const request = createRequest(leader, worker);

		expect(JSON.stringify(request)).not.toContain("team-secret");
		expect(JSON.stringify(request)).not.toContain("member-secret");

		const verified = worker.openRequest(toExecuteParams(leader, request));
		expect(verified).toEqual({
			operationId: "operation-1",
			operation: "member.bootstrap",
			sourceMachineId: "leader-machine",
			sourceRelayKey: leader.relayKey,
			targetMachineId: "worker-machine",
			payload: {
				agentTeamId: "team-secret",
				memberId: "member-secret",
			},
		});

		const response = worker.sealSuccess(verified, {
			sessionId: "session-secret",
		});
		expect(response.operationId).toBe("operation-1");
		expect(JSON.stringify(response)).not.toContain("session-secret");
		expect(
			leader.openResponse({
				operationId: "operation-1",
				operation: "member.bootstrap",
				targetMachineId: "worker-machine",
				targetRelayKey: worker.relayKey,
				ciphertext: response.ciphertext,
			}),
		).toEqual({ sessionId: "session-secret" });
	});

	test.each([
		[
			"outer operation",
			(params: TeamRelayExecuteRpcParams) => ({
				...params,
				operationId: "operation-spoofed",
			}),
		],
		[
			"Gateway-stamped source machine",
			(params: TeamRelayExecuteRpcParams) => ({
				...params,
				sourceMachineId: "machine-spoofed",
			}),
		],
		[
			"Gateway-stamped source key",
			(params: TeamRelayExecuteRpcParams) => ({
				...params,
				sourceRelayKey: createProtocol("attacker", 9).relayKey,
			}),
		],
	])("rejects a request with a mismatched %s", (_label, mutate) => {
		const leader = createProtocol("leader-machine", 1);
		const worker = createProtocol("worker-machine", 2);
		const params = toExecuteParams(leader, createRequest(leader, worker));

		expect(() => worker.openRequest(mutate(params))).toThrow(
			"Invalid Team relay request binding",
		);
	});

	test("rejects unknown operations, extra plaintext, and wrong target bindings", () => {
		const leader = createProtocol("leader-machine", 1);
		const worker = createProtocol("worker-machine", 2);
		const baseEnvelope = {
			version: 1,
			operationId: "operation-1",
			operation: "member.bootstrap",
			sourceMachineId: "leader-machine",
			sourceRelayKeyId: leader.relayKey.keyId,
			targetMachineId: "worker-machine",
			targetRelayKeyId: worker.relayKey.keyId,
			payload: { private: "inside-ciphertext" },
		};

		for (const envelope of [
			{ ...baseEnvelope, operation: "arbitrary.execute" },
			{ ...baseEnvelope, plaintext: "must-not-be-accepted" },
			{ ...baseEnvelope, targetMachineId: "other-worker" },
			{ ...baseEnvelope, targetRelayKeyId: leader.relayKey.keyId },
		]) {
			expect(() =>
				worker.openRequest({
					operationId: "operation-1",
					sourceMachineId: "leader-machine",
					sourceRelayKey: leader.relayKey,
					ciphertext: leader.cryptoService.encryptTeamRelay(
						envelope,
						worker.relayKey,
					),
				}),
			).toThrow();
		}
	});

	test.each([
		["operation id", () => ({ operationId: "operation-spoofed" })],
		["operation kind", () => ({ operation: "team.command" as const })],
		["target machine", () => ({ targetMachineId: "other-worker" })],
		[
			"target relay key",
			() => ({ targetRelayKey: createProtocol("attacker", 9).relayKey }),
		],
	])("rejects a response with a mismatched %s", (_label, createOverride) => {
		const leader = createProtocol("leader-machine", 1);
		const worker = createProtocol("worker-machine", 2);
		const verified = worker.openRequest(
			toExecuteParams(leader, createRequest(leader, worker)),
		);
		const response = worker.sealSuccess(verified, { ok: true });

		expect(() =>
			leader.openResponse({
				operationId: "operation-1",
				operation: "member.bootstrap",
				targetMachineId: "worker-machine",
				targetRelayKey: worker.relayKey,
				ciphertext: response.ciphertext,
				...createOverride(),
			}),
		).toThrow("Invalid Team relay response binding");
	});

	test("returns sanitized business failures inside the encrypted response", () => {
		const leader = createProtocol("leader-machine", 1);
		const worker = createProtocol("worker-machine", 2);
		const verified = worker.openRequest(
			toExecuteParams(leader, createRequest(leader, worker)),
		);
		const response = worker.sealFailure(
			verified,
			new AppError(
				createErrorDetail({
					code: "SESSION_NOT_READY",
					message: "Remote ACP session is not ready",
					retryable: true,
					scope: "session",
					detail: "/private/worker/path",
				}),
				409,
			),
		);

		expect(JSON.stringify(response)).not.toContain("Remote ACP session");
		expect(JSON.stringify(response)).not.toContain("/private/worker/path");
		try {
			leader.openResponse({
				operationId: "operation-1",
				operation: "member.bootstrap",
				targetMachineId: "worker-machine",
				targetRelayKey: worker.relayKey,
				ciphertext: response.ciphertext,
			});
			throw new Error("Expected encrypted remote failure");
		} catch (error) {
			expect(error).toBeInstanceOf(TeamRelayRemoteError);
			expect((error as TeamRelayRemoteError).detail).toEqual({
				code: "SESSION_NOT_READY",
				message: "Remote ACP session is not ready",
				retryable: true,
				scope: "session",
			});
			expect(
				JSON.stringify((error as TeamRelayRemoteError).detail),
			).not.toContain("/private/worker/path");
		}
	});

	test("converts unexpected target failures to a generic encrypted error", () => {
		const leader = createProtocol("leader-machine", 1);
		const worker = createProtocol("worker-machine", 2);
		const verified = worker.openRequest(
			toExecuteParams(leader, createRequest(leader, worker)),
		);
		const response = worker.sealFailure(
			verified,
			new Error("token at /private/worker/path"),
		);

		expect(() =>
			leader.openResponse({
				operationId: "operation-1",
				operation: "member.bootstrap",
				targetMachineId: "worker-machine",
				targetRelayKey: worker.relayKey,
				ciphertext: response.ciphertext,
			}),
		).toThrow("Internal server error");
		expect(JSON.stringify(response)).not.toContain("token");
		expect(JSON.stringify(response)).not.toContain("/private/worker/path");
	});
});
