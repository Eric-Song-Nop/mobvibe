import {
	type AcpBackendId,
	createErrorDetail,
	createInternalError,
	type ErrorDetail,
} from "@remote-claude/shared";
import type { Router } from "express";
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

export function setupSessionRoutes(
	router: Router,
	cliRegistry: CliRegistry,
	sessionRouter: SessionRouter,
) {
	// List sessions
	router.get("/sessions", (_request, response) => {
		const sessions = cliRegistry.getAllSessions();
		response.json({ sessions });
	});

	// Create session
	router.post("/session", async (request, response) => {
		try {
			const { cwd, title, backendId } = request.body ?? {};
			const session = await sessionRouter.createSession({
				cwd: typeof cwd === "string" && cwd.trim().length > 0 ? cwd : undefined,
				title:
					typeof title === "string" && title.trim().length > 0
						? title.trim()
						: undefined,
				backendId:
					typeof backendId === "string"
						? (backendId as AcpBackendId)
						: undefined,
			});
			response.json(session);
		} catch (error) {
			respondError(
				response,
				createInternalError("service", getErrorMessage(error)),
			);
		}
	});

	// Close session
	router.post("/session/close", async (request, response) => {
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
			await sessionRouter.closeSession({ sessionId });
			response.json({ ok: true });
		} catch (error) {
			respondError(
				response,
				createInternalError("session", getErrorMessage(error)),
			);
		}
	});

	// Cancel session
	router.post("/session/cancel", async (request, response) => {
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
			await sessionRouter.cancelSession({ sessionId });
			response.json({ ok: true });
		} catch (error) {
			respondError(
				response,
				createInternalError("session", getErrorMessage(error)),
			);
		}
	});

	// Set session mode
	router.post("/session/mode", async (request, response) => {
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
			const session = await sessionRouter.setSessionMode({ sessionId, modeId });
			response.json(session);
		} catch (error) {
			respondError(
				response,
				createInternalError("session", getErrorMessage(error)),
			);
		}
	});

	// Set session model
	router.post("/session/model", async (request, response) => {
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
			const session = await sessionRouter.setSessionModel({
				sessionId,
				modelId,
			});
			response.json(session);
		} catch (error) {
			respondError(
				response,
				createInternalError("session", getErrorMessage(error)),
			);
		}
	});

	// Send message
	router.post("/message", async (request, response) => {
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
			const result = await sessionRouter.sendMessage({ sessionId, prompt });
			response.json(result);
		} catch (error) {
			respondError(
				response,
				createInternalError("session", getErrorMessage(error)),
			);
		}
	});

	// Permission decision
	router.post("/permission/decision", async (request, response) => {
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
			await sessionRouter.sendPermissionDecision({
				sessionId,
				requestId,
				outcome,
			});
			response.json({ ok: true });
		} catch (error) {
			respondError(
				response,
				createInternalError("session", getErrorMessage(error)),
			);
		}
	});

	return router;
}
