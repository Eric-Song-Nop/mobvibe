import { describe, expect, it, vi } from "vitest";
import { logger } from "../../lib/logger.js";
import {
	sanitizeAcpMetaPayload,
	sanitizeSessionMetaEnvelopes,
	warnSessionMetaSanitization,
} from "../session-meta-sanitizer.js";

vi.mock("../../lib/logger.js", () => ({
	logger: {
		warn: vi.fn(),
	},
}));

describe("session metadata boundary", () => {
	it("drops invalid metadata while preserving plain core session fields", () => {
		const result = sanitizeSessionMetaEnvelopes([
			{
				sessionId: "session-1",
				title: "Core title",
				_meta: JSON.parse('{"constructor":"blocked"}'),
			},
		]);

		expect(result.values).toEqual([
			{ sessionId: "session-1", title: "Core title" },
		]);
		expect(result.rejectedCount).toBe(1);
	});

	it("rejects an uninspectable non-JSON session before registry use", () => {
		const throwing = new Proxy(
			{ sessionId: "hidden", _meta: { unsafe: true } },
			{
				ownKeys() {
					throw new Error("blocked");
				},
			},
		);

		expect(() => sanitizeSessionMetaEnvelopes([throwing])).toThrow(
			"ACP payload must contain plain JSON values",
		);
	});

	it("sanitizes nested permission metadata for non-summary payloads", () => {
		const result = sanitizeAcpMetaPayload({
			sessionId: "session-1",
			requestId: "request-1",
			toolCall: {
				toolCallId: "tool-1",
				title: "Preserved title",
				_meta: JSON.parse('{"constructor":{"polluted":true}}'),
			},
		});

		expect(result.value).toEqual({
			sessionId: "session-1",
			requestId: "request-1",
			toolCall: { toolCallId: "tool-1", title: "Preserved title" },
		});
		expect(result.rejectedCount).toBe(1);
	});

	it("rate limits structured warnings without logging opaque values", () => {
		const result = {
			values: [{ _meta: { secret: "must-not-leak" } }],
			rejectedCount: 1,
		};
		for (let index = 0; index < 21; index += 1) {
			warnSessionMetaSanitization("sessions:list", "socket-1", result);
		}

		expect(logger.warn).toHaveBeenCalledTimes(20);
		expect(logger.warn).toHaveBeenLastCalledWith(
			{
				event: "sessions:list",
				socketId: "socket-1",
				reason: "session_meta_rejected",
				rejectedCount: 1,
			},
			"session_meta_sanitization_warning",
		);
		expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain(
			"must-not-leak",
		);
	});
});
