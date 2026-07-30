import { describe, expect, it } from "vitest";
import { sanitizeInboundAcpPayload } from "../inbound-acp-meta";

describe("sanitizeInboundAcpPayload", () => {
	it("drops invalid nested metadata without dropping event core fields", () => {
		const result = sanitizeInboundAcpPayload({
			sessionId: "session-1",
			payload: {
				update: {
					sessionUpdate: "session_info_update",
					title: "Preserved title",
					_meta: JSON.parse('{"constructor":{"polluted":true}}'),
				},
			},
		});

		expect(result).toEqual({
			sessionId: "session-1",
			payload: {
				update: {
					sessionUpdate: "session_info_update",
					title: "Preserved title",
				},
			},
		});
	});

	it("drops a malformed non-JSON payload without invoking its getter", () => {
		let getterCalled = false;
		const payload: Record<string, unknown> = { sessionId: "session-1" };
		Object.defineProperty(payload, "payload", {
			enumerable: true,
			get() {
				getterCalled = true;
				return { _meta: { deferred: true } };
			},
		});

		expect(sanitizeInboundAcpPayload(payload)).toBeUndefined();
		expect(getterCalled).toBe(false);
	});
});
