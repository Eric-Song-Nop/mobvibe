import type {
	CliRegistrationInfo,
	PermissionDecisionPayload,
	PermissionRequestPayload,
	RegistrationCompletePayload,
	RegistrationRequestPayload,
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
	updateMachineStatus,
	validateMachineToken,
} from "../services/db-service.js";
import type { SessionRouter } from "../services/session-router.js";

// Pending registrations: registrationCode -> socket
const pendingRegistrations = new Map<string, Socket>();
// Timeout handles for cleanup
const registrationTimeouts = new Map<string, NodeJS.Timeout>();

const REGISTRATION_TIMEOUT = 300000; // 5 minutes

/**
 * Complete a pending registration by pushing credentials to the CLI.
 * Called from the machines REST endpoint after successful registration.
 */
export function completeRegistration(
	registrationCode: string,
	payload: RegistrationCompletePayload,
): boolean {
	const socket = pendingRegistrations.get(registrationCode);
	if (!socket) {
		return false;
	}

	// Emit credentials to CLI
	socket.emit("registration:complete", payload);

	// Clean up
	const timeout = registrationTimeouts.get(registrationCode);
	if (timeout) {
		clearTimeout(timeout);
		registrationTimeouts.delete(registrationCode);
	}
	pendingRegistrations.delete(registrationCode);

	console.log(
		`[gateway] Registration completed for code ${registrationCode.slice(0, 8)}...`,
	);
	return true;
}

/**
 * Send registration error to a pending CLI.
 */
export function failRegistration(
	registrationCode: string,
	error: string,
): boolean {
	const socket = pendingRegistrations.get(registrationCode);
	if (!socket) {
		return false;
	}

	socket.emit("registration:error", { error });

	// Clean up
	const timeout = registrationTimeouts.get(registrationCode);
	if (timeout) {
		clearTimeout(timeout);
		registrationTimeouts.delete(registrationCode);
	}
	pendingRegistrations.delete(registrationCode);

	return true;
}

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

		// Handle pre-auth registration request (login flow)
		socket.on("registration:request", (payload: RegistrationRequestPayload) => {
			const { registrationCode } = payload;
			console.log(
				`[gateway] Registration request: ${registrationCode.slice(0, 8)}...`,
			);

			// Store socket for later credential push
			pendingRegistrations.set(registrationCode, socket);

			// Set timeout to clean up if not completed
			const timeout = setTimeout(() => {
				if (pendingRegistrations.has(registrationCode)) {
					pendingRegistrations.delete(registrationCode);
					registrationTimeouts.delete(registrationCode);
					socket.emit("registration:error", {
						error: "Registration timed out",
					});
					console.log(
						`[gateway] Registration timed out: ${registrationCode.slice(0, 8)}...`,
					);
				}
			}, REGISTRATION_TIMEOUT);
			registrationTimeouts.set(registrationCode, timeout);

			// Clean up on disconnect
			socket.once("disconnect", () => {
				const pendingTimeout = registrationTimeouts.get(registrationCode);
				if (pendingTimeout) {
					clearTimeout(pendingTimeout);
					registrationTimeouts.delete(registrationCode);
				}
				pendingRegistrations.delete(registrationCode);
			});
		});

		// CLI registration with authentication
		socket.on("cli:register", async (info: CliRegistrationWithAuth) => {
			// Validate machine token
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

			// Update machine status in database
			await updateMachineStatus(info.machineToken, true);

			socket.emit("cli:registered", {
				machineId: record.machineId,
				userId: machineInfo.userId,
			});
			console.log(
				`[gateway] CLI registered: ${info.machineId} (${info.hostname}) for user ${machineInfo.userId}`,
			);
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
