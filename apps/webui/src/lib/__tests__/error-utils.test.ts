import { describe, expect, it } from "vitest";
import i18n from "@/i18n";
import { ApiError, type ErrorDetail } from "../api";
import {
	buildSessionNotReadyError,
	createFallbackError,
	isErrorDetail,
	normalizeError,
} from "../error-utils";

describe("error-utils", () => {
	describe("createFallbackError", () => {
		it("should create an error with INTERNAL_ERROR code", () => {
			const error = createFallbackError("Test error", "service");
			expect(error.code).toBe("INTERNAL_ERROR");
		});

		it("should preserve the provided message", () => {
			const error = createFallbackError("Test error", "service");
			expect(error.message).toBe("Test error");
		});

		it("should mark as retryable", () => {
			const error = createFallbackError("Test error", "service");
			expect(error.retryable).toBe(true);
		});

		it("should preserve the provided scope", () => {
			const error = createFallbackError("Test error", "session");
			expect(error.scope).toBe("session");
		});

		it("should support all scope types", () => {
			const scopes: Array<ErrorDetail["scope"]> = [
				"service",
				"session",
				"stream",
				"request",
			];

			scopes.forEach((scope) => {
				const error = createFallbackError("Test", scope);
				expect(error.scope).toBe(scope);
			});
		});
	});

	describe("normalizeError", () => {
		it("should return detail from ApiError", () => {
			const detail = {
				code: "INTERNAL_ERROR" as const,
				message: "API error",
				retryable: false,
				scope: "service" as const,
			};
			const apiError = new ApiError(detail);
			const fallback = createFallbackError("Fallback", "request");

			const result = normalizeError(apiError, fallback);

			expect(result).toEqual(detail);
		});

		it("should extract message from generic Error", () => {
			const error = new Error("Generic error");
			const fallback = createFallbackError("Fallback", "request");

			const result = normalizeError(error, fallback);

			expect(result.message).toBe("Generic error");
			expect(result.detail).toBe("Generic error");
			expect(result.code).toBe(fallback.code);
			expect(result.scope).toBe(fallback.scope);
		});

		it("should return fallback for unknown error types", () => {
			const fallback = createFallbackError("Fallback", "request");

			const result = normalizeError("string error", fallback);
			expect(result).toEqual(fallback);

			const result2 = normalizeError(null, fallback);
			expect(result2).toEqual(fallback);

			const result3 = normalizeError(undefined, fallback);
			expect(result3).toEqual(fallback);
		});

		it("should return fallback for object errors", () => {
			const fallback = createFallbackError("Fallback", "request");
			const objectError = { custom: "error" };

			const result = normalizeError(objectError, fallback);
			expect(result).toEqual(fallback);
		});
	});

	describe("isErrorDetail", () => {
		it("should return true for valid ErrorDetail objects", () => {
			const valid = {
				code: "INTERNAL_ERROR",
				message: "Test",
				retryable: true,
				scope: "service",
			};

			expect(isErrorDetail(valid)).toBe(true);
		});

		it("should return true for all valid scope types", () => {
			const scopes: Array<ErrorDetail["scope"]> = [
				"service",
				"session",
				"stream",
				"request",
			];

			scopes.forEach((scope) => {
				const detail = {
					code: "INTERNAL_ERROR",
					message: "Test",
					retryable: true,
					scope,
				};
				expect(isErrorDetail(detail)).toBe(true);
			});
		});

		it("should return false for null or undefined", () => {
			expect(isErrorDetail(null)).toBe(false);
			expect(isErrorDetail(undefined)).toBe(false);
		});

		it("should return false for non-object types", () => {
			expect(isErrorDetail("string")).toBe(false);
			expect(isErrorDetail(123)).toBe(false);
			expect(isErrorDetail(true)).toBe(false);
		});

		it("should return false for objects with missing properties", () => {
			const missingCode = {
				message: "Test",
				retryable: true,
				scope: "service",
			};
			expect(isErrorDetail(missingCode)).toBe(false);

			const missingMessage = {
				code: "INTERNAL_ERROR",
				retryable: true,
				scope: "service",
			};
			expect(isErrorDetail(missingMessage)).toBe(false);

			const missingRetryable = {
				code: "INTERNAL_ERROR",
				message: "Test",
				scope: "service",
			};
			expect(isErrorDetail(missingRetryable)).toBe(false);

			const missingScope = {
				code: "INTERNAL_ERROR",
				message: "Test",
				retryable: true,
			};
			expect(isErrorDetail(missingScope)).toBe(false);
		});

		it("should return false for objects with wrong property types", () => {
			const wrongCode = {
				code: 123,
				message: "Test",
				retryable: true,
				scope: "service",
			};
			expect(isErrorDetail(wrongCode)).toBe(false);

			const wrongMessage = {
				code: "INTERNAL_ERROR",
				message: 123,
				retryable: true,
				scope: "service",
			};
			expect(isErrorDetail(wrongMessage)).toBe(false);

			const wrongRetryable = {
				code: "INTERNAL_ERROR",
				message: "Test",
				retryable: "true",
				scope: "service",
			};
			expect(isErrorDetail(wrongRetryable)).toBe(false);

			const wrongScope = {
				code: "INTERNAL_ERROR",
				message: "Test",
				retryable: true,
				scope: 123,
			};
			expect(isErrorDetail(wrongScope)).toBe(false);
		});
	});

	describe("buildSessionNotReadyError", () => {
		it("should create an error with SESSION_NOT_READY code", () => {
			const error = buildSessionNotReadyError();
			expect(error.code).toBe("SESSION_NOT_READY");
		});

		it("should have appropriate message", () => {
			const error = buildSessionNotReadyError();
			expect(error.message).toBe(i18n.t("errors.sessionNotReady"));
		});

		it("should mark as retryable", () => {
			const error = buildSessionNotReadyError();
			expect(error.retryable).toBe(true);
		});

		it("should have session scope", () => {
			const error = buildSessionNotReadyError();
			expect(error.scope).toBe("session");
		});
	});
});
