import { describe, expect, it } from "vitest";
import {
	parsePlaceTeamRelayPeerParams,
	parsePlaceTeamRelayPeerResult,
	parseResolveTeamRelayPeerResult,
	parseSendTeamRelayResult,
	type TeamRelayCiphertext,
	type TeamRelayPublicKey,
} from "../src/index.js";

const createRelayKey = (seed: number): TeamRelayPublicKey => {
	const publicKey = Buffer.alloc(32, seed).toString("base64");
	return {
		version: 1,
		keyId: `x25519:${publicKey}`,
		publicKey,
	};
};

const createCiphertext = (
	recipientKeyId: string,
	seed: number,
): TeamRelayCiphertext => ({
	version: 1,
	recipientKeyId,
	wrappedDek: Buffer.alloc(80, seed).toString("base64"),
	payload: {
		t: "encrypted",
		c: Buffer.alloc(64, seed).toString("base64"),
	},
});

describe("Team relay placement parsing", () => {
	it("accepts only an exact bounded backend selector", () => {
		expect(parsePlaceTeamRelayPeerParams({ backendId: "codex-acp" })).toEqual({
			backendId: "codex-acp",
		});

		for (const invalid of [
			{},
			{ backendId: "" },
			{ backendId: "   " },
			{ backendId: "x".repeat(257) },
			{ backendId: "界".repeat(86) },
			{ backendId: "codex-acp", sourceMachineId: "machine-forged" },
			{ backendId: "codex-acp", agentTeamId: "team-secret" },
			{ backendId: "codex-acp", memberId: "member-secret" },
			{ backendId: "codex-acp", team: { title: "must-not-reach-gateway" } },
		]) {
			expect(() => parsePlaceTeamRelayPeerParams(invalid)).toThrow(
				"Invalid Team relay request",
			);
		}
	});
});

describe("Team relay result parsing", () => {
	it("parses exact resolve and placement peer results with valid relay keys", () => {
		const relayKey = createRelayKey(1);
		const result = { targetMachineId: "machine-2", relayKey };

		expect(parseResolveTeamRelayPeerResult(result, "machine-2")).toBe(result);
		expect(parsePlaceTeamRelayPeerResult(result)).toBe(result);
	});

	it.each([
		["extra field", { extra: "topology" }],
		[
			"malformed key",
			{
				relayKey: {
					version: 1,
					keyId: "x25519:not-base64",
					publicKey: "not-base64",
				},
			},
		],
		["oversized machine", { targetMachineId: "x".repeat(257) }],
	])("rejects peer results with an %s", (_label, override) => {
		const result = {
			targetMachineId: "machine-2",
			relayKey: createRelayKey(1),
			...override,
		};

		expect(() => parseResolveTeamRelayPeerResult(result)).toThrow(
			"Invalid Team relay response",
		);
		expect(() => parsePlaceTeamRelayPeerResult(result)).toThrow(
			"Invalid Team relay response",
		);
	});

	it("binds a resolved peer result to the requested target machine", () => {
		expect(() =>
			parseResolveTeamRelayPeerResult(
				{
					targetMachineId: "machine-spoofed",
					relayKey: createRelayKey(1),
				},
				"machine-expected",
			),
		).toThrow("Invalid Team relay response");
	});

	it("parses an exact send result and enforces all caller-provided bindings", () => {
		const sourceKey = createRelayKey(1);
		const result = {
			operationId: "operation-1",
			targetMachineId: "machine-2",
			ciphertext: createCiphertext(sourceKey.keyId, 3),
		};

		expect(
			parseSendTeamRelayResult(result, {
				operationId: "operation-1",
				targetMachineId: "machine-2",
				recipientKeyId: sourceKey.keyId,
			}),
		).toBe(result);
	});

	it.each([
		["operationId", { operationId: "operation-spoofed" }],
		["targetMachineId", { targetMachineId: "machine-spoofed" }],
		[
			"recipientKeyId",
			{ ciphertext: createCiphertext(createRelayKey(9).keyId, 4) },
		],
		["exact keys", { extra: "plaintext" }],
		[
			"ciphertext",
			{
				ciphertext: {
					...createCiphertext(createRelayKey(1).keyId, 4),
					payload: { t: "encrypted", c: "not-base64" },
				},
			},
		],
	])("rejects a send result with a mismatched or invalid %s", (_label, override) => {
		const sourceKey = createRelayKey(1);
		const result = {
			operationId: "operation-1",
			targetMachineId: "machine-2",
			ciphertext: createCiphertext(sourceKey.keyId, 3),
			...override,
		};

		expect(() =>
			parseSendTeamRelayResult(result, {
				operationId: "operation-1",
				targetMachineId: "machine-2",
				recipientKeyId: sourceKey.keyId,
			}),
		).toThrow("Invalid Team relay response");
	});
});
