import type { EncryptedPayload } from "../crypto/types.js";

export const TEAM_RELAY_ENVELOPE_VERSION = 1 as const;
export const TEAM_RELAY_OPERATION_ID_MAX_BYTES = 128;
export const TEAM_RELAY_MACHINE_ID_MAX_BYTES = 256;
export const TEAM_RELAY_BACKEND_ID_MAX_BYTES = 256;
export const TEAM_RELAY_CIPHERTEXT_MAX_BYTES = 4 * 1024 * 1024;
export const TEAM_RELAY_GATEWAY_RPC_TIMEOUT_MS = 120_000;
export const TEAM_RELAY_CLIENT_ACK_TIMEOUT_MS = 130_000;
export const TEAM_RELAY_OUTBOX_LEASE_MS = 150_000;

const TEAM_RELAY_PUBLIC_KEY_BYTES = 32;
const TEAM_RELAY_WRAPPED_DEK_BYTES = 80;
const TEAM_RELAY_CIPHERTEXT_MIN_BYTES = 40;
const BASE64_PATTERN =
	/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** Public X25519 identity advertised by a CLI for cross-machine Team relay. */
export type TeamRelayPublicKey = {
	version: typeof TEAM_RELAY_ENVELOPE_VERSION;
	keyId: string;
	publicKey: string;
};

/**
 * Opaque payload forwarded by Gateway. Only the recipient CLI can unwrap the
 * DEK and decrypt the payload.
 */
export type TeamRelayCiphertext = {
	version: typeof TEAM_RELAY_ENVELOPE_VERSION;
	recipientKeyId: string;
	wrappedDek: string;
	payload: EncryptedPayload;
};

/** Source CLI request for the public relay identity of another machine. */
export type ResolveTeamRelayPeerParams = {
	targetMachineId: string;
};

export type ResolveTeamRelayPeerResult = {
	targetMachineId: string;
	relayKey: TeamRelayPublicKey;
};

/** Metadata-only request for an eligible remote worker. */
export type PlaceTeamRelayPeerParams = {
	backendId: string;
};

export type PlaceTeamRelayPeerResult = {
	targetMachineId: string;
	relayKey: TeamRelayPublicKey;
};

/** Source CLI request to forward an encrypted operation to another machine. */
export type SendTeamRelayParams = {
	operationId: string;
	targetMachineId: string;
	ciphertext: TeamRelayCiphertext;
};

export type SendTeamRelayResult = {
	operationId: string;
	targetMachineId: string;
	ciphertext: TeamRelayCiphertext;
};

export type SendTeamRelayResultBinding = {
	operationId: string;
	targetMachineId: string;
	recipientKeyId: string;
};

/** Authenticated Gateway-to-target request. Source fields are Gateway-stamped. */
export type TeamRelayExecuteRpcParams = {
	operationId: string;
	sourceMachineId: string;
	sourceRelayKey: TeamRelayPublicKey;
	ciphertext: TeamRelayCiphertext;
};

export type TeamRelayExecuteRpcResult = {
	operationId: string;
	ciphertext: TeamRelayCiphertext;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const hasExactKeys = (
	value: Record<string, unknown>,
	expectedKeys: readonly string[],
): boolean => {
	const actualKeys = Object.keys(value);
	return (
		actualKeys.length === expectedKeys.length &&
		expectedKeys.every((key) => Object.hasOwn(value, key))
	);
};

const getBase64DecodedBytes = (value: string): number | undefined => {
	if (
		value.length === 0 ||
		value.length % 4 !== 0 ||
		!BASE64_PATTERN.test(value)
	) {
		return undefined;
	}
	const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
	return (value.length / 4) * 3 - padding;
};

const isBoundedIdentifier = (
	value: unknown,
	maxBytes: number,
): value is string =>
	typeof value === "string" &&
	value.length > 0 &&
	value.length <= maxBytes &&
	!/\p{Cc}/u.test(value) &&
	new TextEncoder().encode(value).byteLength <= maxBytes;

export const isTeamRelayPublicKey = (
	value: unknown,
): value is TeamRelayPublicKey => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, ["version", "keyId", "publicKey"]) ||
		value.version !== TEAM_RELAY_ENVELOPE_VERSION ||
		typeof value.publicKey !== "string" ||
		getBase64DecodedBytes(value.publicKey) !== TEAM_RELAY_PUBLIC_KEY_BYTES
	) {
		return false;
	}
	return value.keyId === `x25519:${value.publicKey}`;
};

export const isTeamRelayCiphertext = (
	value: unknown,
): value is TeamRelayCiphertext => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			"version",
			"recipientKeyId",
			"wrappedDek",
			"payload",
		]) ||
		value.version !== TEAM_RELAY_ENVELOPE_VERSION ||
		typeof value.recipientKeyId !== "string" ||
		!value.recipientKeyId.startsWith("x25519:") ||
		getBase64DecodedBytes(value.recipientKeyId.slice("x25519:".length)) !==
			TEAM_RELAY_PUBLIC_KEY_BYTES ||
		typeof value.wrappedDek !== "string" ||
		getBase64DecodedBytes(value.wrappedDek) !== TEAM_RELAY_WRAPPED_DEK_BYTES ||
		!isRecord(value.payload) ||
		!hasExactKeys(value.payload, ["t", "c"]) ||
		value.payload.t !== "encrypted" ||
		typeof value.payload.c !== "string" ||
		value.payload.c.length > Math.ceil(TEAM_RELAY_CIPHERTEXT_MAX_BYTES / 3) * 4
	) {
		return false;
	}
	const ciphertextBytes = getBase64DecodedBytes(value.payload.c);
	return (
		ciphertextBytes !== undefined &&
		ciphertextBytes >= TEAM_RELAY_CIPHERTEXT_MIN_BYTES &&
		ciphertextBytes <= TEAM_RELAY_CIPHERTEXT_MAX_BYTES
	);
};

const parseRelayRequest = <T>(
	value: unknown,
	isValid: (record: Record<string, unknown>) => boolean,
): T => {
	if (!isRecord(value) || !isValid(value)) {
		throw new Error("Invalid Team relay request");
	}
	return value as T;
};

export const parseResolveTeamRelayPeerParams = (
	value: unknown,
): ResolveTeamRelayPeerParams =>
	parseRelayRequest<ResolveTeamRelayPeerParams>(
		value,
		(record) =>
			hasExactKeys(record, ["targetMachineId"]) &&
			isBoundedIdentifier(
				record.targetMachineId,
				TEAM_RELAY_MACHINE_ID_MAX_BYTES,
			),
	);

export const parsePlaceTeamRelayPeerParams = (
	value: unknown,
): PlaceTeamRelayPeerParams =>
	parseRelayRequest<PlaceTeamRelayPeerParams>(
		value,
		(record) =>
			hasExactKeys(record, ["backendId"]) &&
			isBoundedIdentifier(record.backendId, TEAM_RELAY_BACKEND_ID_MAX_BYTES) &&
			record.backendId.trim().length > 0,
	);

export const parseSendTeamRelayParams = (value: unknown): SendTeamRelayParams =>
	parseRelayRequest<SendTeamRelayParams>(
		value,
		(record) =>
			hasExactKeys(record, ["operationId", "targetMachineId", "ciphertext"]) &&
			isBoundedIdentifier(
				record.operationId,
				TEAM_RELAY_OPERATION_ID_MAX_BYTES,
			) &&
			isBoundedIdentifier(
				record.targetMachineId,
				TEAM_RELAY_MACHINE_ID_MAX_BYTES,
			) &&
			isTeamRelayCiphertext(record.ciphertext),
	);

const parseRelayResponse = <T>(
	value: unknown,
	isValid: (record: Record<string, unknown>) => boolean,
): T => {
	if (!isRecord(value) || !isValid(value)) {
		throw new Error("Invalid Team relay response");
	}
	return value as T;
};

const parseTeamRelayPeerResult = <T extends PlaceTeamRelayPeerResult>(
	value: unknown,
	expectedTargetMachineId?: string,
): T =>
	parseRelayResponse<T>(
		value,
		(record) =>
			hasExactKeys(record, ["targetMachineId", "relayKey"]) &&
			isBoundedIdentifier(
				record.targetMachineId,
				TEAM_RELAY_MACHINE_ID_MAX_BYTES,
			) &&
			isTeamRelayPublicKey(record.relayKey) &&
			(expectedTargetMachineId === undefined ||
				record.targetMachineId === expectedTargetMachineId),
	);

export const parseResolveTeamRelayPeerResult = (
	value: unknown,
	expectedTargetMachineId?: string,
): ResolveTeamRelayPeerResult =>
	parseTeamRelayPeerResult<ResolveTeamRelayPeerResult>(
		value,
		expectedTargetMachineId,
	);

export const parsePlaceTeamRelayPeerResult = (
	value: unknown,
): PlaceTeamRelayPeerResult =>
	parseTeamRelayPeerResult<PlaceTeamRelayPeerResult>(value);

export const parseSendTeamRelayResult = (
	value: unknown,
	expected?: SendTeamRelayResultBinding,
): SendTeamRelayResult =>
	parseRelayResponse<SendTeamRelayResult>(
		value,
		(record) =>
			hasExactKeys(record, ["operationId", "targetMachineId", "ciphertext"]) &&
			isBoundedIdentifier(
				record.operationId,
				TEAM_RELAY_OPERATION_ID_MAX_BYTES,
			) &&
			isBoundedIdentifier(
				record.targetMachineId,
				TEAM_RELAY_MACHINE_ID_MAX_BYTES,
			) &&
			isTeamRelayCiphertext(record.ciphertext) &&
			(expected === undefined ||
				(record.operationId === expected.operationId &&
					record.targetMachineId === expected.targetMachineId &&
					record.ciphertext.recipientKeyId === expected.recipientKeyId)),
	);

export const parseTeamRelayExecuteRpcParams = (
	value: unknown,
): TeamRelayExecuteRpcParams =>
	parseRelayRequest<TeamRelayExecuteRpcParams>(
		value,
		(record) =>
			hasExactKeys(record, [
				"operationId",
				"sourceMachineId",
				"sourceRelayKey",
				"ciphertext",
			]) &&
			isBoundedIdentifier(
				record.operationId,
				TEAM_RELAY_OPERATION_ID_MAX_BYTES,
			) &&
			isBoundedIdentifier(
				record.sourceMachineId,
				TEAM_RELAY_MACHINE_ID_MAX_BYTES,
			) &&
			isTeamRelayPublicKey(record.sourceRelayKey) &&
			isTeamRelayCiphertext(record.ciphertext),
	);

export const parseTeamRelayExecuteRpcResult = (
	value: unknown,
): TeamRelayExecuteRpcResult =>
	parseRelayResponse<TeamRelayExecuteRpcResult>(
		value,
		(record) =>
			hasExactKeys(record, ["operationId", "ciphertext"]) &&
			isBoundedIdentifier(
				record.operationId,
				TEAM_RELAY_OPERATION_ID_MAX_BYTES,
			) &&
			isTeamRelayCiphertext(record.ciphertext),
	);
