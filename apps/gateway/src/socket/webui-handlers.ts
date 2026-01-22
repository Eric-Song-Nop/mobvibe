import type {
	CliStatusPayload,
	PermissionDecisionPayload,
	PermissionRequestPayload,
	SessionNotification,
	SessionSummary,
	StreamErrorPayload,
	TerminalOutputEvent,
} from "@remote-claude/shared";
import type { Server, Socket } from "socket.io";
import type { CliRegistry } from "../services/cli-registry.js";
import type { SessionRouter } from "../services/session-router.js";

export function setupWebuiHandlers(
	io: Server,
	cliRegistry: CliRegistry,
	sessionRouter: SessionRouter,
) {
	const webuiNamespace = io.of("/webui");

	// Track session subscriptions
	const sessionSubscriptions = new Map<string, Set<string>>(); // sessionId -> Set of socket IDs

	const emitToSubscribers = (
		sessionId: string,
		event: string,
		payload: unknown,
	) => {
		const subscribers = sessionSubscriptions.get(sessionId);
		if (!subscribers) {
			return;
		}
		for (const socketId of subscribers) {
			const socket = webuiNamespace.sockets.get(socketId);
			if (socket) {
				socket.emit(event, payload);
			}
		}
	};

	// Emit to all webui clients
	const emitToAll = (event: string, payload: unknown) => {
		webuiNamespace.emit(event, payload);
	};

	// Forward CLI status to webui
	cliRegistry.onCliStatus((payload: CliStatusPayload) => {
		emitToAll("cli:status", payload);
	});

	// Forward session updates to subscribers
	cliRegistry.on(
		"sessions:updated",
		(_machineId: string, sessions: SessionSummary[]) => {
			emitToAll("sessions:list", sessions);
		},
	);

	webuiNamespace.on("connection", (socket: Socket) => {
		console.log(`[gateway] Webui connected: ${socket.id}`);

		// Send current CLI status
		for (const cli of cliRegistry.getAllClis()) {
			socket.emit("cli:status", {
				machineId: cli.machineId,
				connected: true,
				hostname: cli.hostname,
				sessionCount: cli.sessions.length,
			});
		}

		// Send current sessions
		socket.emit("sessions:list", cliRegistry.getAllSessions());

		// Subscribe to session updates
		socket.on("subscribe:session", (payload: { sessionId: string }) => {
			const { sessionId } = payload;
			if (!sessionSubscriptions.has(sessionId)) {
				sessionSubscriptions.set(sessionId, new Set());
			}
			sessionSubscriptions.get(sessionId)!.add(socket.id);
			console.log(`[gateway] Webui ${socket.id} subscribed to ${sessionId}`);
		});

		// Unsubscribe from session updates
		socket.on("unsubscribe:session", (payload: { sessionId: string }) => {
			const { sessionId } = payload;
			sessionSubscriptions.get(sessionId)?.delete(socket.id);
			console.log(
				`[gateway] Webui ${socket.id} unsubscribed from ${sessionId}`,
			);
		});

		// Permission decision from webui
		socket.on(
			"permission:decision",
			async (payload: PermissionDecisionPayload) => {
				try {
					await sessionRouter.sendPermissionDecision(payload);
				} catch (error) {
					console.error("[gateway] Permission decision error:", error);
				}
			},
		);

		// Disconnect
		socket.on("disconnect", () => {
			// Remove from all subscriptions
			for (const subscribers of sessionSubscriptions.values()) {
				subscribers.delete(socket.id);
			}
			console.log(`[gateway] Webui disconnected: ${socket.id}`);
		});
	});

	// Return emitter function for CLI handlers to use
	return {
		emitToAll,
		emitToSubscribers,
		emitSessionUpdate: (notification: SessionNotification) => {
			emitToSubscribers(notification.sessionId, "session:update", notification);
		},
		emitPermissionRequest: (payload: PermissionRequestPayload) => {
			emitToSubscribers(payload.sessionId, "permission:request", payload);
		},
		emitPermissionResult: (payload: PermissionDecisionPayload) => {
			emitToSubscribers(payload.sessionId, "permission:result", payload);
		},
		emitTerminalOutput: (event: TerminalOutputEvent) => {
			emitToSubscribers(event.sessionId, "terminal:output", event);
		},
		emitSessionError: (payload: StreamErrorPayload) => {
			emitToSubscribers(payload.sessionId, "session:error", payload);
		},
	};
}
