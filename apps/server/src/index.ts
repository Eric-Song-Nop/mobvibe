import express from "express";
import {
	AppError,
	createErrorDetail,
	createInternalError,
	type ErrorDetail,
	withScope,
} from "./acp/errors.js";
import type { OpencodeConnectionState } from "./acp/opencode.js";
import { SessionManager, type SessionSummary } from "./acp/session-manager.js";
import { getServerConfig } from "./config.js";

const config = getServerConfig();

const sessionManager = new SessionManager({
	command: config.opencodeCommand,
	args: config.opencodeArgs,
	client: {
		name: config.clientName,
		version: config.clientVersion,
	},
});

const app = express();

const defaultCorsOrigins = new Set(["http://localhost:5173"]);
const allowedCorsOrigins = new Set([
	...defaultCorsOrigins,
	...config.corsOrigins,
]);

app.use((request, response, next) => {
	const origin = request.headers.origin;
	if (origin && allowedCorsOrigins.has(origin)) {
		response.setHeader("Access-Control-Allow-Origin", origin);
		response.setHeader("Vary", "Origin");
		response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
		response.setHeader(
			"Access-Control-Allow-Headers",
			"Content-Type, Authorization",
		);
	}
	if (request.method === "OPTIONS") {
		response.status(204).end();
		return;
	}
	next();
});

app.use(express.json());

const getErrorMessage = (error: unknown) => {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
};

const respondError = (
	response: express.Response,
	detail: ErrorDetail,
	status = 500,
) => {
	response.status(status).json({ error: detail });
};

const buildRequestValidationError = (message = "请求参数无效") =>
	createErrorDetail({
		code: "REQUEST_VALIDATION_FAILED",
		message,
		retryable: false,
		scope: "request",
	});

const buildSessionNotFoundError = () =>
	createErrorDetail({
		code: "SESSION_NOT_FOUND",
		message: "会话不存在",
		retryable: false,
		scope: "session",
	});

const buildSessionNotReadyError = (scope: "session" | "stream") =>
	createErrorDetail({
		code: "SESSION_NOT_READY",
		message: "会话未就绪",
		retryable: true,
		scope,
	});

const resolveServiceState = (
	sessions: SessionSummary[],
): OpencodeConnectionState => {
	if (sessions.some((session) => session.state === "error")) {
		return "error";
	}
	if (sessions.some((session) => session.state === "connecting")) {
		return "connecting";
	}
	if (sessions.some((session) => session.state === "ready")) {
		return "ready";
	}
	if (sessions.some((session) => session.state === "stopped")) {
		return "stopped";
	}
	return "idle";
};

const resolveServiceError = (sessions: SessionSummary[]) => {
	const sessionError = sessions.find((session) => session.error)?.error;
	if (!sessionError) {
		return undefined;
	}
	return withScope(sessionError, "service");
};

const buildServiceStatus = () => {
	const sessions = sessionManager.listSessions();
	const state = resolveServiceState(sessions);
	return {
		state,
		command: config.opencodeCommand,
		args: config.opencodeArgs,
		error: resolveServiceError(sessions),
		sessionId: sessions.at(0)?.sessionId,
		pid: sessions.at(0)?.pid,
	};
};

app.get("/health", (_request, response) => {
	response.json({ ok: true });
});

app.get("/acp/opencode", (_request, response) => {
	response.json(buildServiceStatus());
});

app.get("/acp/sessions", (_request, response) => {
	response.json({ sessions: sessionManager.listSessions() });
});

app.post("/acp/session", async (request, response) => {
	try {
		const { cwd, title } = request.body ?? {};
		const session = await sessionManager.createSession({
			cwd: typeof cwd === "string" ? cwd : undefined,
			title:
				typeof title === "string" && title.trim().length > 0
					? title.trim()
					: undefined,
		});
		response.json(session);
	} catch (error) {
		if (error instanceof AppError) {
			respondError(response, error.detail, error.status);
			return;
		}
		respondError(
			response,
			createInternalError("service", getErrorMessage(error)),
		);
	}
});

app.patch("/acp/session", (request, response) => {
	const { sessionId, title } = request.body ?? {};
	if (typeof sessionId !== "string" || typeof title !== "string") {
		respondError(
			response,
			buildRequestValidationError("sessionId 和 title 必填"),
			400,
		);
		return;
	}

	try {
		const summary = sessionManager.updateTitle(sessionId, title.trim());
		response.json({ sessionId: summary.sessionId, title: summary.title });
	} catch (error) {
		if (error instanceof AppError) {
			respondError(response, error.detail, error.status);
			return;
		}
		respondError(
			response,
			createInternalError("session", getErrorMessage(error)),
			500,
		);
	}
});

app.post("/acp/session/close", async (request, response) => {
	const { sessionId } = request.body ?? {};
	if (typeof sessionId !== "string") {
		respondError(response, buildRequestValidationError("sessionId 必填"), 400);
		return;
	}

	try {
		const closed = await sessionManager.closeSession(sessionId);
		if (!closed) {
			respondError(response, buildSessionNotFoundError(), 404);
			return;
		}
		response.json({ ok: true });
	} catch (error) {
		respondError(
			response,
			createInternalError("session", getErrorMessage(error)),
		);
	}
});

app.post("/acp/message", async (request, response) => {
	const { sessionId, prompt } = request.body ?? {};
	if (typeof sessionId !== "string" || typeof prompt !== "string") {
		respondError(
			response,
			buildRequestValidationError("sessionId 和 prompt 必填"),
			400,
		);
		return;
	}

	const record = sessionManager.getSession(sessionId);
	if (!record) {
		respondError(response, buildSessionNotFoundError(), 404);
		return;
	}

	const status = record.connection.getStatus();
	if (status.state !== "ready") {
		respondError(response, buildSessionNotReadyError("session"), 409);
		return;
	}

	try {
		sessionManager.touchSession(sessionId);
		const result = await record.connection.prompt(sessionId, [
			{ type: "text", text: prompt },
		]);
		sessionManager.touchSession(sessionId);
		response.json({ stopReason: result.stopReason });
	} catch (error) {
		respondError(
			response,
			createInternalError("session", getErrorMessage(error)),
		);
	}
});

app.get("/acp/session/stream", (request, response) => {
	const sessionId = request.query.sessionId;
	if (typeof sessionId !== "string" || sessionId.length === 0) {
		respondError(response, buildRequestValidationError("sessionId 必填"), 400);
		return;
	}

	const record = sessionManager.getSession(sessionId);
	if (!record) {
		respondError(response, buildSessionNotFoundError(), 404);
		return;
	}

	const status = record.connection.getStatus();
	if (status.state !== "ready") {
		respondError(response, buildSessionNotReadyError("stream"), 409);
		return;
	}

	response.writeHead(200, {
		"Content-Type": "text/event-stream",
		"Cache-Control": "no-cache",
		Connection: "keep-alive",
	});
	response.write("event: ready\ndata: {}\n\n");

	const sendUpdate = (notification: { sessionId: string }) => {
		if (notification.sessionId !== sessionId) {
			return;
		}
		response.write(
			`event: session_update\ndata: ${JSON.stringify(notification)}\n\n`,
		);
	};

	const sendError = (detail: ErrorDetail) => {
		response.write(
			`event: session_error\ndata: ${JSON.stringify({
				sessionId,
				error: withScope(detail, "stream"),
			})}\n\n`,
		);
	};

	const unsubscribe = record.connection.onSessionUpdate(sendUpdate);
	const unsubscribeStatus = record.connection.onStatusChange((nextStatus) => {
		if (nextStatus.state === "error" && nextStatus.error) {
			sendError(nextStatus.error);
		}
	});
	const ping = setInterval(() => {
		response.write("event: ping\ndata: {}\n\n");
	}, 15000);

	request.on("close", () => {
		clearInterval(ping);
		unsubscribe();
		unsubscribeStatus();
	});
});

const server = app.listen(config.port, () => {
	console.log(`[mobvibe] backend listening on :${config.port}`);
});

const stopServer = async () =>
	new Promise<void>((resolve, reject) => {
		server.close((error) => {
			if (error) {
				reject(error);
				return;
			}
			resolve();
		});
	});

const shutdown = async (signal: string) => {
	console.log(`[mobvibe] received ${signal}, shutting down`);
	try {
		await sessionManager.closeAll();
		await stopServer();
	} catch (error) {
		console.error("[mobvibe] shutdown error", error);
	} finally {
		process.exit(0);
	}
};

process.on("SIGINT", () => {
	void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
	void shutdown("SIGTERM");
});
