import type {
	CliRegistrationInfo,
	PermissionDecisionPayload,
	PermissionRequestPayload,
	RpcResponse,
	SessionNotification,
	SessionSummary,
	StreamErrorPayload,
	TerminalOutputEvent,
} from "@mobvibe/shared";
import type { Server, Socket } from "socket.io";
import { auth } from "../lib/auth.js";
import type { CliRegistry } from "../services/cli-registry.js";
import {
	closeSessionsForMachineById,
	updateMachineStatusById,
	upsertMachine,
} from "../services/db-service.js";
import type { SessionRouter } from "../services/session-router.js";

/**
 * Extended socket data with auth info.
 */
interface SocketData {
	userId?: string;
	apiKey?: string;
}

export function setupCliHandlers(
	io: Server,
	cliRegistry: CliRegistry,
	sessionRouter: SessionRouter,
	emitToWebui: (event: string, payload: unknown) => void,
) {
	const cliNamespace = io.of("/cli");

	cliNamespace.use(async (socket: Socket, next) => {
		const apiKey = socket.handshake.headers["x-api-key"] as string | undefined;

		if (!apiKey) {
			console.log(`[gateway] CLI rejected: no API key provided`);
			return next(new Error("AUTH_REQUIRED"));
		}

		try {
			const verification = await auth.api.verifyApiKey({
				body: { key: apiKey },
			});
			if (!verification.valid || !verification.key) {
				console.log(`[gateway] CLI rejected: invalid API key`);
				return next(new Error("INVALID_KEY"));
			}
			const socketData: SocketData = {
				userId: verification.key.userId,
				apiKey,
			};
			(socket as Socket & { data: SocketData }).data = socketData;
			console.log(`[gateway] CLI authenticated for user: ${socketData.userId}`);
			return next();
		} catch (error) {
			console.error(`[gateway] API key verification error:`, error);
			return next(new Error("AUTH_ERROR"));
		}
	});

	cliNamespace.on("connection", (socket: Socket) => {
		console.log(`[gateway] CLI connected: ${socket.id}`);

		const socketData = (socket as Socket & { data: SocketData }).data;
		const userId = socketData?.userId;
		const apiKey = socketData?.apiKey;

		if (!userId || !apiKey) {
			console.log(`[gateway] CLI rejected: missing auth data`);
			socket.emit("cli:error", {
				code: "AUTH_REQUIRED",
				message: "API key required. Run 'mobvibe login' to authenticate.",
			});
			socket.disconnect(true);
			return;
		}

		// CLI registration (after auth)
		socket.on("cli:register", async (info: CliRegistrationInfo) => {
			// Create or update machine record in database
			console.log(`[gateway] Registering CLI for machine ${info.machineId}`);
			const machineResult = await upsertMachine({
				machineId: info.machineId,
				userId,
				name: info.hostname, // Use hostname as default name
				hostname: info.hostname,
				platform: undefined,
				isOnline: true,
			});

			if (!machineResult) {
				console.log(
					`[gateway] CLI registration failed: could not upsert machine`,
				);
				socket.emit("cli:error", {
					code: "REGISTRATION_ERROR",
					message: "Failed to register machine. Please try again.",
				});
				socket.disconnect(true);
				return;
			}

			// Register with in-memory registry
			const record = cliRegistry.register(socket, info, {
				userId,
				apiKey,
			});

			socket.emit("cli:registered", {
				machineId: record.machineId,
				userId,
			});
			console.log(
				`[gateway] CLI registered: ${info.machineId} (${info.hostname}) for user ${userId}`,
			);
		});

		// Heartbeat
		socket.on("cli:heartbeat", () => {
			// Just acknowledge
		});

		// Sessions list update
		socket.on("sessions:list", (sessions: SessionSummary[]) => {
			cliRegistry.updateSessions(socket.id, sessions);
		});

		// Session update
		socket.on("session:update", async (notification: SessionNotification) => {
			emitToWebui("session:update", notification);

			// Sync session info to database if this is a session_info_update
			if (
				notification.sessionId &&
				notification.update?.sessionUpdate === "session_info_update"
			) {
				const update = notification.update as { title?: string | null };
				await sessionRouter.syncSessionState(
					notification.sessionId,
					"ready",
					update.title ?? undefined,
					undefined,
				);
			}
		});

		// Session error
		socket.on("session:error", (payload: StreamErrorPayload) => {
			emitToWebui("session:error", payload);
		});

		// Permission request from CLI
		socket.on("permission:request", (payload: PermissionRequestPayload) => {
			emitToWebui("permission:request", payload);
		});

		// Permission result from CLI
		socket.on("permission:result", (payload: PermissionDecisionPayload) => {
			emitToWebui("permission:result", payload);
		});

		// Terminal output
		socket.on("terminal:output", (event: TerminalOutputEvent) => {
			emitToWebui("terminal:output", event);
		});

		// RPC response
		socket.on("rpc:response", (response: RpcResponse<unknown>) => {
			sessionRouter.handleRpcResponse(response);
		});

		// Disconnect
		socket.on("disconnect", async (reason) => {
			const record = cliRegistry.unregister(socket.id);
			if (record) {
				console.log(
					`[gateway] CLI disconnected: ${record.machineId} (${reason})`,
				);

				// Update machine status and close sessions in database
				if (record.machineId) {
					await updateMachineStatusById(record.machineId, false);
					await closeSessionsForMachineById(record.machineId);
				}
			}
		});
	});

	return cliNamespace;
}
