import { randomUUID } from "node:crypto";
import type { SessionSummary } from "@mobvibe/shared";
import {
	createErrorDetail,
	createInternalError,
	type ErrorDetail,
} from "@mobvibe/shared";
import type { Router } from "express";
import { logger } from "../lib/logger.js";
import {
	type AuthenticatedRequest,
	getUserId,
	requireAuth,
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
	// Require authentication on all session routes
	router.use(requireAuth);

	// List sessions - returns only user's sessions
	router.get("/sessions", (request: AuthenticatedRequest, response) => {
		const userId = getUserId(request);
		if (!userId) {
			respondError(response, buildAuthorizationError(), 401);
			return;
		}
		const sessions = cliRegistry.getSessionsForUser(userId);
		response.json({ sessions });
	});

	// List available backends - returns only user's backends
	router.get("/backends", (request: AuthenticatedRequest, response) => {
		const userId = getUserId(request);
		if (!userId) {
			respondError(response, buildAuthorizationError(), 401);
			return;
		}
		const { backends } = cliRegistry.getBackendsForUser(userId);
		response.json({ backends });
	});

	// Create session - routes to user's machine if authenticated
	router.post("/session", async (request: AuthenticatedRequest, response) => {
		const userId = getUserId(request);
		try {
			const { cwd, title, backendId, machineId } = request.body ?? {};

			if (typeof backendId !== "string" || backendId.trim().length === 0) {
				respondError(
					response,
					buildRequestValidationError("backendId required"),
					400,
				);
				return;
			}

			logger.info({ userId, backendId, machineId }, "session_create_request");

			const session = await sessionRouter.createSession(
				{
					cwd:
						typeof cwd === "string" && cwd.trim().length > 0 ? cwd : undefined,
					title:
						typeof title === "string" && title.trim().length > 0
							? title.trim()
							: undefined,
					backendId,
					machineId:
						typeof machineId === "string" && machineId.trim().length > 0
							? machineId.trim()
							: undefined,
				},
				userId,
			);
			logger.info(
				{ sessionId: session.sessionId, userId },
				"session_create_success",
			);
			response.json(session);
		} catch (error) {
			const message = getErrorMessage(error);
			logger.error({ err: error, userId }, "session_create_error");
			if (
				message.includes("No CLI connected") ||
				message.includes("Machine not found")
			) {
				respondError(response, buildAuthorizationError(message), 403);
			} else {
				respondError(response, createInternalError("service"));
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
				logger.info({ sessionId, userId }, "session_close_request");
				await sessionRouter.closeSession({ sessionId }, userId);
				logger.info({ sessionId, userId }, "session_close_success");
				response.json({ ok: true });
			} catch (error) {
				const message = getErrorMessage(error);
				logger.error({ err: error, sessionId }, "session_close_error");
				if (message.includes("Session not found")) {
					respondError(response, buildAuthorizationError(message), 404);
				} else {
					respondError(response, createInternalError("session"));
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
				logger.info({ sessionId, userId }, "session_cancel_request");
				await sessionRouter.cancelSession({ sessionId }, userId);
				logger.info({ sessionId, userId }, "session_cancel_success");
				response.json({ ok: true });
			} catch (error) {
				const message = getErrorMessage(error);
				logger.error({ err: error, sessionId }, "session_cancel_error");
				if (message.includes("Session not found")) {
					respondError(response, buildAuthorizationError(message), 404);
				} else {
					respondError(response, createInternalError("session"));
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
				logger.info({ sessionId, modeId, userId }, "session_mode_request");
				const session = await sessionRouter.setSessionMode(
					{ sessionId, modeId },
					userId,
				);
				logger.info({ sessionId, modeId, userId }, "session_mode_success");
				response.json(session);
			} catch (error) {
				const message = getErrorMessage(error);
				logger.error({ err: error, sessionId, modeId }, "session_mode_error");
				if (message.includes("Session not found")) {
					respondError(response, buildAuthorizationError(message), 404);
				} else {
					respondError(response, createInternalError("session"));
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
				logger.info({ sessionId, modelId, userId }, "session_model_request");
				const session = await sessionRouter.setSessionModel(
					{ sessionId, modelId },
					userId,
				);
				logger.info({ sessionId, modelId, userId }, "session_model_success");
				response.json(session);
			} catch (error) {
				const message = getErrorMessage(error);
				logger.error({ err: error, sessionId, modelId }, "session_model_error");
				if (message.includes("Session not found")) {
					respondError(response, buildAuthorizationError(message), 404);
				} else {
					respondError(response, createInternalError("session"));
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
		logger.debug({ sessionId, messageId }, "message_id_created");
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
			const requestId = (
				request as AuthenticatedRequest & {
					requestId?: string;
				}
			).requestId;
			logger.info(
				{ sessionId, userId, promptBlocks: prompt.length, requestId },
				"message_send_request",
			);
			logger.debug(
				{ sessionId, userId, promptBlocks: prompt.length, requestId },
				"message_send_request_debug",
			);
			logger.debug(
				{
					sessionId,
					userId,
					requestId,
					route: "/acp/message",
					promptBlocks: prompt.length,
					requestHasAuth: Boolean(request.headers.authorization),
				},
				"message_send_http_context",
			);

			const result = await sessionRouter.sendMessage(
				{ sessionId, prompt },
				userId,
			);
			logger.debug(
				{
					sessionId,
					userId,
					requestId,
					stopReason: result.stopReason,
				},
				"message_send_rpc_complete",
			);
			logger.info(
				{
					sessionId,
					userId,
					stopReason: result.stopReason,
					requestId,
				},
				"message_send_success",
			);
			logger.debug(
				{
					sessionId,
					userId,
					requestId,
					stopReason: result.stopReason,
				},
				"message_send_complete_debug",
			);
			response.json(result);
		} catch (error) {
			const message = getErrorMessage(error);
			const requestId = (
				request as AuthenticatedRequest & {
					requestId?: string;
				}
			).requestId;
			logger.error(
				{
					err: error,
					sessionId,
					userId: getUserId(request),
					promptBlocks: Array.isArray(prompt) ? prompt.length : undefined,
					requestId,
				},
				"message_send_error",
			);
			if (message.includes("Session not found")) {
				respondError(response, buildAuthorizationError(message), 404);
			} else {
				respondError(response, createInternalError("session"));
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
				logger.info(
					{ sessionId, requestId, outcome, userId },
					"permission_decision_request",
				);
				await sessionRouter.sendPermissionDecision(
					{ sessionId, requestId, outcome },
					userId,
				);
				logger.info(
					{ sessionId, requestId, outcome, userId },
					"permission_decision_success",
				);
				response.json({ ok: true });
			} catch (error) {
				const message = getErrorMessage(error);
				logger.error(
					{ err: error, sessionId, requestId },
					"permission_decision_error",
				);
				if (message.includes("Session not found")) {
					respondError(response, buildAuthorizationError(message), 404);
				} else {
					respondError(response, createInternalError("session"));
				}
			}
		},
	);

	// Discover sessions from ACP agent
	router.get(
		"/sessions/discover",
		async (request: AuthenticatedRequest, response) => {
			const userId = getUserId(request);
			const { machineId, cwd, cursor, backendId } = request.query ?? {};
			const requestedBackendId =
				typeof backendId === "string" && backendId.trim().length > 0
					? backendId.trim()
					: undefined;

			if (!requestedBackendId) {
				respondError(
					response,
					buildRequestValidationError("backendId required"),
					400,
				);
				return;
			}

			try {
				logger.info(
					{ userId, machineId, cwd, backendId: requestedBackendId },
					"sessions_discover_request",
				);
				const result = await sessionRouter.discoverSessions(
					typeof machineId === "string" ? machineId : undefined,
					typeof cwd === "string" ? cwd : undefined,
					userId,
					typeof cursor === "string" ? cursor : undefined,
					requestedBackendId,
				);
				if (typeof machineId === "string" && userId) {
					const cli = cliRegistry.getCliByMachineIdForUser(machineId, userId);
					if (cli) {
						const discoveredBackendLabel =
							cli.backends.find(
								(backend) => backend.backendId === requestedBackendId,
							)?.backendLabel ?? requestedBackendId;
						const summaries: SessionSummary[] = result.sessions.map((s) => ({
							sessionId: s.sessionId,
							title: s.title ?? `Session ${s.sessionId.slice(0, 8)}`,
							cwd: s.cwd,
							updatedAt: s.updatedAt ?? new Date().toISOString(),
							createdAt: s.updatedAt ?? new Date().toISOString(),
							backendId: requestedBackendId,
							backendLabel: discoveredBackendLabel,
							machineId: cli.machineId,
						}));
						cliRegistry.addDiscoveredSessionsForMachine(
							cli.machineId,
							summaries,
							userId,
						);
					}
				}
				logger.info(
					{
						userId,
						sessionCount: result.sessions.length,
						nextCursor: result.nextCursor,
					},
					"sessions_discover_success",
				);
				response.json(result);
			} catch (error) {
				const message = getErrorMessage(error);
				logger.error({ err: error, userId }, "sessions_discover_error");
				if (
					message.includes("Machine not found") ||
					message.includes("No CLI connected")
				) {
					respondError(response, buildAuthorizationError(message), 503);
				} else {
					respondError(response, createInternalError("service"));
				}
			}
		},
	);

	// Load historical session from ACP agent
	router.post(
		"/session/load",
		async (request: AuthenticatedRequest, response) => {
			const { sessionId, cwd, backendId, machineId } = request.body ?? {};
			if (typeof sessionId !== "string" || typeof cwd !== "string") {
				respondError(
					response,
					buildRequestValidationError("sessionId and cwd required"),
					400,
				);
				return;
			}
			if (typeof backendId !== "string" || backendId.trim().length === 0) {
				respondError(
					response,
					buildRequestValidationError("backendId required"),
					400,
				);
				return;
			}

			try {
				const userId = getUserId(request);
				logger.info(
					{ sessionId, cwd, backendId, machineId, userId },
					"session_load_request",
				);
				const session = await sessionRouter.loadSession(
					{
						sessionId,
						cwd,
						backendId,
						machineId: typeof machineId === "string" ? machineId : undefined,
					},
					userId,
				);
				logger.info({ sessionId, userId }, "session_load_success");
				response.json(session);
			} catch (error) {
				const message = getErrorMessage(error);
				logger.error({ err: error, sessionId }, "session_load_error");
				if (
					message.includes("Machine not found") ||
					message.includes("No CLI connected")
				) {
					respondError(response, buildAuthorizationError(message), 503);
				} else if (message.includes("does not support")) {
					respondError(
						response,
						createErrorDetail({
							code: "CAPABILITY_NOT_SUPPORTED",
							message,
							retryable: false,
							scope: "session",
						}),
						409,
					);
				} else {
					respondError(response, createInternalError("session"));
				}
			}
		},
	);

	// Reload historical session from ACP agent
	router.post(
		"/session/reload",
		async (request: AuthenticatedRequest, response) => {
			const { sessionId, cwd, backendId, machineId } = request.body ?? {};
			if (typeof sessionId !== "string" || typeof cwd !== "string") {
				respondError(
					response,
					buildRequestValidationError("sessionId and cwd required"),
					400,
				);
				return;
			}
			if (typeof backendId !== "string" || backendId.trim().length === 0) {
				respondError(
					response,
					buildRequestValidationError("backendId required"),
					400,
				);
				return;
			}

			try {
				const userId = getUserId(request);
				logger.info(
					{ sessionId, cwd, backendId, machineId, userId },
					"session_reload_request",
				);
				const session = await sessionRouter.reloadSession(
					{
						sessionId,
						cwd,
						backendId,
						machineId: typeof machineId === "string" ? machineId : undefined,
					},
					userId,
				);
				logger.info({ sessionId, userId }, "session_reload_success");
				response.json(session);
			} catch (error) {
				const message = getErrorMessage(error);
				logger.error({ err: error, sessionId }, "session_reload_error");
				if (
					message.includes("Machine not found") ||
					message.includes("No CLI connected")
				) {
					respondError(response, buildAuthorizationError(message), 503);
				} else if (message.includes("does not support")) {
					respondError(
						response,
						createErrorDetail({
							code: "CAPABILITY_NOT_SUPPORTED",
							message,
							retryable: false,
							scope: "session",
						}),
						409,
					);
				} else {
					respondError(response, createInternalError("session"));
				}
			}
		},
	);

	// Get session events for backfill
	router.get(
		"/session/events",
		async (request: AuthenticatedRequest, response) => {
			const { sessionId, revision, afterSeq, limit } = request.query ?? {};
			if (
				typeof sessionId !== "string" ||
				typeof revision !== "string" ||
				typeof afterSeq !== "string"
			) {
				respondError(
					response,
					buildRequestValidationError(
						"sessionId, revision, and afterSeq required",
					),
					400,
				);
				return;
			}

			const revisionNum = Number.parseInt(revision, 10);
			const afterSeqNum = Number.parseInt(afterSeq, 10);
			const limitNum =
				typeof limit === "string" ? Number.parseInt(limit, 10) : undefined;

			if (Number.isNaN(revisionNum) || Number.isNaN(afterSeqNum)) {
				respondError(
					response,
					buildRequestValidationError("revision and afterSeq must be numbers"),
					400,
				);
				return;
			}

			try {
				const userId = getUserId(request);
				logger.debug(
					{ sessionId, revision: revisionNum, afterSeq: afterSeqNum, userId },
					"session_events_request",
				);
				const result = await sessionRouter.getSessionEvents(
					{
						sessionId,
						revision: revisionNum,
						afterSeq: afterSeqNum,
						limit: limitNum,
					},
					userId,
				);
				logger.debug(
					{
						sessionId,
						eventCount: result.events.length,
						hasMore: result.hasMore,
						userId,
					},
					"session_events_success",
				);
				response.json(result);
			} catch (error) {
				const message = getErrorMessage(error);
				logger.error({ err: error, sessionId }, "session_events_error");
				if (message.includes("Session not found")) {
					respondError(
						response,
						createErrorDetail({
							code: "SESSION_NOT_FOUND",
							message,
							retryable: false,
							scope: "session",
						}),
						404,
					);
				} else {
					respondError(response, createInternalError("session"));
				}
			}
		},
	);

	return router;
}
