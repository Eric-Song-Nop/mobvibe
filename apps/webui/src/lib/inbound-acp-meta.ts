import { sanitizeAcpMessageMeta } from "@mobvibe/shared";

/**
 * Re-check ACP metadata after transport decoding or E2EE decryption. Invalid
 * opaque envelopes are removed while malformed non-JSON payloads are dropped.
 */
export const sanitizeInboundAcpPayload = <T>(value: T): T | undefined => {
	const result = sanitizeAcpMessageMeta(value);
	return result.complete ? result.value : undefined;
};
