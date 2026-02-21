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
		const userId = getUserId(request);
		if (!userId) {
			respondError(response, buildAuthorizationError(), 401);
			return;
		}
		try {
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

		const userId = getUserId(request);
		if (!userId) {
			respondError(response, buildAuthorizationError(), 401);
			return;
		}
		try {
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

			const userId = getUserId(request);
			if (!userId) {
				respondError(response, buildAuthorizationError(), 401);
				return;
			}
			try {
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

			const userId = getUserId(request);
			if (!userId) {
				respondError(response, buildAuthorizationError(), 401);
				return;
			}
			try {
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

			const userId = getUserId(request);
			if (!userId) {
				respondError(response, buildAuthorizationError(), 401);
				return;
			}
			try {
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

			const userId = getUserId(request);
			if (!userId) {
				respondError(response, buildAuthorizationError(), 401);
				return;
			}
			try {
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

			const userId = getUserId(request);
			if (!userId) {
				respondError(response, buildAuthorizationError(), 401);
				return;
			}
			try {
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

			const userId = getUserId(request);
			if (!userId) {
				respondError(response, buildAuthorizationError(), 401);
				return;
			}
			try {
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

	// Get git log for session
	router.get(
		"/session/git/log",
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
			const userId = getUserId(request);
			if (!userId) {
				respondError(response, buildAuthorizationError(), 401);
				return;
			}
			try {
				const maxCount = request.query.maxCount
					? Number.parseInt(String(request.query.maxCount), 10)
					: undefined;
				const skip = request.query.skip
					? Number.parseInt(String(request.query.skip), 10)
					: undefined;
				const path =
					typeof request.query.path === "string"
						? request.query.path
						: undefined;
				const author =
					typeof request.query.author === "string"
						? request.query.author
						: undefined;
				const search =
					typeof request.query.search === "string"
						? request.query.search
						: undefined;
				const result = await sessionRouter.getGitLog(
					{ sessionId, maxCount, skip, path, author, search },
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

	// Get git commit detail
	router.get(
		"/session/git/show",
		async (request: AuthenticatedRequest, response) => {
			const sessionId =
				typeof request.query.sessionId === "string"
					? request.query.sessionId
					: undefined;
			const hash =
				typeof request.query.hash === "string" ? request.query.hash : undefined;
			if (!sessionId || !hash) {
				respondError(
					response,
					buildRequestValidationError("sessionId and hash required"),
					400,
				);
				return;
			}
			const userId = getUserId(request);
			if (!userId) {
				respondError(response, buildAuthorizationError(), 401);
				return;
			}
			try {
				const result = await sessionRouter.getGitShow(
					{ sessionId, hash },
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

	// Get git blame for file
	router.get(
		"/session/git/blame",
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
			const userId = getUserId(request);
			if (!userId) {
				respondError(response, buildAuthorizationError(), 401);
				return;
			}
			try {
				const startLine = request.query.startLine
					? Number.parseInt(String(request.query.startLine), 10)
					: undefined;
				const endLine = request.query.endLine
					? Number.parseInt(String(request.query.endLine), 10)
					: undefined;
				const result = await sessionRouter.getGitBlame(
					{ sessionId, path, startLine, endLine },
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

	// Get git branches
	router.get(
		"/session/git/branches",
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
			const userId = getUserId(request);
			if (!userId) {
				respondError(response, buildAuthorizationError(), 401);
				return;
			}
			try {
				const result = await sessionRouter.getGitBranches(
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

	// Get git stash list
	router.get(
		"/session/git/stash",
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
			const userId = getUserId(request);
			if (!userId) {
				respondError(response, buildAuthorizationError(), 401);
				return;
			}
			try {
				const result = await sessionRouter.getGitStashList(
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

	// Get extended git status
	router.get(
		"/session/git/status-extended",
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
			const userId = getUserId(request);
			if (!userId) {
				respondError(response, buildAuthorizationError(), 401);
				return;
			}
			try {
				const result = await sessionRouter.getGitStatusExtended(
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

	// Search git log
	router.get(
		"/session/git/search-log",
		async (request: AuthenticatedRequest, response) => {
			const sessionId =
				typeof request.query.sessionId === "string"
					? request.query.sessionId
					: undefined;
			const query =
				typeof request.query.query === "string"
					? request.query.query
					: undefined;
			const type =
				typeof request.query.type === "string" ? request.query.type : undefined;
			if (!sessionId || !query || !type) {
				respondError(
					response,
					buildRequestValidationError("sessionId, query, and type required"),
					400,
				);
				return;
			}
			const userId = getUserId(request);
			if (!userId) {
				respondError(response, buildAuthorizationError(), 401);
				return;
			}
			try {
				const maxCount = request.query.maxCount
					? Number.parseInt(String(request.query.maxCount), 10)
					: undefined;
				const result = await sessionRouter.getGitSearchLog(
					{
						sessionId,
						query,
						type: type as "message" | "diff" | "author",
						maxCount,
					},
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

	// Get git file history
	router.get(
		"/session/git/file-history",
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
			const userId = getUserId(request);
			if (!userId) {
				respondError(response, buildAuthorizationError(), 401);
				return;
			}
			try {
				const maxCount = request.query.maxCount
					? Number.parseInt(String(request.query.maxCount), 10)
					: undefined;
				const result = await sessionRouter.getGitFileHistory(
					{ sessionId, path, maxCount },
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

	// Git grep (search file contents)
	router.get(
		"/session/git/grep",
		async (request: AuthenticatedRequest, response) => {
			const sessionId =
				typeof request.query.sessionId === "string"
					? request.query.sessionId
					: undefined;
			const query =
				typeof request.query.query === "string"
					? request.query.query
					: undefined;
			if (!sessionId || !query) {
				respondError(
					response,
					buildRequestValidationError("sessionId and query required"),
					400,
				);
				return;
			}
			const userId = getUserId(request);
			if (!userId) {
				respondError(response, buildAuthorizationError(), 401);
				return;
			}
			try {
				const caseSensitive = request.query.caseSensitive === "true";
				const regex = request.query.regex === "true";
				const glob =
					typeof request.query.glob === "string"
						? request.query.glob
						: undefined;
				const result = await sessionRouter.getGitGrep(
					{ sessionId, query, caseSensitive, regex, glob },
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
