import {
	createErrorDetail,
	createInternalError,
	type ErrorDetail,
} from "@remote-claude/shared";
import type { Router } from "express";
import {
	type AuthenticatedRequest,
	getUserId,
	optionalAuth,
} from "../middleware/auth.js";
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

const buildAuthorizationError = (message = "Not authorized") =>
	createErrorDetail({
		code: "AUTHORIZATION_FAILED",
		message,
		retryable: false,
		scope: "request",
	});

export function setupFsRoutes(router: Router, sessionRouter: SessionRouter) {
	// Apply optional auth to all routes
	router.use(optionalAuth);

	// Get session roots - with authorization check
	router.get(
		"/session/roots",
		async (request: AuthenticatedRequest, response) => {
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
				const userId = getUserId(request);
				const result = await sessionRouter.getFsRoots(sessionId, userId);
				response.json(result);
			} catch (error) {
				const message = getErrorMessage(error);
				if (message.includes("Not authorized")) {
					respondError(response, buildAuthorizationError(message), 403);
				} else {
					respondError(response, createInternalError("request", message));
				}
			}
		},
	);

	// Get session entries - with authorization check
	router.get(
		"/session/entries",
		async (request: AuthenticatedRequest, response) => {
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
				const userId = getUserId(request);
				const result = await sessionRouter.getFsEntries(
					{ sessionId, path },
					userId,
				);
				response.json(result);
			} catch (error) {
				const message = getErrorMessage(error);
				if (message.includes("Not authorized")) {
					respondError(response, buildAuthorizationError(message), 403);
				} else {
					respondError(response, createInternalError("request", message));
				}
			}
		},
	);

	// Get session file - with authorization check
	router.get(
		"/session/file",
		async (request: AuthenticatedRequest, response) => {
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
				const userId = getUserId(request);
				const result = await sessionRouter.getFsFile(
					{ sessionId, path },
					userId,
				);
				response.json(result);
			} catch (error) {
				const message = getErrorMessage(error);
				if (message.includes("Not authorized")) {
					respondError(response, buildAuthorizationError(message), 403);
				} else {
					respondError(response, createInternalError("request", message));
				}
			}
		},
	);

	// Get session resources - with authorization check
	router.get(
		"/session/resources",
		async (request: AuthenticatedRequest, response) => {
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
				const userId = getUserId(request);
				const result = await sessionRouter.getFsResources(
					{ sessionId },
					userId,
				);
				response.json(result);
			} catch (error) {
				const message = getErrorMessage(error);
				if (message.includes("Not authorized")) {
					respondError(response, buildAuthorizationError(message), 403);
				} else {
					respondError(response, createInternalError("request", message));
				}
			}
		},
	);

	return router;
}
