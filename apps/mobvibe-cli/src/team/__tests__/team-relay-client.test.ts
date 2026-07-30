import { beforeAll, describe, expect, mock, test } from "bun:test";
import {
	initCrypto,
	type PlaceTeamRelayPeerParams,
	type PlaceTeamRelayPeerResult,
	type ResolveTeamRelayPeerParams,
	type ResolveTeamRelayPeerResult,
	type SendTeamRelayParams,
	type SendTeamRelayResult,
} from "@mobvibe/shared";
import { CliCryptoService } from "../../e2ee/crypto-service.js";
import {
	TeamRelayClient,
	type TeamRelayWireTransport,
} from "../team-relay-client.js";
import { TeamRelayProtocol } from "../team-relay-protocol.js";

beforeAll(async () => {
	await initCrypto();
});

const createProtocol = (machineId: string, seed: number) =>
	new TeamRelayProtocol({
		machineId,
		cryptoService: new CliCryptoService(new Uint8Array(32).fill(seed)),
	});

const createWire = (
	leader: TeamRelayProtocol,
	worker: TeamRelayProtocol,
): TeamRelayWireTransport => ({
	placeTeamRelayPeer: mock(
		async (
			_params: PlaceTeamRelayPeerParams,
		): Promise<PlaceTeamRelayPeerResult> => ({
			targetMachineId: worker.machineId,
			relayKey: worker.relayKey,
		}),
	),
	resolveTeamRelayPeer: mock(
		async (
			params: ResolveTeamRelayPeerParams,
		): Promise<ResolveTeamRelayPeerResult> => ({
			targetMachineId: params.targetMachineId,
			relayKey: worker.relayKey,
		}),
	),
	sendTeamRelay: mock(
		async (params: SendTeamRelayParams): Promise<SendTeamRelayResult> => {
			const verified = worker.openRequest({
				operationId: params.operationId,
				sourceMachineId: leader.machineId,
				sourceRelayKey: leader.relayKey,
				ciphertext: params.ciphertext,
			});
			const response = worker.sealSuccess(verified, {
				sessionId: "remote-session",
			});
			return {
				operationId: params.operationId,
				targetMachineId: params.targetMachineId,
				ciphertext: response.ciphertext,
			};
		},
	),
});

describe("TeamRelayClient", () => {
	test("places a worker using backend-only metadata", async () => {
		const leader = createProtocol("leader-machine", 1);
		const worker = createProtocol("worker-machine", 2);
		const wire = createWire(leader, worker);
		const client = new TeamRelayClient({ protocol: leader });
		client.attachTransport(wire);

		expect(await client.place({ backendId: "backend-1" })).toEqual({
			targetMachineId: "worker-machine",
			relayKey: worker.relayKey,
		});
		expect(wire.placeTeamRelayPeer).toHaveBeenCalledWith({
			backendId: "backend-1",
		});
	});

	test("resolves, encrypts, sends, and opens a bound relay call", async () => {
		const leader = createProtocol("leader-machine", 1);
		const worker = createProtocol("worker-machine", 2);
		const wire = createWire(leader, worker);
		const client = new TeamRelayClient({ protocol: leader });
		client.attachTransport(wire);

		await expect(
			client.call({
				operationId: "operation-1",
				operation: "member.bootstrap",
				targetMachineId: worker.machineId,
				payload: { privateTeamId: "team-secret" },
			}),
		).resolves.toEqual({ sessionId: "remote-session" });
		expect(wire.resolveTeamRelayPeer).toHaveBeenCalledWith({
			targetMachineId: worker.machineId,
		});
		const sent = (wire.sendTeamRelay as ReturnType<typeof mock>).mock
			.calls[0]?.[0];
		expect(sent.operationId).toBe("operation-1");
		expect(JSON.stringify(sent)).not.toContain("team-secret");
	});

	test("uses a placed key directly and enforces the durable expected key id", async () => {
		const leader = createProtocol("leader-machine", 1);
		const worker = createProtocol("worker-machine", 2);
		const wire = createWire(leader, worker);
		const client = new TeamRelayClient({ protocol: leader });
		client.attachTransport(wire);

		await client.call({
			operationId: "operation-1",
			operation: "member.bootstrap",
			targetMachineId: worker.machineId,
			targetRelayKey: worker.relayKey,
			expectedTargetRelayKeyId: worker.relayKey.keyId,
			payload: { memberId: "member-1" },
		});
		expect(wire.resolveTeamRelayPeer).not.toHaveBeenCalled();

		await expect(
			client.call({
				operationId: "operation-2",
				operation: "member.bootstrap",
				targetMachineId: worker.machineId,
				targetRelayKey: worker.relayKey,
				expectedTargetRelayKeyId: "x25519:unexpected",
				payload: { memberId: "member-2" },
			}),
		).rejects.toThrow("Team relay target key changed");
		expect(wire.sendTeamRelay).toHaveBeenCalledTimes(1);
	});

	test("requires an attached transport and does not replace operation ids or retry", async () => {
		const leader = createProtocol("leader-machine", 1);
		const worker = createProtocol("worker-machine", 2);
		const client = new TeamRelayClient({ protocol: leader });
		await expect(
			client.call({
				operationId: "stable-operation",
				operation: "team.command",
				targetMachineId: worker.machineId,
				payload: { toolName: "mobvibe_team_list_tasks" },
			}),
		).rejects.toThrow("Team relay transport is not attached");

		const wire = createWire(leader, worker);
		wire.sendTeamRelay = mock(async (params: SendTeamRelayParams) => {
			expect(params.operationId).toBe("stable-operation");
			throw new Error("transport failed");
		});
		client.attachTransport(wire);
		await expect(
			client.call({
				operationId: "stable-operation",
				operation: "team.command",
				targetMachineId: worker.machineId,
				payload: { toolName: "mobvibe_team_list_tasks" },
			}),
		).rejects.toThrow("transport failed");
		expect(wire.sendTeamRelay).toHaveBeenCalledTimes(1);
	});

	test("rejects replacing an attached transport", () => {
		const leader = createProtocol("leader-machine", 1);
		const worker = createProtocol("worker-machine", 2);
		const client = new TeamRelayClient({ protocol: leader });
		client.attachTransport(createWire(leader, worker));

		expect(() => client.attachTransport(createWire(leader, worker))).toThrow(
			"Team relay transport is already attached",
		);
	});
});
