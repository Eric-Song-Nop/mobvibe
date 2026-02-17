// Re-export types from @mobvibe/core
export type {
	AcpBackendSummary,
	AcpBackendsResponse,
	AcpConnectionState,
	CancelSessionResponse,
	CreateSessionResponse,
	DiscoverSessionsResult,
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
	SessionSummary,
	SessionsResponse,
	StopReason,
} from "@mobvibe/core";

// Re-export isErrorDetail for local use
export { isErrorDetail } from "@mobvibe/core";

// Import types for API functions
// Local type for FsEntriesResponse (not exported from core)
import type {
	AcpBackendsResponse,
	CancelSessionResponse,
	ContentBlock,
	CreateSessionResponse,
	DiscoverSessionsResult,
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
} from "@mobvibe/core";
import { isErrorDetail } from "@mobvibe/core";
import { isInTauri } from "./auth";
import { getAuthToken } from "./auth-token";
import { e2ee } from "./e2ee";
import { getDefaultGatewayUrl } from "./gateway-config";

export type FsEntriesResponse = {
	path: string;
	entries: FsEntry[];
};

export type MachinesResponse = {
	machines: Array<{
		id: string;
		name?: string | null;
		hostname?: string | null;
		platform?: string | null;
		isOnline: boolean;
		lastSeenAt?: string | null;
		createdAt?: string | null;
	}>;
};

let API_BASE_URL = getDefaultGatewayUrl();
const SEND_MESSAGE_TIMEOUT_MS = 120_000;

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
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};
	const tauriEnv = isInTauri();
	if (tauriEnv) {
		const token = getAuthToken();
		if (token) {
			headers.Authorization = `Bearer ${token}`;
		}
	}
	const response = await fetch(`${API_BASE_URL}${path}`, {
		...options,
		credentials: tauriEnv ? "omit" : "include",
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

const isAbortError = (error: unknown): boolean =>
	error instanceof DOMException
		? error.name === "AbortError"
		: error instanceof Error && error.name === "AbortError";

const requestJsonWithTimeout = async <ResponseType>(
	path: string,
	timeoutMs: number,
	options?: Omit<RequestInit, "signal">,
): Promise<ResponseType> => {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => {
		controller.abort();
	}, timeoutMs);

	try {
		return await requestJson<ResponseType>(path, {
			...options,
			signal: controller.signal,
		});
	} catch (error) {
		if (isAbortError(error)) {
			throw new ApiError(
				buildRequestError(`Request timed out after ${timeoutMs}ms`),
			);
		}
		throw error;
	} finally {
		clearTimeout(timeoutId);
	}
};

export const fetchAcpBackends = async (): Promise<AcpBackendsResponse> =>
	requestJson<AcpBackendsResponse>("/acp/backends");

export const fetchSessions = async (): Promise<SessionsResponse> =>
	requestJson<SessionsResponse>("/acp/sessions");

export const fetchMachines = async (): Promise<MachinesResponse> =>
	requestJson<MachinesResponse>("/api/machines");

const buildSessionsDiscoverPath = (payload: {
	machineId?: string;
	cwd?: string;
	backendId: string;
	cursor?: string;
}) => {
	const params = new URLSearchParams();
	if (payload.machineId) {
		params.set("machineId", payload.machineId);
	}
	if (payload.cwd) {
		params.set("cwd", payload.cwd);
	}
	params.set("backendId", payload.backendId);
	if (payload.cursor) {
		params.set("cursor", payload.cursor);
	}
	return `/acp/sessions/discover?${params.toString()}`;
};

const buildFsRootsPath = (machineId?: string) => {
	if (!machineId) {
		return "/fs/roots";
	}
	const params = new URLSearchParams({ machineId });
	return `/fs/roots?${params.toString()}`;
};

const buildFsEntriesPath = (pathValue: string, machineId?: string) => {
	const params = new URLSearchParams({ path: pathValue });
	if (machineId) {
		params.set("machineId", machineId);
	}
	return `/fs/entries?${params.toString()}`;
};

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

export const fetchFsRoots = async (payload?: {
	machineId?: string;
}): Promise<FsRootsResponse> =>
	requestJson<FsRootsResponse>(buildFsRootsPath(payload?.machineId));

export const discoverSessions = async (payload: {
	machineId?: string;
	cwd?: string;
	backendId: string;
	cursor?: string;
}): Promise<DiscoverSessionsResult> =>
	requestJson<DiscoverSessionsResult>(buildSessionsDiscoverPath(payload));

export const fetchFsEntries = async (payload: {
	path: string;
	machineId?: string;
}): Promise<FsEntriesResponse> =>
	requestJson<FsEntriesResponse>(
		buildFsEntriesPath(payload.path, payload.machineId),
	);

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
	machineId?: string;
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

export const archiveSession = async (payload: {
	sessionId: string;
}): Promise<{ ok: boolean }> =>
	requestJson<{ ok: boolean }>("/acp/session/archive", {
		method: "POST",
		body: JSON.stringify(payload),
	});

export const bulkArchiveSessions = async (payload: {
	sessionIds: string[];
}): Promise<{ archivedCount: number }> =>
	requestJson<{ archivedCount: number }>("/acp/session/archive-all", {
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
}): Promise<SendMessageResponse> => {
	const encryptedPrompt = e2ee.encryptPayloadForSession(
		payload.sessionId,
		payload.prompt,
	);
	return requestJsonWithTimeout<SendMessageResponse>(
		"/acp/message",
		SEND_MESSAGE_TIMEOUT_MS,
		{
			method: "POST",
			body: JSON.stringify({ ...payload, prompt: encryptedPrompt }),
		},
	);
};

export const sendPermissionDecision = async (
	payload: PermissionDecisionPayload,
): Promise<PermissionDecisionResponse> =>
	requestJson<PermissionDecisionResponse>("/acp/permission/decision", {
		method: "POST",
		body: JSON.stringify(payload),
	});

export const loadSession = async (payload: {
	sessionId: string;
	cwd: string;
	backendId: string;
	machineId?: string;
}): Promise<SessionSummary> =>
	requestJson<SessionSummary>("/acp/session/load", {
		method: "POST",
		body: JSON.stringify(payload),
	});

export const reloadSession = async (payload: {
	sessionId: string;
	cwd: string;
	backendId: string;
	machineId?: string;
}): Promise<SessionSummary> =>
	requestJson<SessionSummary>("/acp/session/reload", {
		method: "POST",
		body: JSON.stringify(payload),
	});

// Git file status codes (from git status --porcelain)
export type GitFileStatus = "M" | "A" | "D" | "?" | "R" | "C" | "U" | "!";

// Git status response
export type GitStatusResponse = {
	isGitRepo: boolean;
	branch?: string;
	files: Array<{ path: string; status: GitFileStatus }>;
	dirStatus: Record<string, GitFileStatus>;
};

// Git file diff response
export type GitFileDiffResponse = {
	isGitRepo: boolean;
	path: string;
	addedLines: number[];
	modifiedLines: number[];
	deletedLines: number[];
};

const buildSessionGitStatusPath = (sessionId: string) =>
	`/fs/session/git/status?sessionId=${encodeURIComponent(sessionId)}`;

const buildSessionGitDiffPath = (sessionId: string, pathValue: string) => {
	const params = new URLSearchParams({ sessionId, path: pathValue });
	return `/fs/session/git/diff?${params.toString()}`;
};

export const fetchSessionGitStatus = async (payload: {
	sessionId: string;
}): Promise<GitStatusResponse> =>
	requestJson<GitStatusResponse>(buildSessionGitStatusPath(payload.sessionId));

export const fetchSessionGitDiff = async (payload: {
	sessionId: string;
	path: string;
}): Promise<GitFileDiffResponse> =>
	requestJson<GitFileDiffResponse>(
		buildSessionGitDiffPath(payload.sessionId, payload.path),
	);

// Note: SSE streaming (createSessionEventSource) has been replaced with Socket.io
// See @/lib/socket.ts for the Socket.io implementation
