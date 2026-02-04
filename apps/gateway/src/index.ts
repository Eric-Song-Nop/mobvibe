import "dotenv/config";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { toNodeHandler } from "better-auth/node";
import cors from "cors";
import express, { type Express } from "express";
import { Server } from "socket.io";
import { getGatewayConfig } from "./config.js";
import { closeDb } from "./db/index.js";
import { auth } from "./lib/auth.js";
import { logger } from "./lib/logger.js";
import { setupFsRoutes } from "./routes/fs.js";
import { setupHealthRoutes } from "./routes/health.js";
import { setupMachineRoutes } from "./routes/machines.js";
import { setupSessionRoutes } from "./routes/sessions.js";
import { CliRegistry } from "./services/cli-registry.js";
import { SessionRouter } from "./services/session-router.js";
import { setupCliHandlers } from "./socket/cli-handlers.js";
import { setupWebuiHandlers } from "./socket/webui-handlers.js";

const config = getGatewayConfig();
const tauriOrigins = [
	"tauri://localhost",
	"http://tauri.localhost",
	"https://tauri.localhost",
	"mobvibe://",
];
const restCorsOrigins = [
	config.webUrl,
	...config.corsOrigins,
	...tauriOrigins,
	"http://localhost:5173",
	"http://127.0.0.1:5173",
].filter(Boolean) as string[];

const app: Express = express();
const httpServer = createServer(app);

// Socket.io server
const io = new Server(httpServer, {
	path: "/socket.io",
	cors: {
		origin: (origin, callback) => {
			// Allow localhost and private IPs
			if (!origin) {
				callback(null, true);
				return;
			}
			try {
				const { hostname } = new URL(origin);
				if (hostname === "localhost" || hostname === "127.0.0.1") {
					callback(null, true);
					return;
				}
				// Check private IPv4
				const parts = hostname.split(".");
				if (parts.length === 4) {
					const [first, second] = parts.map((p) => Number.parseInt(p, 10));
					if (
						first === 10 ||
						first === 127 ||
						(first === 192 && second === 168) ||
						(first === 172 && second >= 16 && second <= 31)
					) {
						callback(null, true);
						return;
					}
				}
				// Check allowed origins (including Tauri origins)
				if (
					config.corsOrigins.includes(origin) ||
					tauriOrigins.includes(origin)
				) {
					callback(null, true);
					return;
				}
				callback(null, false);
			} catch {
				callback(null, false);
			}
		},
		methods: ["GET", "POST"],
		credentials: true,
	},
});

// Services
const cliRegistry = new CliRegistry();
const sessionRouter = new SessionRouter(cliRegistry);

// Setup webui handlers first to get the emitter function
const webuiEmitter = setupWebuiHandlers(io, cliRegistry, sessionRouter);

// Setup CLI handlers with webui emitter
setupCliHandlers(io, cliRegistry, sessionRouter, (event, payload) => {
	// Route events to appropriate webui subscribers
	switch (event) {
		case "session:update":
			webuiEmitter.emitSessionUpdate(
				payload as Parameters<typeof webuiEmitter.emitSessionUpdate>[0],
			);
			break;
		case "session:error":
			webuiEmitter.emitSessionError(
				payload as Parameters<typeof webuiEmitter.emitSessionError>[0],
			);
			break;
		case "session:attached": {
			const machineId = (payload as { machineId: string }).machineId;
			const cli = cliRegistry.getCliByMachineId(machineId);
			if (cli?.userId) {
				webuiEmitter.emitToUser(cli.userId, "session:attached", payload);
			} else {
				webuiEmitter.emitToAll("session:attached", payload);
			}
			break;
		}
		case "session:detached": {
			const machineId = (payload as { machineId: string }).machineId;
			const cli = cliRegistry.getCliByMachineId(machineId);
			if (cli?.userId) {
				webuiEmitter.emitToUser(cli.userId, "session:detached", payload);
			} else {
				webuiEmitter.emitToAll("session:detached", payload);
			}
			break;
		}
		case "permission:request":
			webuiEmitter.emitPermissionRequest(
				payload as Parameters<typeof webuiEmitter.emitPermissionRequest>[0],
			);
			break;
		case "permission:result":
			webuiEmitter.emitPermissionResult(
				payload as Parameters<typeof webuiEmitter.emitPermissionResult>[0],
			);
			break;
		case "terminal:output":
			webuiEmitter.emitTerminalOutput(
				payload as Parameters<typeof webuiEmitter.emitTerminalOutput>[0],
			);
			break;
		case "session:event":
			webuiEmitter.emitSessionEvent(
				payload as Parameters<typeof webuiEmitter.emitSessionEvent>[0],
			);
			break;
		default:
			webuiEmitter.emitToAll(event, payload);
	}
});

app.use((request, response, next) => {
	const start = process.hrtime.bigint();
	const requestId = randomUUID();
	response.setHeader("x-request-id", requestId);
	(request as Express.Request & { requestId?: string }).requestId = requestId;
	request.headers["x-request-id"] = requestId;
	response.on("finish", () => {
		const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
		const log =
			response.statusCode >= 500
				? logger.error.bind(logger)
				: response.statusCode >= 400
					? logger.warn.bind(logger)
					: logger.info.bind(logger);
		log(
			{
				requestId,
				method: request.method,
				path: request.originalUrl,
				status: response.statusCode,
				durationMs,
				ip: request.ip,
				userAgent: request.headers["user-agent"],
			},
			"http_request",
		);
	});
	next();
});

// CORS middleware for REST
app.use(
	cors({
		origin: (origin, callback) => {
			if (!origin) {
				callback(null, true);
				return;
			}
			if (restCorsOrigins.includes(origin)) {
				callback(null, true);
				return;
			}
			callback(null, false);
		},
		methods: ["GET", "POST", "PUT", "DELETE"],
		credentials: true,
	}),
);

// Mount Better Auth handler BEFORE express.json()
// Better Auth needs to handle raw requests for some endpoints
// For Express v4, use app.all with wildcard pattern
app.all("/api/auth/*", toNodeHandler(auth));
logger.info("better_auth_enabled");

app.use(express.json());

// Machine routes (for CLI registration)
const machineRouter = express.Router();
setupMachineRoutes(machineRouter, cliRegistry);
app.use("/", machineRouter);

// Routes
const acpRouter = express.Router();
setupSessionRoutes(acpRouter, cliRegistry, sessionRouter);
app.use("/acp", acpRouter);

const fsRouter = express.Router();
setupFsRoutes(fsRouter, sessionRouter);
app.use("/fs", fsRouter);

const healthRouter = express.Router();
setupHealthRoutes(healthRouter, cliRegistry);
app.use("/", healthRouter);

// Start server
const shouldStartServer = process.env.NODE_ENV !== "test";
let server: ReturnType<typeof httpServer.listen> | undefined;

const stopServer = async () =>
	new Promise<void>((resolve, reject) => {
		if (!server) {
			resolve();
			return;
		}
		server.close((error) => {
			if (error) {
				reject(error);
				return;
			}
			resolve();
		});
	});

const shutdown = async (signal: string) => {
	logger.info({ signal }, "gateway_shutdown_start");
	try {
		io.close();
		await stopServer();
		await closeDb();
		logger.info({ signal }, "gateway_shutdown_complete");
	} catch (error) {
		logger.error({ err: error, signal }, "gateway_shutdown_error");
	}
	process.exit(0);
};

if (shouldStartServer) {
	server = httpServer.listen(config.port, () => {
		logger.info({ port: config.port }, "gateway_listening");
	});

	process.on("SIGINT", () => {
		void shutdown("SIGINT");
	});

	process.on("SIGTERM", () => {
		void shutdown("SIGTERM");
	});
}

export { app, io };
