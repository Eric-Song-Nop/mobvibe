import { describe, expect, it } from "vitest";
import { parseSessionNotification } from "../src/validation/acp-schemas.js";

describe("parseSessionNotification", () => {
	it("preserves protocol updates without importing private SDK validators", () => {
		const payload = {
			sessionId: "session-1",
			update: {
				sessionUpdate: "agent_message_chunk",
				messageId: "message-1",
				content: { type: "text", text: "hello" },
			},
			_meta: { traceparent: "00-test" },
		};

		expect(parseSessionNotification(payload)).toEqual({
			success: true,
			data: payload,
		});
	});

	it("accepts future update variants for WAL forward compatibility", () => {
		const payload = {
			sessionId: "session-1",
			update: { sessionUpdate: "_example/future", value: 42 },
		};

		expect(parseSessionNotification(payload)).toEqual({
			success: true,
			data: payload,
		});
	});

	it("rejects values without a routable session envelope", () => {
		expect(parseSessionNotification({ sessionId: "session-1" }).success).toBe(
			false,
		);
		expect(
			parseSessionNotification({
				sessionId: "",
				update: { sessionUpdate: "plan" },
			}).success,
		).toBe(false);
	});
});
