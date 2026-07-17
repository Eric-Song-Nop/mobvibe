import type { ErrorCode, RpcError } from "@mobvibe/shared";
import { describe, expect, it } from "vitest";
import { toRpcAppError } from "../rpc-errors.js";

const rpcError = (code: ErrorCode): RpcError => ({
	code,
	message: `legacy ${code}`,
	retryable: false,
	scope: "request",
});

describe("toRpcAppError", () => {
	it.each([
		["REQUEST_VALIDATION_FAILED", 400],
		["GIT_WORKTREE_FAILED", 400],
		["SESSION_NOT_FOUND", 404],
		["SESSION_NOT_READY", 409],
		["SESSION_BUSY", 409],
		["CAPABILITY_NOT_SUPPORTED", 409],
		["ACP_PROTOCOL_MISMATCH", 409],
		["MESSAGE_OUTCOME_UNKNOWN", 409],
		["INSTANCE_AFFINITY_CHANGED", 409],
		["AUTHORIZATION_FAILED", 403],
	] satisfies Array<
		[ErrorCode, number]
	>)("maps legacy %s errors without status metadata to %i", (code, status) => {
		expect(toRpcAppError(rpcError(code)).status).toBe(status);
	});

	it("keeps explicit status metadata authoritative", () => {
		expect(
			toRpcAppError({ ...rpcError("SESSION_NOT_FOUND"), status: 410 }).status,
		).toBe(410);
	});

	it("keeps unknown service failures as server errors", () => {
		expect(toRpcAppError(rpcError("ACP_CONNECT_FAILED")).status).toBe(500);
	});

	it.each([
		["Session not found", "SESSION_NOT_FOUND", 404],
		["Session not found: session-123", "SESSION_NOT_FOUND", 404],
		["Session not found or no working directory", "SESSION_NOT_FOUND", 404],
		["Machine not found", "AUTHORIZATION_FAILED", 404],
		[
			"Current agent does not support mode switching",
			"CAPABILITY_NOT_SUPPORTED",
			409,
		],
		["Invalid mode ID", "REQUEST_VALIDATION_FAILED", 400],
	] satisfies Array<
		[string, ErrorCode, number]
	>)("recovers the public semantics of legacy INTERNAL_ERROR: %s", (message, code, status) => {
		const error = toRpcAppError({
			...rpcError("INTERNAL_ERROR"),
			message,
		});
		expect(error.status).toBe(status);
		expect(error.detail).toMatchObject({ code });
	});

	it("does not expose unrecognized legacy INTERNAL_ERROR messages", () => {
		const error = toRpcAppError({
			...rpcError("INTERNAL_ERROR"),
			message: "ENOENT /Users/alice/private/token.txt",
		});

		expect(error.status).toBe(500);
		expect(error.detail.message).toBe("Internal server error");
	});
});
