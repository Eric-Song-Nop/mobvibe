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
	type AgentSessionCapabilities,
	AppError,
	createErrorDetail,
	type DiscoverSessionsRpcResult,
	type PermissionDecisionPayload,
	type PermissionRequestPayload,
	type SessionEvent,
	type SessionEventKind,
	type SessionEventsParams,
	type SessionEventsResponse,
	type SessionSummary,
	type SessionsChangedPayload,
	type StopReason,
} from "@mobvibe/shared";
import type { AcpBackendConfig, CliConfig } from "../config.js";
import type { CliCryptoService } from "../e2ee/crypto-service.js";
import { logger } from "../lib/logger.js";
import { WalStore } from "../wal/index.js";
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
	/** Current WAL revision for this session */
	revision: number;
	/** Agent-defined metadata from session_info_update RFD */
	_meta?: Record<string, unknown> | null;
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
	private permissionRequests = new Map<string, PermissionRequestRecord>();
	private readonly permissionRequestEmitter = new EventEmitter();
	private readonly permissionResultEmitter = new EventEmitter();
	private readonly sessionsChangedEmitter = new EventEmitter();
	private readonly sessionAttachedEmitter = new EventEmitter();
	private readonly sessionDetachedEmitter = new EventEmitter();
	private readonly sessionEventEmitter = new EventEmitter();
	private readonly walStore: WalStore;
	private readonly cryptoService?: CliCryptoService;

	/** Per-backend idle connections (initialized but no session bound) */
	private idleConnections = new Map<string, AcpConnection>();

	/** Per-backend capabilities cache */
	private backendCapabilities = new Map<string, AgentSessionCapabilities>();

	constructor(
		private readonly config: CliConfig,
		cryptoService?: CliCryptoService,
	) {
		this.backendById = new Map(
			config.acpBackends.map((backend) => [backend.id, backend]),
		);
		this.walStore = new WalStore(config.walDbPath);
		this.cryptoService = cryptoService;
	}

	createConnection(backend: AcpBackendConfig): AcpConnection {
		return new AcpConnection({
			backend,
			client: {
				name: this.config.clientName,
				version: this.config.clientVersion,
			},
		});
	}

	/**
	 * Acquire an initialized connection for a backend.
	 * Reuses an idle connection if available and still ready,
	 * otherwise creates and connects a new one.
	 */
	async acquireConnection(backend: AcpBackendConfig): Promise<AcpConnection> {
		const idle = this.idleConnections.get(backend.id);
		if (idle) {
			this.idleConnections.delete(backend.id);
			const status = idle.getStatus();
			if (status.state === "ready") {
				logger.debug({ backendId: backend.id }, "idle_connection_reused");
				return idle;
			}
			// Connection is no longer usable — discard it
			logger.debug(
				{ backendId: backend.id, state: status.state },
				"idle_connection_stale_discarded",
			);
			await idle.disconnect().catch(() => {});
		}

		const connection = this.createConnection(backend);
		await connection.connect();
		return connection;
	}

	/**
	 * Release a connection back to the idle pool for later reuse.
	 * Only keeps one idle connection per backend.
	 */
	releaseConnection(backendId: string, connection: AcpConnection): void {
		const status = connection.getStatus();
		// Only pool connections that are still ready and have no session bound
		if (status.state === "ready" && !status.sessionId) {
			const existing = this.idleConnections.get(backendId);
			if (existing) {
				// Already have one — disconnect the old one
				existing.disconnect().catch(() => {});
			}
			this.idleConnections.set(backendId, connection);
			logger.debug({ backendId }, "connection_released_to_idle_pool");
		} else {
			// Not reusable — disconnect immediately
			connection.disconnect().catch(() => {});
			logger.debug(
				{ backendId, state: status.state, sessionId: status.sessionId },
				"connection_discarded_not_reusable",
			);
		}
	}

	listSessions(): SessionSummary[] {
		return Array.from(this.sessions.values()).map((record) =>
			this.buildSummary(record),
		);
	}

	/**
	 * List all sessions: active sessions merged with persisted discovered sessions.
	 * Used for the gateway heartbeat so that `sessions:list` sends the
	 * complete set, allowing the gateway to replace its cache.
	 */
	listAllSessions(): SessionSummary[] {
		const active = this.listSessions();
		const merged = new Map<string, SessionSummary>(
			active.map((s) => [s.sessionId, s]),
		);

		for (const s of this.walStore.getDiscoveredSessions()) {
			if (s.cwd === undefined) continue;
			const existing = merged.get(s.sessionId);
			if (existing) {
				// Keep the latest updatedAt between active and discovered
				const discoveredUpdatedAt = s.agentUpdatedAt ?? s.discoveredAt;
				if (discoveredUpdatedAt > existing.updatedAt) {
					merged.set(s.sessionId, {
						...existing,
						updatedAt: discoveredUpdatedAt,
					});
				}
			} else {
				merged.set(s.sessionId, {
					sessionId: s.sessionId,
					title: s.title ?? `Session ${s.sessionId.slice(0, 8)}`,
					backendId: s.backendId,
					backendLabel: s.backendId,
					cwd: s.cwd as string,
					createdAt: s.discoveredAt,
					updatedAt: s.agentUpdatedAt ?? s.discoveredAt,
				} satisfies SessionSummary);
			}
		}

		return Array.from(merged.values());
	}

	getSession(sessionId: string): SessionRecord | undefined {
		return this.sessions.get(sessionId);
	}

	/**
	 * Get the current WAL revision for a session.
	 */
	getSessionRevision(sessionId: string): number | undefined {
		return this.sessions.get(sessionId)?.revision;
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

	/**
	 * Listen for session events (WAL-persisted events with seq/revision).
	 */
	onSessionEvent(listener: (event: SessionEvent) => void) {
		this.sessionEventEmitter.on("event", listener);
		return () => {
			this.sessionEventEmitter.off("event", listener);
		};
	}

	/**
	 * Query session events from the WAL.
	 */
	getSessionEvents(params: SessionEventsParams): SessionEventsResponse {
		const record = this.sessions.get(params.sessionId);

		// Determine the actual revision from WAL or active session
		let actualRevision: number;
		if (record) {
			actualRevision = record.revision;
		} else {
			// Session not active, check WAL for persisted revision
			const walSession = this.walStore.getSession(params.sessionId);
			actualRevision = walSession?.currentRevision ?? params.revision;
		}

		// If no events in WAL for this session, return empty with actual revision
		if (!record && !this.walStore.getSession(params.sessionId)) {
			return {
				sessionId: params.sessionId,
				machineId: this.config.machineId,
				revision: actualRevision,
				events: [],
				hasMore: false,
			};
		}

		// Fix 2: If requested revision doesn't match actual revision, return empty events
		// This ensures response.revision === events[].revision consistency
		// Client will see mismatch, reset, and re-request with afterSeq=0
		if (params.revision !== actualRevision) {
			return {
				sessionId: params.sessionId,
				machineId: this.config.machineId,
				revision: actualRevision,
				events: [],
				hasMore: false,
			};
		}

		const limit = params.limit ?? 100;
		const events = this.walStore.queryEvents({
			sessionId: params.sessionId,
			revision: actualRevision, // Use consistent revision
			afterSeq: params.afterSeq,
			limit: limit + 1, // Query one extra to check hasMore
		});

		const hasMore = events.length > limit;
		const resultEvents = hasMore ? events.slice(0, limit) : events;

		return {
			sessionId: params.sessionId,
			machineId: this.config.machineId,
			revision: actualRevision,
			events: resultEvents.map((e) => ({
				sessionId: e.sessionId,
				machineId: this.config.machineId,
				revision: e.revision,
				seq: e.seq,
				kind: e.kind,
				createdAt: e.createdAt,
				payload: e.payload,
			})),
			nextAfterSeq:
				resultEvents.length > 0
					? resultEvents[resultEvents.length - 1].seq
					: undefined,
			hasMore,
		};
	}

	/**
	 * Get unacked events for a session/revision (for reconnection replay).
	 */
	getUnackedEvents(sessionId: string, revision: number): SessionEvent[] {
		const events = this.walStore.getUnackedEvents(sessionId, revision);
		return events.map((e) => ({
			sessionId: e.sessionId,
			machineId: this.config.machineId,
			revision: e.revision,
			seq: e.seq,
			kind: e.kind,
			createdAt: e.createdAt,
			payload: e.payload,
		}));
	}

	/**
	 * Acknowledge events up to a given sequence.
	 */
	ackEvents(sessionId: string, revision: number, upToSeq: number): void {
		this.walStore.ackEvents(sessionId, revision, upToSeq);
	}

	recordTurnEnd(sessionId: string, stopReason: StopReason): void {
		const record = this.sessions.get(sessionId);
		if (!record) {
			return;
		}
		record.updatedAt = new Date();
		this.writeAndEmitEvent(sessionId, record.revision, "turn_end", {
			stopReason,
		});
	}

	/**
	 * Write an event to the WAL and emit it.
	 */
	private writeAndEmitEvent(
		sessionId: string,
		revision: number,
		kind: SessionEventKind,
		payload: unknown,
	): SessionEvent {
		logger.debug(
			{ sessionId, revision, kind },
			"session_write_and_emit_event_start",
		);

		const walEvent = this.walStore.appendEvent({
			sessionId,
			revision,
			kind,
			payload,
		});

		const event: SessionEvent = {
			sessionId: walEvent.sessionId,
			machineId: this.config.machineId,
			revision: walEvent.revision,
			seq: walEvent.seq,
			kind: walEvent.kind,
			createdAt: walEvent.createdAt,
			payload: walEvent.payload,
		};

		logger.info(
			{
				sessionId: event.sessionId,
				revision: event.revision,
				seq: event.seq,
				kind: event.kind,
			},
			"session_event_emitting",
		);

		this.sessionEventEmitter.emit("event", event);

		logger.debug(
			{ sessionId: event.sessionId, seq: event.seq },
			"session_event_emitted",
		);

		return event;
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
			revision: record.revision,
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
		const permRecord = this.permissionRequests.get(key);
		if (!permRecord) {
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
		permRecord.resolve(response);
		this.permissionRequests.delete(key);
		const payload: PermissionDecisionPayload = {
			sessionId,
			requestId,
			outcome,
		};

		// Write permission result to WAL
		const sessionRecord = this.sessions.get(sessionId);
		if (sessionRecord) {
			this.writeAndEmitEvent(
				sessionId,
				sessionRecord.revision,
				"permission_result",
				payload,
			);
		}

		this.permissionResultEmitter.emit("result", payload);
		return payload;
	}

	private resolveBackend(backendId: string) {
		const normalized = backendId.trim();
		if (!normalized) {
			throw new AppError(
				createErrorDetail({
					code: "REQUEST_VALIDATION_FAILED",
					message: "backendId is required",
					retryable: false,
					scope: "request",
				}),
				400,
			);
		}
		const backend = this.backendById.get(normalized);
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

	async createSession(options: {
		cwd?: string;
		title?: string;
		backendId: string;
	}): Promise<SessionSummary> {
		const backend = this.resolveBackend(options.backendId);
		const connection = await this.acquireConnection(backend);
		try {
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

			// Initialize WAL session
			const { revision } = this.walStore.ensureSession({
				sessionId: session.sessionId,
				machineId: this.config.machineId,
				backendId: backend.id,
				cwd: options?.cwd,
				title: options?.title ?? `Session ${this.sessions.size + 1}`,
			});

			// Initialize DEK for E2EE
			if (this.cryptoService) {
				this.cryptoService.initSessionDek(session.sessionId);
			}

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
				revision,
			};
			record.unsubscribe = connection.onSessionUpdate(
				(notification: SessionNotification) => {
					logger.debug(
						{
							sessionId: session.sessionId,
							updateType: notification.update.sessionUpdate,
						},
						"acp_session_update_received",
					);
					record.updatedAt = new Date();
					// Write to WAL and emit via session:event (unified event channel)
					this.writeSessionUpdateToWal(record, notification);
					this.applySessionUpdateToRecord(record, notification);
				},
			);
			record.unsubscribeTerminal = connection.onTerminalOutput((event) => {
				logger.debug(
					{ sessionId: record.sessionId },
					"acp_terminal_output_received",
				);
				// Write terminal output to WAL (emits via session:event)
				this.writeAndEmitEvent(
					record.sessionId,
					record.revision,
					"terminal_output",
					event,
				);
			});
			connection.onStatusChange((status) => {
				if (status.error) {
					// Write error to WAL (emits via session:event)
					this.writeAndEmitEvent(
						record.sessionId,
						record.revision,
						"session_error",
						{ error: status.error },
					);
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
		return {
			sessionId: record.sessionId,
			requestId: record.requestId,
			// Pass SDK types directly - no manual mapping needed
			options: record.params.options,
			toolCall: record.params.toolCall,
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
		const permRecord: PermissionRequestRecord = {
			sessionId,
			requestId,
			params,
			promise,
			resolve: resolver,
		};
		this.permissionRequests.set(key, permRecord);
		const payload = this.buildPermissionRequestPayload(permRecord);

		// Write permission request to WAL
		const sessionRecord = this.sessions.get(sessionId);
		if (sessionRecord) {
			this.writeAndEmitEvent(
				sessionId,
				sessionRecord.revision,
				"permission_request",
				payload,
			);
		}

		this.permissionRequestEmitter.emit("request", payload);
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

		// Persist to WAL
		this.walStore.ensureSession({
			sessionId,
			machineId: this.config.machineId,
			backendId: record.backendId,
			cwd: record.cwd,
			title,
		});

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
		// Also disconnect idle connections
		for (const [, conn] of this.idleConnections) {
			await conn.disconnect().catch(() => {});
		}
		this.idleConnections.clear();
	}

	/**
	 * Archive a session: close if active, delete WAL messages, mark as archived.
	 */
	async archiveSession(sessionId: string): Promise<void> {
		if (this.sessions.has(sessionId)) {
			await this.closeSession(sessionId);
		}
		this.walStore.archiveSession(sessionId);
		this.discoveredSessions.delete(sessionId);
	}

	/**
	 * Archive multiple sessions at once.
	 */
	async bulkArchiveSessions(
		sessionIds: string[],
	): Promise<{ archivedCount: number }> {
		await Promise.allSettled(
			sessionIds
				.filter((id) => this.sessions.has(id))
				.map((id) => this.closeSession(id)),
		);
		const archivedCount = this.walStore.bulkArchiveSessions(sessionIds);
		for (const id of sessionIds) {
			this.discoveredSessions.delete(id);
		}
		return { archivedCount };
	}

	/**
	 * Shutdown the session manager and close resources.
	 */
	async shutdown(): Promise<void> {
		await this.closeAll();
		this.walStore.close();
	}

	/**
	 * Get cached per-backend capabilities.
	 */
	getBackendCapabilities(): Record<string, AgentSessionCapabilities> {
		return Object.fromEntries(this.backendCapabilities);
	}

	/**
	 * Get previously discovered sessions from WAL storage.
	 * Filters out sessions that are already loaded.
	 * @param backendId Optional backend ID to filter by
	 * @returns List of discovered sessions not currently loaded
	 */
	getPersistedDiscoveredSessions(backendId?: string): AcpSessionInfo[] {
		return this.walStore
			.getDiscoveredSessions(backendId)
			.filter((s) => !this.sessions.has(s.sessionId) && s.cwd !== undefined)
			.map((s) => ({
				sessionId: s.sessionId,
				cwd: s.cwd as string, // Safe because we filter above
				title: s.title,
				updatedAt: s.agentUpdatedAt,
			}));
	}

	/**
	 * Discover sessions persisted by the ACP agent.
	 * Creates a temporary connection to query sessions.
	 * @param options Optional parameters for discovery
	 * @returns List of discovered sessions and agent capabilities
	 */
	async discoverSessions(options: {
		cwd?: string;
		backendId: string;
		cursor?: string;
	}): Promise<DiscoverSessionsRpcResult> {
		const backend = this.resolveBackend(options.backendId);
		const connection = await this.acquireConnection(backend);

		try {
			const capabilities = connection.getSessionCapabilities();
			const sessions: AcpSessionInfo[] = [];
			let nextCursor: string | undefined;

			if (capabilities.list) {
				const response = await connection.listSessions({
					cwd: options?.cwd,
					cursor: options?.cursor,
				});
				nextCursor = response.nextCursor;

				// Get archived IDs to filter them out
				const archivedIds = new Set(this.walStore.getArchivedSessionIds());

				const validity = await Promise.all(
					response.sessions.map(async (session) => ({
						session,
						isValid: session.cwd
							? await isValidWorkspacePath(session.cwd)
							: false,
					})),
				);

				const now = new Date().toISOString();
				const discoveredRecords: Array<{
					sessionId: string;
					backendId: string;
					cwd?: string;
					title?: string;
					agentUpdatedAt?: string;
					discoveredAt: string;
					isStale: boolean;
				}> = [];

				for (const { session, isValid } of validity) {
					if (!isValid) {
						this.discoveredSessions.delete(session.sessionId);
						// Mark as stale in WAL
						this.walStore.markDiscoveredSessionStale(session.sessionId);
						continue;
					}

					// Skip archived sessions
					if (archivedIds.has(session.sessionId)) {
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

					// Collect for WAL persistence
					discoveredRecords.push({
						sessionId: session.sessionId,
						backendId: backend.id,
						cwd: session.cwd,
						title: session.title ?? undefined,
						agentUpdatedAt: session.updatedAt ?? undefined,
						discoveredAt: now,
						isStale: false,
					});
				}

				// Persist to WAL
				if (discoveredRecords.length > 0) {
					this.walStore.saveDiscoveredSessions(discoveredRecords);
				}
			}

			// Cache per-backend capabilities
			this.backendCapabilities.set(backend.id, capabilities);

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
			this.releaseConnection(backend.id, connection);
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
		backendId: string,
	): Promise<SessionSummary> {
		logger.info({ sessionId, cwd, backendId }, "load_session_start");

		// Check if session is already loaded
		const existing = this.sessions.get(sessionId);
		if (existing) {
			logger.debug({ sessionId }, "load_session_already_loaded");
			this.emitSessionAttached(sessionId, true);
			return this.buildSummary(existing);
		}

		const backend = this.resolveBackend(backendId);
		const connection = await this.acquireConnection(backend);

		try {
			if (!connection.supportsSessionLoad()) {
				throw createCapabilityNotSupportedError(
					"Agent does not support session loading",
				);
			}

			// P0-9: Check if WAL already has history for this session
			// If so, bump revision to avoid duplicate imports
			const existingWalSession = this.walStore.getSession(sessionId);
			const hasExistingHistory =
				existingWalSession !== null &&
				this.walStore.queryEvents({
					sessionId,
					revision: existingWalSession.currentRevision,
					afterSeq: 0,
					limit: 1,
				}).length > 0;

			let revision: number;
			if (hasExistingHistory) {
				// Already have history → bump revision to avoid duplicates
				revision = this.walStore.incrementRevision(sessionId);
				logger.debug({ sessionId, revision }, "load_session_bump_revision");
			} else {
				// First time import → create or get existing revision
				const result = this.walStore.ensureSession({
					sessionId,
					machineId: this.config.machineId,
					backendId: backend.id,
					cwd,
				});
				revision = result.revision;
			}

			const bufferedUpdates: SessionNotification[] = [];
			let recordRef: SessionRecord | undefined;
			const unsubscribe = connection.onSessionUpdate(
				(notification: SessionNotification) => {
					logger.debug(
						{
							sessionId,
							updateType: notification.update.sessionUpdate,
							hasRecordRef: !!recordRef,
						},
						"load_session_update_received",
					);
					// Write to WAL (emits via session:event)
					if (recordRef) {
						this.writeSessionUpdateToWal(recordRef, notification);
						recordRef.updatedAt = new Date();
						this.applySessionUpdateToRecord(recordRef, notification);
					} else {
						bufferedUpdates.push(notification);
						logger.debug(
							{ sessionId, bufferedCount: bufferedUpdates.length },
							"load_session_buffered",
						);
					}
				},
			);

			logger.debug({ sessionId }, "load_session_calling_acp");
			const response = await connection.loadSession(sessionId, cwd);
			logger.debug(
				{
					sessionId,
					bufferedCount: bufferedUpdates.length,
					hasModels: !!response.models,
					hasModes: !!response.modes,
				},
				"load_session_acp_returned",
			);
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
				revision,
			};

			recordRef = record;
			record.unsubscribe = unsubscribe;

			// Initialize DEK for E2EE (new revision = new key)
			if (this.cryptoService) {
				this.cryptoService.initSessionDek(sessionId);
			}

			// Write buffered updates to WAL
			logger.debug(
				{ sessionId, bufferedCount: bufferedUpdates.length },
				"load_session_writing_buffered",
			);
			for (const notification of bufferedUpdates) {
				logger.debug(
					{ sessionId, updateType: notification.update.sessionUpdate },
					"load_session_writing_buffered_event",
				);
				this.writeSessionUpdateToWal(record, notification);
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

			logger.info(
				{ sessionId, backendId: backend.id, revision: record.revision },
				"load_session_complete",
			);

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
		backendId: string,
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

		// Increment revision in WAL (signals a fresh replay)
		const newRevision = this.walStore.incrementRevision(sessionId);
		existing.revision = newRevision;

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

		logger.info(
			{ sessionId, backendId, revision: newRevision },
			"session_reloaded",
		);

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
			// RFD _meta merge semantics
			if ("_meta" in update) {
				const meta = (update as { _meta?: Record<string, unknown> | null })
					._meta;
				if (meta === null) {
					// null → clear all metadata
					record._meta = null;
				} else if (meta && typeof meta === "object") {
					// Merge: null values delete keys, others upsert
					const current = record._meta ?? {};
					const merged = { ...current };
					for (const [key, value] of Object.entries(meta)) {
						if (value === null) {
							delete merged[key];
						} else {
							merged[key] = value;
						}
					}
					record._meta = Object.keys(merged).length > 0 ? merged : null;
				}
			}
		}
		if (update.sessionUpdate === "available_commands_update") {
			if (update.availableCommands) {
				record.availableCommands = update.availableCommands;
			}
		}
	}

	/**
	 * Map a SessionNotification to WAL event kind and write to WAL.
	 */
	private writeSessionUpdateToWal(
		record: SessionRecord,
		notification: SessionNotification,
	): void {
		const update = notification.update;
		let kind: SessionEventKind;

		logger.debug(
			{
				sessionId: record.sessionId,
				revision: record.revision,
				updateType: update.sessionUpdate,
			},
			"write_session_update_to_wal_start",
		);

		switch (update.sessionUpdate) {
			case "user_message_chunk":
				kind = "user_message";
				break;
			case "agent_message_chunk":
				kind = "agent_message_chunk";
				break;
			case "agent_thought_chunk":
				kind = "agent_thought_chunk";
				break;
			case "tool_call":
				kind = "tool_call";
				break;
			case "tool_call_update":
				kind = "tool_call_update";
				break;
			case "session_info_update":
			case "current_mode_update":
			case "available_commands_update":
			case "plan":
			case "config_option_update":
				kind = "session_info_update";
				break;
			case "usage_update":
				kind = "usage_update";
				break;
			default: {
				// Forward-compatible: write unknown update types to WAL
				// so no data is lost when SDK introduces new event types
				const _unhandled = update as { sessionUpdate?: string };
				logger.warn(
					{
						sessionId: record.sessionId,
						updateType: _unhandled.sessionUpdate,
					},
					"unknown_session_update_type_persisted",
				);
				kind = "unknown_update";
				break;
			}
		}

		logger.info(
			{
				sessionId: record.sessionId,
				revision: record.revision,
				updateType: update.sessionUpdate,
				kind,
			},
			"write_session_update_to_wal_mapped",
		);

		this.writeAndEmitEvent(
			record.sessionId,
			record.revision,
			kind,
			notification,
		);
	}

	/**
	 * Set up event subscriptions for a session record.
	 */
	private setupSessionSubscriptions(
		record: SessionRecord,
		options?: { skipSessionUpdates?: boolean },
	): void {
		const { sessionId, connection } = record;

		logger.debug(
			{ sessionId, skipSessionUpdates: options?.skipSessionUpdates },
			"setup_session_subscriptions",
		);

		if (!options?.skipSessionUpdates) {
			record.unsubscribe = connection.onSessionUpdate(
				(notification: SessionNotification) => {
					logger.debug(
						{
							sessionId,
							updateType: notification.update.sessionUpdate,
						},
						"acp_session_update_received_via_setup",
					);
					record.updatedAt = new Date();
					// Write to WAL and emit via session:event (unified event channel)
					this.writeSessionUpdateToWal(record, notification);
					this.applySessionUpdateToRecord(record, notification);
				},
			);
		}

		record.unsubscribeTerminal = connection.onTerminalOutput((event) => {
			logger.debug({ sessionId }, "acp_terminal_output_received_via_setup");
			// Write terminal output to WAL (emits via session:event)
			this.writeAndEmitEvent(
				sessionId,
				record.revision,
				"terminal_output",
				event,
			);
		});

		connection.onStatusChange((status) => {
			logger.debug(
				{ sessionId, hasError: !!status.error },
				"acp_status_change",
			);
			if (status.error) {
				// Write error to WAL (emits via session:event)
				this.writeAndEmitEvent(sessionId, record.revision, "session_error", {
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
			revision: record.revision,
			wrappedDek:
				this.cryptoService?.getWrappedDek(record.sessionId) ?? undefined,
			_meta: record._meta,
		};
	}
}
