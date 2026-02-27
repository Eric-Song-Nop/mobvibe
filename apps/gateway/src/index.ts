import "./env.js";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { toNodeHandler } from "better-auth/node";
import cors from "cors";
import express, { type Express } from "express";
import { Server } from "socket.io";
import { getGatewayConfig, tauriOrigins } from "./config.js";
import { closeDb } from "./db/index.js";
import { auth } from "./lib/auth.js";
import { logger } from "./lib/logger.js";
import { setupDeviceRoutes } from "./routes/device.js";
import { setupFsRoutes } from "./routes/fs.js";
import { setupHealthRoutes } from "./routes/health.js";
import { setupMachineRoutes } from "./routes/machines.js";
import { setupSessionRoutes } from "./routes/sessions.js";
import { CliRegistry } from "./services/cli-registry.js";
import { SessionRouter } from "./services/session-router.js";
import { setupCliHandlers } from "./socket/cli-handlers.js";
import { setupWebuiHandlers } from "./socket/webui-handlers.js";

const config = getGatewayConfig();
const allowedOrigins = [...config.corsOrigins, ...tauriOrigins];

const isAllowedOrigin = (origin: string): boolean => {
	if (allowedOrigins.includes("*")) {
		return true;
	}
	const allowed = allowedOrigins.includes(origin);
	if (!allowed) {
		logger.warn({ origin }, "cors_origin_rejected");
	}
	return allowed;
};

const app: Express = express();
const httpServer = createServer(app);

// Trust Cloudflare and Render reverse proxy for correct client IP
app.set("trust proxy", 1);

// Socket.io server
const io = new Server(httpServer, {
	path: "/socket.io",
	cors: {
		origin: (origin, callback) => {
			if (!origin) {
				callback(null, true);
				return;
			}
			callback(null, isAllowedOrigin(origin));
		},
		allowedHeaders: ["Content-Type", "Authorization"],
		methods: ["GET", "POST"],
		credentials: true,
	},
});

// Services
const cliRegistry = new CliRegistry();
const sessionRouter = new SessionRouter(cliRegistry);

// Setup webui handlers first to get the emitter function
const webuiEmitter = setupWebuiHandlers(io, cliRegistry);

// Setup CLI handlers with webui emitter
// Note: session:update, session:error, and terminal:output are deprecated
// All content now flows through session:event (WAL-persisted with seq/revision)
setupCliHandlers(io, cliRegistry, sessionRouter, (event, payload, userId) => {
	// Route events to the appropriate user's webui connections
	switch (event) {
		case "session:attached":
			if (userId) {
				webuiEmitter.emitToUser(userId, "session:attached", payload);
			} else {
				logger.warn({ event }, "emitToWebui_missing_userId");
			}
			break;
		case "session:detached":
			if (userId) {
				webuiEmitter.emitToUser(userId, "session:detached", payload);
			} else {
				logger.warn({ event }, "emitToWebui_missing_userId");
			}
			break;
		case "sessions:changed":
			if (userId) {
				webuiEmitter.emitToUser(userId, "sessions:changed", payload);
			} else {
				logger.warn({ event }, "emitToWebui_missing_userId");
			}
			break;
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
		case "session:event":
			webuiEmitter.emitSessionEvent(
				payload as Parameters<typeof webuiEmitter.emitSessionEvent>[0],
			);
			break;
		default:
			logger.warn({ event }, "emitToWebui_unhandled_event");
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
			callback(null, isAllowedOrigin(origin));
		},
		allowedHeaders: ["Content-Type", "Authorization"],
		methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
		credentials: true,
	}),
);

// Mount Better Auth handler BEFORE express.json()
// Better Auth needs to handle raw requests for some endpoints
// For Express v4, use app.all with wildcard pattern
app.all("/api/auth/*", toNodeHandler(auth));
logger.info("better_auth_enabled");

app.use(express.json());

// Health check — mounted before auth-guarded routers so Render's
// health probe (unauthenticated GET /health) is never blocked.
const healthRouter = express.Router();
setupHealthRoutes(healthRouter);
app.use("/", healthRouter);

// Machine routes (for CLI registration)
const machineRouter = express.Router();
setupMachineRoutes(machineRouter, cliRegistry);
app.use("/", machineRouter);

// Device key routes (for E2EE device registration)
const deviceRouter = express.Router();
setupDeviceRoutes(deviceRouter);
app.use("/", deviceRouter);

// Routes
const acpRouter = express.Router();
setupSessionRoutes(acpRouter, cliRegistry, sessionRouter);
app.use("/acp", acpRouter);

const fsRouter = express.Router();
setupFsRoutes(fsRouter, sessionRouter);
app.use("/fs", fsRouter);

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
