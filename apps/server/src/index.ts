import express from "express";
import { getServerConfig } from "./config.js";
import { OpencodeConnection } from "./acp/opencode.js";

const config = getServerConfig();

const opencode = new OpencodeConnection({
	command: config.opencodeCommand,
	args: config.opencodeArgs,
	client: {
		name: config.clientName,
		version: config.clientVersion
	}
});

const app = express();

app.get("/health", (_request, response) => {
	response.json({ ok: true });
});

app.get("/acp/opencode", (_request, response) => {
	response.json(opencode.getStatus());
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
