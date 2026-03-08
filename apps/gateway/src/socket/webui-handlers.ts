import type {
	CliStatusPayload,
	PermissionDecisionPayload,
	PermissionRequestPayload,
	SessionEvent,
	SessionsChangedPayload,
} from "@mobvibe/shared";
import type { Server, Socket } from "socket.io";
import { auth } from "../lib/auth.js";
import { logger } from "../lib/logger.js";
import type { CliRegistry } from "../services/cli-registry.js";
import type { UserAffinityManager } from "../services/user-affinity.js";

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
	userAffinity: UserAffinityManager | null = null,
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

	// Forward CLI status to webui (user-filtered)
	cliRegistry.onCliStatus((payload: CliStatusPayload) => {
		if (payload.userId) {
			emitToUser(payload.userId, "cli:status", payload);
		}
		// No userId → silently discard (auth middleware guarantees userId on CLIs)
	});

	// Forward session updates to subscribers
	cliRegistry.on("sessions:updated", (_machineId: string) => {
		// HTTP-first: session list is fetched via REST on demand
	});

	// Forward sessions:changed events to webui clients
	cliRegistry.onSessionsChanged(
		(_machineId: string, payload: SessionsChangedPayload, userId?: string) => {
			if (userId) {
				emitToUser(userId, "sessions:changed", payload);
			}
			// No userId → silently discard
		},
	);

	// Authenticate WebSocket connections before allowing them
	webuiNamespace.use(async (socket, next) => {
		try {
			const token = socket.handshake.auth?.token as string | undefined;
			const cookies = socket.handshake.headers.cookie;

			if (!token && !cookies) {
				next(new Error("AUTH_REQUIRED"));
				return;
			}

			const headers = new Headers();
			if (token) {
				headers.set("authorization", `Bearer ${token}`);
			} else if (cookies) {
				headers.set("cookie", cookies);
			}

			const session = await auth.api.getSession({ headers });
			if (!session?.user) {
				next(new Error("AUTH_REQUIRED"));
				return;
			}
			socket.data.userId = session.user.id;
			socket.data.userEmail = session.user.email;
			next();
		} catch (error) {
			logger.error({ socketId: socket.id, error }, "webui_auth_error");
			next(new Error("AUTH_REQUIRED"));
		}
	});

	webuiNamespace.on("connection", (socket: Socket) => {
		const authSocket = socket as AuthenticatedSocket;
		const userId = authSocket.data.userId;
		if (!userId) {
			logger.error({ socketId: socket.id }, "webui_missing_userId");
			socket.disconnect(true);
			return;
		}
		socketUserMap.set(socket.id, userId);

		// Claim user affinity for this instance
		if (userAffinity) {
			userAffinity.claimUser(userId).catch((err) => {
				logger.warn({ err, userId }, "webui_claim_user_failed");
			});
		}

		logger.info({ socketId: socket.id, userId }, "webui_authenticated");

		// Send current CLI status for this user (auth middleware guarantees userId)
		const clis = cliRegistry.getClisForUser(userId);

		for (const cli of clis) {
			socket.emit("cli:status", {
				machineId: cli.machineId,
				connected: true,
				hostname: cli.hostname,
				sessionCount: cli.sessions.length,
				userId: cli.userId,
				backendCapabilities: cli.backendCapabilities,
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
			sessionSubscriptions.get(sessionId)?.set(socket.id, userId);
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

		// Disconnect
		socket.on("disconnect", () => {
			// Remove from all subscriptions
			for (const subscribers of sessionSubscriptions.values()) {
				subscribers.delete(socket.id);
			}
			socketUserMap.delete(socket.id);
			logger.info({ socketId: socket.id }, "webui_disconnected");

			// Release user affinity if no more connections for this user
			if (userAffinity && userId) {
				const hasCliConnections = cliRegistry.getClisForUser(userId).length > 0;
				const hasOtherWebuiConnections = Array.from(
					webuiNamespace.sockets.values(),
				).some(
					(s) =>
						s.id !== socket.id &&
						(s as AuthenticatedSocket).data.userId === userId,
				);
				if (!hasCliConnections && !hasOtherWebuiConnections) {
					userAffinity.releaseUser(userId).catch((err) => {
						logger.warn({ err, userId }, "webui_release_user_failed");
					});
				}
			}
		});
	});

	// Return emitter functions for CLI handlers to use
	return {
		emitToUser,
		hasUserConnections: (userId: string) =>
			Array.from(webuiNamespace.sockets.values()).some(
				(socket) => (socket as AuthenticatedSocket).data.userId === userId,
			),
		hasSessionSubscribers: (sessionId: string, userId?: string) => {
			const subscribers = sessionSubscriptions.get(sessionId);
			if (!subscribers || subscribers.size === 0) {
				return false;
			}
			if (!userId) {
				return subscribers.size > 0;
			}
			return Array.from(subscribers.values()).some(
				(subscriberUserId) => subscriberUserId === userId,
			);
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
	};
}
