import type {
	SessionModelState,
	SessionModeState,
	SessionNotification,
} from "@agentclientprotocol/sdk";
import type { AcpBackendConfig, AcpBackendId } from "../config.js";
import { AppError, createErrorDetail, type ErrorDetail } from "./errors.js";
import { AcpConnection, type AcpConnectionState } from "./opencode.js";

type SessionRecord = {
	sessionId: string;
	title: string;
	backendId: AcpBackendId;
	backendLabel: string;
	connection: AcpConnection;
	createdAt: Date;
	updatedAt: Date;
	agentName?: string;
	modelId?: string;
	modelName?: string;
	modeId?: string;
	modeName?: string;
	availableModes?: Array<{ id: string; name: string }>;
	unsubscribe?: () => void;
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
	agentName?: string;
	modelId?: string;
	modelName?: string;
	modeId?: string;
	modeName?: string;
};

const resolveModelState = (models?: SessionModelState | null) => {
	if (!models) {
		return { modelId: undefined, modelName: undefined };
	}
	const modelId = models.currentModelId ?? undefined;
	const modelName = models.availableModels?.find(
		(model) => model.modelId === modelId,
	)?.name;
	return { modelId, modelName };
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

export class SessionManager {
	private sessions = new Map<string, SessionRecord>();
	private backendById: Map<AcpBackendId, AcpBackendConfig>;
	private defaultBackendId: AcpBackendId;

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
			const now = new Date();
			const agentInfo = connection.getAgentInfo();
			const { modelId, modelName } = resolveModelState(session.models);
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
				agentName: agentInfo?.title ?? agentInfo?.name,
				modelId,
				modelName,
				modeId,
				modeName,
				availableModes,
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

	async closeSession(sessionId: string): Promise<boolean> {
		const record = this.sessions.get(sessionId);
		if (!record) {
			return false;
		}
		record.unsubscribe?.();
		await record.connection.disconnect();
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
			agentName: record.agentName,
			modelId: record.modelId,
			modelName: record.modelName,
			modeId: record.modeId,
			modeName: record.modeName,
		};
	}
}
