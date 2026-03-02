import "./env.js";
import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { createServer } from "node:http";
import type { Duplex } from "node:stream";
import { toNodeHandler } from "better-auth/node";
import cors from "cors";
import express, { type Express } from "express";
import { Server } from "socket.io";
import { getGatewayConfig, tauriOrigins } from "./config.js";
import { closeDb } from "./db/index.js";
import { auth } from "./lib/auth.js";
import { logger } from "./lib/logger.js";
import { createFlyReplayMiddleware } from "./middleware/fly-replay.js";
import { setupDeviceRoutes } from "./routes/device.js";
import { setupFsRoutes } from "./routes/fs.js";
import { setupHealthRoutes } from "./routes/health.js";
import { setupMachineRoutes } from "./routes/machines.js";
import { setupSessionRoutes } from "./routes/sessions.js";
import { CliRegistry } from "./services/cli-registry.js";
import { InstanceRegistry } from "./services/instance-registry.js";
import { closeRedis, initRedis } from "./services/redis.js";
import { SessionRouter } from "./services/session-router.js";
import { UserAffinityManager } from "./services/user-affinity.js";
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

// Trust reverse proxy (Cloudflare, Render, Fly.io) for correct client IP
app.set("trust proxy", 1);

// --- Redis + affinity services (null when Redis is unavailable) ---
let instanceRegistry: InstanceRegistry | null = null;
let userAffinity: UserAffinityManager | null = null;
let affinityRenewTimer: NodeJS.Timeout | null = null;

async function initAffinity() {
	const redis = await initRedis(config.redisUrl);
	if (!redis) return;

	instanceRegistry = new InstanceRegistry(
		redis,
		config.instanceId,
		config.flyRegion,
	);
	userAffinity = new UserAffinityManager(
		redis,
		config.instanceId,
		config.flyRegion,
	);

	await instanceRegistry.register();
	instanceRegistry.startHeartbeatLoop(() => {
		// Count unique user IDs across CLI and WebUI
		const cliUserIds = new Set(cliRegistry.getConnectedUserIds());
		for (const socket of io.of("/webui").sockets.values()) {
			const uid = (socket as unknown as { data: { userId?: string } }).data
				.userId;
			if (uid) cliUserIds.add(uid);
		}
		return cliUserIds.size;
	});

	// Renew affinity TTLs every 60s
	affinityRenewTimer = setInterval(() => {
		const cliUserIds = new Set(cliRegistry.getConnectedUserIds());
		for (const socket of io.of("/webui").sockets.values()) {
			const uid = (socket as unknown as { data: { userId?: string } }).data
				.userId;
			if (uid) cliUserIds.add(uid);
		}
		userAffinity?.renewAll(Array.from(cliUserIds)).catch((err) => {
			logger.warn({ err }, "affinity_renew_failed");
		});
	}, 60_000);

	logger.info(
		{ instanceId: config.instanceId, region: config.flyRegion },
		"affinity_enabled",
	);
}

// Socket.io server — manual attach for WebSocket upgrade interception
const corsConfig = {
	origin: (
		origin: string | undefined,
		callback: (err: Error | null, allow?: boolean) => void,
	) => {
		if (!origin) {
			callback(null, true);
			return;
		}
		callback(null, isAllowedOrigin(origin));
	},
	allowedHeaders: ["Content-Type", "Authorization"],
	methods: ["GET", "POST"],
	credentials: true,
};

const io = new Server({
	path: "/socket.io",
	cors: corsConfig,
});

// Attach engine for polling transport
io.attach(httpServer);

// Handle WebSocket upgrades manually for affinity routing
httpServer.removeAllListeners("upgrade");
httpServer.on(
	"upgrade",
	async (req: IncomingMessage, socket: Duplex, head: Buffer) => {
		if (!req.url?.startsWith("/socket.io")) {
			socket.destroy();
			return;
		}

		// WebUI affinity check (cookie-based auth available at upgrade time)
		if (userAffinity) {
			try {
				const cookies = req.headers.cookie;
				if (cookies) {
					const headers = new Headers();
					headers.set("cookie", cookies);
					const session = await auth.api.getSession({ headers });
					const userId = session?.user?.id;
					if (userId) {
						const target = await userAffinity.getUserInstance(userId);
						if (target && target.instanceId !== config.instanceId) {
							logger.info(
								{
									userId,
									targetInstance: target.instanceId,
									path: req.url,
								},
								"ws_upgrade_fly_replay",
							);
							socket.write(
								`HTTP/1.1 307 Temporary Redirect\r\nfly-replay: instance=${target.instanceId}\r\n\r\n`,
							);
							socket.destroy();
							return;
						}
					}
				}
			} catch (err) {
				// Degrade gracefully — proceed with normal upgrade
				logger.warn({ err }, "ws_upgrade_affinity_check_failed");
			}
		}

		// Normal Socket.io upgrade (engine.io augments IncomingMessage with _query at runtime)
		io.engine.handleUpgrade(
			req as unknown as Parameters<typeof io.engine.handleUpgrade>[0],
			socket,
			head,
		);
	},
);

// Services
const cliRegistry = new CliRegistry();
const sessionRouter = new SessionRouter(cliRegistry);

// Setup webui handlers first to get the emitter function
const webuiEmitter = setupWebuiHandlers(io, cliRegistry, userAffinity);

// Setup CLI handlers with webui emitter
// Note: session:update, session:error, and terminal:output are deprecated
// All content now flows through session:event (WAL-persisted with seq/revision)
setupCliHandlers(
	io,
	cliRegistry,
	sessionRouter,
	(event, payload, userId) => {
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
	},
	userAffinity,
	config,
);

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

// Health check — mounted before auth-guarded routers so the
// health probe (unauthenticated GET /health) is never blocked.
const healthRouter = express.Router();
setupHealthRoutes(healthRouter, config, { userAffinity });
app.use("/", healthRouter);

// Machine routes (for CLI registration)
const machineRouter = express.Router();
setupMachineRoutes(machineRouter, cliRegistry);
app.use("/", machineRouter);

// Device key routes (for E2EE device registration)
const deviceRouter = express.Router();
setupDeviceRoutes(deviceRouter);
app.use("/", deviceRouter);

// Fly-replay middleware for stateful routes (when affinity is enabled)
if (userAffinity) {
	const replayMiddleware = createFlyReplayMiddleware(
		userAffinity,
		config.instanceId,
	);
	app.use("/acp", replayMiddleware);
	app.use("/fs", replayMiddleware);
}

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
		if (affinityRenewTimer) {
			clearInterval(affinityRenewTimer);
		}
		if (instanceRegistry) {
			instanceRegistry.stopHeartbeatLoop();
			await instanceRegistry.deregister();
		}
		await closeRedis();
		await stopServer();
		await closeDb();
		logger.info({ signal }, "gateway_shutdown_complete");
	} catch (error) {
		logger.error({ err: error, signal }, "gateway_shutdown_error");
	}
	process.exit(0);
};

if (shouldStartServer) {
	// Initialize affinity before listening
	initAffinity()
		.then(() => {
			server = httpServer.listen(config.port, () => {
				logger.info(
					{
						port: config.port,
						instanceId: config.instanceId,
						region: config.flyRegion,
						affinityEnabled: userAffinity !== null,
					},
					"gateway_listening",
				);
			});
		})
		.catch((err) => {
			logger.error({ err }, "affinity_init_error");
			// Start without affinity
			server = httpServer.listen(config.port, () => {
				logger.info(
					{
						port: config.port,
						instanceId: config.instanceId,
						region: config.flyRegion,
						affinityEnabled: false,
					},
					"gateway_listening",
				);
			});
		});

	process.on("SIGINT", () => {
		void shutdown("SIGINT");
	});

	process.on("SIGTERM", () => {
		void shutdown("SIGTERM");
	});
}

export { app, io };
