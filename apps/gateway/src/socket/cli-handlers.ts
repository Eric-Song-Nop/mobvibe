import type {
	CliRegistrationInfo,
	PermissionDecisionPayload,
	PermissionRequestPayload,
	RpcResponse,
	SessionNotification,
	SessionSummary,
	SessionsChangedPayload,
	SessionsDiscoveredPayload,
	StreamErrorPayload,
	TerminalOutputEvent,
} from "@mobvibe/shared";
import type { Server, Socket } from "socket.io";
import { auth } from "../lib/auth.js";
import { logger } from "../lib/logger.js";
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
			logger.warn("cli_rejected_missing_api_key");
			return next(new Error("AUTH_REQUIRED"));
		}

		try {
			const verification = await auth.api.verifyApiKey({
				body: { key: apiKey },
			});
			if (!verification.valid || !verification.key) {
				logger.warn("cli_rejected_invalid_api_key");
				return next(new Error("INVALID_KEY"));
			}
			const socketData: SocketData = {
				userId: verification.key.userId,
				apiKey,
			};
			(socket as Socket & { data: SocketData }).data = socketData;
			logger.info({ userId: socketData.userId }, "cli_authenticated");
			return next();
		} catch (error) {
			logger.error({ err: error }, "cli_api_key_verification_error");
			return next(new Error("AUTH_ERROR"));
		}
	});

	cliNamespace.on("connection", (socket: Socket) => {
		logger.info({ socketId: socket.id }, "cli_connected");

		const socketData = (socket as Socket & { data: SocketData }).data;
		const userId = socketData?.userId;
		const apiKey = socketData?.apiKey;

		if (!userId || !apiKey) {
			logger.warn({ socketId: socket.id }, "cli_rejected_missing_auth_data");
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
			logger.info(
				{ machineId: info.machineId, hostname: info.hostname, userId },
				"cli_register_start",
			);
			const machineResult = await upsertMachine({
				machineId: info.machineId,
				userId,
				name: info.hostname, // Use hostname as default name
				hostname: info.hostname,
				platform: undefined,
				isOnline: true,
			});

			if (!machineResult) {
				logger.error(
					{ machineId: info.machineId, userId },
					"cli_register_failed",
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
			logger.info(
				{ machineId: info.machineId, hostname: info.hostname, userId },
				"cli_registered",
			);
		});

		// Heartbeat
		socket.on("cli:heartbeat", () => {
			// Just acknowledge
		});

		// Sessions list update (initial sync and heartbeat)
		socket.on("sessions:list", (sessions: SessionSummary[]) => {
			cliRegistry.updateSessions(socket.id, sessions);
			logger.debug(
				{ socketId: socket.id, sessionCount: sessions.length },
				"cli_sessions_list",
			);
		});

		// Incremental sessions update
		socket.on("sessions:changed", (payload: SessionsChangedPayload) => {
			logger.info(
				{
					socketId: socket.id,
					added: payload.added.length,
					updated: payload.updated.length,
					removed: payload.removed.length,
				},
				"cli_sessions_changed",
			);
			cliRegistry.updateSessionsIncremental(socket.id, payload);
		});

		// Historical sessions discovered from ACP agent
		socket.on("sessions:discovered", (payload: SessionsDiscoveredPayload) => {
			const cliRecord = cliRegistry.getCliBySocketId(socket.id);
			if (!cliRecord) {
				logger.warn(
					{ socketId: socket.id },
					"sessions_discovered_no_cli_record",
				);
				return;
			}

			const { sessions, capabilities } = payload;

			// Transform AcpSessionInfo to SessionSummary with historical markers
			const historicalSessions: SessionSummary[] = sessions.map((s) => ({
				sessionId: s.sessionId,
				title: s.title ?? `Session ${s.sessionId.slice(0, 8)}`,
				cwd: s.cwd,
				updatedAt: s.updatedAt ?? new Date().toISOString(),
				createdAt: s.updatedAt ?? new Date().toISOString(),
				state: "idle" as const,
				backendId: cliRecord.defaultBackendId ?? "",
				backendLabel:
					cliRecord.backends[0]?.backendLabel ??
					cliRecord.defaultBackendId ??
					"",
				machineId: cliRecord.machineId,
				lifecycle: "suspended" as const,
			}));

			// Add to CLI registry (only adds sessions that don't already exist)
			cliRegistry.addDiscoveredSessions(socket.id, historicalSessions);

			// Emit sessions:changed to webui for the user
			if (cliRecord.userId && historicalSessions.length > 0) {
				// Use the same event pattern as updateSessionsIncremental
				emitToWebui("sessions:changed", {
					added: historicalSessions,
					updated: [],
					removed: [],
				});
			}

			logger.info(
				{
					machineId: cliRecord.machineId,
					count: sessions.length,
					capabilities,
				},
				"historical_sessions_synced",
			);
		});

		// Session update
		socket.on("session:update", async (notification: SessionNotification) => {
			logger.debug(
				{ sessionId: notification.sessionId, socketId: socket.id },
				"session_update_received",
			);
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
			logger.warn(
				{ sessionId: payload.sessionId, socketId: socket.id },
				"session_error_received",
			);
			emitToWebui("session:error", payload);
		});

		// Permission request from CLI
		socket.on("permission:request", (payload: PermissionRequestPayload) => {
			logger.info(
				{ sessionId: payload.sessionId, requestId: payload.requestId },
				"permission_request_received",
			);
			emitToWebui("permission:request", payload);
		});

		// Permission result from CLI
		socket.on("permission:result", (payload: PermissionDecisionPayload) => {
			logger.info(
				{ sessionId: payload.sessionId, requestId: payload.requestId },
				"permission_result_received",
			);
			emitToWebui("permission:result", payload);
		});

		// Terminal output
		socket.on("terminal:output", (event: TerminalOutputEvent) => {
			logger.debug(
				{ sessionId: event.sessionId, socketId: socket.id },
				"terminal_output_received",
			);
			emitToWebui("terminal:output", event);
		});

		// RPC response
		socket.on("rpc:response", (response: RpcResponse<unknown>) => {
			logger.debug(
				{
					requestId: response.requestId,
					isError: Boolean(response.error),
					code: response.error?.code,
				},
				"rpc_response_received",
			);
			sessionRouter.handleRpcResponse(response);
		});

		// Disconnect
		socket.on("disconnect", async (reason) => {
			const record = cliRegistry.unregister(socket.id);
			if (record) {
				logger.info(
					{ machineId: record.machineId, reason, socketId: socket.id },
					"cli_disconnected",
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
