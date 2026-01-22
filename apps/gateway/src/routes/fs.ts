import {
	createErrorDetail,
	createInternalError,
	type ErrorDetail,
} from "@remote-claude/shared";
import type { Router } from "express";
import type { SessionRouter } from "../services/session-router.js";

const getErrorMessage = (error: unknown) => {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
};

const respondError = (
	response: { status: (code: number) => { json: (body: unknown) => void } },
	detail: ErrorDetail,
	status = 500,
) => {
	response.status(status).json({ error: detail });
};

const buildRequestValidationError = (message = "Invalid request") =>
	createErrorDetail({
		code: "REQUEST_VALIDATION_FAILED",
		message,
		retryable: false,
		scope: "request",
	});

export function setupFsRoutes(router: Router, sessionRouter: SessionRouter) {
	// Get session roots
	router.get("/session/roots", async (request, response) => {
		const sessionId =
			typeof request.query.sessionId === "string"
				? request.query.sessionId
				: undefined;
		if (!sessionId) {
			respondError(
				response,
				buildRequestValidationError("sessionId required"),
				400,
			);
			return;
		}

		try {
			const result = await sessionRouter.getFsRoots(sessionId);
			response.json(result);
		} catch (error) {
			respondError(
				response,
				createInternalError("request", getErrorMessage(error)),
			);
		}
	});

	// Get session entries
	router.get("/session/entries", async (request, response) => {
		const sessionId =
			typeof request.query.sessionId === "string"
				? request.query.sessionId
				: undefined;
		const path =
			typeof request.query.path === "string" ? request.query.path : undefined;
		if (!sessionId) {
			respondError(
				response,
				buildRequestValidationError("sessionId required"),
				400,
			);
			return;
		}

		try {
			const result = await sessionRouter.getFsEntries({ sessionId, path });
			response.json(result);
		} catch (error) {
			respondError(
				response,
				createInternalError("request", getErrorMessage(error)),
			);
		}
	});

	// Get session file
	router.get("/session/file", async (request, response) => {
		const sessionId =
			typeof request.query.sessionId === "string"
				? request.query.sessionId
				: undefined;
		const path =
			typeof request.query.path === "string" ? request.query.path : undefined;
		if (!sessionId || !path) {
			respondError(
				response,
				buildRequestValidationError("sessionId and path required"),
				400,
			);
			return;
		}

		try {
			const result = await sessionRouter.getFsFile({ sessionId, path });
			response.json(result);
		} catch (error) {
			respondError(
				response,
				createInternalError("request", getErrorMessage(error)),
			);
		}
	});

	// Get session resources
	router.get("/session/resources", async (request, response) => {
		const sessionId =
			typeof request.query.sessionId === "string"
				? request.query.sessionId
				: undefined;
		if (!sessionId) {
			respondError(
				response,
				buildRequestValidationError("sessionId required"),
				400,
			);
			return;
		}

		try {
			const result = await sessionRouter.getFsResources({ sessionId });
			response.json(result);
		} catch (error) {
			respondError(
				response,
				createInternalError("request", getErrorMessage(error)),
			);
		}
	});

	return router;
}
