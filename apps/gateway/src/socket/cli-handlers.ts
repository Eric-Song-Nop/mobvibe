import type {
	AgentTeamsChangedPayload,
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
import type { GatewayConfig } from "../config.js";
import { logger } from "../lib/logger.js";
import type { CliRecord, CliRegistry } from "../services/cli-registry.js";
import {
	findDeviceByPublicKey,
	upsertMachine,
} from "../services/db-service.js";
import type { NotificationService } from "../services/notification-service.js";
import type { SessionRouter } from "../services/session-router.js";
import type { TeamRouter } from "../services/team-router.js";
import type { UserAffinityProvider } from "../services/user-affinity.js";

/**
 * Extended socket data with auth info.
 */
interface SocketData {
	userId?: string;
	deviceId?: string;
}

const MAX_PRE_REGISTRATION_EVENTS = 1_000;
const MAX_PRE_REGISTRATION_BYTES = 4 * 1024 * 1024;

const selectDiscoveredSessionTimestamp = (
	existing: string | undefined,
	provided: string | null | undefined,
	discoveredAt: string,
): string => {
	const validValues = [existing, provided].filter(
		(value): value is string =>
			typeof value === "string" && !Number.isNaN(Date.parse(value)),
	);
	return (
		validValues.reduce<string | undefined>((latest, value) => {
			if (latest === undefined || Date.parse(value) > Date.parse(latest)) {
				return value;
			}
			return latest;
		}, undefined) ?? discoveredAt
	);
};

const getSerializedPayloadBytes = (payload: unknown): number | undefined => {
	try {
		const serialized = JSON.stringify(payload);
		return typeof serialized === "string"
			? Buffer.byteLength(serialized, "utf8")
			: undefined;
	} catch {
		return undefined;
	}
};

export type CliHandlersDeps = {
	io: Server;
	cliRegistry: CliRegistry;
	sessionRouter: SessionRouter;
	teamRouter: TeamRouter;
	emitToWebui: (event: string, payload: unknown, userId?: string) => void;
	getUserAffinity: UserAffinityProvider;
	config: GatewayConfig;
	notificationService?: NotificationService;
};

export function setupCliHandlers(
	io: Server,
	cliRegistry: CliRegistry,
	sessionRouter: SessionRouter,
	teamRouter: TeamRouter,
	emitToWebui: (event: string, payload: unknown, userId?: string) => void,
	getUserAffinity: UserAffinityProvider = () => null,
	config?: GatewayConfig,
	notificationService?: NotificationService,
) {
	const cliNamespace = io.of("/cli");

	const isActiveCliSession = (
		record: ReturnType<CliRegistry["getCliBySocketId"]>,
		sessionId: string,
	): boolean => {
		if (!record) {
			return false;
		}
		const session = record.sessions.find(
			(candidate) => candidate.sessionId === sessionId,
		);
		return session ? session.isAttached !== false : true;
	};

	// Ensure crypto is ready for signature verification
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

			// Claim affinity before accepting the socket. A read followed by a later
			// claim lets two instances accept the same user concurrently.
			const userAffinity = getUserAffinity();
			if (userAffinity && config) {
				const claimed = await userAffinity.claimUser(device.userId);
				if (!claimed) {
					const target = await userAffinity.getUserInstance(device.userId);
					logger.info(
						{
							userId: device.userId,
							targetInstance: target?.instanceId,
							thisInstance: config.instanceId,
						},
						"cli_affinity_wrong_instance",
					);
					return next(
						new Error(
							target?.instanceId
								? `WRONG_INSTANCE:${target.instanceId}`
								: "AFFINITY_UNAVAILABLE",
						),
					);
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
		let disconnected = false;
		let registrationAttempt: Promise<CliRecord | undefined> | undefined;
		let pendingRegistrationEvents: Array<{
			event: string;
			handler: (record: CliRecord) => void;
		}> = [];
		let pendingRegistrationBytes = 0;

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

		const withRegisteredCli = (
			event: string,
			payload: unknown,
			handler: (record: CliRecord) => void,
		): void => {
			if (disconnected) {
				return;
			}
			const record = cliRegistry.getCliBySocketId(socket.id);
			if (record) {
				try {
					handler(record);
				} catch (error) {
					logger.error(
						{ err: error, socketId: socket.id, event },
						"cli_registered_event_failed",
					);
					disconnected = true;
					pendingRegistrationEvents = [];
					socket.disconnect(true);
				}
				return;
			}

			const pendingRegistration = registrationAttempt;
			if (!pendingRegistration) {
				logger.warn({ socketId: socket.id, event }, "cli_event_unregistered");
				return;
			}

			const payloadBytes = getSerializedPayloadBytes(payload);
			if (payloadBytes === undefined) {
				logger.error(
					{ socketId: socket.id, event },
					"cli_event_payload_invalid",
				);
				disconnected = true;
				pendingRegistrationEvents = [];
				pendingRegistrationBytes = 0;
				socket.emit("cli:error", {
					code: "INVALID_EVENT_PAYLOAD",
					message: "Event payload must be JSON serializable.",
				});
				socket.disconnect(true);
				return;
			}

			const queuedBytes = Buffer.byteLength(event, "utf8") + payloadBytes;
			if (pendingRegistrationBytes + queuedBytes > MAX_PRE_REGISTRATION_BYTES) {
				logger.error(
					{
						socketId: socket.id,
						event,
						queuedBytes: pendingRegistrationBytes,
						payloadBytes: queuedBytes,
						limitBytes: MAX_PRE_REGISTRATION_BYTES,
					},
					"cli_pre_registration_queue_bytes_overflow",
				);
				disconnected = true;
				pendingRegistrationEvents = [];
				pendingRegistrationBytes = 0;
				socket.emit("cli:error", {
					code: "REGISTRATION_BACKPRESSURE",
					message: "Registration event buffer exceeded its byte limit.",
				});
				socket.disconnect(true);
				return;
			}

			if (pendingRegistrationEvents.length >= MAX_PRE_REGISTRATION_EVENTS) {
				logger.error(
					{
						socketId: socket.id,
						event,
						limit: MAX_PRE_REGISTRATION_EVENTS,
					},
					"cli_pre_registration_queue_overflow",
				);
				disconnected = true;
				pendingRegistrationEvents = [];
				pendingRegistrationBytes = 0;
				socket.emit("cli:error", {
					code: "REGISTRATION_BACKPRESSURE",
					message: "Too many events arrived before registration completed.",
				});
				socket.disconnect(true);
				return;
			}

			pendingRegistrationBytes += queuedBytes;
			pendingRegistrationEvents.push({ event, handler });
		};

		const flushPendingRegistrationEvents = (record: CliRecord): boolean => {
			const pending = pendingRegistrationEvents;
			pendingRegistrationEvents = [];
			pendingRegistrationBytes = 0;
			for (const queued of pending) {
				if (
					disconnected ||
					cliRegistry.getCliBySocketId(socket.id) !== record
				) {
					return false;
				}
				try {
					queued.handler(record);
				} catch (error) {
					logger.error(
						{ err: error, socketId: socket.id, event: queued.event },
						"cli_queued_event_failed",
					);
					disconnected = true;
					pendingRegistrationBytes = 0;
					socket.disconnect(true);
					return false;
				}
			}
			return true;
		};

		const registerCli = async (
			info: CliRegistrationInfo,
		): Promise<CliRecord | undefined> => {
			const rawMachineId = info.machineId;
			try {
				// Create or update machine record in database
				logger.info(
					{ machineId: rawMachineId, hostname: info.hostname, userId },
					"cli_register_start",
				);
				const machineResult = await upsertMachine({
					rawMachineId,
					userId,
					name: info.hostname,
					hostname: info.hostname,
					platform: undefined,
				});

				if (!machineResult) {
					pendingRegistrationEvents = [];
					pendingRegistrationBytes = 0;
					logger.error(
						{ machineId: info.machineId, userId },
						"cli_register_failed",
					);
					socket.emit("cli:error", {
						code: "REGISTRATION_ERROR",
						message: "Failed to register machine. Please try again.",
					});
					socket.disconnect(true);
					return undefined;
				}

				if (disconnected) {
					pendingRegistrationEvents = [];
					pendingRegistrationBytes = 0;
					logger.info(
						{ socketId: socket.id, machineId: rawMachineId },
						"cli_registration_aborted_disconnected",
					);
					return undefined;
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
				if (!flushPendingRegistrationEvents(record)) {
					cliRegistry.unregister(socket.id);
					return undefined;
				}

				// Claim user affinity for this instance. Affinity failure must not
				// invalidate an otherwise authenticated live connection.
				const userAffinity = getUserAffinity();
				if (userAffinity) {
					try {
						await userAffinity.claimUser(userId);
					} catch (error) {
						logger.warn({ err: error, userId }, "cli_claim_user_failed");
					}
				}

				if (
					disconnected ||
					cliRegistry.getCliBySocketId(socket.id) !== record
				) {
					return undefined;
				}

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
				return record;
			} catch (error) {
				pendingRegistrationEvents = [];
				pendingRegistrationBytes = 0;
				logger.error(
					{ err: error, machineId: info.machineId, userId },
					"cli_register_error",
				);
				socket.emit("cli:error", {
					code: "REGISTRATION_ERROR",
					message: "Failed to register machine. Please try again.",
				});
				socket.disconnect(true);
				return undefined;
			}
		};

		// CLI registration (after auth)
		socket.on("cli:register", (info: CliRegistrationInfo) => {
			if (registrationAttempt || cliRegistry.getCliBySocketId(socket.id)) {
				logger.warn({ socketId: socket.id }, "cli_duplicate_registration");
				return;
			}
			const attempt = registerCli(info);
			registrationAttempt = attempt;
			void attempt.finally(() => {
				if (registrationAttempt === attempt) {
					registrationAttempt = undefined;
				}
			});
		});

		// Heartbeat
		socket.on("cli:heartbeat", () => {
			// Just acknowledge
		});

		// Sessions list update (initial sync and heartbeat)
		socket.on("sessions:list", (sessions: SessionSummary[]) => {
			withRegisteredCli("sessions:list", sessions, () => {
				cliRegistry.updateSessions(socket.id, sessions);
				logger.debug(
					{ socketId: socket.id, sessionCount: sessions.length },
					"cli_sessions_list",
				);
			});
		});

		// Incremental sessions update
		socket.on("sessions:changed", (payload: SessionsChangedPayload) => {
			withRegisteredCli("sessions:changed", payload, () => {
				logger.info(
					{
						socketId: socket.id,
						added: payload.added.length,
						updated: payload.updated.length,
						removed: payload.removed.length,
					},
					"cli_sessions_changed",
				);
				if (payload.backendCapabilities) {
					cliRegistry.updateBackendCapabilities(
						socket.id,
						payload.backendCapabilities,
					);
				}
				cliRegistry.updateSessionsIncremental(socket.id, payload);
			});
		});

		// Historical sessions discovered from ACP agent
		socket.on("sessions:discovered", (payload: SessionsDiscoveredPayload) => {
			withRegisteredCli("sessions:discovered", payload, (cliRecord) => {
				const { sessions, capabilities } = payload;

				// Update per-backend capabilities from discovery result
				if (capabilities && payload.backendId) {
					cliRegistry.updateBackendCapabilities(socket.id, {
						[payload.backendId]: capabilities,
					});
				}

				// Transform AcpSessionInfo to SessionSummary with historical markers
				const existingSessions = new Map(
					cliRecord.sessions.map((session) => [session.sessionId, session]),
				);
				const discoveredAt = new Date().toISOString();
				const historicalSessions: SessionSummary[] = sessions.map((s) => {
					const existing = existingSessions.get(s.sessionId);
					const updatedAt = selectDiscoveredSessionTimestamp(
						existing?.updatedAt,
						s.updatedAt,
						discoveredAt,
					);
					return {
						sessionId: s.sessionId,
						title: s.title ?? `Session ${s.sessionId.slice(0, 8)}`,
						cwd: s.cwd,
						workspaceRootCwd: s.workspaceRootCwd,
						updatedAt,
						createdAt: existing?.createdAt ?? updatedAt,
						backendId: payload.backendId,
						backendLabel: payload.backendLabel,
						machineId: cliRecord.machineId,
						additionalDirectories: s.additionalDirectories ?? [],
						_meta: s._meta ?? null,
					};
				});

				const changes = cliRegistry.addDiscoveredSessions(
					socket.id,
					historicalSessions,
				);

				// Emit sessions:changed to webui (with capabilities even if no metadata changed)
				if (
					cliRecord.userId &&
					(changes.added.length > 0 ||
						changes.updated.length > 0 ||
						capabilities)
				) {
					emitToWebui(
						"sessions:changed",
						{
							...changes,
							backendCapabilities: payload.backendId
								? { [payload.backendId]: capabilities }
								: undefined,
						},
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
		});

		// Note: session:update and session:error are deprecated - all content updates
		// now go through session:event (WAL-persisted events with seq/revision)

		socket.on("agent-teams:changed", (payload: AgentTeamsChangedPayload) => {
			withRegisteredCli("agent-teams:changed", payload, (record) => {
				const payloadWithMachineId: AgentTeamsChangedPayload = {
					...payload,
					machineId: record.machineId,
					added: payload.added.map((team) => ({
						...team,
						machineId: record.machineId,
					})),
					updated: payload.updated.map((team) => ({
						...team,
						machineId: record.machineId,
					})),
				};
				logger.info(
					{
						machineId: payloadWithMachineId.machineId,
						added: payload.added.length,
						updated: payload.updated.length,
						removed: payload.removed.length,
					},
					"agent_teams_changed_received",
				);
				emitToWebui("agent-teams:changed", payloadWithMachineId, record.userId);
			});
		});

		// Session attached
		socket.on("session:attached", (payload: SessionAttachedPayload) => {
			withRegisteredCli("session:attached", payload, (record) => {
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
		});

		// Session detached
		socket.on("session:detached", (payload: SessionDetachedPayload) => {
			withRegisteredCli("session:detached", payload, (record) => {
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
		});

		// Permission request from CLI
		socket.on("permission:request", (payload: PermissionRequestPayload) => {
			withRegisteredCli("permission:request", payload, (record) => {
				logger.info(
					{ sessionId: payload.sessionId, requestId: payload.requestId },
					"permission_request_received",
				);
				emitToWebui("permission:request", payload, record.userId);
				if (
					record.userId &&
					notificationService &&
					isActiveCliSession(record, payload.sessionId)
				) {
					void notificationService.notifyPermissionRequest(
						record.userId,
						payload,
					);
				}
			});
		});

		// Permission result from CLI
		socket.on("permission:result", (payload: PermissionDecisionPayload) => {
			withRegisteredCli("permission:result", payload, (record) => {
				logger.info(
					{ sessionId: payload.sessionId, requestId: payload.requestId },
					"permission_result_received",
				);
				emitToWebui("permission:result", payload, record.userId);
			});
		});

		// Session event (WAL-persisted events with seq/revision)
		// Note: terminal:output is deprecated - terminal output now goes through
		// session:event with kind="terminal_output"
		socket.on("session:event", (event: SessionEvent) => {
			withRegisteredCli("session:event", event, (record) => {
				const eventWithMachineId: SessionEvent = {
					...event,
					machineId: record.machineId,
				};
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
				emitToWebui("session:event", eventWithMachineId, record.userId);
				if (
					record.userId &&
					notificationService &&
					isActiveCliSession(record, event.sessionId)
				) {
					void notificationService.notifySessionEvent(
						record.userId,
						eventWithMachineId,
					);
				}

				// Send acknowledgment back to CLI only after the event has been relayed.
				socket.emit("events:ack", {
					sessionId: event.sessionId,
					revision: event.revision,
					upToSeq: event.seq,
				});
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
			sessionRouter.handleRpcResponse(response, socket.id);
			teamRouter.handleRpcResponse(response, socket.id);
		});

		// Disconnect
		socket.on("disconnect", (reason) => {
			disconnected = true;
			pendingRegistrationEvents = [];
			pendingRegistrationBytes = 0;
			sessionRouter.handleCliDisconnect(socket.id);
			teamRouter.handleCliDisconnect(socket.id);
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
					// Only emit detached for sessions that were actually attached
					// (skip discovered sessions that were never attached)
					if (!session.isAttached) continue;
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

				// Do not eagerly release affinity here. A reconnect can claim/refresh
				// between the local connection check and Redis deletion, allowing this
				// stale disconnect to delete the new lease. The 300s TTL safely reaps
				// inactive users, while the renewal loop keeps active users pinned.
			}
		});
	});

	return cliNamespace;
}
