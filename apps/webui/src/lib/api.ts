// Re-export shared types used by webui
export type {
	AcpBackendSummary,
	AcpBackendsResponse,
	CreateSessionResponse,
	ErrorDetail,
	FsEntriesResponse,
	FsEntry,
	GitFileStatus,
	HostFsRootsResponse,
	MachinesResponse,
	PermissionDecisionResponse,
	SessionFsFilePreviewResponse,
	SessionFsResourceEntry,
	SessionSummary,
	SessionsResponse,
} from "@mobvibe/shared";
// Re-export isErrorDetail for local use
export { isErrorDetail } from "@mobvibe/shared";

// Import types for API functions
import type {
	AcpBackendsResponse,
	CancelSessionResponse,
	ContentBlock,
	CreateSessionResponse,
	DiscoverSessionsResult,
	ErrorDetail,
	FsEntriesResponse,
	FsResourcesResponse,
	FsRootsResponse,
	GitBranchesForCwdResponse,
	HostFsRootsResponse,
	MachinesResponse,
	MessageIdResponse,
	PermissionDecisionPayload,
	PermissionDecisionResponse,
	SendMessageResult,
	SessionFsFilePreviewResponse,
	SessionSummary,
	SessionsResponse,
} from "@mobvibe/shared";
import { isErrorDetail } from "@mobvibe/shared";
import { isInTauri } from "./auth";
import { getAuthToken } from "./auth-token";
import { e2ee } from "./e2ee";
import { getDefaultGatewayUrl } from "./gateway-config";
import { platformFetch } from "./tauri-fetch";

let API_BASE_URL = getDefaultGatewayUrl();
const SEND_MESSAGE_TIMEOUT_MS = 120_000;

/**
 * Update the API base URL. Used when Tauri app loads a stored gateway URL.
 */
export const setApiBaseUrl = (url: string): void => {
	API_BASE_URL = url;
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
	const response = await platformFetch(`${API_BASE_URL}${path}`, {
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
}): Promise<HostFsRootsResponse> =>
	requestJson<HostFsRootsResponse>(buildFsRootsPath(payload?.machineId));

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
}): Promise<FsRootsResponse> =>
	requestJson<FsRootsResponse>(buildSessionFsRootsPath(payload.sessionId));

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
}): Promise<FsResourcesResponse> =>
	requestJson<FsResourcesResponse>(
		buildSessionFsResourcesPath(payload.sessionId),
	);

export const createSession = async (payload?: {
	cwd?: string;
	title?: string;
	backendId?: string;
	machineId?: string;
	worktree?: {
		branch: string;
		baseBranch?: string;
		sourceCwd: string;
	};
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
}): Promise<SendMessageResult> => {
	const encryptedPrompt = e2ee.encryptPayloadForSession(
		payload.sessionId,
		payload.prompt,
	);
	return requestJsonWithTimeout<SendMessageResult>(
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

import type {
	GitBlameParams,
	GitBlameResponse,
	GitBranchesParams,
	GitBranchesResponse,
	GitFileDiffResponse,
	GitFileHistoryParams,
	GitFileHistoryResponse,
	GitGrepParams,
	GitGrepResponse,
	GitLogParams,
	GitLogResponse,
	GitSearchLogParams,
	GitSearchLogResponse,
	GitShowParams,
	GitShowResponse,
	GitStashListParams,
	GitStashListResponse,
	GitStatusExtendedParams,
	GitStatusExtendedResponse,
	GitStatusResponse,
} from "@mobvibe/shared";

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

// --- Extended Git API functions ---

export const fetchSessionGitLog = async (
	payload: GitLogParams,
): Promise<GitLogResponse> => {
	const params = new URLSearchParams({ sessionId: payload.sessionId });
	if (payload.maxCount) params.set("maxCount", String(payload.maxCount));
	if (payload.skip) params.set("skip", String(payload.skip));
	if (payload.path) params.set("path", payload.path);
	if (payload.author) params.set("author", payload.author);
	if (payload.search) params.set("search", payload.search);
	return requestJson<GitLogResponse>(
		`/fs/session/git/log?${params.toString()}`,
	);
};

export const fetchSessionGitShow = async (
	payload: GitShowParams,
): Promise<GitShowResponse> => {
	const params = new URLSearchParams({
		sessionId: payload.sessionId,
		hash: payload.hash,
	});
	return requestJson<GitShowResponse>(
		`/fs/session/git/show?${params.toString()}`,
	);
};

export const fetchSessionGitBlame = async (
	payload: GitBlameParams,
): Promise<GitBlameResponse> => {
	const params = new URLSearchParams({
		sessionId: payload.sessionId,
		path: payload.path,
	});
	if (payload.startLine) params.set("startLine", String(payload.startLine));
	if (payload.endLine) params.set("endLine", String(payload.endLine));
	return requestJson<GitBlameResponse>(
		`/fs/session/git/blame?${params.toString()}`,
	);
};

export const fetchSessionGitBranches = async (
	payload: GitBranchesParams,
): Promise<GitBranchesResponse> =>
	requestJson<GitBranchesResponse>(
		`/fs/session/git/branches?sessionId=${encodeURIComponent(payload.sessionId)}`,
	);

/** Get git branches for a cwd (no session required — used before session creation) */
export const fetchGitBranchesForCwd = async (payload: {
	machineId: string;
	cwd: string;
}): Promise<GitBranchesForCwdResponse> =>
	requestJson<GitBranchesForCwdResponse>(
		`/fs/git/branches?machineId=${encodeURIComponent(payload.machineId)}&cwd=${encodeURIComponent(payload.cwd)}`,
	);

export const fetchSessionGitStashList = async (
	payload: GitStashListParams,
): Promise<GitStashListResponse> =>
	requestJson<GitStashListResponse>(
		`/fs/session/git/stash?sessionId=${encodeURIComponent(payload.sessionId)}`,
	);

export const fetchSessionGitStatusExtended = async (
	payload: GitStatusExtendedParams,
): Promise<GitStatusExtendedResponse> =>
	requestJson<GitStatusExtendedResponse>(
		`/fs/session/git/status-extended?sessionId=${encodeURIComponent(payload.sessionId)}`,
	);

export const fetchSessionGitSearchLog = async (
	payload: GitSearchLogParams,
): Promise<GitSearchLogResponse> => {
	const params = new URLSearchParams({
		sessionId: payload.sessionId,
		query: payload.query,
		type: payload.type,
	});
	if (payload.maxCount) params.set("maxCount", String(payload.maxCount));
	return requestJson<GitSearchLogResponse>(
		`/fs/session/git/search-log?${params.toString()}`,
	);
};

export const fetchSessionGitFileHistory = async (
	payload: GitFileHistoryParams,
): Promise<GitFileHistoryResponse> => {
	const params = new URLSearchParams({
		sessionId: payload.sessionId,
		path: payload.path,
	});
	if (payload.maxCount) params.set("maxCount", String(payload.maxCount));
	return requestJson<GitFileHistoryResponse>(
		`/fs/session/git/file-history?${params.toString()}`,
	);
};

export const fetchSessionGitGrep = async (
	payload: GitGrepParams,
): Promise<GitGrepResponse> => {
	const params = new URLSearchParams({
		sessionId: payload.sessionId,
		query: payload.query,
	});
	if (payload.caseSensitive) params.set("caseSensitive", "true");
	if (payload.regex) params.set("regex", "true");
	if (payload.glob) params.set("glob", payload.glob);
	return requestJson<GitGrepResponse>(
		`/fs/session/git/grep?${params.toString()}`,
	);
};

// Note: SSE streaming (createSessionEventSource) has been replaced with Socket.io
// See @/lib/socket.ts for the Socket.io implementation
