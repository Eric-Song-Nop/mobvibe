import { describe, expect, it } from "vitest";
import {
	AppError,
	createErrorDetail,
	createInternalError,
	isProtocolMismatch,
	withScope,
} from "../src/acp/errors.js";

describe("errors", () => {
	it("creates error detail and overrides scope", () => {
		const detail = createErrorDetail({
			code: "REQUEST_VALIDATION_FAILED",
			message: "参数错误",
			retryable: false,
			scope: "request",
		});
		const scoped = withScope(detail, "session");
		expect(scoped.scope).toBe("session");
		expect(scoped.code).toBe("REQUEST_VALIDATION_FAILED");
	});

	it("creates internal error with retryable flag", () => {
		const detail = createInternalError("service", "trace");
		expect(detail.code).toBe("INTERNAL_ERROR");
		expect(detail.retryable).toBe(true);
		expect(detail.detail).toBe("trace");
	});

	it("detects protocol mismatch and wraps AppError", () => {
		const error = new Error("protocol mismatch");
		expect(isProtocolMismatch(error)).toBe(true);

		const appError = new AppError(
			createErrorDetail({
				code: "ACP_PROTOCOL_MISMATCH",
				message: "协议不匹配",
				retryable: false,
				scope: "service",
			}),
			400,
		);
		expect(appError.detail.code).toBe("ACP_PROTOCOL_MISMATCH");
		expect(appError.status).toBe(400);
	});
});
