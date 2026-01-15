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
		message: "服务内部错误",
		retryable: true,
		scope,
		detail,
	});

export const isProtocolMismatch = (error: unknown) => {
	if (error instanceof Error) {
		return /protocol/i.test(error.message);
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
