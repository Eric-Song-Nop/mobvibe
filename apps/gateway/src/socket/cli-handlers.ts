import type { SignedAuthToken } from "@mobvibe/shared";
import { initCrypto, verifySignedToken } from "@mobvibe/shared";
import type { Server, Socket } from "socket.io";
import type { GatewayConfig } from "../config.js";
import { logger } from "../lib/logger.js";
import type { CliRegistry } from "../services/cli-registry.js";
import {
	type CliTransport,
	CliTransportDisconnectEmitter,
} from "../services/cli-transport.js";
import type { NotificationService } from "../services/notification-service.js";
import type { SessionRouter } from "../services/session-router.js";
import type { UserAffinityManager } from "../services/user-affinity.js";
import {
	cliMessageTypes,
	createCliConnectionHandlers,
} from "./cli-connection.js";

interface SocketData {
	deviceId?: string;
	userId?: string;
}

class SocketIoCliTransport implements CliTransport {
	private readonly disconnects = new CliTransportDisconnectEmitter();

	constructor(private readonly socket: Socket) {}

	get id() {
		return this.socket.id;
	}

	close(): void {
		this.socket.disconnect(true);
	}

	onDisconnect(listener: (reason?: string) => void): () => void {
		return this.disconnects.on(listener);
	}

	send(type: string, payload: unknown): void {
		this.socket.emit(type, payload);
	}

	emitDisconnect(reason?: string) {
		this.disconnects.emit(reason);
	}
}

export function setupCliHandlers(
	io: Server,
	cliRegistry: CliRegistry,
	sessionRouter: SessionRouter,
	emitToWebui: (event: string, payload: unknown, userId?: string) => void,
	userAffinity: UserAffinityManager | null = null,
	config?: GatewayConfig,
	notificationService?: NotificationService,
) {
	const cliNamespace = io.of("/cli");
	const cryptoReady = initCrypto();
	const connectionHandlers = createCliConnectionHandlers({
		cliRegistry,
		emitToWebui,
		hasOtherUserConnections: (userId: string) =>
			Array.from(io.of("/webui").sockets.values()).some(
				(socket) =>
					(socket as Socket & { data: { userId?: string } }).data.userId ===
					userId,
			),
		notificationService,
		sessionRouter,
		userAffinity,
	});

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

			const { authenticateCliToken } = await import("./cli-connection.js");
			const authInfo = await authenticateCliToken(verified.publicKey);
			if (!authInfo) {
				logger.warn(
					{ publicKey: verified.publicKey },
					"cli_rejected_unregistered_device",
				);
				return next(new Error("DEVICE_NOT_REGISTERED"));
			}

			(socket as Socket & { data: SocketData }).data = authInfo;
			logger.info(
				{ userId: authInfo.userId, deviceId: authInfo.deviceId },
				"cli_authenticated",
			);

			if (userAffinity && config) {
				const target = await userAffinity.getUserInstance(authInfo.userId);
				if (target && target.instanceId !== config.instanceId) {
					logger.info(
						{
							userId: authInfo.userId,
							targetInstance: target.instanceId,
							thisInstance: config.instanceId,
						},
						"cli_affinity_wrong_instance",
					);
					return next(new Error(`WRONG_INSTANCE:${target.instanceId}`));
				}
			}

			return next();
		} catch (error) {
			logger.error({ err: error }, "cli_signed_token_verification_error");
			return next(new Error("AUTH_ERROR"));
		}
	});

	cliNamespace.on("connection", (socket: Socket) => {
		logger.info({ socketId: socket.id }, "cli_connected");
		const transport = new SocketIoCliTransport(socket);
		const socketData = (socket as Socket & { data: SocketData }).data;
		const context = {
			deviceId: socketData?.deviceId,
			transport,
			userId: socketData?.userId,
		};

		for (const type of cliMessageTypes) {
			socket.on(type, (payload) => {
				void connectionHandlers.handleMessage(context, type, payload as never);
			});
		}

		socket.on("disconnect", (reason) => {
			transport.emitDisconnect(reason);
			void connectionHandlers.handleDisconnect(context, reason);
		});
	});

	return cliNamespace;
}
