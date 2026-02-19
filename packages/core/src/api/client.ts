import type {
	AcpBackendsResponse,
	CancelSessionResponse,
	CreateSessionResponse,
	EncryptedPayload,
	ErrorDetail,
	FsEntriesResponse,
	FsRootsResponse,
	MessageIdResponse,
	PermissionDecisionPayload,
	PermissionDecisionResponse,
	SendMessageResponse,
	SessionFsFilePreviewResponse,
	SessionFsResourcesResponse,
	SessionFsRootsResponse,
	SessionSummary,
	SessionsResponse,
} from "./types";

const isErrorDetail = (payload: unknown): payload is ErrorDetail => {
	if (!payload || typeof payload !== "object") {
		return false;
	}
	const detail = payload as ErrorDetail;
	return (
		typeof detail.code === "string" &&
		typeof detail.message === "string" &&
		typeof detail.retryable === "boolean" &&
		typeof detail.scope === "string"
	);
};

const buildRequestError = (message: string): ErrorDetail => ({
	code: "INTERNAL_ERROR",
	message,
	retryable: true,
	scope: "request",
});

export class ApiError extends Error {
	readonly detail: ErrorDetail;

	constructor(detail: ErrorDetail) {
		super(detail.message);
		this.detail = detail;
	}
}

export type ApiClientConfig = {
	getBaseUrl: () => string;
	getToken: () => string | null;
};

export const createApiClient = (config: ApiClientConfig) => {
	const requestJson = async <ResponseType>(
		path: string,
		options?: RequestInit,
	): Promise<ResponseType> => {
		const token = config.getToken();
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};
		if (token) {
			headers.Authorization = `Bearer ${token}`;
		}
		const baseUrl = config.getBaseUrl();
		const response = await fetch(`${baseUrl}${path}`, {
			...options,
			headers: {
				...headers,
				...options?.headers,
			},
		});

		if (!response.ok) {
			let fallbackMessage = `${response.status} ${response.statusText}`;
			try {
				const payload = (await response.json()) as { error?: unknown };
				if (payload?.error && isErrorDetail(payload.error)) {
					throw new ApiError(payload.error);
				}
				if (typeof payload?.error === "string") {
					fallbackMessage = payload.error;
				}
			} catch (parseError) {
				if (parseError instanceof ApiError) {
					throw parseError;
				}
			}
			throw new ApiError(buildRequestError(fallbackMessage));
		}

		return (await response.json()) as ResponseType;
	};

	const buildFsEntriesPath = (pathValue: string) =>
		`/fs/entries?path=${encodeURIComponent(pathValue)}`;

	const buildSessionFsRootsPath = (sessionId: string) =>
		`/fs/session/roots?sessionId=${encodeURIComponent(sessionId)}`;

	const buildSessionFsEntriesPath = (sessionId: string, pathValue?: string) => {
		const params = new URLSearchParams({ sessionId });
		if (pathValue) {
			params.set("path", pathValue);
		}
		return `/fs/session/entries?${params.toString()}`;
	};

	const buildSessionFsFilePath = (sessionId: string, pathValue: string) => {
		const params = new URLSearchParams({ sessionId, path: pathValue });
		return `/fs/session/file?${params.toString()}`;
	};

	const buildSessionFsResourcesPath = (sessionId: string) =>
		`/fs/session/resources?sessionId=${encodeURIComponent(sessionId)}`;

	return {
		fetchAcpBackends: async (): Promise<AcpBackendsResponse> =>
			requestJson<AcpBackendsResponse>("/acp/backends"),

		fetchSessions: async (): Promise<SessionsResponse> =>
			requestJson<SessionsResponse>("/acp/sessions"),

		fetchFsRoots: async (): Promise<FsRootsResponse> =>
			requestJson<FsRootsResponse>("/fs/roots"),

		fetchFsEntries: async (payload: {
			path: string;
		}): Promise<FsEntriesResponse> =>
			requestJson<FsEntriesResponse>(buildFsEntriesPath(payload.path)),

		fetchSessionFsRoots: async (payload: {
			sessionId: string;
		}): Promise<SessionFsRootsResponse> =>
			requestJson<SessionFsRootsResponse>(
				buildSessionFsRootsPath(payload.sessionId),
			),

		fetchSessionFsEntries: async (payload: {
			sessionId: string;
			path?: string;
		}): Promise<FsEntriesResponse> =>
			requestJson<FsEntriesResponse>(
				buildSessionFsEntriesPath(payload.sessionId, payload.path),
			),

		fetchSessionFsFile: async (payload: {
			sessionId: string;
			path: string;
		}): Promise<SessionFsFilePreviewResponse> =>
			requestJson<SessionFsFilePreviewResponse>(
				buildSessionFsFilePath(payload.sessionId, payload.path),
			),

		fetchSessionFsResources: async (payload: {
			sessionId: string;
		}): Promise<SessionFsResourcesResponse> =>
			requestJson<SessionFsResourcesResponse>(
				buildSessionFsResourcesPath(payload.sessionId),
			),

		createSession: async (payload?: {
			cwd?: string;
			title?: string;
			backendId?: string;
		}): Promise<CreateSessionResponse> =>
			requestJson<CreateSessionResponse>("/acp/session", {
				method: "POST",
				body: JSON.stringify(payload ?? {}),
			}),

		renameSession: async (payload: {
			sessionId: string;
			title: string;
		}): Promise<{ sessionId: string; title: string }> =>
			requestJson<{ sessionId: string; title: string }>("/acp/session", {
				method: "PATCH",
				body: JSON.stringify(payload),
			}),

		archiveSession: async (payload: {
			sessionId: string;
		}): Promise<{ ok: boolean }> =>
			requestJson<{ ok: boolean }>("/acp/session/archive", {
				method: "POST",
				body: JSON.stringify(payload),
			}),

		cancelSession: async (payload: {
			sessionId: string;
		}): Promise<CancelSessionResponse> =>
			requestJson<CancelSessionResponse>("/acp/session/cancel", {
				method: "POST",
				body: JSON.stringify(payload),
			}),

		createMessageId: async (payload: {
			sessionId: string;
		}): Promise<MessageIdResponse> =>
			requestJson<MessageIdResponse>("/acp/message/id", {
				method: "POST",
				body: JSON.stringify(payload),
			}),

		setSessionMode: async (payload: {
			sessionId: string;
			modeId: string;
		}): Promise<SessionSummary> =>
			requestJson<SessionSummary>("/acp/session/mode", {
				method: "POST",
				body: JSON.stringify(payload),
			}),

		setSessionModel: async (payload: {
			sessionId: string;
			modelId: string;
		}): Promise<SessionSummary> =>
			requestJson<SessionSummary>("/acp/session/model", {
				method: "POST",
				body: JSON.stringify(payload),
			}),

		sendMessage: async (payload: {
			sessionId: string;
			prompt: EncryptedPayload;
		}): Promise<SendMessageResponse> =>
			requestJson<SendMessageResponse>("/acp/message", {
				method: "POST",
				body: JSON.stringify(payload),
			}),

		sendPermissionDecision: async (
			payload: PermissionDecisionPayload,
		): Promise<PermissionDecisionResponse> =>
			requestJson<PermissionDecisionResponse>("/acp/permission/decision", {
				method: "POST",
				body: JSON.stringify(payload),
			}),
	};
};

export type ApiClient = ReturnType<typeof createApiClient>;
