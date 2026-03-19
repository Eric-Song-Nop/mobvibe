import type {
	CliRegistrationInfo,
	CliToGatewayWirePayloadMap,
	CliToGatewayWireType,
	PermissionDecisionPayload,
	PermissionRequestPayload,
	RpcResponse,
	SessionAttachedPayload,
	SessionDetachedPayload,
	SessionEvent,
	SessionSummary,
	SessionsChangedPayload,
	SessionsDiscoveredPayload,
} from "@mobvibe/shared";
import { logger } from "../lib/logger.js";
import type { CliRegistry } from "../services/cli-registry.js";
import type { CliTransport } from "../services/cli-transport.js";
import {
	findDeviceByPublicKey,
	upsertMachine,
} from "../services/db-service.js";
import type { NotificationService } from "../services/notification-service.js";
import type { SessionRouter } from "../services/session-router.js";
import type { UserAffinityManager } from "../services/user-affinity.js";

export type AuthenticatedCliContext = {
	deviceId?: string;
	transport: CliTransport;
	userId?: string;
};

type CliConnectionDeps = {
	cliRegistry: CliRegistry;
	emitToWebui: (event: string, payload: unknown, userId?: string) => void;
	hasOtherUserConnections: (userId: string) => boolean;
	notificationService?: NotificationService;
	sessionRouter: SessionRouter;
	userAffinity: UserAffinityManager | null;
};

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

const forwardRegistration = async (
	context: AuthenticatedCliContext,
	info: CliRegistrationInfo,
	deps: CliConnectionDeps,
) => {
	const { cliRegistry, userAffinity } = deps;
	const rawMachineId = info.machineId;
	const userId = context.userId;
	const deviceId = context.deviceId;

	if (!userId || !deviceId) {
		logger.warn(
			{ transportId: context.transport.id },
			"cli_rejected_missing_auth_data",
		);
		context.transport.send("cli:error", {
			code: "AUTH_REQUIRED",
			message: "Device not authenticated. Run 'mobvibe login' to register.",
		});
		context.transport.close(4001, "AUTH_REQUIRED");
		return;
	}

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
		logger.error({ machineId: info.machineId, userId }, "cli_register_failed");
		context.transport.send("cli:error", {
			code: "REGISTRATION_ERROR",
			message: "Failed to register machine. Please try again.",
		});
		context.transport.close(1011, "REGISTRATION_ERROR");
		return;
	}

	const resolvedMachineId = machineResult.machineId;
	const record = cliRegistry.register(
		context.transport,
		{ ...info, machineId: resolvedMachineId },
		{
			userId,
			deviceId,
		},
	);

	if (userAffinity) {
		await userAffinity.claimUser(userId);
	}

	context.transport.send("cli:registered", {
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
};

const forwardDiscoveredSessions = (
	context: AuthenticatedCliContext,
	payload: SessionsDiscoveredPayload,
	deps: CliConnectionDeps,
) => {
	const { cliRegistry, emitToWebui } = deps;
	const cliRecord = cliRegistry.getCliBySocketId(context.transport.id);
	if (!cliRecord) {
		logger.warn(
			{ transportId: context.transport.id },
			"sessions_discovered_no_cli_record",
		);
		return;
	}

	const { sessions, capabilities } = payload;
	if (capabilities && payload.backendId) {
		cliRegistry.updateBackendCapabilities(context.transport.id, {
			[payload.backendId]: capabilities,
		});
	}

	const historicalSessions: SessionSummary[] = sessions.map((session) => ({
		sessionId: session.sessionId,
		title: session.title ?? `Session ${session.sessionId.slice(0, 8)}`,
		cwd: session.cwd,
		workspaceRootCwd: session.workspaceRootCwd,
		updatedAt: session.updatedAt ?? new Date().toISOString(),
		createdAt: session.updatedAt ?? new Date().toISOString(),
		backendId: payload.backendId,
		backendLabel: payload.backendLabel,
		machineId: cliRecord.machineId,
	}));

	const added = cliRegistry.addDiscoveredSessions(
		context.transport.id,
		historicalSessions,
	);

	if (cliRecord.userId && (added.length > 0 || capabilities)) {
		emitToWebui(
			"sessions:changed",
			{
				added,
				updated: [],
				removed: [],
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
};

const forwardAttached = (
	context: AuthenticatedCliContext,
	payload: SessionAttachedPayload,
	deps: CliConnectionDeps,
) => {
	const record = deps.cliRegistry.getCliBySocketId(context.transport.id);
	if (!record) {
		logger.warn(
			{ transportId: context.transport.id },
			"session_attached_unregistered_cli",
		);
		return;
	}

	logger.info(
		{ sessionId: payload.sessionId, machineId: record.machineId },
		"session_attached_received",
	);
	deps.emitToWebui(
		"session:attached",
		{ ...payload, machineId: record.machineId },
		record.userId,
	);
};

const forwardDetached = (
	context: AuthenticatedCliContext,
	payload: SessionDetachedPayload,
	deps: CliConnectionDeps,
) => {
	const record = deps.cliRegistry.getCliBySocketId(context.transport.id);
	if (!record) {
		logger.warn(
			{ transportId: context.transport.id },
			"session_detached_unregistered_cli",
		);
		return;
	}

	logger.info(
		{
			sessionId: payload.sessionId,
			machineId: record.machineId,
			reason: payload.reason,
		},
		"session_detached_received",
	);
	deps.emitToWebui(
		"session:detached",
		{ ...payload, machineId: record.machineId },
		record.userId,
	);
};

const forwardPermissionRequest = (
	context: AuthenticatedCliContext,
	payload: PermissionRequestPayload,
	deps: CliConnectionDeps,
) => {
	const record = deps.cliRegistry.getCliBySocketId(context.transport.id);
	if (!record) {
		logger.warn(
			{ transportId: context.transport.id },
			"permission_request_unregistered_cli",
		);
		return;
	}

	logger.info(
		{ sessionId: payload.sessionId, requestId: payload.requestId },
		"permission_request_received",
	);
	deps.emitToWebui("permission:request", payload, record.userId);
	if (
		record.userId &&
		deps.notificationService &&
		isActiveCliSession(record, payload.sessionId)
	) {
		void deps.notificationService.notifyPermissionRequest(
			record.userId,
			payload,
		);
	}
};

const forwardPermissionResult = (
	context: AuthenticatedCliContext,
	payload: PermissionDecisionPayload,
	deps: CliConnectionDeps,
) => {
	const record = deps.cliRegistry.getCliBySocketId(context.transport.id);
	if (!record) {
		logger.warn(
			{ transportId: context.transport.id },
			"permission_result_unregistered_cli",
		);
		return;
	}

	logger.info(
		{ sessionId: payload.sessionId, requestId: payload.requestId },
		"permission_result_received",
	);
	deps.emitToWebui("permission:result", payload, record.userId);
};

const forwardSessionEvent = (
	context: AuthenticatedCliContext,
	event: SessionEvent,
	deps: CliConnectionDeps,
) => {
	const record = deps.cliRegistry.getCliBySocketId(context.transport.id);
	if (!record) {
		logger.warn(
			{ transportId: context.transport.id },
			"session_event_unregistered_cli",
		);
		return;
	}

	logger.debug(
		{
			sessionId: event.sessionId,
			revision: event.revision,
			seq: event.seq,
			kind: event.kind,
			transportId: context.transport.id,
		},
		"session_event_received",
	);
	deps.emitToWebui("session:event", event, record.userId);
	if (
		record.userId &&
		deps.notificationService &&
		isActiveCliSession(record, event.sessionId)
	) {
		void deps.notificationService.notifySessionEvent(record.userId, event);
	}

	context.transport.send("events:ack", {
		sessionId: event.sessionId,
		revision: event.revision,
		upToSeq: event.seq,
	});
};

export const createCliConnectionHandlers = (deps: CliConnectionDeps) => ({
	async handleMessage<TType extends CliToGatewayWireType>(
		context: AuthenticatedCliContext,
		type: TType,
		payload: CliToGatewayWirePayloadMap[TType],
	) {
		switch (type) {
			case "cli:register":
				await forwardRegistration(
					context,
					payload as CliRegistrationInfo,
					deps,
				);
				return;
			case "cli:heartbeat":
				return;
			case "sessions:list":
				deps.cliRegistry.updateSessions(
					context.transport.id,
					payload as SessionSummary[],
				);
				logger.debug(
					{
						transportId: context.transport.id,
						sessionCount: (payload as SessionSummary[]).length,
					},
					"cli_sessions_list",
				);
				return;
			case "sessions:changed":
				logger.info(
					{
						transportId: context.transport.id,
						added: (payload as SessionsChangedPayload).added.length,
						updated: (payload as SessionsChangedPayload).updated.length,
						removed: (payload as SessionsChangedPayload).removed.length,
					},
					"cli_sessions_changed",
				);
				deps.cliRegistry.updateSessionsIncremental(
					context.transport.id,
					payload as SessionsChangedPayload,
				);
				return;
			case "sessions:discovered":
				forwardDiscoveredSessions(
					context,
					payload as SessionsDiscoveredPayload,
					deps,
				);
				return;
			case "session:attached":
				forwardAttached(context, payload as SessionAttachedPayload, deps);
				return;
			case "session:detached":
				forwardDetached(context, payload as SessionDetachedPayload, deps);
				return;
			case "permission:request":
				forwardPermissionRequest(
					context,
					payload as PermissionRequestPayload,
					deps,
				);
				return;
			case "permission:result":
				forwardPermissionResult(
					context,
					payload as PermissionDecisionPayload,
					deps,
				);
				return;
			case "session:event":
				forwardSessionEvent(context, payload as SessionEvent, deps);
				return;
			case "rpc:response":
				logger.debug(
					{
						requestId: (payload as RpcResponse<unknown>).requestId,
						isError: Boolean((payload as RpcResponse<unknown>).error),
						code: (payload as RpcResponse<unknown>).error?.code,
					},
					"rpc_response_received",
				);
				deps.sessionRouter.handleRpcResponse(payload as RpcResponse<unknown>);
				return;
		}
	},
	async handleDisconnect(context: AuthenticatedCliContext, reason?: string) {
		const { cliRegistry, emitToWebui, userAffinity } = deps;
		const preRecord = cliRegistry.getCliBySocketId(context.transport.id);
		const cachedUserId = preRecord?.userId;
		const record = cliRegistry.unregister(context.transport.id);
		if (!record) {
			return;
		}

		logger.info(
			{
				machineId: record.machineId,
				reason,
				transportId: context.transport.id,
			},
			"cli_disconnected",
		);
		for (const session of record.sessions) {
			if (!session.isAttached) {
				continue;
			}
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

		if (userAffinity && cachedUserId) {
			const hasCliConnections =
				cliRegistry.getClisForUser(cachedUserId).length > 0;
			const hasOtherConnections = deps.hasOtherUserConnections(cachedUserId);
			if (!hasCliConnections && !hasOtherConnections) {
				await userAffinity.releaseUser(cachedUserId);
			}
		}
	},
});

export const cliMessageTypes: CliToGatewayWireType[] = [
	"cli:heartbeat",
	"cli:register",
	"permission:request",
	"permission:result",
	"rpc:response",
	"session:attached",
	"session:detached",
	"session:event",
	"sessions:changed",
	"sessions:discovered",
	"sessions:list",
];

export const authenticateCliToken = async (
	publicKey: string,
): Promise<{ deviceId: string; userId: string } | null> => {
	const device = await findDeviceByPublicKey(publicKey);
	if (!device) {
		return null;
	}
	return {
		userId: device.userId,
		deviceId: device.id,
	};
};
