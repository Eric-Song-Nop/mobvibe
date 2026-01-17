import type { PermissionOutcome } from "./acp";

export type AcpConnectionState =
	| "idle"
	| "connecting"
	| "ready"
	| "error"
	| "stopped";

export type ErrorScope = "service" | "session" | "stream" | "request";

export type ErrorCode =
	| "ACP_CONNECT_FAILED"
	| "ACP_PROCESS_EXITED"
	| "ACP_CONNECTION_CLOSED"
	| "ACP_PROTOCOL_MISMATCH"
	| "SESSION_NOT_FOUND"
	| "SESSION_NOT_READY"
	| "CAPABILITY_NOT_SUPPORTED"
	| "REQUEST_VALIDATION_FAILED"
	| "STREAM_DISCONNECTED"
	| "INTERNAL_ERROR";

export type ErrorDetail = {
	code: ErrorCode;
	message: string;
	retryable: boolean;
	scope: ErrorScope;
	detail?: string;
};

export type AcpBackendSummary = {
	backendId: string;
	backendLabel: string;
};

export type AcpBackendsResponse = {
	defaultBackendId: string;
	backends: AcpBackendSummary[];
};

export type FsRoot = {
	name: string;
	path: string;
};

export type FsRootsResponse = {
	homePath: string;
	roots: FsRoot[];
};

export type FsEntry = {
	name: string;
	path: string;
	type: "directory" | "file";
	hidden: boolean;
};

export type FsEntriesResponse = {
	path: string;
	entries: FsEntry[];
};

export type SessionFsRoot = {
	name: string;
	path: string;
};

export type SessionFsRootsResponse = {
	root: SessionFsRoot;
};

export type SessionFsFilePreviewType = "code" | "image";

export type SessionFsFilePreviewResponse = {
	path: string;
	previewType: SessionFsFilePreviewType;
	content: string;
	mimeType?: string;
};

export type SessionState = AcpConnectionState;

export type SessionModeOption = {
	id: string;
	name: string;
};

export type SessionModelOption = {
	id: string;
	name: string;
	description?: string | null;
};

export type SessionSummary = {
	sessionId: string;
	title: string;
	backendId: string;
	backendLabel: string;
	state: SessionState;
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
	availableModes?: SessionModeOption[];
	availableModels?: SessionModelOption[];
};

export type SessionsResponse = {
	sessions: SessionSummary[];
};

export type CreateSessionResponse = SessionSummary;

export type SendMessageResponse = {
	stopReason: string;
};

export type CancelSessionResponse = {
	ok: boolean;
};

export type PermissionDecisionPayload = {
	sessionId: string;
	requestId: string;
	outcome: PermissionOutcome;
};

export type PermissionDecisionResponse = {
	sessionId: string;
	requestId: string;
	outcome: PermissionOutcome;
};

export type MessageIdResponse = {
	messageId: string;
};

const resolveDefaultApiBaseUrl = () => {
	if (typeof window === "undefined") {
		return "http://localhost:3757";
	}
	return `${window.location.protocol}//${window.location.hostname}:3757`;
};

const API_BASE_URL =
	import.meta.env.VITE_API_BASE_URL ?? resolveDefaultApiBaseUrl();

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

const requestJson = async <ResponseType>(
	path: string,
	options?: RequestInit,
): Promise<ResponseType> => {
	const response = await fetch(`${API_BASE_URL}${path}`, {
		...options,
		headers: {
			"Content-Type": "application/json",
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

export const fetchAcpBackends = async (): Promise<AcpBackendsResponse> =>
	requestJson<AcpBackendsResponse>("/acp/backends");

export const fetchSessions = async (): Promise<SessionsResponse> =>
	requestJson<SessionsResponse>("/acp/sessions");

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

export const fetchFsRoots = async (): Promise<FsRootsResponse> =>
	requestJson<FsRootsResponse>("/fs/roots");

export const fetchFsEntries = async (payload: {
	path: string;
}): Promise<FsEntriesResponse> =>
	requestJson<FsEntriesResponse>(buildFsEntriesPath(payload.path));

export const fetchSessionFsRoots = async (payload: {
	sessionId: string;
}): Promise<SessionFsRootsResponse> =>
	requestJson<SessionFsRootsResponse>(
		buildSessionFsRootsPath(payload.sessionId),
	);

export const fetchSessionFsEntries = async (payload: {
	sessionId: string;
	path?: string;
}): Promise<FsEntriesResponse> =>
	requestJson<FsEntriesResponse>(
		buildSessionFsEntriesPath(payload.sessionId, payload.path),
	);

export const fetchSessionFsFile = async (payload: {
	sessionId: string;
	path: string;
}): Promise<SessionFsFilePreviewResponse> =>
	requestJson<SessionFsFilePreviewResponse>(
		buildSessionFsFilePath(payload.sessionId, payload.path),
	);

export const createSession = async (payload?: {
	cwd?: string;
	title?: string;
	backendId?: string;
}): Promise<CreateSessionResponse> =>
	requestJson<CreateSessionResponse>("/acp/session", {
		method: "POST",
		body: JSON.stringify(payload ?? {}),
	});

export const renameSession = async (payload: {
	sessionId: string;
	title: string;
}): Promise<{ sessionId: string; title: string }> =>
	requestJson<{ sessionId: string; title: string }>("/acp/session", {
		method: "PATCH",
		body: JSON.stringify(payload),
	});

export const closeSession = async (payload: {
	sessionId: string;
}): Promise<{ ok: boolean }> =>
	requestJson<{ ok: boolean }>("/acp/session/close", {
		method: "POST",
		body: JSON.stringify(payload),
	});

export const cancelSession = async (payload: {
	sessionId: string;
}): Promise<CancelSessionResponse> =>
	requestJson<CancelSessionResponse>("/acp/session/cancel", {
		method: "POST",
		body: JSON.stringify(payload),
	});

export const createMessageId = async (payload: {
	sessionId: string;
}): Promise<MessageIdResponse> =>
	requestJson<MessageIdResponse>("/acp/message/id", {
		method: "POST",
		body: JSON.stringify(payload),
	});

export const setSessionMode = async (payload: {
	sessionId: string;
	modeId: string;
}): Promise<SessionSummary> =>
	requestJson<SessionSummary>("/acp/session/mode", {
		method: "POST",
		body: JSON.stringify(payload),
	});

export const setSessionModel = async (payload: {
	sessionId: string;
	modelId: string;
}): Promise<SessionSummary> =>
	requestJson<SessionSummary>("/acp/session/model", {
		method: "POST",
		body: JSON.stringify(payload),
	});

export const sendMessage = async (payload: {
	sessionId: string;
	prompt: string;
}): Promise<SendMessageResponse> =>
	requestJson<SendMessageResponse>("/acp/message", {
		method: "POST",
		body: JSON.stringify(payload),
	});

export const sendPermissionDecision = async (
	payload: PermissionDecisionPayload,
): Promise<PermissionDecisionResponse> =>
	requestJson<PermissionDecisionResponse>("/acp/permission/decision", {
		method: "POST",
		body: JSON.stringify(payload),
	});

export const createSessionEventSource = (sessionId: string) =>
	new EventSource(
		`${API_BASE_URL}/acp/session/stream?sessionId=${encodeURIComponent(
			sessionId,
		)}`,
	);
