import { describe, expect, it } from "vitest";
import {
	createMessageSendKey,
	isMessageIdWithinLimit,
} from "../message-send-safety.js";

describe("message send safety", () => {
	it("applies the message ID boundary to UTF-8 bytes", () => {
		expect(isMessageIdWithinLimit("a".repeat(128))).toBe(true);
		expect(isMessageIdWithinLimit("界".repeat(42))).toBe(true);
		expect(isMessageIdWithinLimit("界".repeat(43))).toBe(false);
	});

	it("uses a stable, fixed-size, tuple-safe message key", () => {
		const key = createMessageSendKey("owner", "session", "message");

		expect(key).toMatch(/^message-send:[0-9a-f]{64}$/);
		expect(createMessageSendKey("owner", "session", "message")).toBe(key);
		expect(createMessageSendKey("ow", "nersession", "message")).not.toBe(key);
		expect(createMessageSendKey("owner", "sessionmessage", "")).not.toBe(key);
	});
});
