import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import type {
	AvailableCommand,
	JsonRpcId,
	RequestPermissionRequest,
	RequestPermissionResponse,
	SessionConfigOption,
	SessionModeState,
	SessionNotification,
} from "@agentclientprotocol/sdk";
import { RequestError } from "@agentclientprotocol/sdk";
import {
	type AcpSessionInfo,
	type AgentSessionCapabilities,
	AppError,
	type CreateSessionWorktreeOptions,
	createErrorDetail,
	type DiscoverSessionsRpcResult,
	type PermissionDecisionPayload,
	type PermissionRequestPayload,
	type ReportedTokenUsage,
	resolveWorktreeBranchName,
	type SendMessageResult,
	type SessionEvent,
	type SessionEventKind,
	type SessionEventsParams,
	type SessionEventsResponse,
	type SessionSummary,
	type SessionsChangedPayload,
	type StopReason,
	sanitizeWorktreeBranchForPath,
} from "@mobvibe/shared";
import type { AcpBackendConfig, CliConfig } from "../config.js";
import type { CliCryptoService } from "../e2ee/crypto-service.js";
import {
	createGitWorktree,
	isGitRepo,
	resolveGitProjectContext,
} from "../lib/git-utils.js";
import { logger } from "../lib/logger.js";
import {
	consolidateEventsForRead,
	isStubPayload,
} from "../wal/consolidator.js";
import {
	type MessageSendClaim,
	type WalEvent,
	type WalEventInput,
	WalStore,
} from "../wal/index.js";
import {
	AcpConnection,
	normalizeAdditionalDirectories,
} from "./acp-connection.js";

type PendingReloadEvent =
	| { type: "session_update"; notification: SessionNotification }
	| { type: "wal_event"; kind: SessionEventKind; payload: unknown };

type PendingReloadBuffer = {
	events: PendingReloadEvent[];
	bytes: number;
	error?: Error;
};

const MAX_RELOAD_BUFFER_BYTES = 8 * 1024 * 1024;
const MAX_RELOAD_BUFFER_EVENTS = 20_000;
const LEGACY_KEY_VALIDATION_PAGE_SIZE = 100;
const WAL_ENCRYPTION_IDENTITY_SCHEMA_VERSION = 11;
const RECENT_SESSION_DELETE_TTL_MS = 5 * 60 * 1000;
const MAX_RECENT_SESSION_DELETES = 1024;
const MAX_ACTIVE_AGENT_SESSION_OBSERVATIONS = 128;
const MAX_DELETES_PER_AGENT_SESSION_OBSERVATION = 1024;
const MAX_SESSION_ID_BYTES = 1024;
const AGENT_AUTH_OPERATION_TIMEOUT_MS = 120_000;

type RecentSessionDelete = {
	generation: number;
	expiresAt: number;
};

type AgentSessionObservation = {
	generation: number;
	deletedSessionIds: Set<string>;
	invalidated: boolean;
	tracked: boolean;
};

const isValidSessionId = (sessionId: unknown): sessionId is string =>
	typeof sessionId === "string" &&
	sessionId.trim().length > 0 &&
	Buffer.byteLength(sessionId, "utf8") <= MAX_SESSION_ID_BYTES;

const resolveSessionUpdateEventKind = (
	notification: SessionNotification,
): SessionEventKind => {
	switch (notification.update.sessionUpdate) {
		case "user_message_chunk":
			return "user_message";
		case "agent_message_chunk":
			return "agent_message_chunk";
		case "agent_thought_chunk":
			return "agent_thought_chunk";
		case "tool_call":
			return "tool_call";
		case "tool_call_update":
			return "tool_call_update";
		case "session_info_update":
		case "current_mode_update":
		case "available_commands_update":
		case "plan":
		case "config_option_update":
			return "session_info_update";
		case "usage_update":
			return "usage_update";
		case "plan_update":
			return "plan_update";
		case "plan_removed":
			return "plan_removed";
		default:
			return "unknown_update";
	}
};

type SessionRecord = {
	sessionId: string;
	title: string;
	backendId: string;
	backendLabel: string;
	connection: AcpConnection;
	createdAt: Date;
	updatedAt: Date;
	cwd?: string;
	additionalDirectories: string[];
	agentName?: string;
	modelId?: string;
	modelName?: string;
	modelConfigId?: string;
	modeId?: string;
	modeName?: string;
	availableModes?: Array<{ id: string; name: string }>;
	availableModels?: Array<{
		id: string;
		name: string;
		description?: string | null;
	}>;
	configOptions: SessionConfigOption[];
	availableCommands?: AvailableCommand[];
	unsubscribe?: () => void;
	unsubscribeTerminal?: () => void;
	unsubscribeStatus?: () => void;
	pendingReload?: PendingReloadBuffer;
	isAttached?: boolean;
	attachedAt?: Date;
	/** Current WAL revision for this session */
	revision: number;
	/** Agent-defined metadata from session_info_update RFD */
	_meta?: Record<string, unknown> | null;
	/** Whether the title was manually set by the user (immune to agent auto-update) */
	isTitlePinned?: boolean;
	/** Original repo cwd (only for worktree sessions) */
	worktreeSourceCwd?: string;
	/** Branch name of the worktree (only for worktree sessions) */
	worktreeBranch?: string;
	/** Stable workspace/project root for grouping and navigation */
	workspaceRootCwd?: string;
};

const getSessionFallbackTitle = (sessionId: string) =>
	`Session ${sessionId.slice(0, 8)}`;

const resolveSessionTitle = ({
	sessionId,
	isTitlePinned,
	localTitle,
	hasDiscoveredSnapshot,
	discoveredTitle,
}: {
	sessionId: string;
	isTitlePinned?: boolean;
	localTitle?: string | null;
	hasDiscoveredSnapshot: boolean;
	discoveredTitle?: string | null;
}): string => {
	if (isTitlePinned || !hasDiscoveredSnapshot) {
		return localTitle ?? getSessionFallbackTitle(sessionId);
	}
	return discoveredTitle ?? getSessionFallbackTitle(sessionId);
};

const parseAgentUpdatedAt = (value: string): Date | undefined => {
	const timestamp = new Date(value);
	return Number.isNaN(timestamp.getTime()) ? undefined : timestamp;
};

const advanceSessionUpdatedAt = (record: SessionRecord, candidate: Date) => {
	if (
		!Number.isNaN(candidate.getTime()) &&
		candidate.getTime() > record.updatedAt.getTime()
	) {
		record.updatedAt = candidate;
	}
};

const selectNewerTimestamp = (current: string, candidate?: string): string => {
	if (candidate === undefined) {
		return current;
	}
	const currentTime = parseAgentUpdatedAt(current)?.getTime();
	const candidateTime = parseAgentUpdatedAt(candidate)?.getTime();
	if (candidateTime === undefined) {
		return current;
	}
	if (currentTime === undefined || candidateTime > currentTime) {
		return candidate;
	}
	return current;
};

type PermissionRequestRecord = {
	sessionId: string;
	requestId: string;
	params: RequestPermissionRequest;
	promise: Promise<RequestPermissionResponse>;
	resolve: (response: RequestPermissionResponse) => void;
};

const isAbsolutePathInput = (value: string) =>
	path.posix.isAbsolute(value) || path.win32.isAbsolute(value);

const normalizeRelativeWorktreePath = (value: string): string => {
	const trimmed = value.trim();
	if (!trimmed || isAbsolutePathInput(trimmed)) {
		throw new AppError(
			createErrorDetail({
				code: "REQUEST_VALIDATION_FAILED",
				message: "worktree relative path must be a relative subdirectory",
				retryable: false,
				scope: "request",
			}),
			400,
		);
	}
	const segments = trimmed.split(/[/\\]+/).filter(Boolean);
	if (
		segments.length === 0 ||
		segments.some((segment) => segment === "." || segment === "..")
	) {
		throw new AppError(
			createErrorDetail({
				code: "REQUEST_VALIDATION_FAILED",
				message: "worktree relative path must be normalized",
				retryable: false,
				scope: "request",
			}),
			400,
		);
	}
	return segments.join(path.sep);
};

const resolveWorktreeExecutionCwd = (
	worktreeRoot: string,
	relativeCwd?: string,
): string => {
	if (!relativeCwd) {
		return worktreeRoot;
	}
	const normalized = normalizeRelativeWorktreePath(relativeCwd);
	const resolved = path.resolve(worktreeRoot, normalized);
	const relativeToRoot = path.relative(worktreeRoot, resolved);
	if (
		!relativeToRoot ||
		relativeToRoot === ".." ||
		relativeToRoot.startsWith(`..${path.sep}`) ||
		isAbsolutePathInput(relativeToRoot)
	) {
		throw new AppError(
			createErrorDetail({
				code: "REQUEST_VALIDATION_FAILED",
				message: "worktree relative path must stay within the worktree root",
				retryable: false,
				scope: "request",
			}),
			400,
		);
	}
	return resolved;
};

const buildPermissionKey = (sessionId: string, requestId: string) =>
	`${sessionId}:${requestId}`;

const encodeProtocolRequestId = (
	requestId: JsonRpcId,
	fallbackId: string,
): string =>
	requestId === null
		? `null:${fallbackId}`
		: `${typeof requestId}:${requestId}`;

const flattenConfigSelectOptions = (
	options: Extract<SessionConfigOption, { type: "select" }>["options"],
) =>
	options.flatMap((option) =>
		"options" in option ? option.options : [option],
	);

const createSessionConfigValidationError = (message: string) =>
	new AppError(
		createErrorDetail({
			code: "REQUEST_VALIDATION_FAILED",
			message,
			retryable: false,
			scope: "request",
		}),
		400,
	);

const validateSessionConfigValue = (
	configOption: SessionConfigOption,
	value: string | boolean,
) => {
	if (configOption.type === "boolean") {
		if (typeof value !== "boolean") {
			throw createSessionConfigValidationError(
				"Boolean session config option requires a boolean value",
			);
		}
		return;
	}
	const allowedValues = flattenConfigSelectOptions(configOption.options);
	if (
		typeof value !== "string" ||
		!allowedValues.some((option) => option.value === value)
	) {
		throw createSessionConfigValidationError(
			"Invalid value for session config option",
		);
	}
};

const resolveModelState = (configOptions?: SessionConfigOption[] | null) => {
	const modelConfig = configOptions?.find(
		(option) => option.category === "model" && option.type === "select",
	);
	if (!modelConfig || modelConfig.type !== "select") {
		return {
			modelConfigId: undefined,
			modelId: undefined,
			modelName: undefined,
			availableModels: undefined,
		};
	}
	const availableModels = flattenConfigSelectOptions(modelConfig.options).map(
		(model) => ({
			id: model.value,
			name: model.name,
			description: model.description ?? undefined,
		}),
	);
	const modelId = modelConfig.currentValue;
	const modelName = availableModels.find((model) => model.id === modelId)?.name;
	return {
		modelConfigId: modelConfig.id,
		modelId,
		modelName,
		availableModels,
	};
};

const normalizeConfigOptions = (
	configOptions?: SessionConfigOption[] | null,
): SessionConfigOption[] => [...(configOptions ?? [])];

const applyConfigOptionsToRecord = (
	record: SessionRecord,
	configOptions?: SessionConfigOption[] | null,
) => {
	record.configOptions = normalizeConfigOptions(configOptions);
	const state = resolveModelState(record.configOptions);
	record.modelConfigId = state.modelConfigId;
	record.modelId = state.modelId;
	record.modelName = state.modelName;
	record.availableModels = state.availableModels;
	return state;
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

const createAgentAuthenticationError = (
	code: "AGENT_AUTHENTICATION_REQUIRED" | "AGENT_AUTHENTICATION_FAILED",
	message: string,
	retryable: boolean,
	status = 409,
) =>
	new AppError(
		createErrorDetail({
			code,
			message,
			retryable,
			scope: "service",
		}),
		status,
	);

const translateAgentAuthenticationRequired = (error: unknown): never => {
	if (error instanceof RequestError && error.code === -32000) {
		throw createAgentAuthenticationError(
			"AGENT_AUTHENTICATION_REQUIRED",
			"Agent authentication is required",
			false,
		);
	}
	throw error;
};

const isValidWorkspacePath = async (cwd: string): Promise<boolean> => {
	try {
		const stats = await fs.stat(cwd);
		return stats.isDirectory();
	} catch {
		return false;
	}
};

export type SessionManagerDependencies = {
	validateWorkspacePath?: (cwd: string) => Promise<boolean>;
	createGitWorktree?: typeof createGitWorktree;
	isGitRepo?: typeof isGitRepo;
	resolveGitProjectContext?: typeof resolveGitProjectContext;
	agentAuthOperationTimeoutMs?: number;
};

type CreateManagedSessionOptions = {
	cwd?: string;
	additionalDirectories?: string[];
	title?: string;
	backendId: string;
	worktree?: CreateSessionWorktreeOptions;
};

type DiscoverManagedSessionsOptions = {
	cwd?: string;
	backendId: string;
	cursor?: string;
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
	private readonly validateWorkspacePath: (cwd: string) => Promise<boolean>;
	private readonly createGitWorktree: typeof createGitWorktree;
	private readonly isGitRepo: typeof isGitRepo;
	private readonly resolveGitProjectContext: typeof resolveGitProjectContext;
	private readonly agentAuthOperationTimeoutMs: number;
	private readonly activeMessageIdBySession = new Map<string, string>();
	private readonly sessionReloadTails = new Map<string, Promise<void>>();
	private readonly closedSessionRecords = new WeakSet<SessionRecord>();
	private readonly sessionDeletesInFlight = new Map<string, Promise<void>>();
	private readonly remoteDeleteCleanupPending = new Set<string>();
	private readonly recentlyDeletedSessions = new Map<
		string,
		RecentSessionDelete
	>();
	private readonly latestDeleteGenerationBySession = new Map<string, number>();
	private readonly activeAgentSessionObservations =
		new Set<AgentSessionObservation>();
	private readonly sessionIncarnationGenerationBySession = new Map<
		string,
		number
	>();
	private readonly currentSessionIncarnationIds = new Set<string>();
	private evictedSessionIncarnationFloor = 0;
	private reuseQuarantineUntil = 0;
	private sessionLifecycleGeneration = 0;
	/** Per-backend idle connections (initialized but no session bound) */
	private idleConnections = new Map<string, AcpConnection>();
	/** Serializes every operation that may acquire or release a backend process. */
	private readonly backendLifecycleTails = new Map<string, Promise<void>>();
	private shuttingDown = false;

	/** Per-backend capabilities cache */
	private backendCapabilities = new Map<string, AgentSessionCapabilities>();

	constructor(
		private readonly config: CliConfig,
		cryptoService?: CliCryptoService,
		dependencies?: SessionManagerDependencies,
	) {
		this.backendById = new Map(
			config.acpBackends.map((backend) => [backend.id, backend]),
		);
		this.walStore = new WalStore(config.walDbPath);
		for (const session of this.walStore.getSessions()) {
			if (isValidSessionId(session.sessionId)) {
				this.currentSessionIncarnationIds.add(session.sessionId);
			}
		}
		for (const session of this.walStore.getDiscoveredSessions()) {
			if (isValidSessionId(session.sessionId)) {
				this.currentSessionIncarnationIds.add(session.sessionId);
			}
		}
		this.cryptoService = cryptoService;
		this.validateWorkspacePath =
			dependencies?.validateWorkspacePath ?? isValidWorkspacePath;
		this.createGitWorktree =
			dependencies?.createGitWorktree ?? createGitWorktree;
		this.isGitRepo = dependencies?.isGitRepo ?? isGitRepo;
		this.resolveGitProjectContext =
			dependencies?.resolveGitProjectContext ?? resolveGitProjectContext;
		this.agentAuthOperationTimeoutMs =
			dependencies?.agentAuthOperationTimeoutMs ??
			AGENT_AUTH_OPERATION_TIMEOUT_MS;
		const keyIdentity = cryptoService?.getKeyIdentity?.();
		if (keyIdentity && cryptoService) {
			try {
				if (!this.walStore.getEncryptionIdentity()) {
					let verifiedLegacyKeyCount = 0;
					let after: { sessionId: string; revision: number } | undefined;
					while (true) {
						const legacyKeys = this.walStore.getSessionRevisionKeysPage(
							after,
							LEGACY_KEY_VALIDATION_PAGE_SIZE,
						);
						for (const legacyKey of legacyKeys) {
							verifiedLegacyKeyCount += 1;
							if (
								!cryptoService.canUnwrapDek ||
								!cryptoService.canUnwrapDek(legacyKey.wrappedDek)
							) {
								throw new Error(
									"WAL encryption identity mismatch; the persisted revision keys require the original master secret",
								);
							}
						}
						if (legacyKeys.length < LEGACY_KEY_VALIDATION_PAGE_SIZE) {
							break;
						}
						const lastKey = legacyKeys.at(-1);
						if (!lastKey) {
							break;
						}
						after = {
							sessionId: lastKey.sessionId,
							revision: lastKey.revision,
						};
					}
					if (
						verifiedLegacyKeyCount === 0 &&
						this.walStore.hasDurableData() &&
						this.walStore.getInitialSchemaVersion() >=
							WAL_ENCRYPTION_IDENTITY_SCHEMA_VERSION
					) {
						throw new Error(
							"WAL encryption identity is missing and durable data has no wrapped key, so Mobvibe cannot verify the original master secret; restore the original credentials or move the WAL to a separate MOBVIBE_HOME",
						);
					}
				}
				this.walStore.bindEncryptionIdentity(keyIdentity);
			} catch (error) {
				this.walStore.close();
				throw error;
			}
		}
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
				this.backendCapabilities.set(backend.id, idle.getSessionCapabilities());
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
		this.backendCapabilities.set(
			backend.id,
			connection.getSessionCapabilities(),
		);
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

	private enqueueBackendLifecycle<T>(
		backendId: string,
		operation: () => Promise<T>,
	): Promise<T> {
		if (this.shuttingDown) {
			return Promise.reject(
				new AppError(
					createErrorDetail({
						code: "SESSION_NOT_READY",
						message: "CLI is shutting down",
						retryable: true,
						scope: "service",
					}),
					503,
				),
			);
		}
		const previous = this.backendLifecycleTails.get(backendId);
		const result = (previous ?? Promise.resolve()).then(operation);
		const tail = result.then(
			() => {},
			() => {},
		);
		this.backendLifecycleTails.set(backendId, tail);
		const clearTail = () => {
			if (this.backendLifecycleTails.get(backendId) === tail) {
				this.backendLifecycleTails.delete(backendId);
			}
		};
		void result.then(clearTail, clearTail);
		return result;
	}

	private async withAgentAuthTimeout<T>(
		operation: () => Promise<T>,
	): Promise<T> {
		let timeout: NodeJS.Timeout | undefined;
		try {
			return await Promise.race([
				operation(),
				new Promise<never>((_, reject) => {
					timeout = setTimeout(
						() => reject(new Error("Agent authentication operation timed out")),
						this.agentAuthOperationTimeoutMs,
					);
				}),
			]);
		} finally {
			if (timeout) clearTimeout(timeout);
		}
	}

	private getRecentSessionDelete(
		sessionId: string,
	): RecentSessionDelete | undefined {
		const recentDelete = this.recentlyDeletedSessions.get(sessionId);
		if (!recentDelete) {
			return undefined;
		}
		if (recentDelete.expiresAt <= Date.now()) {
			this.recentlyDeletedSessions.delete(sessionId);
			return undefined;
		}
		return recentDelete;
	}

	private beginAgentSessionObservation(): AgentSessionObservation {
		if (
			this.activeAgentSessionObservations.size >=
			MAX_ACTIVE_AGENT_SESSION_OBSERVATIONS
		) {
			return {
				generation: this.sessionLifecycleGeneration,
				deletedSessionIds: new Set(),
				invalidated: true,
				tracked: false,
			};
		}
		const observation: AgentSessionObservation = {
			generation: this.sessionLifecycleGeneration,
			deletedSessionIds: new Set(),
			invalidated: false,
			tracked: true,
		};
		this.activeAgentSessionObservations.add(observation);
		return observation;
	}

	private finishAgentSessionObservation(
		observation: AgentSessionObservation,
	): void {
		if (observation.tracked) {
			this.activeAgentSessionObservations.delete(observation);
		}
		observation.deletedSessionIds.clear();
	}

	private invalidateObservationsForDeletedSession(
		sessionId: string,
		generation: number,
	): void {
		for (const observation of this.activeAgentSessionObservations) {
			if (observation.generation >= generation || observation.invalidated) {
				continue;
			}
			if (
				observation.deletedSessionIds.size >=
				MAX_DELETES_PER_AGENT_SESSION_OBSERVATION
			) {
				observation.invalidated = true;
				observation.deletedSessionIds.clear();
				continue;
			}
			observation.deletedSessionIds.add(sessionId);
		}
	}

	private pruneSessionIncarnationHistory(): void {
		let historicalCount = 0;
		for (const sessionId of this.sessionIncarnationGenerationBySession.keys()) {
			if (!this.currentSessionIncarnationIds.has(sessionId)) {
				historicalCount++;
			}
		}
		while (historicalCount > MAX_RECENT_SESSION_DELETES) {
			const oldestEntry = Array.from(
				this.sessionIncarnationGenerationBySession.entries(),
			).find(
				([sessionId]) => !this.currentSessionIncarnationIds.has(sessionId),
			);
			if (!oldestEntry) {
				break;
			}
			const [oldestSessionId, oldestGeneration] = oldestEntry;
			this.sessionIncarnationGenerationBySession.delete(oldestSessionId);
			this.evictedSessionIncarnationFloor = Math.max(
				this.evictedSessionIncarnationFloor,
				oldestGeneration,
			);
			historicalCount--;
		}
	}

	private registerCurrentSessionIncarnation(sessionId: string): void {
		if (
			!this.currentSessionIncarnationIds.has(sessionId) &&
			!this.sessionIncarnationGenerationBySession.has(sessionId) &&
			this.evictedSessionIncarnationFloor > 0
		) {
			this.sessionIncarnationGenerationBySession.set(
				sessionId,
				++this.sessionLifecycleGeneration,
			);
		}
		this.currentSessionIncarnationIds.add(sessionId);
		this.pruneSessionIncarnationHistory();
	}

	private markSessionRecentlyDeleted(sessionId: string): void {
		const generation = ++this.sessionLifecycleGeneration;
		this.invalidateObservationsForDeletedSession(sessionId, generation);
		this.currentSessionIncarnationIds.delete(sessionId);
		this.sessionIncarnationGenerationBySession.delete(sessionId);
		this.sessionIncarnationGenerationBySession.set(sessionId, generation);
		this.pruneSessionIncarnationHistory();
		this.recentlyDeletedSessions.delete(sessionId);
		this.recentlyDeletedSessions.set(sessionId, {
			generation,
			expiresAt: Date.now() + RECENT_SESSION_DELETE_TTL_MS,
		});
		while (this.recentlyDeletedSessions.size > MAX_RECENT_SESSION_DELETES) {
			const oldestSessionId = this.recentlyDeletedSessions.keys().next().value;
			if (typeof oldestSessionId !== "string") {
				break;
			}
			const evictedDelete = this.recentlyDeletedSessions.get(oldestSessionId);
			if (evictedDelete) {
				this.reuseQuarantineUntil = Math.max(
					this.reuseQuarantineUntil,
					evictedDelete.expiresAt,
				);
			}
			this.recentlyDeletedSessions.delete(oldestSessionId);
		}
		this.latestDeleteGenerationBySession.delete(sessionId);
		this.latestDeleteGenerationBySession.set(sessionId, generation);
		while (
			this.latestDeleteGenerationBySession.size > MAX_RECENT_SESSION_DELETES
		) {
			const oldestSessionId = this.latestDeleteGenerationBySession
				.keys()
				.next().value;
			if (typeof oldestSessionId !== "string") {
				break;
			}
			this.latestDeleteGenerationBySession.delete(oldestSessionId);
		}
	}

	/**
	 * Whether durable data or outbound events for a session must be suppressed.
	 * Socket replay calls this immediately before every emit because a page may
	 * have been read before deletion began.
	 */
	isSessionDeletionGuarded(sessionId: string): boolean {
		return (
			this.sessionDeletesInFlight.has(sessionId) ||
			this.remoteDeleteCleanupPending.has(sessionId) ||
			this.latestDeleteGenerationBySession.has(sessionId)
		);
	}

	/** Stable token for the current local incarnation of a session ID. */
	getSessionIncarnationGeneration(sessionId: string): number {
		const explicitGeneration =
			this.sessionIncarnationGenerationBySession.get(sessionId);
		if (explicitGeneration !== undefined) {
			return explicitGeneration;
		}
		return this.currentSessionIncarnationIds.has(sessionId)
			? 0
			: this.evictedSessionIncarnationFloor;
	}

	private isSessionTemporarilyHidden(sessionId: string): boolean {
		return (
			this.sessionDeletesInFlight.has(sessionId) ||
			this.getRecentSessionDelete(sessionId) !== undefined
		);
	}

	private assertValidSessionId(sessionId: string): void {
		if (isValidSessionId(sessionId)) {
			return;
		}
		throw new AppError(
			createErrorDetail({
				code: "REQUEST_VALIDATION_FAILED",
				message:
					"A non-empty sessionId of at most 1024 UTF-8 bytes is required",
				retryable: false,
				scope: "request",
			}),
			400,
		);
	}

	private assertSessionMutable(sessionId: string): void {
		this.assertValidSessionId(sessionId);
		if (
			this.sessionDeletesInFlight.has(sessionId) ||
			this.remoteDeleteCleanupPending.has(sessionId)
		) {
			throw new AppError(
				createErrorDetail({
					code: "SESSION_BUSY",
					message: "Session is deleting",
					retryable: true,
					scope: "session",
				}),
				409,
			);
		}
		if (this.latestDeleteGenerationBySession.has(sessionId)) {
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
	}

	/**
	 * Accept a session identity observed directly from the Agent. An observation
	 * that started before deletion completed is stale and cannot recreate local
	 * state. A later session/new or session/list response is authoritative proof
	 * that the Agent now owns this ID again, so it may clear the short-lived
	 * retry tombstone.
	 */
	private acceptAgentSessionObservation(
		sessionId: string,
		observation: AgentSessionObservation,
	): boolean {
		if (this.isAgentSessionObservationStale(sessionId, observation)) {
			return false;
		}
		// Keep the ID quarantined while a timed-out delete response can still be
		// retried by the Gateway/WebUI using only the bare session ID.
		if (this.getRecentSessionDelete(sessionId)) {
			return false;
		}
		if (this.reuseQuarantineUntil > Date.now()) {
			return false;
		}
		const latestDeleteGeneration =
			this.latestDeleteGenerationBySession.get(sessionId);
		if (latestDeleteGeneration === undefined) {
			return true;
		}
		this.recentlyDeletedSessions.delete(sessionId);
		this.latestDeleteGenerationBySession.delete(sessionId);
		logger.info({ sessionId }, "session_delete_tombstone_cleared_by_agent");
		return true;
	}

	private isAgentSessionObservationStale(
		sessionId: string,
		observation: AgentSessionObservation,
	): boolean {
		if (
			this.sessionDeletesInFlight.has(sessionId) ||
			this.remoteDeleteCleanupPending.has(sessionId)
		) {
			return true;
		}
		return (
			observation.invalidated || observation.deletedSessionIds.has(sessionId)
		);
	}

	listSessions(): SessionSummary[] {
		return Array.from(this.sessions.values())
			.filter((record) => !this.isSessionTemporarilyHidden(record.sessionId))
			.map((record) => this.buildSummary(record));
	}

	/**
	 * List all sessions: active sessions merged with persisted discovered sessions.
	 * Used for the gateway heartbeat so that `sessions:list` sends the
	 * complete set, allowing the gateway to replace its cache.
	 */
	listAllSessions(): SessionSummary[] {
		const active = this.listSessions();
		const activeSessionIds = new Set(
			active.map((session) => session.sessionId),
		);
		const merged = new Map<string, SessionSummary>(
			active.map((s) => [s.sessionId, s]),
		);

		for (const session of this.walStore.getSessions()) {
			if (merged.has(session.sessionId)) continue;
			if (this.isSessionTemporarilyHidden(session.sessionId)) continue;
			const backend = this.backendById.get(session.backendId);
			merged.set(session.sessionId, {
				sessionId: session.sessionId,
				title: session.title ?? getSessionFallbackTitle(session.sessionId),
				backendId: session.backendId,
				backendLabel: backend?.label ?? session.backendId,
				cwd: session.cwd,
				additionalDirectories: session.additionalDirectories,
				workspaceRootCwd: session.cwd,
				createdAt: session.createdAt,
				updatedAt: session.updatedAt,
				revision: session.currentRevision,
				wrappedDek: this.ensureSessionRevisionDek(
					session.sessionId,
					session.currentRevision,
				),
				isAttached: false,
				isTitlePinned: session.isTitlePinned,
			});
		}

		for (const s of this.walStore.getDiscoveredSessions()) {
			if (s.cwd === undefined) continue;
			if (this.isSessionTemporarilyHidden(s.sessionId)) continue;
			const existing = merged.get(s.sessionId);
			if (existing) {
				// Active connection state is authoritative. A detached discovery result
				// is a current metadata snapshot, but it must not make local activity
				// ordering regress or treat discovery time as agent activity.
				if (activeSessionIds.has(s.sessionId)) continue;
				merged.set(s.sessionId, {
					...existing,
					title: existing.isTitlePinned
						? existing.title
						: (s.title ?? getSessionFallbackTitle(s.sessionId)),
					cwd: s.cwd ?? existing.cwd,
					additionalDirectories: s.additionalDirectories,
					workspaceRootCwd:
						s.workspaceRootCwd ?? s.cwd ?? existing.workspaceRootCwd,
					...(Object.hasOwn(s, "_meta") ? { _meta: s._meta } : {}),
					updatedAt: selectNewerTimestamp(
						existing.updatedAt,
						s.agentUpdatedAt ?? undefined,
					),
				});
			} else {
				const agentUpdatedAt =
					typeof s.agentUpdatedAt !== "string" ||
					parseAgentUpdatedAt(s.agentUpdatedAt) === undefined
						? undefined
						: s.agentUpdatedAt;
				merged.set(s.sessionId, {
					sessionId: s.sessionId,
					title: s.title ?? getSessionFallbackTitle(s.sessionId),
					backendId: s.backendId,
					backendLabel: s.backendId,
					cwd: s.cwd as string,
					additionalDirectories: s.additionalDirectories,
					workspaceRootCwd: s.workspaceRootCwd ?? s.cwd,
					...(Object.hasOwn(s, "_meta") ? { _meta: s._meta } : {}),
					createdAt: s.discoveredAt,
					updatedAt: agentUpdatedAt ?? s.discoveredAt,
				} satisfies SessionSummary);
			}
		}

		return Array.from(merged.values());
	}

	private prepareSessionRevisionDek(
		sessionId: string,
		revision: number,
	): string | undefined {
		if (this.isSessionDeletionGuarded(sessionId)) return undefined;
		if (!this.cryptoService) return undefined;
		if (this.cryptoService.contentEncryptionEnabled === false) return undefined;

		const persisted = this.walStore.getSessionRevisionKey(sessionId, revision);
		if (persisted) {
			if (this.cryptoService.getWrappedDek(sessionId, revision) === persisted) {
				return persisted;
			}
			try {
				const restored = this.cryptoService.restoreSessionDek(
					sessionId,
					revision,
					persisted,
				);
				if (!restored) return undefined;
				return persisted;
			} catch (error) {
				logger.error(
					{ err: error, sessionId, revision },
					"session_revision_dek_restore_failed",
				);
				return undefined;
			}
		}
		const { wrappedDek } = this.cryptoService.initSessionDek(
			sessionId,
			revision,
		);
		return wrappedDek ?? undefined;
	}

	private ensureSessionRevisionDek(
		sessionId: string,
		revision: number,
	): string | undefined {
		if (this.isSessionDeletionGuarded(sessionId)) return undefined;
		const wrappedDek = this.prepareSessionRevisionDek(sessionId, revision);
		if (
			wrappedDek &&
			!this.walStore.getSessionRevisionKey(sessionId, revision)
		) {
			this.walStore.recordSessionRevisionKey(sessionId, revision, wrappedDek);
		}
		return wrappedDek;
	}

	private requirePreparedSessionRevisionDek(
		sessionId: string,
		revision: number,
	): string | undefined {
		const wrappedDek = this.prepareSessionRevisionDek(sessionId, revision);
		if (this.cryptoService?.contentEncryptionEnabled && !wrappedDek) {
			throw new Error(
				`Unable to initialize encryption key for session ${sessionId} revision ${revision}`,
			);
		}
		return wrappedDek;
	}

	private requireSessionRevisionDek(
		sessionId: string,
		revision: number,
	): string | undefined {
		const wrappedDek = this.ensureSessionRevisionDek(sessionId, revision);
		if (this.cryptoService?.contentEncryptionEnabled && !wrappedDek) {
			throw new Error(
				`Unable to initialize encryption key for session ${sessionId} revision ${revision}`,
			);
		}
		return wrappedDek;
	}

	async backfillDiscoveredWorkspaceRoots(): Promise<void> {
		const observation = this.beginAgentSessionObservation();
		try {
			const discoveredSessions = this.walStore.getDiscoveredSessions();
			let checked = 0;
			let updated = 0;
			let skippedMissingCwd = 0;
			let failed = 0;

			for (const session of discoveredSessions) {
				if (
					this.isSessionDeletionGuarded(session.sessionId) ||
					this.isAgentSessionObservationStale(session.sessionId, observation)
				) {
					continue;
				}
				if (!session.cwd) {
					skippedMissingCwd++;
					continue;
				}
				if (
					session.workspaceRootCwd &&
					session.workspaceRootCwd !== session.cwd
				) {
					continue;
				}

				checked++;

				try {
					const projectContext = await this.resolveGitProjectContext(
						session.cwd,
					);
					if (
						this.isSessionDeletionGuarded(session.sessionId) ||
						this.isAgentSessionObservationStale(session.sessionId, observation)
					) {
						continue;
					}
					const workspaceRootCwd = projectContext.repoRoot ?? session.cwd;
					this.walStore.saveDiscoveredSessions([
						{
							...session,
							workspaceRootCwd,
						},
					]);
					updated++;
				} catch (error) {
					failed++;
					logger.warn(
						{
							sessionId: session.sessionId,
							cwd: session.cwd,
							err: error,
						},
						"discovered_workspace_root_backfill_failed",
					);
				}
			}

			logger.info(
				{ checked, updated, skippedMissingCwd, failed },
				"discovered_workspace_root_backfill_complete",
			);
		} finally {
			this.finishAgentSessionObservation(observation);
		}
	}

	getSession(sessionId: string): SessionRecord | undefined {
		if (this.isSessionDeletionGuarded(sessionId)) {
			return undefined;
		}
		return this.sessions.get(sessionId);
	}

	/**
	 * Get the current WAL revision for a session.
	 */
	getSessionRevision(sessionId: string): number | undefined {
		if (this.isSessionDeletionGuarded(sessionId)) {
			return undefined;
		}
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
				| "session_close"
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
		if (this.isSessionDeletionGuarded(params.sessionId)) {
			return {
				sessionId: params.sessionId,
				machineId: this.config.machineId,
				revision: params.revision,
				events: [],
				hasMore: false,
			};
		}
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

		this.requireSessionRevisionDek(params.sessionId, actualRevision);

		const limit = params.limit ?? 100;
		const events = this.walStore.queryEvents({
			sessionId: params.sessionId,
			revision: actualRevision, // Use consistent revision
			afterSeq: params.afterSeq,
			limit: limit + 1, // Query one extra to check hasMore
		});

		const hasMore = events.length > limit;
		const rawEvents = hasMore ? events.slice(0, limit) : events;

		// Read-time consolidation: merge consecutive events to reduce backfill volume
		const consolidated =
			this.config.consolidation?.enabled !== false
				? consolidateEventsForRead(rawEvents)
				: rawEvents.filter((e) => !isStubPayload(e.payload));

		return {
			sessionId: params.sessionId,
			machineId: this.config.machineId,
			revision: actualRevision,
			events: consolidated.map((event) => this.toSessionEvent(event)),
			nextAfterSeq:
				rawEvents.length > 0 ? rawEvents[rawEvents.length - 1].seq : undefined,
			hasMore,
		};
	}

	listUnackedSessionRevisions(): Array<{
		sessionId: string;
		revision: number;
	}> {
		return this.walStore
			.listUnackedSessionRevisions()
			.filter(({ sessionId }) => !this.isSessionDeletionGuarded(sessionId));
	}

	/**
	 * Get unacked events for a session/revision (for reconnection replay).
	 */
	getUnackedEvents(sessionId: string, revision: number): SessionEvent[] {
		if (this.isSessionDeletionGuarded(sessionId)) {
			return [];
		}
		const wrappedDek = this.ensureSessionRevisionDek(sessionId, revision);
		if (this.cryptoService?.contentEncryptionEnabled && !wrappedDek) {
			logger.error(
				{ sessionId, revision },
				"unacked_events_skipped_missing_revision_dek",
			);
			return [];
		}
		const events = this.walStore.getUnackedEvents(sessionId, revision);
		return events.map((event) => this.toSessionEvent(event));
	}

	getUnackedEventsPage(
		sessionId: string,
		revision: number,
		afterSeq: number,
		limit: number,
	): SessionEvent[] {
		if (this.isSessionDeletionGuarded(sessionId)) {
			return [];
		}
		const wrappedDek = this.ensureSessionRevisionDek(sessionId, revision);
		if (this.cryptoService?.contentEncryptionEnabled && !wrappedDek) {
			logger.error(
				{ sessionId, revision },
				"unacked_events_skipped_missing_revision_dek",
			);
			return [];
		}
		return this.walStore
			.getUnackedEventsPage(sessionId, revision, afterSeq, limit)
			.map((event) => this.toSessionEvent(event));
	}

	/**
	 * Acknowledge events up to a given sequence.
	 */
	ackEvents(
		sessionId: string,
		revision: number,
		upToSeq: number,
		incarnationGeneration?: number,
	): void {
		if (this.isSessionDeletionGuarded(sessionId)) {
			return;
		}
		const currentIncarnation = this.getSessionIncarnationGeneration(sessionId);
		if (incarnationGeneration === undefined) {
			if (this.sessionIncarnationGenerationBySession.has(sessionId)) {
				return;
			}
		} else if (incarnationGeneration !== currentIncarnation) {
			return;
		}
		this.walStore.ackEvents(sessionId, revision, upToSeq);
	}

	getMessageSendResult(
		sessionId: string,
		messageId: string,
	): SendMessageResult | undefined {
		if (this.isSessionDeletionGuarded(sessionId)) {
			return undefined;
		}
		return this.walStore.getMessageSendResult(sessionId, messageId);
	}

	recordMessageSendResult(
		sessionId: string,
		messageId: string,
		stopReason: StopReason,
		usage?: ReportedTokenUsage,
	): void {
		if (this.isSessionDeletionGuarded(sessionId)) {
			return;
		}
		this.walStore.recordMessageSendResult(
			sessionId,
			messageId,
			stopReason,
			usage,
		);
	}

	claimMessageSend(sessionId: string, messageId: string): MessageSendClaim {
		this.assertSessionMutable(sessionId);
		return this.walStore.claimMessageSend(sessionId, messageId);
	}

	beginMessageSend(sessionId: string, messageId: string): void {
		this.assertSessionMutable(sessionId);
		const activeMessageId = this.activeMessageIdBySession.get(sessionId);
		if (activeMessageId && activeMessageId !== messageId) {
			throw new Error(
				`Another message is already active for session ${sessionId}`,
			);
		}
		this.activeMessageIdBySession.set(sessionId, messageId);
	}

	endMessageSend(sessionId: string, messageId: string): void {
		if (this.activeMessageIdBySession.get(sessionId) === messageId) {
			this.activeMessageIdBySession.delete(sessionId);
		}
	}

	completeMessageSend(
		sessionId: string,
		messageId: string,
		claimId: string,
		stopReason: StopReason,
		usage?: ReportedTokenUsage,
	): void {
		if (this.isSessionDeletionGuarded(sessionId)) {
			return;
		}
		const record = this.sessions.get(sessionId);
		if (!record) {
			throw new Error(`Session not found: ${sessionId}`);
		}
		const terminalEvent = this.walStore.completeMessageSend(
			sessionId,
			messageId,
			claimId,
			stopReason,
			usage,
		);
		record.updatedAt = new Date();
		this.emitSessionEvent(this.toSessionEvent(terminalEvent));
		this.emitSessionsChanged({
			added: [],
			updated: [this.buildSummary(record)],
			removed: [],
		});
	}

	recordTurnEnd(
		sessionId: string,
		stopReason: StopReason,
		usage?: ReportedTokenUsage,
	): void {
		if (this.isSessionDeletionGuarded(sessionId)) {
			return;
		}
		const record = this.sessions.get(sessionId);
		if (!record) {
			return;
		}
		record.updatedAt = new Date();
		const payload = { stopReason, ...(usage ? { usage } : {}) };
		this.bufferOrWriteSessionEvent(record, "turn_end", payload);
		// 将更新后的 updatedAt 推送给 WebUI，确保侧边栏排序正确
		const summary = this.buildSummary(record);
		this.emitSessionsChanged({
			added: [],
			updated: [summary],
			removed: [],
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
	): SessionEvent | undefined {
		if (this.isSessionDeletionGuarded(sessionId)) {
			return undefined;
		}
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
		const event = this.toSessionEvent(walEvent);
		this.emitSessionEvent(event);
		return event;
	}

	private toSessionEvent(walEvent: WalEvent): SessionEvent {
		const protocolMessageId = this.extractProtocolMessageId(walEvent.payload);
		return {
			sessionId: walEvent.sessionId,
			machineId: this.config.machineId,
			incarnationGeneration: this.getSessionIncarnationGeneration(
				walEvent.sessionId,
			),
			revision: walEvent.revision,
			seq: walEvent.seq,
			kind: walEvent.kind,
			...(protocolMessageId !== undefined ? { protocolMessageId } : {}),
			createdAt: walEvent.createdAt,
			payload: walEvent.payload,
		};
	}

	private extractProtocolMessageId(payload: unknown): string | undefined {
		if (!payload || typeof payload !== "object") {
			return undefined;
		}
		const update = (payload as { update?: unknown }).update;
		if (!update || typeof update !== "object") {
			return undefined;
		}
		const messageId = (update as { messageId?: unknown }).messageId;
		return typeof messageId === "string" ? messageId : undefined;
	}

	private emitSessionEvent(event: SessionEvent): void {
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
	}

	private bufferOrWriteSessionEvent(
		record: SessionRecord,
		kind: SessionEventKind,
		payload: unknown,
	): SessionEvent | undefined {
		if (
			this.closedSessionRecords.has(record) ||
			this.isSessionDeletionGuarded(record.sessionId)
		) {
			return undefined;
		}
		if (record.pendingReload) {
			this.bufferReloadEvent(record.pendingReload, {
				type: "wal_event",
				kind,
				payload,
			});
			return undefined;
		}
		return this.writeAndEmitEvent(
			record.sessionId,
			record.revision,
			kind,
			payload,
		);
	}

	private emitSessionsChanged(payload: SessionsChangedPayload) {
		const cachedCapabilities =
			payload.added.length > 0 ? this.getBackendCapabilities() : {};
		const backendCapabilities = {
			...cachedCapabilities,
			...payload.backendCapabilities,
		};
		this.sessionsChangedEmitter.emit("changed", {
			...payload,
			...(Object.keys(backendCapabilities).length > 0
				? { backendCapabilities }
				: {}),
		} satisfies SessionsChangedPayload);
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
		reason:
			| "agent_exit"
			| "cli_disconnect"
			| "gateway_disconnect"
			| "session_close"
			| "unknown",
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

	async createSession(
		options: CreateManagedSessionOptions,
	): Promise<SessionSummary> {
		const backend = this.resolveBackend(options.backendId);
		return this.enqueueBackendLifecycle(backend.id, () =>
			this.createSessionOnBackend(options, backend),
		).catch(translateAgentAuthenticationRequired);
	}

	private async createSessionOnBackend(
		options: CreateManagedSessionOptions,
		backend: AcpBackendConfig,
	): Promise<SessionSummary> {
		// Handle worktree creation before acquiring connection
		let effectiveCwd = options.cwd;
		let worktreeSourceCwd: string | undefined;
		let worktreeBranch: string | undefined;
		let workspaceRootCwd: string | undefined;

		if (options.worktree) {
			const repoDir = options.worktree.sourceCwd;
			if (!(await this.isGitRepo(repoDir))) {
				throw new AppError(
					createErrorDetail({
						code: "REQUEST_VALIDATION_FAILED",
						message: `Not a git repository: ${repoDir}`,
						retryable: false,
						scope: "request",
					}),
					400,
				);
			}

			const branch = resolveWorktreeBranchName(options.worktree.branch);
			const sanitizedBranch = sanitizeWorktreeBranchForPath(branch);
			const repoName = path.basename(repoDir);
			const targetPath = path.join(
				this.config.worktreeBaseDir,
				repoName,
				sanitizedBranch,
			);

			logger.info(
				{
					repoDir,
					branch,
					baseBranch: options.worktree.baseBranch,
					targetPath,
				},
				"creating_git_worktree",
			);

			try {
				const result = await this.createGitWorktree(repoDir, {
					branch,
					targetPath,
					baseBranch: options.worktree.baseBranch,
				});
				effectiveCwd = resolveWorktreeExecutionCwd(
					result.path,
					options.worktree.relativeCwd,
				);
			} catch (error) {
				if (error instanceof AppError) {
					throw error;
				}
				const message = error instanceof Error ? error.message : String(error);
				throw new AppError(
					createErrorDetail({
						code: "GIT_WORKTREE_FAILED",
						message: `Failed to create worktree: ${message}`,
						retryable: false,
						scope: "request",
					}),
					400,
				);
			}

			worktreeSourceCwd = repoDir;
			worktreeBranch = branch;
			workspaceRootCwd = repoDir;
		} else if (options.cwd) {
			const projectContext = await this.resolveGitProjectContext(options.cwd);
			workspaceRootCwd = projectContext.repoRoot ?? options.cwd;
		}

		const additionalDirectories = normalizeAdditionalDirectories(
			effectiveCwd ?? process.cwd(),
			options.additionalDirectories,
		);
		const connection = await this.acquireConnection(backend);
		const creationBuffer: PendingReloadBuffer = { events: [], bytes: 0 };
		let recordRef: SessionRecord | undefined;
		let observation: AgentSessionObservation | undefined;
		let quarantinedSessionId: string | undefined;
		const unsubscribe = connection.onSessionUpdate(
			(notification: SessionNotification) => {
				logger.debug(
					{
						sessionId: notification.sessionId,
						updateType: notification.update.sessionUpdate,
						hasRecordRef: !!recordRef,
					},
					"acp_session_update_received",
				);
				if (recordRef) {
					this.handleSessionUpdate(recordRef, notification);
					return;
				}
				this.bufferReloadEvent(creationBuffer, {
					type: "session_update",
					notification,
				});
			},
		);
		try {
			observation = this.beginAgentSessionObservation();
			const session = await connection.createSession({
				cwd: effectiveCwd,
				additionalDirectories,
			});
			if (!isValidSessionId(session.sessionId)) {
				throw new AppError(
					createErrorDetail({
						code: "REQUEST_VALIDATION_FAILED",
						message: "Agent returned an invalid session ID",
						retryable: false,
						scope: "session",
					}),
					502,
				);
			}
			if (creationBuffer.error) {
				throw creationBuffer.error;
			}
			if (!this.acceptAgentSessionObservation(session.sessionId, observation)) {
				quarantinedSessionId = session.sessionId;
				throw new AppError(
					createErrorDetail({
						code: "SESSION_BUSY",
						message: "Session was deleted while it was being created",
						retryable: true,
						scope: "session",
					}),
					409,
				);
			}
			connection.setPermissionHandler((params, requestId, signal) =>
				this.handlePermissionRequest(
					session.sessionId,
					params,
					requestId,
					signal,
				),
			);
			const now = new Date();
			const agentInfo = connection.getAgentInfo();
			const { modelConfigId, modelId, modelName, availableModels } =
				resolveModelState(session.configOptions);
			const { modeId, modeName, availableModes } = resolveModeState(
				session.modes,
			);

			// Pin title when explicitly provided by the user
			const hasExplicitTitle = !!options?.title;
			const sessionTitle =
				options?.title ?? `Session ${this.sessions.size + 1}`;

			// Initialize WAL session
			const { revision } = this.walStore.ensureSession({
				sessionId: session.sessionId,
				machineId: this.config.machineId,
				backendId: backend.id,
				cwd: effectiveCwd,
				additionalDirectories,
				title: sessionTitle,
				isTitlePinned: hasExplicitTitle,
			});
			this.registerCurrentSessionIncarnation(session.sessionId);

			// Initialize DEK for E2EE
			this.requireSessionRevisionDek(session.sessionId, revision);

			const record: SessionRecord = {
				sessionId: session.sessionId,
				title: sessionTitle,
				backendId: backend.id,
				backendLabel: backend.label,
				connection,
				createdAt: now,
				updatedAt: now,
				cwd: effectiveCwd,
				additionalDirectories,
				workspaceRootCwd,
				worktreeSourceCwd,
				worktreeBranch,
				agentName: agentInfo?.title ?? agentInfo?.name,
				modelConfigId,
				modelId,
				modelName,
				modeId,
				modeName,
				availableModes,
				availableModels,
				configOptions: normalizeConfigOptions(session.configOptions),
				availableCommands: undefined,
				revision,
				isTitlePinned: hasExplicitTitle,
			};
			recordRef = record;
			record.unsubscribe = unsubscribe;
			record.unsubscribeTerminal = connection.onTerminalOutput((event) => {
				logger.debug(
					{ sessionId: record.sessionId },
					"acp_terminal_output_received",
				);
				// Write terminal output to WAL (emits via session:event)
				this.bufferOrWriteSessionEvent(record, "terminal_output", event);
			});
			record.unsubscribeStatus = connection.onStatusChange((status) => {
				if (status.error) {
					// Write error to WAL (emits via session:event)
					this.bufferOrWriteSessionEvent(record, "session_error", {
						error: status.error,
					});
					this.emitSessionDetached(session.sessionId, "agent_exit");
				}
			});
			for (const event of creationBuffer.events) {
				if (event.type !== "session_update") continue;
				this.writeSessionUpdateToWal(record, event.notification);
				this.applySessionUpdateToRecord(record, event.notification);
			}
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
			unsubscribe();
			recordRef?.unsubscribeTerminal?.();
			recordRef?.unsubscribeStatus?.();
			if (worktreeSourceCwd) {
				logger.warn(
					{ worktreePath: effectiveCwd, branch: worktreeBranch },
					"session_creation_failed_after_worktree_created",
				);
			}
			if (quarantinedSessionId) {
				try {
					if (connection.supportsSessionDelete()) {
						await connection.deleteSession(quarantinedSessionId);
					} else if (connection.supportsSessionClose()) {
						await connection.closeSession(quarantinedSessionId);
					}
				} catch (cleanupError) {
					logger.warn(
						{ err: cleanupError, sessionId: quarantinedSessionId },
						"quarantined_session_cleanup_failed",
					);
				}
			}
			const status = connection.getStatus();
			await connection.disconnect();
			if (status.error) {
				throw new AppError(status.error, 500);
			}
			throw error;
		} finally {
			if (observation) {
				this.finishAgentSessionObservation(observation);
			}
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
		protocolRequestId: JsonRpcId,
		signal: AbortSignal,
	): Promise<RequestPermissionResponse> {
		if (this.isSessionDeletionGuarded(sessionId)) {
			return Promise.resolve({ outcome: { outcome: "cancelled" } });
		}
		const requestId = encodeProtocolRequestId(
			protocolRequestId,
			params.toolCall?.toolCallId ?? randomUUID(),
		);
		const key = buildPermissionKey(sessionId, requestId);
		const existing = this.permissionRequests.get(key);
		if (existing) {
			return existing.promise;
		}
		let resolver: (response: RequestPermissionResponse) => void = () => {};
		const promise = new Promise<RequestPermissionResponse>((resolve) => {
			resolver = resolve;
		});
		let settled = false;
		let onAbort = () => {};
		const resolveOnce = (response: RequestPermissionResponse) => {
			if (settled) {
				return;
			}
			settled = true;
			signal.removeEventListener("abort", onAbort);
			resolver(response);
		};
		const permRecord: PermissionRequestRecord = {
			sessionId,
			requestId,
			params,
			promise,
			resolve: resolveOnce,
		};
		this.permissionRequests.set(key, permRecord);
		onAbort = () => {
			if (this.permissionRequests.get(key) !== permRecord) {
				return;
			}
			const outcome: RequestPermissionResponse["outcome"] = {
				outcome: "cancelled",
			};
			this.permissionRequests.delete(key);
			resolveOnce({ outcome });
			this.permissionResultEmitter.emit("result", {
				sessionId,
				requestId,
				outcome,
			});
		};
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
		signal.addEventListener("abort", onAbort, { once: true });
		if (signal.aborted) {
			onAbort();
		}
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
		this.assertSessionMutable(sessionId);
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
		record.isTitlePinned = true;
		record.updatedAt = new Date();

		// Persist to WAL
		this.walStore.ensureSession({
			sessionId,
			machineId: this.config.machineId,
			backendId: record.backendId,
			cwd: record.cwd,
			additionalDirectories: record.additionalDirectories,
			title,
			isTitlePinned: true,
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
		if (this.isSessionDeletionGuarded(sessionId)) {
			return;
		}
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
		this.assertSessionMutable(sessionId);
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
		this.assertSessionMutable(sessionId);
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
		this.assertSessionMutable(sessionId);
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
		if (
			!record.modelConfigId ||
			!record.availableModels ||
			record.availableModels.length === 0
		) {
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
		return this.setSessionConfigOption(
			sessionId,
			record.modelConfigId,
			modelId,
		);
	}

	async setSessionConfigOption(
		sessionId: string,
		configId: string,
		value: string | boolean,
		_meta?: Record<string, unknown> | null,
	): Promise<SessionSummary> {
		this.assertSessionMutable(sessionId);
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
		if (record.configOptions.length === 0) {
			throw createCapabilityNotSupportedError(
				"Current agent does not support session configuration",
			);
		}
		const configOption = record.configOptions.find(
			(option) => option.id === configId,
		);
		if (!configOption) {
			throw createSessionConfigValidationError(
				"Invalid session config option ID",
			);
		}
		validateSessionConfigValue(configOption, value);

		const response = await (_meta === undefined
			? record.connection.setSessionConfigOption(sessionId, configId, value)
			: record.connection.setSessionConfigOption(
					sessionId,
					configId,
					value,
					_meta,
				));
		this.assertSessionMutable(sessionId);
		applyConfigOptionsToRecord(record, response.configOptions);
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
		this.assertSessionMutable(sessionId);
		const record = this.sessions.get(sessionId);
		if (!record) {
			return false;
		}
		this.cancelPermissionRequests(sessionId);
		await record.connection.cancel(sessionId);
		this.touchSession(sessionId);
		return true;
	}

	/**
	 * Close a session through ACP while preserving its durable local history.
	 * The active record is only detached after the agent confirms success.
	 */
	async closeSession(sessionId: string): Promise<SessionSummary> {
		const record = this.requireClosableSession(sessionId);
		await record.connection.closeSession(sessionId);
		const detachedSummary: SessionSummary = {
			...this.buildSummary(record),
			error: undefined,
			pid: undefined,
			isAttached: false,
		};
		await this.disposeAttachedSession(sessionId, {
			reason: "session_close",
			detachedSummary,
		});
		return detachedSummary;
	}

	/** Validate close before the daemon cancels any active prompt. */
	assertSessionCloseSupported(sessionId: string): void {
		this.requireClosableSession(sessionId);
	}

	private requireClosableSession(sessionId: string): SessionRecord {
		this.assertSessionMutable(sessionId);
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
		if (!record.connection.supportsSessionClose()) {
			throw createCapabilityNotSupportedError(
				"Agent does not support session/close capability",
			);
		}
		return record;
	}

	/** Validate active-session delete support before cancelling pending work. */
	assertSessionDeleteSupported(sessionId: string): void {
		if (
			this.getRecentSessionDelete(sessionId) ||
			this.sessionDeletesInFlight.has(sessionId) ||
			this.isUnknownSessionWithinReuseQuarantine(sessionId)
		) {
			return;
		}
		const target = this.resolveSessionDeleteTarget(sessionId);
		if (target.record && !target.record.connection.supportsSessionDelete()) {
			throw createCapabilityNotSupportedError(
				"Agent does not support session/delete capability",
			);
		}
	}

	/**
	 * Delete the agent-owned session first, then permanently remove local state.
	 * Keeping the local record until both steps succeed makes a remote-success /
	 * local-failure outcome safely retryable against ACP's idempotent method.
	 */
	async deleteSession(sessionId: string): Promise<void> {
		if (this.getRecentSessionDelete(sessionId)) {
			return;
		}
		const existingDelete = this.sessionDeletesInFlight.get(sessionId);
		if (existingDelete) {
			await existingDelete;
			return;
		}
		if (this.isUnknownSessionWithinReuseQuarantine(sessionId)) {
			return;
		}
		const target = this.resolveSessionDeleteTarget(sessionId);
		const operation = Promise.resolve().then(() =>
			this.executeSessionDelete(sessionId, target),
		);
		this.sessionDeletesInFlight.set(sessionId, operation);
		try {
			await operation;
			this.markSessionRecentlyDeleted(sessionId);
		} finally {
			if (this.sessionDeletesInFlight.get(sessionId) === operation) {
				this.sessionDeletesInFlight.delete(sessionId);
			}
		}
	}

	private isUnknownSessionWithinReuseQuarantine(sessionId: string): boolean {
		this.assertValidSessionId(sessionId);
		return (
			this.reuseQuarantineUntil > Date.now() &&
			!this.sessions.has(sessionId) &&
			this.walStore.getSession(sessionId) === null &&
			this.walStore.getDiscoveredSessionBackendId(sessionId) === undefined
		);
	}

	private async executeSessionDelete(
		sessionId: string,
		target: { backend: AcpBackendConfig; record?: SessionRecord },
	): Promise<void> {
		if (!target.record) {
			return this.enqueueBackendLifecycle(target.backend.id, () =>
				this.executeSessionDeleteOnBackend(sessionId, target),
			).catch(translateAgentAuthenticationRequired);
		}
		return this.executeSessionDeleteOnBackend(sessionId, target);
	}

	private async executeSessionDeleteOnBackend(
		sessionId: string,
		target: { backend: AcpBackendConfig; record?: SessionRecord },
	): Promise<void> {
		const connection =
			target.record?.connection ??
			(await this.acquireConnection(target.backend));
		const shouldRelease = target.record === undefined;

		try {
			if (!connection.supportsSessionDelete()) {
				throw createCapabilityNotSupportedError(
					"Agent does not support session/delete capability",
				);
			}
			await connection.deleteSession(sessionId);
			this.remoteDeleteCleanupPending.add(sessionId);

			// Do not alter memory or cached keys until the entire WAL transaction commits.
			this.walStore.deleteSession(sessionId);
			this.cryptoService?.forgetSession(sessionId);
			this.discoveredSessions.delete(sessionId);

			if (target.record) {
				await this.disposeAttachedSession(sessionId);
			} else {
				try {
					this.emitSessionsChanged({
						added: [],
						updated: [],
						removed: [sessionId],
					});
				} catch (error) {
					logger.error(
						{ err: error, sessionId },
						"session_delete_change_emit_failed",
					);
				}
			}
			this.remoteDeleteCleanupPending.delete(sessionId);
		} finally {
			if (shouldRelease) {
				this.releaseConnection(target.backend.id, connection);
			}
		}
	}

	private resolveSessionDeleteTarget(sessionId: string): {
		backend: AcpBackendConfig;
		record?: SessionRecord;
	} {
		this.assertValidSessionId(sessionId);

		const record = this.sessions.get(sessionId);
		const walSession = this.walStore.getSession(sessionId);
		const discoveredBackendId =
			this.walStore.getDiscoveredSessionBackendId(sessionId);
		const backendIds = new Set(
			[record?.backendId, walSession?.backendId, discoveredBackendId].filter(
				(value): value is string => value !== undefined,
			),
		);
		if (backendIds.size === 0) {
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
		if (backendIds.size > 1) {
			throw new AppError(
				createErrorDetail({
					code: "REQUEST_VALIDATION_FAILED",
					message: "Session has conflicting backend affinity",
					retryable: false,
					scope: "session",
				}),
				409,
			);
		}
		const [backendId] = backendIds;
		if (!backendId) {
			throw new Error("Session backend affinity was not resolved");
		}
		return { backend: this.resolveBackend(backendId), record };
	}

	/** Dispose a local ACP connection without invoking protocol session/close. */
	private async disposeAttachedSession(
		sessionId: string,
		options?: {
			reason?:
				| "agent_exit"
				| "cli_disconnect"
				| "gateway_disconnect"
				| "session_close"
				| "unknown";
			detachedSummary?: SessionSummary;
		},
	): Promise<boolean> {
		const record = this.sessions.get(sessionId);
		if (!record) {
			return false;
		}
		this.closedSessionRecords.add(record);
		try {
			record.unsubscribe?.();
			record.unsubscribeTerminal?.();
			record.unsubscribeStatus?.();
		} catch (error) {
			logger.error({ err: error, sessionId }, "session_unsubscribe_failed");
		}
		try {
			this.cancelPermissionRequests(sessionId);
		} catch (error) {
			logger.error(
				{ err: error, sessionId },
				"session_permission_cancel_failed",
			);
		}
		try {
			await record.connection.disconnect();
		} catch (error) {
			logger.error({ err: error, sessionId }, "session_disconnect_failed");
		}
		try {
			this.emitSessionDetached(sessionId, options?.reason ?? "unknown");
		} catch (error) {
			logger.error({ err: error, sessionId }, "session_detach_emit_failed");
		}
		this.sessions.delete(sessionId);
		try {
			this.emitSessionsChanged(
				options?.detachedSummary
					? {
							added: [],
							updated: [options.detachedSummary],
							removed: [],
						}
					: {
							added: [],
							updated: [],
							removed: [sessionId],
						},
			);
		} catch (error) {
			logger.error(
				{ err: error, sessionId },
				"session_close_change_emit_failed",
			);
		}
		return true;
	}

	async closeAll(): Promise<void> {
		const sessionIds = Array.from(this.sessions.keys());
		await Promise.all(
			sessionIds.map((sessionId) => this.disposeAttachedSession(sessionId)),
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
		this.assertSessionMutable(sessionId);
		if (this.sessions.has(sessionId)) {
			await this.disposeAttachedSession(sessionId);
		}
		this.walStore.archiveSession(sessionId);
		this.discoveredSessions.delete(sessionId);
		this.currentSessionIncarnationIds.delete(sessionId);
	}

	/**
	 * Archive multiple sessions at once.
	 */
	async bulkArchiveSessions(
		sessionIds: string[],
	): Promise<{ archivedCount: number }> {
		for (const sessionId of sessionIds) {
			this.assertSessionMutable(sessionId);
		}
		await Promise.allSettled(
			sessionIds
				.filter((id) => this.sessions.has(id))
				.map((id) => this.disposeAttachedSession(id)),
		);
		const archivedCount = this.walStore.bulkArchiveSessions(sessionIds);
		for (const id of sessionIds) {
			this.discoveredSessions.delete(id);
			this.currentSessionIncarnationIds.delete(id);
		}
		return { archivedCount };
	}

	/**
	 * Shutdown the session manager and close resources.
	 */
	async shutdown(): Promise<void> {
		this.shuttingDown = true;
		await Promise.all(Array.from(this.backendLifecycleTails.values()));
		await this.closeAll();
		this.walStore.close();
	}

	/** Initialize a backend without creating a session and return a safe snapshot. */
	async getAgentCapabilities(
		backendId: string,
	): Promise<AgentSessionCapabilities> {
		const backend = this.resolveBackend(backendId);
		return this.enqueueBackendLifecycle(backend.id, async () => {
			const connection = await this.acquireConnection(backend);
			try {
				const capabilities = connection.getSessionCapabilities();
				this.backendCapabilities.set(backend.id, capabilities);
				return capabilities;
			} finally {
				this.releaseConnection(backend.id, connection);
			}
		});
	}

	/** Run a stable Agent-managed authentication flow on the backend process. */
	async authenticateAgent(
		backendId: string,
		methodId: string,
	): Promise<AgentSessionCapabilities> {
		const backend = this.resolveBackend(backendId);
		return this.enqueueBackendLifecycle(backend.id, async () => {
			const connection = await this.acquireConnection(backend);
			const advertisedMethod = connection
				.getAuthenticationCapabilities()
				?.methods.some((method) => method.id === methodId);
			if (!advertisedMethod) {
				this.releaseConnection(backend.id, connection);
				throw new AppError(
					createErrorDetail({
						code: "REQUEST_VALIDATION_FAILED",
						message: "Invalid Agent authentication method",
						retryable: false,
						scope: "request",
					}),
					400,
				);
			}

			try {
				await this.withAgentAuthTimeout(() =>
					connection.authenticate(methodId),
				);
			} catch {
				await connection.disconnect().catch(() => {});
				throw createAgentAuthenticationError(
					"AGENT_AUTHENTICATION_FAILED",
					"Agent authentication failed",
					true,
					502,
				);
			}

			const capabilities = connection.getSessionCapabilities();
			this.backendCapabilities.set(backend.id, capabilities);
			this.releaseConnection(backend.id, connection);
			this.emitBackendCapabilitiesChanged(backend.id, capabilities);
			return capabilities;
		});
	}

	/** Logout invalidates the process, so it is never returned to the idle pool. */
	async logoutAgent(backendId: string): Promise<AgentSessionCapabilities> {
		const backend = this.resolveBackend(backendId);
		return this.enqueueBackendLifecycle(backend.id, async () => {
			if (
				Array.from(this.sessions.values()).some(
					(record) => record.backendId === backend.id,
				)
			) {
				throw new AppError(
					createErrorDetail({
						code: "SESSION_BUSY",
						message: "Close active sessions before logging out of this Agent",
						retryable: false,
						scope: "service",
					}),
					409,
				);
			}

			const connection = await this.acquireConnection(backend);
			if (!connection.supportsLogout()) {
				this.releaseConnection(backend.id, connection);
				throw createCapabilityNotSupportedError(
					"Agent does not support logout",
				);
			}
			const capabilities = connection.getSessionCapabilities();
			try {
				await this.withAgentAuthTimeout(() => connection.logout());
			} catch {
				throw createAgentAuthenticationError(
					"AGENT_AUTHENTICATION_FAILED",
					"Agent logout failed",
					true,
					502,
				);
			} finally {
				await connection.disconnect().catch(() => {});
			}
			this.backendCapabilities.set(backend.id, capabilities);
			this.emitBackendCapabilitiesChanged(backend.id, capabilities);
			return capabilities;
		});
	}

	private emitBackendCapabilitiesChanged(
		backendId: string,
		capabilities: AgentSessionCapabilities,
	): void {
		try {
			this.emitSessionsChanged({
				added: [],
				updated: [],
				removed: [],
				backendCapabilities: { [backendId]: capabilities },
			});
		} catch (error) {
			logger.error(
				{ err: error, backendId },
				"agent_backend_capabilities_emit_failed",
			);
		}
	}

	/**
	 * Get cached per-backend capabilities.
	 */
	getBackendCapabilities(): Record<string, AgentSessionCapabilities> {
		return Object.fromEntries(this.backendCapabilities);
	}

	/**
	 * Discover sessions persisted by the ACP agent.
	 * Creates a temporary connection to query sessions.
	 * @param options Optional parameters for discovery
	 * @returns List of discovered sessions and agent capabilities
	 */
	async discoverSessions(
		options: DiscoverManagedSessionsOptions,
	): Promise<DiscoverSessionsRpcResult> {
		const backend = this.resolveBackend(options.backendId);
		return this.enqueueBackendLifecycle(backend.id, () =>
			this.discoverSessionsOnBackend(options, backend),
		).catch(translateAgentAuthenticationRequired);
	}

	private async discoverSessionsOnBackend(
		options: DiscoverManagedSessionsOptions,
		backend: AcpBackendConfig,
	): Promise<DiscoverSessionsRpcResult> {
		const connection = await this.acquireConnection(backend);

		try {
			const capabilities = connection.getSessionCapabilities();
			const sessions: AcpSessionInfo[] = [];
			let nextCursor: string | undefined;

			if (capabilities.list) {
				const observation = this.beginAgentSessionObservation();
				try {
					const response = await connection.listSessions({
						cwd: options?.cwd,
						cursor: options?.cursor,
					});
					nextCursor = response.nextCursor;

					// Get archived IDs to filter them out
					const archivedIds = new Set(this.walStore.getArchivedSessionIds());
					const sessionsWithValidIds = response.sessions.filter((session) => {
						if (isValidSessionId(session.sessionId)) {
							return true;
						}
						logger.warn(
							{ backendId: backend.id },
							"discovered_session_invalid_id",
						);
						return false;
					});

					const validity = await Promise.all(
						sessionsWithValidIds.map(async (session) => {
							try {
								const additionalDirectories = normalizeAdditionalDirectories(
									session.cwd,
									session.additionalDirectories ?? undefined,
								);
								return {
									session,
									additionalDirectories,
									isValid: session.cwd
										? await this.validateWorkspacePath(session.cwd)
										: false,
									projectContext: session.cwd
										? await this.resolveGitProjectContext(session.cwd)
										: undefined,
								};
							} catch (error) {
								logger.warn(
									{ err: error, sessionId: session.sessionId },
									"discovered_session_invalid_additional_directories",
								);
								return {
									session,
									additionalDirectories: [],
									isValid: false,
									projectContext: undefined,
								};
							}
						}),
					);

					const now = new Date().toISOString();
					const discoveredRecords: Array<{
						sessionId: string;
						backendId: string;
						cwd?: string;
						additionalDirectories: string[];
						workspaceRootCwd?: string;
						title?: string | null;
						agentUpdatedAt?: string | null;
						_meta?: Record<string, unknown> | null;
						discoveredAt: string;
						isStale: boolean;
					}> = [];

					for (const {
						session,
						additionalDirectories,
						isValid,
						projectContext,
					} of validity) {
						if (
							this.isAgentSessionObservationStale(
								session.sessionId,
								observation,
							)
						) {
							continue;
						}
						if (!isValid) {
							if (this.isSessionTemporarilyHidden(session.sessionId)) {
								continue;
							}
							this.discoveredSessions.delete(session.sessionId);
							// Mark as stale in WAL
							this.walStore.markDiscoveredSessionStale(session.sessionId);
							continue;
						}

						// Skip archived sessions
						if (archivedIds.has(session.sessionId)) {
							continue;
						}
						if (
							!this.acceptAgentSessionObservation(
								session.sessionId,
								observation,
							)
						) {
							continue;
						}
						this.registerCurrentSessionIncarnation(session.sessionId);

						const previous = this.discoveredSessions.get(session.sessionId);
						const metadata = Object.hasOwn(session, "_meta")
							? { _meta: session._meta }
							: previous && Object.hasOwn(previous, "_meta")
								? { _meta: previous._meta }
								: {};
						this.discoveredSessions.set(session.sessionId, {
							sessionId: session.sessionId,
							cwd: session.cwd,
							additionalDirectories,
							workspaceRootCwd: projectContext?.repoRoot ?? session.cwd,
							title: session.title,
							updatedAt: session.updatedAt,
							...metadata,
						});
						sessions.push({
							sessionId: session.sessionId,
							cwd: session.cwd,
							additionalDirectories,
							workspaceRootCwd: projectContext?.repoRoot ?? session.cwd,
							title: session.title,
							updatedAt: session.updatedAt,
							...metadata,
						});

						// Collect for WAL persistence
						discoveredRecords.push({
							sessionId: session.sessionId,
							backendId: backend.id,
							cwd: session.cwd,
							additionalDirectories,
							workspaceRootCwd: projectContext?.repoRoot ?? session.cwd,
							title: session.title ?? null,
							agentUpdatedAt: session.updatedAt ?? null,
							...metadata,
							discoveredAt: now,
							isStale: false,
						});
					}

					// Persist to WAL
					if (discoveredRecords.length > 0) {
						this.walStore.saveDiscoveredSessions(discoveredRecords);
					}
				} finally {
					this.finishAgentSessionObservation(observation);
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
	 * Resume a durable session without asking the agent to replay history.
	 * The existing WAL revision, events, and revision key remain authoritative.
	 */
	async resumeSession(
		sessionId: string,
		cwd: string,
		backendId: string,
		additionalDirectories?: string[],
	): Promise<SessionSummary> {
		const backend = this.resolveBackend(backendId);
		return this.enqueueBackendLifecycle(backend.id, () =>
			this.resumeSessionOnBackend(
				sessionId,
				cwd,
				backendId,
				additionalDirectories,
				backend,
			),
		).catch(translateAgentAuthenticationRequired);
	}

	private async resumeSessionOnBackend(
		sessionId: string,
		cwd: string,
		backendId: string,
		additionalDirectories: string[] | undefined,
		backend: AcpBackendConfig,
	): Promise<SessionSummary> {
		logger.info({ sessionId, cwd, backendId }, "resume_session_start");
		if (
			sessionId.length === 0 ||
			cwd.length === 0 ||
			(!path.posix.isAbsolute(cwd) && !path.win32.isAbsolute(cwd))
		) {
			throw new AppError(
				createErrorDetail({
					code: "REQUEST_VALIDATION_FAILED",
					message: "Session ID and an absolute cwd are required",
					retryable: false,
					scope: "request",
				}),
				400,
			);
		}
		this.assertSessionMutable(sessionId);
		if (this.walStore.isArchived(sessionId)) {
			throw new AppError(
				createErrorDetail({
					code: "SESSION_NOT_FOUND",
					message: "Archived session cannot be resumed",
					retryable: false,
					scope: "session",
				}),
				410,
			);
		}

		const walSession = this.walStore.getSession(sessionId);
		const existing = this.sessions.get(sessionId);
		const discovered = this.discoveredSessions.get(sessionId);
		const durableDiscovered = this.walStore
			.getDiscoveredSessions()
			.find((session) => session.sessionId === sessionId);
		const isTitlePinned = walSession?.isTitlePinned ?? existing?.isTitlePinned;
		const resolvedTitle = resolveSessionTitle({
			sessionId,
			isTitlePinned,
			localTitle: walSession?.isTitlePinned
				? walSession.title
				: (existing?.title ?? walSession?.title),
			hasDiscoveredSnapshot:
				existing === undefined &&
				(discovered !== undefined || durableDiscovered !== undefined),
			discoveredTitle:
				discovered !== undefined ? discovered.title : durableDiscovered?.title,
		});
		const knownBackendIds = [
			walSession?.backendId,
			existing?.backendId,
			durableDiscovered?.backendId,
		].filter((value): value is string => value !== undefined);
		if (
			knownBackendIds.some((knownBackendId) => knownBackendId !== backendId)
		) {
			throw new AppError(
				createErrorDetail({
					code: "REQUEST_VALIDATION_FAILED",
					message: "Session backend does not match resume request",
					retryable: false,
					scope: "request",
				}),
				400,
			);
		}
		const knownCwds = [
			walSession?.cwd,
			existing?.cwd,
			discovered?.cwd,
			durableDiscovered?.cwd,
		].filter((value): value is string => value !== undefined);
		if (knownCwds.some((knownCwd) => knownCwd !== cwd)) {
			throw new AppError(
				createErrorDetail({
					code: "REQUEST_VALIDATION_FAILED",
					message: "Session cwd does not match resume request",
					retryable: false,
					scope: "request",
				}),
				400,
			);
		}
		const normalizedAdditionalDirectories = normalizeAdditionalDirectories(
			cwd,
			additionalDirectories,
		);
		const rootsAlreadyActive =
			existing?.additionalDirectories.length ===
				normalizedAdditionalDirectories.length &&
			existing.additionalDirectories.every(
				(directory, index) =>
					directory === normalizedAdditionalDirectories[index],
			);

		if (
			existing?.connection.getStatus().state === "ready" &&
			existing.connection.getStatus().sessionId === sessionId &&
			rootsAlreadyActive
		) {
			this.emitSessionAttached(sessionId, true);
			return this.buildSummary(existing);
		}

		if (existing) {
			this.closedSessionRecords.add(existing);
			existing.unsubscribe?.();
			existing.unsubscribeTerminal?.();
			existing.unsubscribeStatus?.();
			this.cancelPermissionRequests(sessionId);
			this.emitSessionDetached(sessionId, "unknown");
			this.sessions.delete(sessionId);
			await existing.connection.disconnect().catch((error) => {
				logger.warn(
					{ err: error, sessionId },
					"resume_replaced_connection_disconnect_failed",
				);
			});
		}

		const connection = await this.acquireConnection(backend);
		const resumeBuffer: PendingReloadBuffer = { events: [], bytes: 0 };
		let recordRef: SessionRecord | undefined;
		let committedEvents: WalEvent[] = [];
		const unsubscribe = connection.onSessionUpdate((notification) => {
			if (recordRef) {
				this.handleSessionUpdate(recordRef, notification);
				return;
			}
			this.bufferReloadEvent(resumeBuffer, {
				type: "session_update",
				notification,
			});
		});

		try {
			if (!connection.supportsSessionResume()) {
				throw createCapabilityNotSupportedError(
					"Agent does not support session resuming",
				);
			}
			const response = await connection.resumeSession(
				sessionId,
				cwd,
				normalizedAdditionalDirectories,
			);
			connection.setPermissionHandler((params, requestId, signal) =>
				this.handlePermissionRequest(sessionId, params, requestId, signal),
			);
			if (resumeBuffer.error) {
				throw resumeBuffer.error;
			}

			const projectContext = await this.resolveGitProjectContext(cwd);
			if (resumeBuffer.error) {
				throw resumeBuffer.error;
			}
			this.assertSessionMutable(sessionId);

			const now = new Date();
			const agentInfo = connection.getAgentInfo();
			const modelState = resolveModelState(response.configOptions);
			const modeState = resolveModeState(response.modes);
			const preserveConfigState = response.configOptions === undefined;
			const preserveModeState = response.modes === undefined;
			const configOptions = preserveConfigState
				? (existing?.configOptions ?? [])
				: normalizeConfigOptions(response.configOptions);
			const revision = walSession?.currentRevision ?? 1;
			const wrappedDek = this.requirePreparedSessionRevisionDek(
				sessionId,
				revision,
			);
			const record: SessionRecord = {
				sessionId,
				title: resolvedTitle,
				backendId: backend.id,
				backendLabel: backend.label,
				connection,
				createdAt:
					existing?.createdAt ??
					(walSession ? new Date(walSession.createdAt) : now),
				updatedAt: now,
				cwd,
				additionalDirectories: normalizedAdditionalDirectories,
				workspaceRootCwd:
					existing?.workspaceRootCwd ?? projectContext.repoRoot ?? cwd,
				worktreeSourceCwd: existing?.worktreeSourceCwd,
				worktreeBranch: existing?.worktreeBranch,
				agentName: agentInfo?.title ?? agentInfo?.name ?? existing?.agentName,
				modelConfigId: preserveConfigState
					? existing?.modelConfigId
					: modelState.modelConfigId,
				modelId: preserveConfigState ? existing?.modelId : modelState.modelId,
				modelName: preserveConfigState
					? existing?.modelName
					: modelState.modelName,
				availableModels: preserveConfigState
					? existing?.availableModels
					: modelState.availableModels,
				modeId: preserveModeState ? existing?.modeId : modeState.modeId,
				modeName: preserveModeState ? existing?.modeName : modeState.modeName,
				availableModes: preserveModeState
					? existing?.availableModes
					: modeState.availableModes,
				configOptions,
				availableCommands: existing?.availableCommands,
				revision,
				_meta:
					existing !== undefined
						? existing._meta
						: discovered !== undefined
							? discovered._meta
							: durableDiscovered?._meta,
				isTitlePinned,
				pendingReload: resumeBuffer,
			};
			recordRef = record;
			record.unsubscribe = unsubscribe;
			this.setupSessionSubscriptions(record, { skipSessionUpdates: true });
			if (resumeBuffer.error) {
				throw resumeBuffer.error;
			}
			const committed = this.walStore.commitSessionResume({
				sessionId,
				machineId: walSession?.machineId ?? this.config.machineId,
				backendId: walSession?.backendId ?? backend.id,
				cwd,
				additionalDirectories: normalizedAdditionalDirectories,
				title: resolvedTitle,
				isTitlePinned,
				expectedRevision: walSession?.currentRevision ?? null,
				events: this.toWalEventInputs(resumeBuffer.events),
				wrappedDek,
			});
			committedEvents = committed.events;
			delete record.pendingReload;
		} catch (error) {
			if (recordRef) {
				this.closedSessionRecords.add(recordRef);
				delete recordRef.pendingReload;
			}
			unsubscribe();
			recordRef?.unsubscribeTerminal?.();
			recordRef?.unsubscribeStatus?.();
			if (this.sessions.get(sessionId) === recordRef) {
				this.sessions.delete(sessionId);
			}
			await connection.disconnect().catch(() => {});
			throw error;
		}

		if (!recordRef) {
			throw new Error("Resumed session record was not initialized");
		}
		this.applyReloadEventsToRecord(recordRef, resumeBuffer.events);
		this.registerCurrentSessionIncarnation(sessionId);
		this.emitCommittedReloadEvents(committedEvents);
		this.sessions.set(sessionId, recordRef);
		const summary = this.buildSummary(recordRef);
		try {
			this.emitSessionsChanged(
				walSession
					? {
							added: [],
							updated: [summary],
							removed: [],
							backendCapabilities: {
								[backend.id]: connection.getSessionCapabilities(),
							},
						}
					: { added: [summary], updated: [], removed: [] },
			);
			this.emitSessionAttached(sessionId);
		} catch (error) {
			logger.error(
				{ err: error, sessionId },
				"resume_session_notification_failed",
			);
		}
		logger.info(
			{ sessionId, backendId, revision: recordRef.revision },
			"resume_session_complete",
		);
		return summary;
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
		additionalDirectories?: string[],
	): Promise<SessionSummary> {
		const backend = this.resolveBackend(backendId);
		return this.enqueueBackendLifecycle(backend.id, () =>
			this.loadSessionOnBackend(
				sessionId,
				cwd,
				backendId,
				additionalDirectories,
				backend,
			),
		).catch(translateAgentAuthenticationRequired);
	}

	private async loadSessionOnBackend(
		sessionId: string,
		cwd: string,
		backendId: string,
		additionalDirectories: string[] | undefined,
		backend: AcpBackendConfig,
	): Promise<SessionSummary> {
		logger.info({ sessionId, cwd, backendId }, "load_session_start");
		this.assertSessionMutable(sessionId);
		if (this.walStore.isArchived(sessionId)) {
			throw new AppError(
				createErrorDetail({
					code: "SESSION_NOT_FOUND",
					message: "Archived session cannot be loaded",
					retryable: false,
					scope: "session",
				}),
				410,
			);
		}

		// Check if session is already loaded
		const existing = this.sessions.get(sessionId);
		if (existing) {
			logger.debug({ sessionId }, "load_session_already_loaded");
			this.emitSessionAttached(sessionId, true);
			return this.buildSummary(existing);
		}

		const connection = await this.acquireConnection(backend);
		const normalizedAdditionalDirectories = normalizeAdditionalDirectories(
			cwd,
			additionalDirectories,
		);
		let unsubscribe: (() => void) | undefined;
		let recordRef: SessionRecord | undefined;

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

			const loadBuffer: PendingReloadBuffer = { events: [], bytes: 0 };
			const bufferedEvents = loadBuffer.events;
			unsubscribe = connection.onSessionUpdate(
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
						this.handleSessionUpdate(recordRef, notification);
					} else {
						this.bufferReloadEvent(loadBuffer, {
							type: "session_update",
							notification,
						});
						logger.debug(
							{ sessionId, bufferedCount: bufferedEvents.length },
							"load_session_buffered",
						);
					}
				},
			);

			logger.debug({ sessionId }, "load_session_calling_acp");
			const response = await connection.loadSession(
				sessionId,
				cwd,
				normalizedAdditionalDirectories,
			);
			logger.debug(
				{
					sessionId,
					bufferedCount: bufferedEvents.length,
					hasModelConfig: !!resolveModelState(response.configOptions)
						.modelConfigId,
					hasModes: !!response.modes,
				},
				"load_session_acp_returned",
			);
			if (loadBuffer.error) {
				throw loadBuffer.error;
			}
			connection.setPermissionHandler((params, requestId, signal) =>
				this.handlePermissionRequest(sessionId, params, requestId, signal),
			);

			const now = new Date();
			const agentInfo = connection.getAgentInfo();
			const { modelConfigId, modelId, modelName, availableModels } =
				resolveModelState(response.configOptions);
			const { modeId, modeName, availableModes } = resolveModeState(
				response.modes,
			);
			const discovered = this.discoveredSessions.get(sessionId);
			const durableDiscovered = this.walStore
				.getDiscoveredSessions()
				.find((session) => session.sessionId === sessionId);
			const walPinned = existingWalSession?.isTitlePinned;
			const resolvedTitle = resolveSessionTitle({
				sessionId,
				isTitlePinned: walPinned,
				localTitle: existingWalSession?.title,
				hasDiscoveredSnapshot:
					discovered !== undefined || durableDiscovered !== undefined,
				discoveredTitle:
					discovered !== undefined
						? discovered.title
						: durableDiscovered?.title,
			});
			const resolvedMeta =
				discovered !== undefined ? discovered._meta : durableDiscovered?._meta;
			const projectContext = await this.resolveGitProjectContext(cwd);
			if (loadBuffer.error) {
				throw loadBuffer.error;
			}
			this.assertSessionMutable(sessionId);

			const walEvents = this.toWalEventInputs(bufferedEvents);
			let revision: number;
			let committedEvents: WalEvent[];
			if (hasExistingHistory && existingWalSession) {
				const targetRevision = existingWalSession.currentRevision + 1;
				const wrappedDek = this.requirePreparedSessionRevisionDek(
					sessionId,
					targetRevision,
				);
				const committed = this.walStore.commitReloadRevision({
					sessionId,
					expectedRevision: existingWalSession.currentRevision,
					additionalDirectories: normalizedAdditionalDirectories,
					events: walEvents,
					wrappedDek,
				});
				revision = committed.revision;
				committedEvents = committed.events;
			} else {
				const expectedRevision = existingWalSession?.currentRevision ?? null;
				const targetRevision = expectedRevision ?? 1;
				const wrappedDek = this.requirePreparedSessionRevisionDek(
					sessionId,
					targetRevision,
				);
				const committed = this.walStore.commitSessionLoad({
					sessionId,
					machineId: this.config.machineId,
					backendId: backend.id,
					cwd,
					additionalDirectories: normalizedAdditionalDirectories,
					title: resolvedTitle,
					isTitlePinned: walPinned,
					expectedRevision,
					events: walEvents,
					wrappedDek,
				});
				revision = committed.revision;
				committedEvents = committed.events;
			}
			if (hasExistingHistory) {
				logger.debug({ sessionId, revision }, "load_session_bump_revision");
			}

			const record: SessionRecord = {
				sessionId,
				title: resolvedTitle,
				backendId: backend.id,
				backendLabel: backend.label,
				connection,
				createdAt: now,
				updatedAt: now,
				cwd,
				additionalDirectories: normalizedAdditionalDirectories,
				workspaceRootCwd: projectContext.repoRoot ?? cwd,
				agentName: agentInfo?.title ?? agentInfo?.name,
				modelConfigId,
				modelId,
				modelName,
				modeId,
				modeName,
				availableModes,
				availableModels,
				configOptions: normalizeConfigOptions(response.configOptions),
				availableCommands: undefined,
				revision,
				_meta: resolvedMeta,
				isTitlePinned: walPinned,
			};

			recordRef = record;
			record.unsubscribe = unsubscribe;

			// Apply and emit only after the complete replay is durably committed.
			logger.debug(
				{ sessionId, bufferedCount: bufferedEvents.length },
				"load_session_writing_buffered",
			);
			this.applyReloadEventsToRecord(record, bufferedEvents);
			this.registerCurrentSessionIncarnation(sessionId);
			this.emitCommittedReloadEvents(committedEvents);

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
			unsubscribe?.();
			recordRef?.unsubscribeTerminal?.();
			recordRef?.unsubscribeStatus?.();
			await connection.disconnect();
			throw error;
		}
	}

	/**
	 * Reload a historical session from the ACP agent.
	 * Replays session history even if the session is already loaded.
	 */
	reloadSession(
		sessionId: string,
		cwd: string,
		backendId: string,
		additionalDirectories?: string[],
	): Promise<SessionSummary> {
		const previous =
			this.sessionReloadTails.get(sessionId) ?? Promise.resolve();
		const operation = previous.then(() =>
			this.executeReloadSession(
				sessionId,
				cwd,
				backendId,
				additionalDirectories,
			),
		);
		const tail = operation.then(
			() => {},
			() => {},
		);
		this.sessionReloadTails.set(sessionId, tail);
		const clearTail = () => {
			if (this.sessionReloadTails.get(sessionId) === tail) {
				this.sessionReloadTails.delete(sessionId);
			}
		};
		void operation.then(clearTail, clearTail);
		return operation;
	}

	private async executeReloadSession(
		sessionId: string,
		cwd: string,
		backendId: string,
		additionalDirectories?: string[],
	): Promise<SessionSummary> {
		this.assertSessionMutable(sessionId);
		const normalizedAdditionalDirectories = normalizeAdditionalDirectories(
			cwd,
			additionalDirectories,
		);
		const existing = this.sessions.get(sessionId);
		if (!existing) {
			return this.loadSession(
				sessionId,
				cwd,
				backendId,
				normalizedAdditionalDirectories,
			);
		}

		if (!existing.connection.supportsSessionLoad()) {
			throw createCapabilityNotSupportedError(
				"Agent does not support session loading",
			);
		}

		const reloadBuffer: PendingReloadBuffer = { events: [], bytes: 0 };
		const bufferedEvents = reloadBuffer.events;
		existing.pendingReload = reloadBuffer;
		let response: Awaited<ReturnType<typeof existing.connection.loadSession>>;
		let projectContext: Awaited<ReturnType<typeof resolveGitProjectContext>>;
		try {
			response = await existing.connection.loadSession(
				sessionId,
				cwd,
				normalizedAdditionalDirectories,
			);
			if (reloadBuffer.error) {
				throw reloadBuffer.error;
			}
			projectContext = await this.resolveGitProjectContext(cwd);
			if (reloadBuffer.error) {
				throw reloadBuffer.error;
			}
			this.assertSessionMutable(sessionId);
		} catch (error) {
			delete existing.pendingReload;
			if (bufferedEvents.length > 0) {
				logger.warn(
					{
						err: error,
						sessionId,
						discardedEvents: bufferedEvents.length,
					},
					"reload_failed_events_discarded",
				);
			}
			await this.disposeAttachedSession(sessionId);
			throw error;
		}

		const commitReload = () => {
			const modelState = resolveModelState(response.configOptions);
			const modeState = resolveModeState(response.modes);
			const agentInfo = existing.connection.getAgentInfo();
			const targetRevision = existing.revision + 1;
			const wrappedDek = this.requirePreparedSessionRevisionDek(
				sessionId,
				targetRevision,
			);
			const committed = this.walStore.commitReloadRevision({
				sessionId,
				expectedRevision: existing.revision,
				additionalDirectories: normalizedAdditionalDirectories,
				events: this.toWalEventInputs(bufferedEvents),
				wrappedDek,
			});
			return {
				agentInfo,
				committed,
				configOptions: normalizeConfigOptions(response.configOptions),
				...modelState,
				...modeState,
			};
		};
		let reloadCommit: ReturnType<typeof commitReload>;
		try {
			reloadCommit = commitReload();
		} catch (error) {
			logger.error(
				{ err: error, sessionId },
				"reload_local_commit_failed_session_closing",
			);
			await this.disposeAttachedSession(sessionId);
			throw error;
		} finally {
			delete existing.pendingReload;
		}
		const {
			agentInfo,
			committed,
			modelId,
			modelName,
			modelConfigId,
			availableModels,
			configOptions,
			modeId,
			modeName,
			availableModes,
		} = reloadCommit;

		existing.revision = committed.revision;
		existing.cwd = cwd;
		existing.additionalDirectories = normalizedAdditionalDirectories;
		existing.workspaceRootCwd = projectContext.repoRoot ?? cwd;
		existing.agentName =
			agentInfo?.title ?? agentInfo?.name ?? existing.agentName;
		existing.modelConfigId = modelConfigId;
		existing.modelId = modelId;
		existing.modelName = modelName;
		existing.availableModels = availableModels;
		existing.configOptions = configOptions;
		existing.modeId = modeId;
		existing.modeName = modeName;
		existing.availableModes = availableModes;
		existing.updatedAt = new Date();
		this.applyReloadEventsToRecord(existing, bufferedEvents);
		this.emitCommittedReloadEvents(committed.events);

		const summary = this.buildSummary(existing);
		this.emitSessionsChanged({
			added: [],
			updated: [summary],
			removed: [],
		});
		this.emitSessionAttached(sessionId, true);

		logger.info(
			{ sessionId, backendId, revision: committed.revision },
			"session_reloaded",
		);

		return summary;
	}

	private toWalEventInputs(
		events: readonly PendingReloadEvent[],
	): WalEventInput[] {
		return events.map((event) => {
			if (event.type === "wal_event") {
				return { kind: event.kind, payload: event.payload };
			}
			return {
				kind: resolveSessionUpdateEventKind(event.notification),
				payload: event.notification,
			};
		});
	}

	private applyReloadEventsToRecord(
		record: SessionRecord,
		events: readonly PendingReloadEvent[],
	): void {
		for (const event of events) {
			if (event.type === "session_update") {
				advanceSessionUpdatedAt(record, new Date());
				this.applySessionUpdateToRecord(record, event.notification);
			}
		}
	}

	private emitCommittedReloadEvents(events: readonly WalEvent[]): void {
		for (const walEvent of events) {
			try {
				this.emitSessionEvent(this.toSessionEvent(walEvent));
			} catch (error) {
				logger.error(
					{
						err: error,
						sessionId: walEvent.sessionId,
						revision: walEvent.revision,
						seq: walEvent.seq,
					},
					"committed_reload_event_emit_failed",
				);
			}
		}
	}

	private handleSessionUpdate(
		record: SessionRecord,
		notification: SessionNotification,
	): void {
		if (
			this.closedSessionRecords.has(record) ||
			this.isSessionDeletionGuarded(record.sessionId)
		) {
			return;
		}
		if (record.pendingReload) {
			this.bufferReloadEvent(record.pendingReload, {
				type: "session_update",
				notification,
			});
			return;
		}
		advanceSessionUpdatedAt(record, new Date());
		this.writeSessionUpdateToWal(record, notification);
		this.applySessionUpdateToRecord(record, notification);
		if (notification.update.sessionUpdate === "config_option_update") {
			this.emitSessionsChanged({
				added: [],
				updated: [this.buildSummary(record)],
				removed: [],
			});
		}
	}

	private bufferReloadEvent(
		buffer: PendingReloadBuffer,
		event: PendingReloadEvent,
	): void {
		if (buffer.error) {
			return;
		}
		if (buffer.events.length >= MAX_RELOAD_BUFFER_EVENTS) {
			buffer.error = new Error("Reload replay exceeds local buffer limit");
			return;
		}
		let serialized: string | undefined;
		try {
			serialized = JSON.stringify(event);
		} catch (error) {
			buffer.error =
				error instanceof Error
					? error
					: new Error("Reload replay event is not serializable");
			return;
		}
		if (
			serialized === undefined ||
			buffer.bytes + Buffer.byteLength(serialized, "utf8") >
				MAX_RELOAD_BUFFER_BYTES
		) {
			buffer.error = new Error("Reload replay exceeds local buffer limit");
			return;
		}
		buffer.bytes += Buffer.byteLength(serialized, "utf8");
		buffer.events.push(event);
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
			if ("title" in update && !record.isTitlePinned) {
				if (update.title === null) {
					record.title = getSessionFallbackTitle(record.sessionId);
				} else if (typeof update.title === "string") {
					record.title = update.title;
				}
			}
			if ("updatedAt" in update && typeof update.updatedAt === "string") {
				const agentUpdatedAt = parseAgentUpdatedAt(update.updatedAt);
				if (agentUpdatedAt) {
					advanceSessionUpdatedAt(record, agentUpdatedAt);
				}
			}
			if ("_meta" in update) {
				const meta = update._meta;
				if (meta !== undefined) {
					// `_meta` is opaque: a concrete object replaces the previous value
					// exactly (including null-valued keys), while null clears it.
					record._meta = meta;
				}
			}
		}
		if (update.sessionUpdate === "available_commands_update") {
			if (update.availableCommands) {
				record.availableCommands = update.availableCommands;
			}
			return;
		}
		if (update.sessionUpdate === "config_option_update") {
			applyConfigOptionsToRecord(record, update.configOptions);
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
		const kind = resolveSessionUpdateEventKind(notification);

		logger.debug(
			{
				sessionId: record.sessionId,
				revision: record.revision,
				updateType: update.sessionUpdate,
			},
			"write_session_update_to_wal_start",
		);

		if (kind === "unknown_update") {
			// Forward-compatible: write unknown update types to WAL so no data is
			// lost when the SDK introduces new event types.
			logger.warn(
				{
					sessionId: record.sessionId,
					updateType: (update as { sessionUpdate?: string }).sessionUpdate,
				},
				"unknown_session_update_type_persisted",
			);
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

		const messageId =
			kind === "user_message"
				? this.activeMessageIdBySession.get(record.sessionId)
				: undefined;
		const payload = messageId ? { ...notification, messageId } : notification;

		this.writeAndEmitEvent(record.sessionId, record.revision, kind, payload);
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
					this.handleSessionUpdate(record, notification);
				},
			);
		}

		record.unsubscribeTerminal = connection.onTerminalOutput((event) => {
			logger.debug({ sessionId }, "acp_terminal_output_received_via_setup");
			// Write terminal output to WAL (emits via session:event)
			this.bufferOrWriteSessionEvent(record, "terminal_output", event);
		});

		record.unsubscribeStatus = connection.onStatusChange((status) => {
			logger.debug(
				{ sessionId, hasError: !!status.error },
				"acp_status_change",
			);
			if (status.error) {
				// Write error to WAL (emits via session:event)
				this.bufferOrWriteSessionEvent(record, "session_error", {
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
			additionalDirectories: record.additionalDirectories,
			workspaceRootCwd: record.workspaceRootCwd,
			agentName: record.agentName,
			modelId: record.modelId,
			modelName: record.modelName,
			modeId: record.modeId,
			modeName: record.modeName,
			availableModes: record.availableModes,
			availableModels: record.availableModels,
			configOptions: record.configOptions,
			availableCommands: record.availableCommands,
			revision: record.revision,
			wrappedDek:
				this.cryptoService?.getWrappedDek(record.sessionId, record.revision) ??
				undefined,
			_meta: record._meta,
			isTitlePinned: record.isTitlePinned,
			worktreeSourceCwd: record.worktreeSourceCwd,
			worktreeBranch: record.worktreeBranch,
			isAttached: true,
		};
	}
}
