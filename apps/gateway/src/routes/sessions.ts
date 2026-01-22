import { randomUUID } from "node:crypto";
import {
	type AcpBackendId,
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
import type { CliRegistry } from "../services/cli-registry.js";
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

export function setupSessionRoutes(
	router: Router,
	cliRegistry: CliRegistry,
	sessionRouter: SessionRouter,
) {
	// Apply optional auth to all routes - userId will be available if authenticated
	router.use(optionalAuth);

	// List sessions - returns only user's sessions if authenticated
	router.get("/sessions", (request: AuthenticatedRequest, response) => {
		const userId = getUserId(request);
		const sessions = userId
			? cliRegistry.getSessionsForUser(userId)
			: cliRegistry.getAllSessions();
		response.json({ sessions });
	});

	// List available backends - returns only user's backends if authenticated
	router.get("/backends", (request: AuthenticatedRequest, response) => {
		const userId = getUserId(request);
		const { backends, defaultBackendId } =
			cliRegistry.getBackendsForUser(userId);
		response.json({ backends, defaultBackendId });
	});

	// Create session - routes to user's machine if authenticated
	router.post("/session", async (request: AuthenticatedRequest, response) => {
		try {
			const { cwd, title, backendId } = request.body ?? {};
			const userId = getUserId(request);

			const session = await sessionRouter.createSession(
				{
					cwd:
						typeof cwd === "string" && cwd.trim().length > 0 ? cwd : undefined,
					title:
						typeof title === "string" && title.trim().length > 0
							? title.trim()
							: undefined,
					backendId:
						typeof backendId === "string"
							? (backendId as AcpBackendId)
							: undefined,
				},
				userId,
			);
			response.json(session);
		} catch (error) {
			const message = getErrorMessage(error);
			if (
				message.includes("Not authorized") ||
				message.includes("No CLI connected for this user")
			) {
				respondError(response, buildAuthorizationError(message), 403);
			} else {
				respondError(response, createInternalError("service", message));
			}
		}
	});

	// Close session - with authorization check
	router.post(
		"/session/close",
		async (request: AuthenticatedRequest, response) => {
			const { sessionId } = request.body ?? {};
			if (typeof sessionId !== "string") {
				respondError(
					response,
					buildRequestValidationError("sessionId required"),
					400,
				);
				return;
			}

			try {
				const userId = getUserId(request);
				await sessionRouter.closeSession({ sessionId }, userId);
				response.json({ ok: true });
			} catch (error) {
				const message = getErrorMessage(error);
				if (message.includes("Not authorized")) {
					respondError(response, buildAuthorizationError(message), 403);
				} else {
					respondError(response, createInternalError("session", message));
				}
			}
		},
	);

	// Cancel session - with authorization check
	router.post(
		"/session/cancel",
		async (request: AuthenticatedRequest, response) => {
			const { sessionId } = request.body ?? {};
			if (typeof sessionId !== "string") {
				respondError(
					response,
					buildRequestValidationError("sessionId required"),
					400,
				);
				return;
			}

			try {
				const userId = getUserId(request);
				await sessionRouter.cancelSession({ sessionId }, userId);
				response.json({ ok: true });
			} catch (error) {
				const message = getErrorMessage(error);
				if (message.includes("Not authorized")) {
					respondError(response, buildAuthorizationError(message), 403);
				} else {
					respondError(response, createInternalError("session", message));
				}
			}
		},
	);

	// Set session mode - with authorization check
	router.post(
		"/session/mode",
		async (request: AuthenticatedRequest, response) => {
			const { sessionId, modeId } = request.body ?? {};
			if (typeof sessionId !== "string" || typeof modeId !== "string") {
				respondError(
					response,
					buildRequestValidationError("sessionId and modeId required"),
					400,
				);
				return;
			}

			try {
				const userId = getUserId(request);
				const session = await sessionRouter.setSessionMode(
					{ sessionId, modeId },
					userId,
				);
				response.json(session);
			} catch (error) {
				const message = getErrorMessage(error);
				if (message.includes("Not authorized")) {
					respondError(response, buildAuthorizationError(message), 403);
				} else {
					respondError(response, createInternalError("session", message));
				}
			}
		},
	);

	// Set session model - with authorization check
	router.post(
		"/session/model",
		async (request: AuthenticatedRequest, response) => {
			const { sessionId, modelId } = request.body ?? {};
			if (typeof sessionId !== "string" || typeof modelId !== "string") {
				respondError(
					response,
					buildRequestValidationError("sessionId and modelId required"),
					400,
				);
				return;
			}

			try {
				const userId = getUserId(request);
				const session = await sessionRouter.setSessionModel(
					{ sessionId, modelId },
					userId,
				);
				response.json(session);
			} catch (error) {
				const message = getErrorMessage(error);
				if (message.includes("Not authorized")) {
					respondError(response, buildAuthorizationError(message), 403);
				} else {
					respondError(response, createInternalError("session", message));
				}
			}
		},
	);

	// Generate message ID - for optimistic UI updates
	router.post("/message/id", (request: AuthenticatedRequest, response) => {
		const { sessionId } = request.body ?? {};
		if (typeof sessionId !== "string") {
			respondError(
				response,
				buildRequestValidationError("sessionId required"),
				400,
			);
			return;
		}

		// Generate a unique message ID
		const messageId = randomUUID();
		response.json({ messageId });
	});

	// Send message - with authorization check
	router.post("/message", async (request: AuthenticatedRequest, response) => {
		const { sessionId, prompt } = request.body ?? {};
		if (typeof sessionId !== "string" || !Array.isArray(prompt)) {
			respondError(
				response,
				buildRequestValidationError("sessionId and prompt required"),
				400,
			);
			return;
		}

		try {
			const userId = getUserId(request);
			const result = await sessionRouter.sendMessage(
				{ sessionId, prompt },
				userId,
			);
			response.json(result);
		} catch (error) {
			const message = getErrorMessage(error);
			if (message.includes("Not authorized")) {
				respondError(response, buildAuthorizationError(message), 403);
			} else {
				respondError(response, createInternalError("session", message));
			}
		}
	});

	// Permission decision - with authorization check
	router.post(
		"/permission/decision",
		async (request: AuthenticatedRequest, response) => {
			const { sessionId, requestId, outcome } = request.body ?? {};
			if (typeof sessionId !== "string" || typeof requestId !== "string") {
				respondError(
					response,
					buildRequestValidationError("sessionId and requestId required"),
					400,
				);
				return;
			}

			try {
				const userId = getUserId(request);
				await sessionRouter.sendPermissionDecision(
					{ sessionId, requestId, outcome },
					userId,
				);
				response.json({ ok: true });
			} catch (error) {
				const message = getErrorMessage(error);
				if (message.includes("Not authorized")) {
					respondError(response, buildAuthorizationError(message), 403);
				} else {
					respondError(response, createInternalError("session", message));
				}
			}
		},
	);

	return router;
}
