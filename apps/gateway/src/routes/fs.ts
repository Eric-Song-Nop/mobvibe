import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	createErrorDetail,
	createInternalError,
	type ErrorDetail,
} from "@mobvibe/shared";
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

	// Get local filesystem roots (for creating sessions)
	router.get("/roots", (_request, response) => {
		try {
			const homePath = homedir();
			// On Unix, root is /; on Windows, list drive letters
			const roots =
				process.platform === "win32"
					? ["C:\\", "D:\\", "E:\\"].filter((drive) => {
							try {
								statSync(drive);
								return true;
							} catch {
								return false;
							}
						})
					: ["/"];
			response.json({ roots, homePath });
		} catch (error) {
			const message = getErrorMessage(error);
			respondError(response, createInternalError("request", message));
		}
	});

	// Get local filesystem entries (for creating sessions)
	router.get("/entries", (request, response) => {
		const path =
			typeof request.query.path === "string" ? request.query.path : undefined;
		if (!path) {
			respondError(response, buildRequestValidationError("path required"), 400);
			return;
		}

		try {
			const entries = readdirSync(path, { withFileTypes: true })
				.filter((entry) => {
					// Filter hidden files/folders (starting with .)
					if (entry.name.startsWith(".")) {
						return false;
					}
					return true;
				})
				.map((entry) => ({
					name: entry.name,
					path: join(path, entry.name),
					isDirectory: entry.isDirectory(),
				}))
				.sort((a, b) => {
					// Directories first, then alphabetically
					if (a.isDirectory !== b.isDirectory) {
						return a.isDirectory ? -1 : 1;
					}
					return a.name.localeCompare(b.name);
				});
			response.json({ entries });
		} catch (error) {
			const message = getErrorMessage(error);
			respondError(response, createInternalError("request", message));
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
