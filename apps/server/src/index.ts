import express from "express";
import { OpencodeConnection } from "./acp/opencode.js";
import { getServerConfig } from "./config.js";

const config = getServerConfig();

const opencode = new OpencodeConnection({
	command: config.opencodeCommand,
	args: config.opencodeArgs,
	client: {
		name: config.clientName,
		version: config.clientVersion,
	},
});

const app = express();

app.use(express.json());

const getErrorMessage = (error: unknown) => {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
};

app.get("/health", (_request, response) => {
	response.json({ ok: true });
});

app.get("/acp/opencode", (_request, response) => {
	response.json(opencode.getStatus());
});

app.post("/acp/session", async (request, response) => {
	try {
		const { cwd } = request.body ?? {};
		const sessionId = await opencode.createSession({
			cwd: typeof cwd === "string" ? cwd : undefined,
		});
		response.json({ sessionId });
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

	try {
		const result = await opencode.prompt(sessionId, [
			{ type: "text", text: prompt },
		]);
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

	const unsubscribe = opencode.onSessionUpdate(sendUpdate);
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

const startOpencode = async () => {
	try {
		await opencode.connect();
		console.log("[mobvibe] opencode ACP connected");
	} catch (error) {
		console.error("[mobvibe] opencode ACP connection failed", error);
	}
};

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
		await opencode.disconnect();
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

void startOpencode();
