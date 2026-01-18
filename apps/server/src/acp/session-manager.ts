import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type {
	RequestPermissionRequest,
	RequestPermissionResponse,
	SessionModelState,
	SessionModeState,
	SessionNotification,
} from "@agentclientprotocol/sdk";
import type { AcpBackendConfig, AcpBackendId } from "../config.js";
import { AcpConnection, type AcpConnectionState } from "./acp-connection.js";
import { AppError, createErrorDetail, type ErrorDetail } from "./errors.js";

type SessionRecord = {
	sessionId: string;
	title: string;
	backendId: AcpBackendId;
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
	unsubscribe?: () => void;
};

export type PermissionRequestPayload = {
	sessionId: string;
	requestId: string;
	options: RequestPermissionRequest["options"];
	toolCall?: RequestPermissionRequest["toolCall"];
};

export type PermissionResultPayload = {
	sessionId: string;
	requestId: string;
	outcome: RequestPermissionResponse["outcome"];
};

type PermissionRequestRecord = {
	sessionId: string;
	requestId: string;
	params: RequestPermissionRequest;
	promise: Promise<RequestPermissionResponse>;
	resolve: (response: RequestPermissionResponse) => void;
};

export type SessionSummary = {
	sessionId: string;
	title: string;
	backendId: AcpBackendId;
	backendLabel: string;
	state: AcpConnectionState;
	error?: ErrorDetail;
	pid?: number;
	createdAt: string;
	updatedAt: string;
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

export class SessionManager {
	private sessions = new Map<string, SessionRecord>();
	private backendById: Map<AcpBackendId, AcpBackendConfig>;
	private defaultBackendId: AcpBackendId;
	private permissionRequests = new Map<string, PermissionRequestRecord>();
	private permissionRequestEmitter = new EventEmitter();
	private permissionResultEmitter = new EventEmitter();

	constructor(
		private readonly options: {
			backends: AcpBackendConfig[];
			defaultBackendId: AcpBackendId;
			client: {
				name: string;
				version: string;
			};
		},
	) {
		this.backendById = new Map(
			options.backends.map((backend) => [backend.id, backend]),
		);
		this.defaultBackendId = options.defaultBackendId;
	}

	listSessions(): SessionSummary[] {
		return Array.from(this.sessions.values()).map((record) =>
			this.buildSummary(record),
		);
	}

	getSession(sessionId: string): SessionRecord | undefined {
		return this.sessions.get(sessionId);
	}

	onPermissionRequest(listener: (payload: PermissionRequestPayload) => void) {
		this.permissionRequestEmitter.on("request", listener);
		return () => {
			this.permissionRequestEmitter.off("request", listener);
		};
	}

	onPermissionResult(listener: (payload: PermissionResultPayload) => void) {
		this.permissionResultEmitter.on("result", listener);
		return () => {
			this.permissionResultEmitter.off("result", listener);
		};
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
	): PermissionResultPayload {
		const key = buildPermissionKey(sessionId, requestId);
		const record = this.permissionRequests.get(key);
		if (!record) {
			throw new AppError(
				createErrorDetail({
					code: "REQUEST_VALIDATION_FAILED",
					message: "权限请求不存在",
					retryable: false,
					scope: "request",
				}),
				404,
			);
		}
		const response: RequestPermissionResponse = { outcome };
		record.resolve(response);
		this.permissionRequests.delete(key);
		const payload: PermissionResultPayload = { sessionId, requestId, outcome };
		this.permissionResultEmitter.emit("result", payload);
		return payload;
	}

	private resolveBackend(backendId?: string) {
		const normalized = backendId?.trim();
		const resolvedId =
			normalized && normalized.length > 0
				? (normalized as AcpBackendId)
				: this.defaultBackendId;
		const backend = this.backendById.get(resolvedId);
		if (!backend) {
			throw new AppError(
				createErrorDetail({
					code: "REQUEST_VALIDATION_FAILED",
					message: "backendId 不可用",
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
	}) {
		const backend = this.resolveBackend(options?.backendId);
		const connection = new AcpConnection({
			backend: {
				id: backend.id,
				label: backend.label,
			},
			command: backend.command,
			args: backend.args,
			envOverrides: backend.envOverrides,
			client: this.options.client,
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
				title: options?.title ?? `对话 ${this.sessions.size + 1}`,
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
			};
			record.unsubscribe = connection.onSessionUpdate(
				(notification: SessionNotification) => {
					this.touchSession(session.sessionId);
					const update = notification.update;
					if (update.sessionUpdate === "current_mode_update") {
						record.modeId = update.currentModeId;
						record.modeName =
							record.availableModes?.find(
								(mode) => mode.id === update.currentModeId,
							)?.name ?? record.modeName;
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
				},
			);
			this.sessions.set(session.sessionId, record);
			return this.buildSummary(record);
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
					message: "会话不存在",
					retryable: false,
					scope: "session",
				}),
				404,
			);
		}
		record.title = title;
		record.updatedAt = new Date();
		return this.buildSummary(record);
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
					message: "会话不存在",
					retryable: false,
					scope: "session",
				}),
				404,
			);
		}
		if (!record.availableModes || record.availableModes.length === 0) {
			throw createCapabilityNotSupportedError("当前 Agent 不支持会话模式切换");
		}
		const selected = record.availableModes.find((mode) => mode.id === modeId);
		if (!selected) {
			throw new AppError(
				createErrorDetail({
					code: "REQUEST_VALIDATION_FAILED",
					message: "modeId 不合法",
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
		return this.buildSummary(record);
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
					message: "会话不存在",
					retryable: false,
					scope: "session",
				}),
				404,
			);
		}
		if (!record.availableModels || record.availableModels.length === 0) {
			throw createCapabilityNotSupportedError("当前 Agent 不支持会话模型切换");
		}
		const selected = record.availableModels.find(
			(model) => model.id === modelId,
		);
		if (!selected) {
			throw new AppError(
				createErrorDetail({
					code: "REQUEST_VALIDATION_FAILED",
					message: "modelId 不合法",
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
		return this.buildSummary(record);
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
		} catch (error) {
			console.error(
				`[mobvibe] session unsubscribe failed: ${sessionId}`,
				error,
			);
		}
		this.cancelPermissionRequests(sessionId);
		try {
			await record.connection.disconnect();
		} catch (error) {
			console.error(`[mobvibe] session disconnect failed: ${sessionId}`, error);
		}
		this.sessions.delete(sessionId);
		return true;
	}

	async closeAll(): Promise<void> {
		const sessionIds = Array.from(this.sessions.keys());
		await Promise.all(
			sessionIds.map((sessionId) => this.closeSession(sessionId)),
		);
	}

	private buildSummary(record: SessionRecord): SessionSummary {
		const status = record.connection.getStatus();
		return {
			sessionId: record.sessionId,
			title: record.title,
			backendId: record.backendId,
			backendLabel: record.backendLabel,
			state: status.state,
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
		};
	}
}
