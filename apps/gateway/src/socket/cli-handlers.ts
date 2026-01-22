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
import type { CliRegistry } from "../services/cli-registry.js";
import {
	closeSessionsForMachine,
	isAuthEnabled,
	updateMachineStatus,
	validateMachineToken,
} from "../services/db-service.js";
import type { SessionRouter } from "../services/session-router.js";

/**
 * Extended CLI registration info with optional machine token.
 */
interface CliRegistrationWithAuth extends CliRegistrationInfo {
	/** Machine token for authentication (required when auth is enabled) */
	machineToken?: string;
}

export function setupCliHandlers(
	io: Server,
	cliRegistry: CliRegistry,
	sessionRouter: SessionRouter,
	emitToWebui: (event: string, payload: unknown) => void,
) {
	const cliNamespace = io.of("/cli");

	cliNamespace.on("connection", (socket: Socket) => {
		console.log(`[gateway] CLI connected: ${socket.id}`);

		// CLI registration with optional authentication
		socket.on("cli:register", async (info: CliRegistrationWithAuth) => {
			// Validate machine token if auth is enabled
			if (isAuthEnabled()) {
				if (!info.machineToken) {
					console.log(
						`[gateway] CLI registration rejected: no machine token (${info.machineId})`,
					);
					socket.emit("cli:error", {
						code: "AUTH_REQUIRED",
						message:
							"Machine token required. Run 'mobvibe login' to authenticate.",
					});
					socket.disconnect(true);
					return;
				}

				const machineInfo = await validateMachineToken(info.machineToken);
				if (!machineInfo) {
					console.log(
						`[gateway] CLI registration rejected: invalid machine token (${info.machineId})`,
					);
					socket.emit("cli:error", {
						code: "INVALID_TOKEN",
						message:
							"Invalid machine token. Run 'mobvibe login' to re-authenticate.",
					});
					socket.disconnect(true);
					return;
				}

				// Register with auth info
				const record = cliRegistry.register(socket, info, {
					userId: machineInfo.userId,
					machineToken: info.machineToken,
				});

				// Update machine status in Convex
				await updateMachineStatus(info.machineToken, true);

				socket.emit("cli:registered", {
					machineId: record.machineId,
					userId: machineInfo.userId,
				});
				console.log(
					`[gateway] CLI registered: ${info.machineId} (${info.hostname}) for user ${machineInfo.userId}`,
				);
			} else {
				// Auth disabled - register without auth info
				const record = cliRegistry.register(socket, info);
				socket.emit("cli:registered", { machineId: record.machineId });
				console.log(
					`[gateway] CLI registered: ${info.machineId} (${info.hostname}) [auth disabled]`,
				);
			}
		});

		// Heartbeat
		socket.on("cli:heartbeat", () => {
			// Just acknowledge
		});

		// Sessions list update
		socket.on("sessions:list", (sessions: SessionSummary[]) => {
			cliRegistry.updateSessions(socket.id, sessions);
			emitToWebui("sessions:list", sessions);
		});

		// Session update
		socket.on("session:update", async (notification: SessionNotification) => {
			emitToWebui("session:update", notification);

			// Sync session info to Convex if this is a session_info_update
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

				// Update machine status and close sessions in Convex
				if (record.machineToken) {
					await updateMachineStatus(record.machineToken, false);
					await closeSessionsForMachine(record.machineToken);
				}
			}
		});
	});

	return cliNamespace;
}
