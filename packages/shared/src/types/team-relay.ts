import type { EncryptedPayload } from "../crypto/types.js";

export const TEAM_RELAY_ENVELOPE_VERSION = 1 as const;

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
