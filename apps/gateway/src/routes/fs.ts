import {
	createErrorDetail,
	createInternalError,
	type ErrorDetail,
} from "@mobvibe/shared";
import type { Router } from "express";
import {
	type AuthenticatedRequest,
	getUserId,
	requireAuth,
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
	// Require authentication on all FS routes
	router.use(requireAuth);

	// Get host filesystem roots (for creating sessions)
	router.get("/roots", async (request, response) => {
		const machineId =
			typeof request.query.machineId === "string"
				? request.query.machineId
				: undefined;
		if (!machineId) {
			respondError(
				response,
				buildRequestValidationError("machineId required"),
				400,
			);
			return;
		}
		try {
			const userId = getUserId(request);
			const result = await sessionRouter.getHostFsRoots({ machineId }, userId);
			response.json(result);
		} catch (error) {
			const message = getErrorMessage(error);
			if (message.includes("Machine not found")) {
				respondError(response, buildAuthorizationError(message), 404);
			} else {
				respondError(response, createInternalError("request"));
			}
		}
	});

	// Get host filesystem entries (for creating sessions)
	router.get("/entries", async (request, response) => {
		const path =
			typeof request.query.path === "string" ? request.query.path : undefined;
		const machineId =
			typeof request.query.machineId === "string"
				? request.query.machineId
				: undefined;
		if (!path) {
			respondError(response, buildRequestValidationError("path required"), 400);
			return;
		}
		if (!machineId) {
			respondError(
				response,
				buildRequestValidationError("machineId required"),
				400,
			);
			return;
		}

		try {
			const userId = getUserId(request);
			const result = await sessionRouter.getHostFsEntries(
				{ machineId, path },
				userId,
			);
			response.json(result);
		} catch (error) {
			const message = getErrorMessage(error);
			if (message.includes("Machine not found")) {
				respondError(response, buildAuthorizationError(message), 404);
			} else {
				respondError(response, createInternalError("request"));
			}
		}
	});

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
				if (message.includes("Session not found")) {
					respondError(response, buildAuthorizationError(message), 404);
				} else {
					respondError(response, createInternalError("request"));
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
				if (message.includes("Session not found")) {
					respondError(response, buildAuthorizationError(message), 404);
				} else {
					respondError(response, createInternalError("request"));
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
				if (message.includes("Session not found")) {
					respondError(response, buildAuthorizationError(message), 404);
				} else {
					respondError(response, createInternalError("request"));
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
				if (message.includes("Session not found")) {
					respondError(response, buildAuthorizationError(message), 404);
				} else {
					respondError(response, createInternalError("request"));
				}
			}
		},
	);

	// Get git status for session - with authorization check
	router.get(
		"/session/git/status",
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
				const result = await sessionRouter.getGitStatus(sessionId, userId);
				response.json(result);
			} catch (error) {
				const message = getErrorMessage(error);
				if (message.includes("Session not found")) {
					respondError(response, buildAuthorizationError(message), 404);
				} else {
					respondError(response, createInternalError("request"));
				}
			}
		},
	);

	// Get git file diff for session - with authorization check
	router.get(
		"/session/git/diff",
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
				const result = await sessionRouter.getGitFileDiff(
					{ sessionId, path },
					userId,
				);
				response.json(result);
			} catch (error) {
				const message = getErrorMessage(error);
				if (message.includes("Session not found")) {
					respondError(response, buildAuthorizationError(message), 404);
				} else {
					respondError(response, createInternalError("request"));
				}
			}
		},
	);

	return router;
}
