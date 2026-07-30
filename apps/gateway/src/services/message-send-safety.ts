import { createHash } from "node:crypto";

export const MAX_MESSAGE_ID_BYTES = 128;

export const isMessageIdWithinLimit = (messageId: string): boolean =>
	Buffer.byteLength(messageId, "utf8") <= MAX_MESSAGE_ID_BYTES;

/**
 * Keep attacker-controlled identifiers out of long-lived map keys. JSON gives
 * the tuple an unambiguous encoding and SHA-256 makes the retained key fixed
 * size while preserving collision-resistant message identity semantics.
 */
export const createMessageSendKey = (
	userId: string,
	sessionId: string,
	messageId: string,
): string => {
	const digest = createHash("sha256")
		.update(JSON.stringify([userId, sessionId, messageId]))
		.digest("hex");
	return `message-send:${digest}`;
};
