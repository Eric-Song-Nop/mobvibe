import type {
	CliRegistrationInfo,
	PermissionDecisionPayload,
	PermissionRequestPayload,
	RpcResponse,
	SessionAttachedPayload,
	SessionDetachedPayload,
	SessionEvent,
	SessionSummary,
	SessionsChangedPayload,
	SessionsDiscoveredPayload,
	SignedAuthToken,
} from "@mobvibe/shared";
import { initCrypto, verifySignedToken } from "@mobvibe/shared";
import type { Server, Socket } from "socket.io";
import { logger } from "../lib/logger.js";
import type { CliRegistry } from "../services/cli-registry.js";
import {
	closeSessionsForMachineById,
	findDeviceByPublicKey,
	updateMachineStatusById,
	upsertMachine,
} from "../services/db-service.js";
import type { SessionRouter } from "../services/session-router.js";

/**
 * Extended socket data with auth info.
 */
interface SocketData {
	userId?: string;
	deviceId?: string;
}

export function setupCliHandlers(
	io: Server,
	cliRegistry: CliRegistry,
	sessionRouter: SessionRouter,
	emitToWebui: (event: string, payload: unknown, userId?: string) => void,
) {
	const cliNamespace = io.of("/cli");

	// Ensure libsodium is ready for signature verification
	const cryptoReady = initCrypto();

	cliNamespace.use(async (socket: Socket, next) => {
		await cryptoReady;

		const authToken = socket.handshake.auth as SignedAuthToken | undefined;

		if (
			!authToken?.payload?.publicKey ||
			!authToken?.payload?.timestamp ||
			!authToken?.signature
		) {
			logger.warn("cli_rejected_missing_signed_token");
			return next(new Error("AUTH_REQUIRED"));
		}

		try {
			const verified = verifySignedToken(authToken, 5 * 60 * 1000);
			if (!verified) {
				logger.warn("cli_rejected_invalid_signed_token");
				return next(new Error("INVALID_TOKEN"));
			}

			const device = await findDeviceByPublicKey(verified.publicKey);
			if (!device) {
				logger.warn(
					{ publicKey: verified.publicKey },
					"cli_rejected_unregistered_device",
				);
				return next(new Error("DEVICE_NOT_REGISTERED"));
			}

			const socketData: SocketData = {
				userId: device.userId,
				deviceId: device.id,
			};
			(socket as Socket & { data: SocketData }).data = socketData;
			logger.info(
				{ userId: device.userId, deviceId: device.id },
				"cli_authenticated",
			);
			return next();
		} catch (error) {
			logger.error({ err: error }, "cli_signed_token_verification_error");
			return next(new Error("AUTH_ERROR"));
		}
	});

	cliNamespace.on("connection", (socket: Socket) => {
		logger.info({ socketId: socket.id }, "cli_connected");

		const socketData = (socket as Socket & { data: SocketData }).data;
		const userId = socketData?.userId;
		const deviceId = socketData?.deviceId;

		if (!userId || !deviceId) {
			logger.warn({ socketId: socket.id }, "cli_rejected_missing_auth_data");
			socket.emit("cli:error", {
				code: "AUTH_REQUIRED",
				message: "Device not authenticated. Run 'mobvibe login' to register.",
			});
			socket.disconnect(true);
			return;
		}

		// CLI registration (after auth)
		socket.on("cli:register", async (info: CliRegistrationInfo) => {
			const rawMachineId = info.machineId;
			// Create or update machine record in database
			logger.info(
				{ machineId: rawMachineId, hostname: info.hostname, userId },
				"cli_register_start",
			);
			const machineResult = await upsertMachine({
				rawMachineId,
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

			const resolvedMachineId = machineResult.machineId;

			// Register with in-memory registry
			const record = cliRegistry.register(
				socket,
				{ ...info, machineId: resolvedMachineId },
				{
					userId,
					deviceId,
				},
			);

			socket.emit("cli:registered", {
				machineId: record.machineId,
				userId,
			});
			logger.info(
				{
					machineId: record.machineId,
					rawMachineId,
					hostname: info.hostname,
					userId,
				},
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
				backendId: payload.backendId,
				backendLabel: payload.backendLabel,
				machineId: cliRecord.machineId,
			}));

			// Add to CLI registry (only adds sessions that don't already exist)
			cliRegistry.addDiscoveredSessions(socket.id, historicalSessions);

			// Emit sessions:changed to webui for the user
			if (cliRecord.userId && historicalSessions.length > 0) {
				// Use the same event pattern as updateSessionsIncremental
				emitToWebui(
					"sessions:changed",
					{ added: historicalSessions, updated: [], removed: [] },
					cliRecord.userId,
				);
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

		// Note: session:update and session:error are deprecated - all content updates
		// now go through session:event (WAL-persisted events with seq/revision)

		// Session attached
		socket.on("session:attached", (payload: SessionAttachedPayload) => {
			const record = cliRegistry.getCliBySocketId(socket.id);
			if (!record) {
				logger.warn(
					{ socketId: socket.id },
					"session_attached_unregistered_cli",
				);
				return;
			}
			logger.info(
				{ sessionId: payload.sessionId, machineId: record.machineId },
				"session_attached_received",
			);
			emitToWebui(
				"session:attached",
				{ ...payload, machineId: record.machineId },
				record.userId,
			);
		});

		// Session detached
		socket.on("session:detached", (payload: SessionDetachedPayload) => {
			const record = cliRegistry.getCliBySocketId(socket.id);
			if (!record) {
				logger.warn(
					{ socketId: socket.id },
					"session_detached_unregistered_cli",
				);
				return;
			}
			logger.info(
				{
					sessionId: payload.sessionId,
					machineId: record.machineId,
					reason: payload.reason,
				},
				"session_detached_received",
			);
			emitToWebui(
				"session:detached",
				{ ...payload, machineId: record.machineId },
				record.userId,
			);
		});

		// Permission request from CLI
		socket.on("permission:request", (payload: PermissionRequestPayload) => {
			const record = cliRegistry.getCliBySocketId(socket.id);
			if (!record) {
				logger.warn(
					{ socketId: socket.id },
					"permission_request_unregistered_cli",
				);
				return;
			}
			logger.info(
				{ sessionId: payload.sessionId, requestId: payload.requestId },
				"permission_request_received",
			);
			emitToWebui("permission:request", payload, record.userId);
		});

		// Permission result from CLI
		socket.on("permission:result", (payload: PermissionDecisionPayload) => {
			const record = cliRegistry.getCliBySocketId(socket.id);
			if (!record) {
				logger.warn(
					{ socketId: socket.id },
					"permission_result_unregistered_cli",
				);
				return;
			}
			logger.info(
				{ sessionId: payload.sessionId, requestId: payload.requestId },
				"permission_result_received",
			);
			emitToWebui("permission:result", payload, record.userId);
		});

		// Session event (WAL-persisted events with seq/revision)
		// Note: terminal:output is deprecated - terminal output now goes through
		// session:event with kind="terminal_output"
		socket.on("session:event", (event: SessionEvent) => {
			const record = cliRegistry.getCliBySocketId(socket.id);
			if (!record) {
				logger.warn({ socketId: socket.id }, "session_event_unregistered_cli");
				return;
			}
			logger.debug(
				{
					sessionId: event.sessionId,
					revision: event.revision,
					seq: event.seq,
					kind: event.kind,
					socketId: socket.id,
				},
				"session_event_received",
			);
			emitToWebui("session:event", event, record.userId);

			// Send acknowledgment back to CLI
			socket.emit("events:ack", {
				sessionId: event.sessionId,
				revision: event.revision,
				upToSeq: event.seq,
			});
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
			// Cache userId before unregister (unregister deletes the userId mapping)
			const preRecord = cliRegistry.getCliBySocketId(socket.id);
			const cachedUserId = preRecord?.userId;

			const record = cliRegistry.unregister(socket.id);
			if (record) {
				logger.info(
					{ machineId: record.machineId, reason, socketId: socket.id },
					"cli_disconnected",
				);
				for (const session of record.sessions) {
					emitToWebui(
						"session:detached",
						{
							sessionId: session.sessionId,
							machineId: record.machineId,
							detachedAt: new Date().toISOString(),
							reason: "cli_disconnect",
						},
						cachedUserId,
					);
				}

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
