import { createServer } from "node:http";
import { toNodeHandler } from "better-auth/node";
import cors from "cors";
import express, { type Express } from "express";
import { Server } from "socket.io";
import { getGatewayConfig } from "./config.js";
import { closeDb } from "./db/index.js";
import { getAuth } from "./lib/auth.js";
import { setupFsRoutes } from "./routes/fs.js";
import { setupHealthRoutes } from "./routes/health.js";
import { setupMachineRoutes } from "./routes/machines.js";
import { setupSessionRoutes } from "./routes/sessions.js";
import { CliRegistry } from "./services/cli-registry.js";
import { SessionRouter } from "./services/session-router.js";
import { setupCliHandlers } from "./socket/cli-handlers.js";
import { setupWebuiHandlers } from "./socket/webui-handlers.js";

const config = getGatewayConfig();

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
				// Check allowed origins
				if (config.corsOrigins.includes(origin)) {
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
		case "sessions:list":
			webuiEmitter.emitToAll(event, payload);
			break;
		default:
			webuiEmitter.emitToAll(event, payload);
	}
});

// CORS middleware for REST
const isPrivateIpv4 = (hostname: string) => {
	const parts = hostname.split(".");
	if (parts.length !== 4) {
		return false;
	}
	const numbers = parts.map((part) => Number.parseInt(part, 10));
	if (
		numbers.some((value) => Number.isNaN(value) || value < 0 || value > 255)
	) {
		return false;
	}
	const [first, second] = numbers;
	if (first === 10 || first === 127) {
		return true;
	}
	if (first === 192 && second === 168) {
		return true;
	}
	if (first === 172 && second >= 16 && second <= 31) {
		return true;
	}
	return false;
};

const isAllowedCorsOrigin = (origin: string) => {
	if (config.corsOrigins.includes(origin)) {
		return true;
	}
	try {
		const { hostname } = new URL(origin);
		if (hostname === "localhost" || hostname === "::1") {
			return true;
		}
		return isPrivateIpv4(hostname);
	} catch {
		return false;
	}
};

app.use((request, response, next) => {
	const origin = request.headers.origin;
	if (origin && isAllowedCorsOrigin(origin)) {
		response.setHeader("Access-Control-Allow-Origin", origin);
		response.setHeader("Vary", "Origin");
		response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
		response.setHeader(
			"Access-Control-Allow-Headers",
			"Content-Type, Authorization",
		);
		response.setHeader("Access-Control-Allow-Credentials", "true");
	}
	if (request.method === "OPTIONS") {
		response.status(204).end();
		return;
	}
	next();
});

// Mount Better Auth handler BEFORE express.json()
// Better Auth needs to handle raw requests for some endpoints
const auth = getAuth();
if (auth) {
	app.all("/api/auth/*splat", toNodeHandler(auth));
	console.log("[gateway] Better Auth enabled");
} else {
	console.log("[gateway] Better Auth disabled (no DATABASE_URL)");
}

app.use(express.json());

// Machine routes (for CLI registration)
const machineRouter = express.Router();
setupMachineRoutes(machineRouter);
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
	console.log(`[gateway] received ${signal}, shutting down`);
	try {
		io.close();
		await stopServer();
		await closeDb();
	} catch (error) {
		console.error("[gateway] shutdown error", error);
	}
	process.exit(0);
};

if (shouldStartServer) {
	server = httpServer.listen(config.port, () => {
		console.log(`[gateway] listening on :${config.port}`);
	});

	process.on("SIGINT", () => {
		void shutdown("SIGINT");
	});

	process.on("SIGTERM", () => {
		void shutdown("SIGTERM");
	});
}

export { app, io };
