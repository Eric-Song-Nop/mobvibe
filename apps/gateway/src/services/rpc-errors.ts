import { AppError, createInternalError, type RpcError } from "@mobvibe/shared";

const isHttpErrorStatus = (status: unknown): status is number =>
	typeof status === "number" &&
	Number.isInteger(status) &&
	status >= 400 &&
	status <= 599;

export const toRpcAppError = (error: RpcError): AppError => {
	const { status, ...detail } = error;
	const publicDetail =
		error.code === "INTERNAL_ERROR" ? createInternalError(error.scope) : detail;
	const publicStatus = isHttpErrorStatus(status)
		? status
		: error.code === "MESSAGE_OUTCOME_UNKNOWN"
			? 409
			: 500;

	return new AppError(publicDetail, publicStatus);
};
