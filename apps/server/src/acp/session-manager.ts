import type {
	SessionModelState,
	SessionModeState,
} from "@agentclientprotocol/sdk";
import { AppError, createErrorDetail, type ErrorDetail } from "./errors.js";
import {
	OpencodeConnection,
	type OpencodeConnectionState,
} from "./opencode.js";

type SessionRecord = {
	sessionId: string;
	title: string;
	connection: OpencodeConnection;
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
	state: OpencodeConnectionState;
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

	constructor(
		private readonly options: {
			command: string;
			args: string[];
			client: {
				name: string;
				version: string;
			};
		},
	) {}

	listSessions(): SessionSummary[] {
		return Array.from(this.sessions.values()).map((record) =>
			this.buildSummary(record),
		);
	}

	getSession(sessionId: string): SessionRecord | undefined {
		return this.sessions.get(sessionId);
	}

	async createSession(options?: { cwd?: string; title?: string }) {
		const connection = new OpencodeConnection(this.options);
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
			record.unsubscribe = connection.onSessionUpdate((notification) => {
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
			});
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
