import type {
	CliRegistrationInfo,
	PermissionDecisionPayload,
	PermissionRequestPayload,
	RpcResponse,
	SessionNotification,
	SessionSummary,
	StreamErrorPayload,
	TerminalOutputEvent,
} from "@remote-claude/shared";
import type { Server, Socket } from "socket.io";
import type { CliRegistry } from "../services/cli-registry.js";
import type { SessionRouter } from "../services/session-router.js";

export function setupCliHandlers(
	io: Server,
	cliRegistry: CliRegistry,
	sessionRouter: SessionRouter,
	emitToWebui: (event: string, payload: unknown) => void,
) {
	const cliNamespace = io.of("/cli");

	cliNamespace.on("connection", (socket: Socket) => {
		console.log(`[gateway] CLI connected: ${socket.id}`);

		// CLI registration
		socket.on("cli:register", (info: CliRegistrationInfo) => {
			const record = cliRegistry.register(socket, info);
			socket.emit("cli:registered", { machineId: record.machineId });
			console.log(
				`[gateway] CLI registered: ${info.machineId} (${info.hostname})`,
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
		socket.on("session:update", (notification: SessionNotification) => {
			emitToWebui("session:update", notification);
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
		socket.on("disconnect", (reason) => {
			const record = cliRegistry.unregister(socket.id);
			if (record) {
				console.log(
					`[gateway] CLI disconnected: ${record.machineId} (${reason})`,
				);
			}
		});
	});

	return cliNamespace;
}
