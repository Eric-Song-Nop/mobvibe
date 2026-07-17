import {
	AppError,
	createInternalError,
	type ErrorDetail,
} from "@mobvibe/shared";

export type ErrorResponse = {
	status: (code: number) => { json: (body: unknown) => void };
};

const isHttpErrorStatus = (status: unknown): status is number =>
	typeof status === "number" &&
	Number.isInteger(status) &&
	status >= 400 &&
	status <= 599;

export const respondError = (
	response: ErrorResponse,
	detail: ErrorDetail,
	status = 500,
): void => {
	response.status(status).json({ error: detail });
};

export const respondAppError = (
	response: ErrorResponse,
	error: unknown,
): error is AppError => {
	if (!(error instanceof AppError)) {
		return false;
	}
	const detail =
		error.detail.code === "INTERNAL_ERROR"
			? createInternalError(error.detail.scope)
			: error.detail;
	respondError(
		response,
		detail,
		isHttpErrorStatus(error.status) ? error.status : 500,
	);
	return true;
};
