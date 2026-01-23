import type {
	CliStatusPayload,
	PermissionDecisionPayload,
	PermissionRequestPayload,
	SessionNotification,
	SessionSummary,
	StreamErrorPayload,
	TerminalOutputEvent,
} from "@mobvibe/shared";
import type { Server, Socket } from "socket.io";
import { auth } from "../lib/auth.js";
import type { CliRegistry } from "../services/cli-registry.js";
import type { SessionRouter } from "../services/session-router.js";

/**
 * Extended Socket with user context.
 */
interface AuthenticatedSocket extends Socket {
	data: {
		userId?: string;
		userEmail?: string;
	};
}

export function setupWebuiHandlers(
	io: Server,
	cliRegistry: CliRegistry,
	sessionRouter: SessionRouter,
) {
	const webuiNamespace = io.of("/webui");

	// Track session subscriptions with user context
	// sessionId -> Map<socketId, userId>
	const sessionSubscriptions = new Map<
		string,
		Map<string, string | undefined>
	>();
	// socketId -> userId (for quick lookup)
	const socketUserMap = new Map<string, string | undefined>();

	const emitToSubscribers = (
		sessionId: string,
		event: string,
		payload: unknown,
	) => {
		const subscribers = sessionSubscriptions.get(sessionId);
		if (!subscribers) {
			return;
		}
		for (const socketId of subscribers.keys()) {
			const socket = webuiNamespace.sockets.get(socketId) as
				| AuthenticatedSocket
				| undefined;
			if (socket) {
				socket.emit(event, payload);
			}
		}
	};

	// Emit to user's sockets only
	const emitToUser = (userId: string, event: string, payload: unknown) => {
		for (const socket of webuiNamespace.sockets.values()) {
			const authSocket = socket as AuthenticatedSocket;
			if (authSocket.data.userId === userId) {
				socket.emit(event, payload);
			}
		}
	};

	// Emit to all webui clients (filtered by user if auth enabled)
	const emitToAll = (event: string, payload: unknown) => {
		webuiNamespace.emit(event, payload);
	};

	// Forward CLI status to webui (user-filtered)
	cliRegistry.onCliStatus((payload: CliStatusPayload) => {
		if (payload.userId) {
			// Only emit to the user who owns this CLI
			emitToUser(payload.userId, "cli:status", payload);
		} else {
			// Auth disabled - emit to all
			emitToAll("cli:status", payload);
		}
	});

	// Forward session updates to subscribers
	cliRegistry.on(
		"sessions:updated",
		(_machineId: string, sessions: SessionSummary[]) => {
			// This event is emitted to all for now - filtering happens at query time
			emitToAll("sessions:list", sessions);
		},
	);

	webuiNamespace.on("connection", async (socket: Socket) => {
		const authSocket = socket as AuthenticatedSocket;
		authSocket.data = {};

		console.log(`[gateway] Webui connected: ${socket.id}`);

		// Authenticate via handshake cookies
		try {
			// Get cookies from handshake headers for session validation
			const cookies = socket.handshake.headers.cookie;
			if (cookies) {
				const session = await auth.api.getSession({
					headers: new Headers({ cookie: cookies }),
				});
				if (session?.user) {
					authSocket.data.userId = session.user.id;
					authSocket.data.userEmail = session.user.email;
					socketUserMap.set(socket.id, session.user.id);
					console.log(
						`[gateway] Webui authenticated: ${socket.id} as ${session.user.email}`,
					);
				} else {
					console.log(
						`[gateway] Webui auth failed: ${socket.id} (no session)`,
					);
				}
			} else {
				console.log(
					`[gateway] Webui connected without cookies: ${socket.id}`,
				);
			}
		} catch (error) {
			console.log(
				`[gateway] Webui auth error: ${socket.id}`,
				error instanceof Error ? error.message : error,
			);
		}

		const userId = authSocket.data.userId;

		// Send current CLI status - filtered by user if authenticated
		const clis = userId
			? cliRegistry.getClisForUser(userId)
			: cliRegistry.getAllClis();

		for (const cli of clis) {
			socket.emit("cli:status", {
				machineId: cli.machineId,
				connected: true,
				hostname: cli.hostname,
				sessionCount: cli.sessions.length,
				userId: cli.userId,
			});
		}

		// Send current sessions - filtered by user if authenticated
		const sessions = userId
			? cliRegistry.getSessionsForUser(userId)
			: cliRegistry.getAllSessions();

		socket.emit("sessions:list", sessions);

		// Subscribe to session updates - with ownership check
		socket.on("subscribe:session", (payload: { sessionId: string }) => {
			const { sessionId } = payload;

			// Check ownership if auth enabled
			if (userId && !cliRegistry.isSessionOwnedByUser(sessionId, userId)) {
				socket.emit("subscription:error", {
					sessionId,
					error: "Not authorized to subscribe to this session",
				});
				return;
			}

			if (!sessionSubscriptions.has(sessionId)) {
				sessionSubscriptions.set(sessionId, new Map());
			}
			sessionSubscriptions.get(sessionId)!.set(socket.id, userId);
			console.log(
				`[gateway] Webui ${socket.id} subscribed to ${sessionId}${userId ? ` (user: ${userId})` : ""}`,
			);
		});

		// Unsubscribe from session updates
		socket.on("unsubscribe:session", (payload: { sessionId: string }) => {
			const { sessionId } = payload;
			sessionSubscriptions.get(sessionId)?.delete(socket.id);
			console.log(
				`[gateway] Webui ${socket.id} unsubscribed from ${sessionId}`,
			);
		});

		// Permission decision from webui - with ownership check
		socket.on(
			"permission:decision",
			async (payload: PermissionDecisionPayload) => {
				try {
					// Check ownership if auth enabled
					if (
						userId &&
						!cliRegistry.isSessionOwnedByUser(payload.sessionId, userId)
					) {
						socket.emit("permission:error", {
							sessionId: payload.sessionId,
							requestId: payload.requestId,
							error: "Not authorized to make decisions for this session",
						});
						return;
					}

					await sessionRouter.sendPermissionDecision(payload, userId);
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
			socketUserMap.delete(socket.id);
			console.log(`[gateway] Webui disconnected: ${socket.id}`);
		});
	});

	// Return emitter function for CLI handlers to use
	return {
		emitToAll,
		emitToSubscribers,
		emitToUser,
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
