export type ErrorScope = "service" | "session" | "stream" | "request";

export type ErrorCode =
	| "ACP_CONNECT_FAILED"
	| "ACP_PROCESS_EXITED"
	| "ACP_CONNECTION_CLOSED"
	| "ACP_PROTOCOL_MISMATCH"
	| "SESSION_NOT_FOUND"
	| "SESSION_NOT_READY"
	| "CAPABILITY_NOT_SUPPORTED"
	| "REQUEST_VALIDATION_FAILED"
	| "AUTHORIZATION_FAILED"
	| "STREAM_DISCONNECTED"
	| "INTERNAL_ERROR";

export type ErrorDetail = {
	code: ErrorCode;
	message: string;
	retryable: boolean;
	scope: ErrorScope;
	detail?: string;
};

export type ErrorDetailInput = Omit<ErrorDetail, "detail"> & {
	detail?: string;
};

export const createErrorDetail = (input: ErrorDetailInput): ErrorDetail => ({
	...input,
});

export const withScope = (
	detail: ErrorDetail,
	scope: ErrorScope,
): ErrorDetail =>
	createErrorDetail({
		...detail,
		scope,
	});

export const createInternalError = (
	scope: ErrorScope,
	detail?: string,
): ErrorDetail =>
	createErrorDetail({
		code: "INTERNAL_ERROR",
		message: "Internal server error",
		retryable: true,
		scope,
		detail,
	});

export const isProtocolMismatch = (error: unknown): boolean => {
	if (error instanceof Error) {
		// Check JSON-RPC error code -32002 (protocol version mismatch)
		if ("code" in error && (error as { code: number }).code === -32002) {
			return true;
		}
		return /protocol.*version|version.*mismatch|protocol/i.test(error.message);
	}
	return false;
};

export class AppError extends Error {
	readonly detail: ErrorDetail;
	readonly status: number;

	constructor(detail: ErrorDetail, status = 500) {
		super(detail.message);
		this.detail = detail;
		this.status = status;
	}
}

export const isErrorDetail = (payload: unknown): payload is ErrorDetail => {
	if (!payload || typeof payload !== "object") {
		return false;
	}
	const detail = payload as ErrorDetail;
	return (
		typeof detail.code === "string" &&
		typeof detail.message === "string" &&
		typeof detail.retryable === "boolean" &&
		typeof detail.scope === "string"
	);
};
