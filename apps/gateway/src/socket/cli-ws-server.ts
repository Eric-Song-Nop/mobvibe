import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import {
	type CliControlWireMessage,
	type CliToGatewayWireMessage,
	initCrypto,
	type SignedAuthToken,
	verifySignedToken,
} from "@mobvibe/shared";
import { type RawData, type WebSocket, WebSocketServer } from "ws";
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

class WebSocketCliTransport implements CliTransport {
	private readonly disconnects = new CliTransportDisconnectEmitter();
	readonly id = randomUUID();

	constructor(private readonly socket: WebSocket) {}

	close(code?: number, reason?: string): void {
		this.socket.close(code, reason);
	}

	onDisconnect(listener: (reason?: string) => void): () => void {
		return this.disconnects.on(listener);
	}

	send(type: string, payload: unknown): void {
		const message = {
			type,
			payload,
		};
		this.socket.send(JSON.stringify(message));
	}

	emitDisconnect(reason?: string) {
		this.disconnects.emit(reason);
	}
}

const parseMessage = (
	data: RawData,
): CliControlWireMessage | CliToGatewayWireMessage | null => {
	try {
		const text =
			typeof data === "string"
				? data
				: data instanceof ArrayBuffer
					? Buffer.from(data).toString("utf8")
					: Array.isArray(data)
						? Buffer.concat(data).toString("utf8")
						: Buffer.from(data).toString("utf8");
		return JSON.parse(text) as CliControlWireMessage | CliToGatewayWireMessage;
	} catch {
		return null;
	}
};

export const createCliWsServer = ({
	config,
	cliRegistry,
	emitToWebui,
	notificationService,
	sessionRouter,
	userAffinity,
	hasOtherUserConnections,
}: {
	config: GatewayConfig;
	cliRegistry: CliRegistry;
	emitToWebui: (event: string, payload: unknown, userId?: string) => void;
	hasOtherUserConnections: (userId: string) => boolean;
	notificationService?: NotificationService;
	sessionRouter: SessionRouter;
	userAffinity: UserAffinityManager | null;
}) => {
	const wsServer = new WebSocketServer({
		noServer: true,
		path: "/cli-ws",
	});
	const cryptoReady = initCrypto();
	const connectionHandlers = createCliConnectionHandlers({
		cliRegistry,
		emitToWebui,
		hasOtherUserConnections,
		notificationService,
		sessionRouter,
		userAffinity,
	});

	wsServer.on("connection", (socket: WebSocket, req: IncomingMessage) => {
		const transport = new WebSocketCliTransport(socket);
		const context: {
			deviceId?: string;
			transport: CliTransport;
			userId?: string;
		} = { transport };
		let authenticated = false;

		logger.info(
			{
				transportId: transport.id,
				remoteAddress: req.socket.remoteAddress,
			},
			"cli_ws_connected",
		);

		socket.on("message", async (data: RawData) => {
			const message = parseMessage(data);
			if (!message) {
				logger.warn({ transportId: transport.id }, "cli_ws_invalid_message");
				transport.send("auth-error", {
					code: "INVALID_MESSAGE",
					message: "Invalid JSON message.",
				});
				transport.close(1008, "INVALID_MESSAGE");
				return;
			}

			if (!authenticated) {
				if (message.type !== "auth") {
					transport.send("auth-error", {
						code: "AUTH_REQUIRED",
						message: "Authenticate before sending CLI messages.",
					});
					transport.close(1008, "AUTH_REQUIRED");
					return;
				}

				await cryptoReady;
				const authToken = message.payload as SignedAuthToken | undefined;
				if (
					!authToken?.payload?.publicKey ||
					!authToken?.payload?.timestamp ||
					!authToken?.signature
				) {
					transport.send("auth-error", {
						code: "AUTH_REQUIRED",
						message: "Missing signed auth token.",
					});
					transport.close(1008, "AUTH_REQUIRED");
					return;
				}

				try {
					const verified = verifySignedToken(authToken, 5 * 60 * 1000);
					if (!verified) {
						transport.send("auth-error", {
							code: "INVALID_TOKEN",
							message: "Invalid device signature.",
						});
						transport.close(1008, "INVALID_TOKEN");
						return;
					}

					const { authenticateCliToken } = await import("./cli-connection.js");
					const authInfo = await authenticateCliToken(verified.publicKey);
					if (!authInfo) {
						transport.send("auth-error", {
							code: "DEVICE_NOT_REGISTERED",
							message:
								"Device not authenticated. Run 'mobvibe login' to register.",
						});
						transport.close(1008, "DEVICE_NOT_REGISTERED");
						return;
					}

					if (userAffinity) {
						const target = await userAffinity.getUserInstance(authInfo.userId);
						if (target && target.instanceId !== config.instanceId) {
							logger.info(
								{
									userId: authInfo.userId,
									targetInstance: target.instanceId,
									thisInstance: config.instanceId,
								},
								"cli_ws_affinity_redirect",
							);
							transport.send("redirect", {
								instanceId: target.instanceId,
							});
							transport.close(4003, "WRONG_INSTANCE");
							return;
						}
					}

					authenticated = true;
					context.userId = authInfo.userId;
					context.deviceId = authInfo.deviceId;
					transport.send("auth-ok", authInfo);
					logger.info(
						{
							userId: authInfo.userId,
							deviceId: authInfo.deviceId,
							transportId: transport.id,
						},
						"cli_ws_authenticated",
					);
				} catch (error) {
					logger.error({ err: error }, "cli_ws_auth_error");
					transport.send("auth-error", {
						code: "AUTH_ERROR",
						message: "Failed to verify signed auth token.",
					});
					transport.close(1011, "AUTH_ERROR");
				}
				return;
			}

			if (!cliMessageTypes.includes(message.type as never)) {
				logger.warn(
					{ transportId: transport.id, type: message.type },
					"cli_ws_unknown_message",
				);
				return;
			}

			await connectionHandlers.handleMessage(
				context,
				message.type as never,
				message.payload as never,
			);
		});

		socket.on("close", (_code: number, reasonBuffer: Buffer) => {
			const reason =
				typeof reasonBuffer === "string"
					? reasonBuffer
					: Buffer.from(reasonBuffer).toString("utf8");
			transport.emitDisconnect(reason);
			if (authenticated) {
				void connectionHandlers.handleDisconnect(context, reason);
			}
		});

		socket.on("error", (error: Error) => {
			logger.warn({ err: error, transportId: transport.id }, "cli_ws_error");
		});
	});

	return wsServer;
};
