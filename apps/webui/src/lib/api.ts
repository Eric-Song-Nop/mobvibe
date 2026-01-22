// Re-export types from @remote-claude/core
export type {
	AcpBackendSummary,
	AcpBackendsResponse,
	AcpConnectionState,
	CancelSessionResponse,
	CreateSessionResponse,
	ErrorCode,
	ErrorDetail,
	ErrorScope,
	FsEntry,
	FsRoot,
	FsRootsResponse,
	MessageIdResponse,
	PermissionDecisionResponse,
	SendMessageResponse,
	SessionFsFilePreviewResponse,
	SessionFsFilePreviewType,
	SessionFsResourceEntry,
	SessionFsResourcesResponse,
	SessionFsRoot,
	SessionFsRootsResponse,
	SessionModelOption,
	SessionModeOption,
	SessionState,
	SessionSummary,
	SessionsResponse,
	StopReason,
} from "@remote-claude/core";

// Re-export isErrorDetail for local use
export { isErrorDetail } from "@remote-claude/core";

// Import types for API functions
// Local type for FsEntriesResponse (not exported from core)
import type {
	AcpBackendsResponse,
	CancelSessionResponse,
	ContentBlock,
	CreateSessionResponse,
	ErrorDetail,
	FsEntry,
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
} from "@remote-claude/core";
import { isErrorDetail } from "@remote-claude/core";
export type FsEntriesResponse = {
	path: string;
	entries: FsEntry[];
};

import { getCachedToken } from "./auth";
import { getDefaultGatewayUrl } from "./gateway-config";

let API_BASE_URL = getDefaultGatewayUrl();

/**
 * Update the API base URL. Used when Tauri app loads a stored gateway URL.
 */
export const setApiBaseUrl = (url: string): void => {
	API_BASE_URL = url;
};

/**
 * Get the current API base URL.
 */
export const getApiBaseUrl = (): string => API_BASE_URL;

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
	const token = getCachedToken();
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};
	if (token) {
		headers.Authorization = `Bearer ${token}`;
	}
	const response = await fetch(`${API_BASE_URL}${path}`, {
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

const buildSessionFsResourcesPath = (sessionId: string) =>
	`/fs/session/resources?sessionId=${encodeURIComponent(sessionId)}`;

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

export const fetchSessionFsResources = async (payload: {
	sessionId: string;
}): Promise<SessionFsResourcesResponse> =>
	requestJson<SessionFsResourcesResponse>(
		buildSessionFsResourcesPath(payload.sessionId),
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
	prompt: ContentBlock[];
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

// Note: SSE streaming (createSessionEventSource) has been replaced with Socket.io
// See @/lib/socket.ts for the Socket.io implementation
