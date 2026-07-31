import type {
	PlaceTeamRelayPeerParams,
	PlaceTeamRelayPeerResult,
	ResolveTeamRelayPeerParams,
	ResolveTeamRelayPeerResult,
	SendTeamRelayParams,
	SendTeamRelayResult,
	TeamRelayPublicKey,
} from "@mobvibe/shared";
import {
	parsePlaceTeamRelayPeerParams,
	parsePlaceTeamRelayPeerResult,
	parseResolveTeamRelayPeerResult,
	parseSendTeamRelayResult,
} from "@mobvibe/shared";
import type {
	TeamRelayOperation,
	TeamRelayProtocol,
} from "./team-relay-protocol.js";

export type TeamRelayWireTransport = {
	placeTeamRelayPeer(
		params: PlaceTeamRelayPeerParams,
	): Promise<PlaceTeamRelayPeerResult>;
	resolveTeamRelayPeer(
		params: ResolveTeamRelayPeerParams,
	): Promise<ResolveTeamRelayPeerResult>;
	sendTeamRelay(params: SendTeamRelayParams): Promise<SendTeamRelayResult>;
};

export type TeamRelayCallInput = {
	operationId: string;
	operation: TeamRelayOperation;
	targetMachineId: string;
	targetRelayKey?: TeamRelayPublicKey;
	expectedTargetRelayKeyId?: string;
	payload: unknown;
};

type TeamRelayClientOptions = {
	protocol: TeamRelayProtocol;
};

export class TeamRelayClient {
	private readonly protocol: TeamRelayProtocol;
	private transport?: TeamRelayWireTransport;

	constructor(options: TeamRelayClientOptions) {
		this.protocol = options.protocol;
	}

	attachTransport(transport: TeamRelayWireTransport): void {
		if (this.transport) {
			throw new Error("Team relay transport is already attached");
		}
		this.transport = transport;
	}

	async place(
		rawParams: PlaceTeamRelayPeerParams,
	): Promise<PlaceTeamRelayPeerResult> {
		const params = parsePlaceTeamRelayPeerParams(rawParams);
		const result = await this.requireTransport().placeTeamRelayPeer(params);
		return parsePlaceTeamRelayPeerResult(result);
	}

	async call<Result = unknown>(input: TeamRelayCallInput): Promise<Result> {
		const transport = this.requireTransport();
		const targetRelayKey =
			input.targetRelayKey ??
			parseResolveTeamRelayPeerResult(
				await transport.resolveTeamRelayPeer({
					targetMachineId: input.targetMachineId,
				}),
				input.targetMachineId,
			).relayKey;
		if (
			input.expectedTargetRelayKeyId !== undefined &&
			targetRelayKey.keyId !== input.expectedTargetRelayKeyId
		) {
			throw new Error("Team relay target key changed");
		}

		const request = this.protocol.sealRequest({
			operationId: input.operationId,
			operation: input.operation,
			targetMachineId: input.targetMachineId,
			targetRelayKey,
			payload: input.payload,
		});
		const rawResponse = await transport.sendTeamRelay(request);
		const response = parseSendTeamRelayResult(rawResponse, {
			operationId: input.operationId,
			targetMachineId: input.targetMachineId,
			recipientKeyId: this.protocol.relayKey.keyId,
		});
		return this.protocol.openResponse({
			operationId: input.operationId,
			operation: input.operation,
			targetMachineId: input.targetMachineId,
			targetRelayKey,
			ciphertext: response.ciphertext,
		}) as Result;
	}

	private requireTransport(): TeamRelayWireTransport {
		if (!this.transport) {
			throw new Error("Team relay transport is not attached");
		}
		return this.transport;
	}
}
