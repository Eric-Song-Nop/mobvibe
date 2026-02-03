import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import type {
	AvailableCommand,
	RequestPermissionRequest,
	RequestPermissionResponse,
	SessionModelState,
	SessionModeState,
	SessionNotification,
} from "@agentclientprotocol/sdk";
import {
	type AcpSessionInfo,
	AppError,
	createErrorDetail,
	type DiscoverSessionsRpcResult,
	type ErrorDetail,
	type PermissionDecisionPayload,
	type PermissionRequestPayload,
	type SessionSummary,
	type SessionsChangedPayload,
	type TerminalOutputEvent,
} from "@mobvibe/shared";
import type { AcpBackendConfig, CliConfig } from "../config.js";
import { logger } from "../lib/logger.js";
import { AcpConnection } from "./acp-connection.js";

type SessionRecord = {
	sessionId: string;
	title: string;
	backendId: string;
	backendLabel: string;
	connection: AcpConnection;
	createdAt: Date;
	updatedAt: Date;
	cwd?: string;
	agentName?: string;
	modelId?: string;
	modelName?: string;
	modeId?: string;
	modeName?: string;
	availableModes?: Array<{ id: string; name: string }>;
	availableModels?: Array<{
		id: string;
		name: string;
		description?: string | null;
	}>;
	availableCommands?: AvailableCommand[];
	unsubscribe?: () => void;
	unsubscribeTerminal?: () => void;
	isAttached?: boolean;
	attachedAt?: Date;
};

type PermissionRequestRecord = {
	sessionId: string;
	requestId: string;
	params: RequestPermissionRequest;
	promise: Promise<RequestPermissionResponse>;
	resolve: (response: RequestPermissionResponse) => void;
};

const buildPermissionKey = (sessionId: string, requestId: string) =>
	`${sessionId}:${requestId}`;

const resolveModelState = (models?: SessionModelState | null) => {
	if (!models) {
		return {
			modelId: undefined,
			modelName: undefined,
			availableModels: undefined,
		};
	}
	const availableModels = models.availableModels?.map((model) => ({
		id: model.modelId,
		name: model.name,
		description: model.description ?? undefined,
	}));
	const modelId = models.currentModelId ?? undefined;
	const modelName = availableModels?.find(
		(model) => model.id === modelId,
	)?.name;
	return { modelId, modelName, availableModels };
};

const resolveModeState = (modes?: SessionModeState | null) => {
	if (!modes) {
		return {
			modeId: undefined,
			modeName: undefined,
			availableModes: undefined,
		};
	}
	const modeId = modes.currentModeId ?? undefined;
	const modeName = modes.availableModes?.find(
		(mode) => mode.id === modeId,
	)?.name;
	return {
		modeId,
		modeName,
		availableModes: modes.availableModes?.map((mode) => ({
			id: mode.id,
			name: mode.name,
		})),
	};
};

const createCapabilityNotSupportedError = (message: string) =>
	new AppError(
		createErrorDetail({
			code: "CAPABILITY_NOT_SUPPORTED",
			message,
			retryable: false,
			scope: "session",
		}),
		409,
	);

const isValidWorkspacePath = async (cwd: string): Promise<boolean> => {
	try {
		const stats = await fs.stat(cwd);
		return stats.isDirectory();
	} catch {
		return false;
	}
};

export class SessionManager {
	private sessions = new Map<string, SessionRecord>();
	private discoveredSessions = new Map<string, AcpSessionInfo>();
	private backendById: Map<string, AcpBackendConfig>;
	private defaultBackendId: string;
	private permissionRequests = new Map<string, PermissionRequestRecord>();
	private readonly sessionUpdateEmitter = new EventEmitter();
	private readonly sessionErrorEmitter = new EventEmitter();
	private readonly permissionRequestEmitter = new EventEmitter();
	private readonly permissionResultEmitter = new EventEmitter();
	private readonly terminalOutputEmitter = new EventEmitter();
	private readonly sessionsChangedEmitter = new EventEmitter();
	private readonly sessionAttachedEmitter = new EventEmitter();
	private readonly sessionDetachedEmitter = new EventEmitter();

	constructor(private readonly config: CliConfig) {
		this.backendById = new Map(
			config.acpBackends.map((backend) => [backend.id, backend]),
		);
		this.defaultBackendId = config.defaultAcpBackendId;
	}

	listSessions(): SessionSummary[] {
		return Array.from(this.sessions.values()).map((record) =>
			this.buildSummary(record),
		);
	}

	getSession(sessionId: string): SessionRecord | undefined {
		return this.sessions.get(sessionId);
	}

	onSessionUpdate(listener: (notification: SessionNotification) => void) {
		this.sessionUpdateEmitter.on("update", listener);
		return () => {
			this.sessionUpdateEmitter.off("update", listener);
		};
	}

	onSessionError(
		listener: (payload: { sessionId: string; error: ErrorDetail }) => void,
	) {
		this.sessionErrorEmitter.on("error", listener);
		return () => {
			this.sessionErrorEmitter.off("error", listener);
		};
	}

	onPermissionRequest(listener: (payload: PermissionRequestPayload) => void) {
		this.permissionRequestEmitter.on("request", listener);
		return () => {
			this.permissionRequestEmitter.off("request", listener);
		};
	}

	onPermissionResult(listener: (payload: PermissionDecisionPayload) => void) {
		this.permissionResultEmitter.on("result", listener);
		return () => {
			this.permissionResultEmitter.off("result", listener);
		};
	}

	onTerminalOutput(listener: (event: TerminalOutputEvent) => void) {
		this.terminalOutputEmitter.on("output", listener);
		return () => {
			this.terminalOutputEmitter.off("output", listener);
		};
	}

	onSessionsChanged(listener: (payload: SessionsChangedPayload) => void) {
		this.sessionsChangedEmitter.on("changed", listener);
		return () => {
			this.sessionsChangedEmitter.off("changed", listener);
		};
	}

	onSessionAttached(
		listener: (payload: {
			sessionId: string;
			machineId: string;
			attachedAt: string;
		}) => void,
	) {
		this.sessionAttachedEmitter.on("attached", listener);
		return () => {
			this.sessionAttachedEmitter.off("attached", listener);
		};
	}

	onSessionDetached(
		listener: (payload: {
			sessionId: string;
			machineId: string;
			detachedAt: string;
			reason:
				| "agent_exit"
				| "cli_disconnect"
				| "gateway_disconnect"
				| "unknown";
		}) => void,
	) {
		this.sessionDetachedEmitter.on("detached", listener);
		return () => {
			this.sessionDetachedEmitter.off("detached", listener);
		};
	}

	private emitSessionsChanged(payload: SessionsChangedPayload) {
		this.sessionsChangedEmitter.emit("changed", payload);
	}

	private emitSessionAttached(sessionId: string, force = false) {
		const record = this.sessions.get(sessionId);
		if (!record) {
			return;
		}
		if (record.isAttached && !force) {
			return;
		}
		const attachedAt = new Date();
		record.isAttached = true;
		record.attachedAt = attachedAt;
		this.sessionAttachedEmitter.emit("attached", {
			sessionId,
			machineId: this.config.machineId,
			attachedAt: attachedAt.toISOString(),
		});
	}

	private emitSessionDetached(
		sessionId: string,
		reason: "agent_exit" | "cli_disconnect" | "gateway_disconnect" | "unknown",
	) {
		const record = this.sessions.get(sessionId);
		if (!record) {
			return;
		}
		if (!record.isAttached) {
			return;
		}
		record.isAttached = false;
		this.sessionDetachedEmitter.emit("detached", {
			sessionId,
			machineId: this.config.machineId,
			detachedAt: new Date().toISOString(),
			reason,
		});
	}

	listPendingPermissions(sessionId: string): PermissionRequestPayload[] {
		return Array.from(this.permissionRequests.values())
			.filter((record) => record.sessionId === sessionId)
			.map((record) => this.buildPermissionRequestPayload(record));
	}

	resolvePermissionRequest(
		sessionId: string,
		requestId: string,
		outcome: RequestPermissionResponse["outcome"],
	): PermissionDecisionPayload {
		const key = buildPermissionKey(sessionId, requestId);
		const record = this.permissionRequests.get(key);
		if (!record) {
			throw new AppError(
				createErrorDetail({
					code: "REQUEST_VALIDATION_FAILED",
					message: "Permission request not found",
					retryable: false,
					scope: "request",
				}),
				404,
			);
		}
		const response: RequestPermissionResponse = { outcome };
		record.resolve(response);
		this.permissionRequests.delete(key);
		const payload: PermissionDecisionPayload = {
			sessionId,
			requestId,
			outcome,
		};
		this.permissionResultEmitter.emit("result", payload);
		return payload;
	}

	private resolveBackend(backendId?: string) {
		const normalized = backendId?.trim();
		const resolvedId =
			normalized && normalized.length > 0 ? normalized : this.defaultBackendId;
		const backend = this.backendById.get(resolvedId);
		if (!backend) {
			throw new AppError(
				createErrorDetail({
					code: "REQUEST_VALIDATION_FAILED",
					message: "Invalid backend ID",
					retryable: false,
					scope: "request",
				}),
				400,
			);
		}
		return backend;
	}

	async createSession(options?: {
		cwd?: string;
		title?: string;
		backendId?: string;
	}): Promise<SessionSummary> {
		const backend = this.resolveBackend(options?.backendId);
		const connection = new AcpConnection({
			backend,
			client: {
				name: this.config.clientName,
				version: this.config.clientVersion,
			},
		});
		try {
			await connection.connect();
			const session = await connection.createSession({ cwd: options?.cwd });
			connection.setPermissionHandler((params) =>
				this.handlePermissionRequest(session.sessionId, params),
			);
			const now = new Date();
			const agentInfo = connection.getAgentInfo();
			const { modelId, modelName, availableModels } = resolveModelState(
				session.models,
			);
			const { modeId, modeName, availableModes } = resolveModeState(
				session.modes,
			);
			const record: SessionRecord = {
				sessionId: session.sessionId,
				title: options?.title ?? `Session ${this.sessions.size + 1}`,
				backendId: backend.id,
				backendLabel: backend.label,
				connection,
				createdAt: now,
				updatedAt: now,
				cwd: options?.cwd,
				agentName: agentInfo?.title ?? agentInfo?.name,
				modelId,
				modelName,
				modeId,
				modeName,
				availableModes,
				availableModels,
				availableCommands: undefined,
			};
			record.unsubscribe = connection.onSessionUpdate(
				(notification: SessionNotification) => {
					record.updatedAt = new Date();
					this.sessionUpdateEmitter.emit("update", notification);
					this.applySessionUpdateToRecord(record, notification);
				},
			);
			record.unsubscribeTerminal = connection.onTerminalOutput((event) => {
				this.terminalOutputEmitter.emit("output", event);
			});
			connection.onStatusChange((status) => {
				if (status.error) {
					this.sessionErrorEmitter.emit("error", {
						sessionId: session.sessionId,
						error: status.error,
					});
					this.emitSessionDetached(session.sessionId, "agent_exit");
				}
			});
			this.sessions.set(session.sessionId, record);
			const summary = this.buildSummary(record);
			this.emitSessionsChanged({
				added: [summary],
				updated: [],
				removed: [],
			});
			this.emitSessionAttached(session.sessionId);
			return summary;
		} catch (error) {
			const status = connection.getStatus();
			await connection.disconnect();
			if (status.error) {
				throw new AppError(status.error, 500);
			}
			throw error;
		}
	}

	private buildPermissionRequestPayload(
		record: PermissionRequestRecord,
	): PermissionRequestPayload {
		const toolCall = record.params.toolCall;
		return {
			sessionId: record.sessionId,
			requestId: record.requestId,
			options: record.params.options.map((option) => ({
				optionId: option.optionId,
				// SDK uses 'name', our shared type uses 'label'
				label: option.name,
				description: (option._meta?.description as string) ?? null,
			})),
			toolCall: {
				toolCallId: toolCall.toolCallId,
				name: (toolCall._meta?.name as string) ?? null,
				title: toolCall.title,
				command: (toolCall._meta?.command as string) ?? null,
				args: (toolCall._meta?.args as string[]) ?? null,
			},
		};
	}

	private handlePermissionRequest(
		sessionId: string,
		params: RequestPermissionRequest,
	): Promise<RequestPermissionResponse> {
		const requestId = params.toolCall?.toolCallId ?? randomUUID();
		const key = buildPermissionKey(sessionId, requestId);
		const existing = this.permissionRequests.get(key);
		if (existing) {
			return existing.promise;
		}
		let resolver: (response: RequestPermissionResponse) => void = () => {};
		const promise = new Promise<RequestPermissionResponse>((resolve) => {
			resolver = resolve;
		});
		const record: PermissionRequestRecord = {
			sessionId,
			requestId,
			params,
			promise,
			resolve: resolver,
		};
		this.permissionRequests.set(key, record);
		this.permissionRequestEmitter.emit(
			"request",
			this.buildPermissionRequestPayload(record),
		);
		return promise;
	}

	private cancelPermissionRequests(sessionId: string) {
		const cancelledOutcome: RequestPermissionResponse["outcome"] = {
			outcome: "cancelled",
		};
		for (const [key, record] of this.permissionRequests.entries()) {
			if (record.sessionId !== sessionId) {
				continue;
			}
			record.resolve({ outcome: cancelledOutcome });
			this.permissionRequests.delete(key);
			this.permissionResultEmitter.emit("result", {
				sessionId,
				requestId: record.requestId,
				outcome: cancelledOutcome,
			});
		}
	}

	updateTitle(sessionId: string, title: string): SessionSummary {
		const record = this.sessions.get(sessionId);
		if (!record) {
			throw new AppError(
				createErrorDetail({
					code: "SESSION_NOT_FOUND",
					message: "Session not found",
					retryable: false,
					scope: "session",
				}),
				404,
			);
		}
		record.title = title;
		record.updatedAt = new Date();
		const summary = this.buildSummary(record);
		this.emitSessionsChanged({
			added: [],
			updated: [summary],
			removed: [],
		});
		return summary;
	}

	touchSession(sessionId: string) {
		const record = this.sessions.get(sessionId);
		if (!record) {
			return;
		}
		record.updatedAt = new Date();
	}

	async setSessionMode(
		sessionId: string,
		modeId: string,
	): Promise<SessionSummary> {
		const record = this.sessions.get(sessionId);
		if (!record) {
			throw new AppError(
				createErrorDetail({
					code: "SESSION_NOT_FOUND",
					message: "Session not found",
					retryable: false,
					scope: "session",
				}),
				404,
			);
		}
		if (!record.availableModes || record.availableModes.length === 0) {
			throw createCapabilityNotSupportedError(
				"Current agent does not support mode switching",
			);
		}
		const selected = record.availableModes.find((mode) => mode.id === modeId);
		if (!selected) {
			throw new AppError(
				createErrorDetail({
					code: "REQUEST_VALIDATION_FAILED",
					message: "Invalid mode ID",
					retryable: false,
					scope: "request",
				}),
				400,
			);
		}
		await record.connection.setSessionMode(sessionId, modeId);
		record.modeId = selected.id;
		record.modeName = selected.name;
		record.updatedAt = new Date();
		const summary = this.buildSummary(record);
		this.emitSessionsChanged({
			added: [],
			updated: [summary],
			removed: [],
		});
		return summary;
	}

	async setSessionModel(
		sessionId: string,
		modelId: string,
	): Promise<SessionSummary> {
		const record = this.sessions.get(sessionId);
		if (!record) {
			throw new AppError(
				createErrorDetail({
					code: "SESSION_NOT_FOUND",
					message: "Session not found",
					retryable: false,
					scope: "session",
				}),
				404,
			);
		}
		if (!record.availableModels || record.availableModels.length === 0) {
			throw createCapabilityNotSupportedError(
				"Current agent does not support model switching",
			);
		}
		const selected = record.availableModels.find(
			(model) => model.id === modelId,
		);
		if (!selected) {
			throw new AppError(
				createErrorDetail({
					code: "REQUEST_VALIDATION_FAILED",
					message: "Invalid model ID",
					retryable: false,
					scope: "request",
				}),
				400,
			);
		}
		await record.connection.setSessionModel(sessionId, modelId);
		record.modelId = selected.id;
		record.modelName = selected.name;
		record.updatedAt = new Date();
		const summary = this.buildSummary(record);
		this.emitSessionsChanged({
			added: [],
			updated: [summary],
			removed: [],
		});
		return summary;
	}

	async cancelSession(sessionId: string): Promise<boolean> {
		const record = this.sessions.get(sessionId);
		if (!record) {
			return false;
		}
		this.cancelPermissionRequests(sessionId);
		await record.connection.cancel(sessionId);
		this.touchSession(sessionId);
		return true;
	}

	async closeSession(sessionId: string): Promise<boolean> {
		const record = this.sessions.get(sessionId);
		if (!record) {
			return false;
		}
		try {
			record.unsubscribe?.();
			record.unsubscribeTerminal?.();
		} catch (error) {
			logger.error({ err: error, sessionId }, "session_unsubscribe_failed");
		}
		this.cancelPermissionRequests(sessionId);
		try {
			await record.connection.disconnect();
		} catch (error) {
			logger.error({ err: error, sessionId }, "session_disconnect_failed");
		}
		this.emitSessionDetached(sessionId, "unknown");
		this.sessions.delete(sessionId);
		this.emitSessionsChanged({
			added: [],
			updated: [],
			removed: [sessionId],
		});
		return true;
	}

	async closeAll(): Promise<void> {
		const sessionIds = Array.from(this.sessions.keys());
		await Promise.all(
			sessionIds.map((sessionId) => this.closeSession(sessionId)),
		);
	}

	/**
	 * Discover sessions persisted by the ACP agent.
	 * Creates a temporary connection to query sessions.
	 * @param options Optional parameters for discovery
	 * @returns List of discovered sessions and agent capabilities
	 */
	async discoverSessions(options?: {
		cwd?: string;
		backendId?: string;
		cursor?: string;
	}): Promise<DiscoverSessionsRpcResult> {
		const backend = this.resolveBackend(options?.backendId);
		const connection = new AcpConnection({
			backend,
			client: {
				name: this.config.clientName,
				version: this.config.clientVersion,
			},
		});

		try {
			await connection.connect();
			const capabilities = connection.getSessionCapabilities();
			const sessions: AcpSessionInfo[] = [];
			let nextCursor: string | undefined;

			if (capabilities.list) {
				const response = await connection.listSessions({
					cwd: options?.cwd,
					cursor: options?.cursor,
				});
				nextCursor = response.nextCursor;
				const validity = await Promise.all(
					response.sessions.map(async (session) => ({
						session,
						isValid: session.cwd
							? await isValidWorkspacePath(session.cwd)
							: false,
					})),
				);
				for (const { session, isValid } of validity) {
					if (!isValid) {
						this.discoveredSessions.delete(session.sessionId);
						continue;
					}
					this.discoveredSessions.set(session.sessionId, {
						sessionId: session.sessionId,
						cwd: session.cwd,
						title: session.title ?? undefined,
						updatedAt: session.updatedAt ?? undefined,
					});
					sessions.push({
						sessionId: session.sessionId,
						cwd: session.cwd,
						title: session.title ?? undefined,
						updatedAt: session.updatedAt ?? undefined,
					});
				}
			}

			logger.info(
				{
					backendId: backend.id,
					sessionCount: sessions.length,
					capabilities,
				},
				"sessions_discovered",
			);

			return { sessions, capabilities, nextCursor };
		} finally {
			await connection.disconnect();
		}
	}

	/**
	 * Load a historical session from the ACP agent.
	 * This will replay the session's message history.
	 * @param sessionId The session ID to load
	 * @param cwd The working directory
	 * @param backendId Optional backend ID
	 * @returns The loaded session summary
	 */
	async loadSession(
		sessionId: string,
		cwd: string,
		backendId?: string,
	): Promise<SessionSummary> {
		// Check if session is already loaded
		const existing = this.sessions.get(sessionId);
		if (existing) {
			this.emitSessionAttached(sessionId, true);
			return this.buildSummary(existing);
		}

		const backend = this.resolveBackend(backendId);
		const connection = new AcpConnection({
			backend,
			client: {
				name: this.config.clientName,
				version: this.config.clientVersion,
			},
		});

		try {
			await connection.connect();

			if (!connection.supportsSessionLoad()) {
				throw createCapabilityNotSupportedError(
					"Agent does not support session loading",
				);
			}

			const bufferedUpdates: SessionNotification[] = [];
			let recordRef: SessionRecord | undefined;
			const unsubscribe = connection.onSessionUpdate(
				(notification: SessionNotification) => {
					this.sessionUpdateEmitter.emit("update", notification);
					if (recordRef) {
						recordRef.updatedAt = new Date();
						this.applySessionUpdateToRecord(recordRef, notification);
					} else {
						bufferedUpdates.push(notification);
					}
				},
			);

			const response = await connection.loadSession(sessionId, cwd);
			connection.setPermissionHandler((params) =>
				this.handlePermissionRequest(sessionId, params),
			);

			const now = new Date();
			const agentInfo = connection.getAgentInfo();
			const { modelId, modelName, availableModels } = resolveModelState(
				response.models,
			);
			const { modeId, modeName, availableModes } = resolveModeState(
				response.modes,
			);
			const discovered = this.discoveredSessions.get(sessionId);

			const record: SessionRecord = {
				sessionId,
				title: discovered?.title ?? sessionId,
				backendId: backend.id,
				backendLabel: backend.label,
				connection,
				createdAt: now,
				updatedAt: now,
				cwd,
				agentName: agentInfo?.title ?? agentInfo?.name,
				modelId,
				modelName,
				modeId,
				modeName,
				availableModes,
				availableModels,
				availableCommands: undefined,
			};

			recordRef = record;
			record.unsubscribe = unsubscribe;
			for (const notification of bufferedUpdates) {
				this.applySessionUpdateToRecord(record, notification);
			}

			this.setupSessionSubscriptions(record, { skipSessionUpdates: true });
			this.sessions.set(sessionId, record);

			const summary = this.buildSummary(record);
			this.emitSessionsChanged({
				added: [summary],
				updated: [],
				removed: [],
			});
			this.emitSessionAttached(sessionId);

			logger.info({ sessionId, backendId: backend.id }, "session_loaded");

			return summary;
		} catch (error) {
			await connection.disconnect();
			throw error;
		}
	}

	/**
	 * Reload a historical session from the ACP agent.
	 * Replays session history even if the session is already loaded.
	 */
	async reloadSession(
		sessionId: string,
		cwd: string,
		backendId?: string,
	): Promise<SessionSummary> {
		const existing = this.sessions.get(sessionId);
		if (!existing) {
			return this.loadSession(sessionId, cwd, backendId);
		}

		if (!existing.connection.supportsSessionLoad()) {
			throw createCapabilityNotSupportedError(
				"Agent does not support session loading",
			);
		}

		const response = await existing.connection.loadSession(sessionId, cwd);
		const { modelId, modelName, availableModels } = resolveModelState(
			response.models,
		);
		const { modeId, modeName, availableModes } = resolveModeState(
			response.modes,
		);
		const agentInfo = existing.connection.getAgentInfo();

		existing.cwd = cwd;
		existing.agentName =
			agentInfo?.title ?? agentInfo?.name ?? existing.agentName;
		existing.modelId = modelId;
		existing.modelName = modelName;
		existing.availableModels = availableModels;
		existing.modeId = modeId;
		existing.modeName = modeName;
		existing.availableModes = availableModes;
		existing.updatedAt = new Date();

		const summary = this.buildSummary(existing);
		this.emitSessionsChanged({
			added: [],
			updated: [summary],
			removed: [],
		});
		this.emitSessionAttached(sessionId, true);

		logger.info({ sessionId, backendId }, "session_reloaded");

		return summary;
	}

	private applySessionUpdateToRecord(
		record: SessionRecord,
		notification: SessionNotification,
	) {
		const update = notification.update;
		if (update.sessionUpdate === "current_mode_update") {
			record.modeId = update.currentModeId;
			record.modeName =
				record.availableModes?.find((mode) => mode.id === update.currentModeId)
					?.name ?? record.modeName;
			return;
		}
		if (update.sessionUpdate === "session_info_update") {
			if (typeof update.title === "string") {
				record.title = update.title;
			}
			if (typeof update.updatedAt === "string") {
				record.updatedAt = new Date(update.updatedAt);
			}
		}
		if (update.sessionUpdate === "available_commands_update") {
			if (update.availableCommands) {
				record.availableCommands = update.availableCommands;
			}
		}
	}

	/**
	 * Set up event subscriptions for a session record.
	 */
	private setupSessionSubscriptions(
		record: SessionRecord,
		options?: { skipSessionUpdates?: boolean },
	): void {
		const { sessionId, connection } = record;

		if (!options?.skipSessionUpdates) {
			record.unsubscribe = connection.onSessionUpdate(
				(notification: SessionNotification) => {
					record.updatedAt = new Date();
					this.sessionUpdateEmitter.emit("update", notification);
					this.applySessionUpdateToRecord(record, notification);
				},
			);
		}

		record.unsubscribeTerminal = connection.onTerminalOutput((event) => {
			this.terminalOutputEmitter.emit("output", event);
		});

		connection.onStatusChange((status) => {
			if (status.error) {
				this.sessionErrorEmitter.emit("error", {
					sessionId,
					error: status.error,
				});
				this.emitSessionDetached(sessionId, "agent_exit");
			}
		});
	}

	private buildSummary(record: SessionRecord): SessionSummary {
		const status = record.connection.getStatus();
		return {
			sessionId: record.sessionId,
			title: record.title,
			backendId: record.backendId,
			backendLabel: record.backendLabel,
			error: status.error,
			pid: status.pid,
			createdAt: record.createdAt.toISOString(),
			updatedAt: record.updatedAt.toISOString(),
			cwd: record.cwd,
			agentName: record.agentName,
			modelId: record.modelId,
			modelName: record.modelName,
			modeId: record.modeId,
			modeName: record.modeName,
			availableModes: record.availableModes,
			availableModels: record.availableModels,
			availableCommands: record.availableCommands,
		};
	}
}
