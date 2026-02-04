import type {
	CliStatusPayload,
	PermissionDecisionPayload,
	PermissionRequestPayload,
	SessionEvent,
	SessionNotification,
	SessionsChangedPayload,
	StreamErrorPayload,
	TerminalOutputEvent,
} from "@mobvibe/shared";
import type { Server, Socket } from "socket.io";
import { auth } from "../lib/auth.js";
import { logger } from "../lib/logger.js";
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
	cliRegistry.on("sessions:updated", (_machineId: string) => {
		// HTTP-first: session list is fetched via REST on demand
	});

	// Forward sessions:changed events to webui clients
	cliRegistry.onSessionsChanged(
		(machineId: string, payload: SessionsChangedPayload, userId?: string) => {
			if (userId) {
				// Only emit to the user who owns this CLI
				emitToUser(userId, "sessions:changed", payload);
			} else {
				// Auth disabled - emit to all
				emitToAll("sessions:changed", payload);
			}
		},
	);

	webuiNamespace.on("connection", async (socket: Socket) => {
		const authSocket = socket as AuthenticatedSocket;
		authSocket.data = {};

		logger.info({ socketId: socket.id }, "webui_connected");

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
					logger.info(
						{ socketId: socket.id, userId: session.user.id },
						"webui_authenticated",
					);
				} else {
					logger.warn({ socketId: socket.id }, "webui_auth_missing_session");
				}
			} else {
				logger.info({ socketId: socket.id }, "webui_connected_no_cookies");
			}
		} catch (error) {
			logger.error(
				{
					socketId: socket.id,
					error,
				},
				"webui_auth_error",
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

		// Subscribe to session updates - with ownership check
		socket.on("subscribe:session", (payload: { sessionId: string }) => {
			const { sessionId } = payload;

			// Check ownership if auth enabled
			if (userId && !cliRegistry.isSessionOwnedByUser(sessionId, userId)) {
				logger.warn(
					{ socketId: socket.id, sessionId, userId },
					"webui_subscribe_denied",
				);
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
			logger.info(
				{ socketId: socket.id, sessionId, userId },
				"webui_subscribed",
			);
		});

		// Unsubscribe from session updates
		socket.on("unsubscribe:session", (payload: { sessionId: string }) => {
			const { sessionId } = payload;
			sessionSubscriptions.get(sessionId)?.delete(socket.id);
			logger.info({ socketId: socket.id, sessionId }, "webui_unsubscribed");
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
						logger.warn(
							{
								sessionId: payload.sessionId,
								requestId: payload.requestId,
								userId,
							},
							"permission_decision_denied",
						);
						socket.emit("permission:error", {
							sessionId: payload.sessionId,
							requestId: payload.requestId,
							error: "Not authorized to make decisions for this session",
						});
						return;
					}

					await sessionRouter.sendPermissionDecision(payload, userId);
					logger.info(
						{
							sessionId: payload.sessionId,
							requestId: payload.requestId,
							userId,
						},
						"permission_decision_sent",
					);
				} catch (error) {
					logger.error(
						{
							error,
							sessionId: payload.sessionId,
							requestId: payload.requestId,
						},
						"permission_decision_error",
					);
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
			logger.info({ socketId: socket.id }, "webui_disconnected");
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
		emitSessionEvent: (event: SessionEvent) => {
			emitToSubscribers(event.sessionId, "session:event", event);
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
