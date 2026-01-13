import express from "express";
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

const buildServiceStatus = () => {
	const sessions = sessionManager.listSessions();
	const state = resolveServiceState(sessions);
	const lastError = sessions.find(
		(session) => session.state === "error",
	)?.lastError;
	return {
		state,
		command: config.opencodeCommand,
		args: config.opencodeArgs,
		lastError,
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
		response.status(500).json({ error: getErrorMessage(error) });
	}
});

app.patch("/acp/session", (request, response) => {
	const { sessionId, title } = request.body ?? {};
	if (typeof sessionId !== "string" || typeof title !== "string") {
		response.status(400).json({ error: "sessionId and title are required" });
		return;
	}

	try {
		const summary = sessionManager.updateTitle(sessionId, title.trim());
		response.json({ sessionId: summary.sessionId, title: summary.title });
	} catch (error) {
		response.status(404).json({ error: getErrorMessage(error) });
	}
});

app.post("/acp/session/close", async (request, response) => {
	const { sessionId } = request.body ?? {};
	if (typeof sessionId !== "string") {
		response.status(400).json({ error: "sessionId is required" });
		return;
	}

	try {
		const closed = await sessionManager.closeSession(sessionId);
		if (!closed) {
			response.status(404).json({ error: "session not found" });
			return;
		}
		response.json({ ok: true });
	} catch (error) {
		response.status(500).json({ error: getErrorMessage(error) });
	}
});

app.post("/acp/message", async (request, response) => {
	const { sessionId, prompt } = request.body ?? {};
	if (typeof sessionId !== "string" || typeof prompt !== "string") {
		response.status(400).json({ error: "sessionId and prompt are required" });
		return;
	}

	const record = sessionManager.getSession(sessionId);
	if (!record) {
		response.status(404).json({ error: "session not found" });
		return;
	}

	const status = record.connection.getStatus();
	if (status.state !== "ready") {
		response.status(409).json({ error: "session not ready" });
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
		response.status(500).json({ error: getErrorMessage(error) });
	}
});

app.get("/acp/session/stream", (request, response) => {
	const sessionId = request.query.sessionId;
	if (typeof sessionId !== "string" || sessionId.length === 0) {
		response.status(400).json({ error: "sessionId is required" });
		return;
	}

	const record = sessionManager.getSession(sessionId);
	if (!record) {
		response.status(404).json({ error: "session not found" });
		return;
	}

	const status = record.connection.getStatus();
	if (status.state !== "ready") {
		response.status(409).json({ error: "session not ready" });
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

	const unsubscribe = record.connection.onSessionUpdate(sendUpdate);
	const ping = setInterval(() => {
		response.write("event: ping\ndata: {}\n\n");
	}, 15000);

	request.on("close", () => {
		clearInterval(ping);
		unsubscribe();
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
