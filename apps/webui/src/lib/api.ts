// Re-export shared types used by webui
export type {
	AcpBackendSummary,
	AcpBackendsResponse,
	AgentTeamSummary,
	CreateAgentTeamRpcResult,
	CreateSessionResponse,
	ErrorDetail,
	FsEntriesResponse,
	FsEntry,
	FsPathSegment,
	GetAgentTeamRpcResult,
	GitFileStatus,
	HostFsRootsResponse,
	ListAgentTeamsRpcResult,
	MachinesResponse,
	PermissionDecisionResponse,
	SessionFsFilePreviewResponse,
	SessionFsResourceEntry,
	SessionSummary,
	SessionsResponse,
	SetSessionConfigOptionParams,
	TeamWorkspaceMode,
} from "@mobvibe/shared";
// Re-export isErrorDetail for local use
export { isErrorDetail } from "@mobvibe/shared";

// Import types for API functions
import type {
	AcpBackendsResponse,
	CancelSessionResponse,
	ContentBlock,
	CreateAgentTeamRpcResult,
	CreateSessionResponse,
	DiscoverSessionsResult,
	ErrorDetail,
	FsEntriesResponse,
	FsResourcesResponse,
	FsRootsResponse,
	GetAgentTeamRpcResult,
	GitBranchesForCwdResponse,
	HostFsRootsResponse,
	ListAgentTeamsRpcResult,
	MachinesResponse,
	PermissionDecisionPayload,
	PermissionDecisionResponse,
	SendMessageResult,
	SessionFsFilePreviewResponse,
	SessionSummary,
	SessionsResponse,
	SetSessionConfigOptionParams,
	TeamWorkspaceMode,
} from "@mobvibe/shared";
import { isErrorDetail } from "@mobvibe/shared";
import { isInTauri } from "./auth";
import { getAuthToken } from "./auth-token";
import { e2ee } from "./e2ee";
import { createFallbackError } from "./error-utils";
import { getDefaultGatewayUrl } from "./gateway-config";
import { platformFetch } from "./tauri-fetch";

let API_BASE_URL = getDefaultGatewayUrl();
const SEND_MESSAGE_TIMEOUT_MS = 120_000;
const SESSION_LOAD_TIMEOUT_MS = 30_000;
const OWNER_ROUTING_PATH = "/acp/routing";
const OWNER_RESPONSE_HEADER = "x-mobvibe-instance-id";
const FORCE_INSTANCE_HEADER = "fly-force-instance-id";
const INSTANCE_AFFINITY_CHANGED_CODE = "INSTANCE_AFFINITY_CHANGED";
const OWNER_RESOLUTION_TIMEOUT_MS = 3_000;
const OWNER_RESOLUTION_RETRY_BASE_MS = 1_000;
const OWNER_RESOLUTION_RETRY_MAX_MS = 30_000;

type OwnerRoutingState = {
	baseUrl: string;
	ownerId?: string;
	consecutiveResolutionMisses: number;
	retryResolutionAt: number;
	resolutionPromise?: Promise<string | undefined>;
};

const createOwnerRoutingState = (baseUrl: string): OwnerRoutingState => ({
	baseUrl,
	consecutiveResolutionMisses: 0,
	retryResolutionAt: 0,
});

let ownerRoutingState = createOwnerRoutingState(API_BASE_URL);

/**
 * Update the API base URL. Used when Tauri app loads a stored gateway URL.
 */
export const setApiBaseUrl = (url: string): void => {
	API_BASE_URL = url;
	ownerRoutingState = createOwnerRoutingState(url);
};

export class ApiError extends Error {
	readonly detail: ErrorDetail;

	constructor(detail: ErrorDetail) {
		super(detail.message);
		this.detail = detail;
	}
}

type RequestTransport = {
	credentials: RequestCredentials;
	headers: Record<string, string>;
};

const createRequestTransport = (): RequestTransport => {
	const tauriEnv = isInTauri();
	const headers: Record<string, string> = {};
	if (tauriEnv) {
		const token = getAuthToken();
		if (token) {
			headers.Authorization = `Bearer ${token}`;
		}
	}
	return {
		credentials: tauriEnv ? "omit" : "include",
		headers,
	};
};

const readResponseHeader = (
	response: Response,
	headerName: string,
): string | undefined => {
	const value = (response as { headers?: Headers }).headers?.get?.(headerName);
	const normalizedValue = value?.trim();
	return normalizedValue || undefined;
};

const isOwnerRoutedPath = (path: string): boolean =>
	path !== OWNER_ROUTING_PATH &&
	(path === "/acp" ||
		path.startsWith("/acp/") ||
		path === "/fs" ||
		path.startsWith("/fs/") ||
		path === "/api/machines" ||
		path.startsWith("/api/machines?"));

const cacheOwner = (state: OwnerRoutingState, ownerId: string): void => {
	state.ownerId = ownerId;
	state.consecutiveResolutionMisses = 0;
	state.retryResolutionAt = 0;
};

const recordOwnerResolutionMiss = (state: OwnerRoutingState): void => {
	state.consecutiveResolutionMisses = Math.min(
		state.consecutiveResolutionMisses + 1,
		6,
	);
	const retryDelay = Math.min(
		OWNER_RESOLUTION_RETRY_BASE_MS *
			2 ** (state.consecutiveResolutionMisses - 1),
		OWNER_RESOLUTION_RETRY_MAX_MS,
	);
	state.retryResolutionAt = Date.now() + retryDelay;
};

const createAbortError = (): DOMException =>
	new DOMException("The operation was aborted", "AbortError");

const waitForResolution = <Value>(
	promise: Promise<Value>,
	signal?: AbortSignal | null,
): Promise<Value> => {
	if (!signal) {
		return promise;
	}
	if (signal.aborted) {
		return Promise.reject(createAbortError());
	}
	return new Promise((resolve, reject) => {
		const handleAbort = () => {
			signal.removeEventListener("abort", handleAbort);
			reject(createAbortError());
		};
		signal.addEventListener("abort", handleAbort, { once: true });
		promise.then(
			(value) => {
				signal.removeEventListener("abort", handleAbort);
				resolve(value);
			},
			(error: unknown) => {
				signal.removeEventListener("abort", handleAbort);
				reject(error);
			},
		);
	});
};

const startOwnerResolution = (
	state: OwnerRoutingState,
	transport: RequestTransport,
): Promise<string | undefined> => {
	const controller = new AbortController();
	let timeoutId: ReturnType<typeof setTimeout> | undefined;
	const fetchOwner = platformFetch(`${state.baseUrl}${OWNER_ROUTING_PATH}`, {
		method: "GET",
		credentials: transport.credentials,
		headers: transport.headers,
		signal: controller.signal,
	})
		.then((response) => readResponseHeader(response, OWNER_RESPONSE_HEADER))
		.catch(() => undefined);
	const timeout = new Promise<undefined>((resolve) => {
		timeoutId = setTimeout(() => {
			controller.abort();
			resolve(undefined);
		}, OWNER_RESOLUTION_TIMEOUT_MS);
	});
	const resolutionPromise = Promise.race([fetchOwner, timeout])
		.then((ownerId) => {
			if (ownerId) {
				cacheOwner(state, ownerId);
			} else {
				recordOwnerResolutionMiss(state);
			}
			return ownerId;
		})
		.finally(() => {
			if (timeoutId !== undefined) {
				clearTimeout(timeoutId);
			}
			state.resolutionPromise = undefined;
		});
	state.resolutionPromise = resolutionPromise;
	return resolutionPromise;
};

const resolveOwner = async (
	state: OwnerRoutingState,
	transport: RequestTransport,
	signal?: AbortSignal | null,
): Promise<string | undefined> => {
	if (state.ownerId) {
		return state.ownerId;
	}
	if (signal?.aborted) {
		throw createAbortError();
	}
	if (!state.resolutionPromise && Date.now() < state.retryResolutionAt) {
		return undefined;
	}
	const resolutionPromise =
		state.resolutionPromise ?? startOwnerResolution(state, transport);
	return waitForResolution(resolutionPromise, signal);
};

const mergeHeaders = (
	transportHeaders: Record<string, string>,
	requestHeaders: HeadersInit | undefined,
	ownerId: string | undefined,
): Record<string, string> => {
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		...transportHeaders,
	};
	if (requestHeaders instanceof Headers) {
		requestHeaders.forEach((value, key) => {
			headers[key] = value;
		});
	} else if (Array.isArray(requestHeaders)) {
		for (const [key, value] of requestHeaders) {
			headers[key] = value;
		}
	} else if (requestHeaders) {
		Object.assign(headers, requestHeaders);
	}
	if (ownerId) {
		headers[FORCE_INSTANCE_HEADER] = ownerId;
	}
	return headers;
};

const parseErrorDetail = async (response: Response): Promise<ErrorDetail> => {
	let fallbackMessage = `${response.status} ${response.statusText}`;
	try {
		const payload = (await response.json()) as { error?: unknown };
		if (payload?.error && isErrorDetail(payload.error)) {
			return payload.error;
		}
		if (typeof payload?.error === "string") {
			fallbackMessage = payload.error;
		}
	} catch {
		// Keep the status fallback for non-JSON error responses.
	}
	return createFallbackError(fallbackMessage, "request");
};

const hasStableMessageId = (body: BodyInit | null | undefined): boolean => {
	if (typeof body !== "string") {
		return false;
	}
	try {
		const payload = JSON.parse(body) as { messageId?: unknown };
		return (
			typeof payload.messageId === "string" && payload.messageId.length > 0
		);
	} catch {
		return false;
	}
};

const canRetryAfterAffinityChange = (
	path: string,
	options: RequestInit | undefined,
): boolean => {
	const method = (options?.method ?? "GET").toUpperCase();
	if (method === "GET" || method === "HEAD") {
		return true;
	}
	return (
		path === "/acp/message" &&
		method === "POST" &&
		hasStableMessageId(options?.body)
	);
};

const requestJson = async <ResponseType>(
	path: string,
	options?: RequestInit,
): Promise<ResponseType> => {
	const baseUrl = API_BASE_URL;
	const state = ownerRoutingState;
	const transport = createRequestTransport();
	const routedRequest = isOwnerRoutedPath(path);
	const initialOwnerId = routedRequest
		? await resolveOwner(state, transport, options?.signal)
		: undefined;

	const performRequest = async (
		ownerId: string | undefined,
		retriedAfterAffinityChange: boolean,
	): Promise<ResponseType> => {
		const response = await platformFetch(`${baseUrl}${path}`, {
			...options,
			credentials: transport.credentials,
			headers: mergeHeaders(transport.headers, options?.headers, ownerId),
		});
		const advertisedOwnerId = routedRequest
			? readResponseHeader(response, OWNER_RESPONSE_HEADER)
			: undefined;
		if (advertisedOwnerId) {
			cacheOwner(state, advertisedOwnerId);
		}

		if (!response.ok) {
			const detail = await parseErrorDetail(response);
			if (
				!retriedAfterAffinityChange &&
				detail.code === INSTANCE_AFFINITY_CHANGED_CODE &&
				advertisedOwnerId &&
				canRetryAfterAffinityChange(path, options)
			) {
				return performRequest(advertisedOwnerId, true);
			}
			throw new ApiError(detail);
		}

		if (response.status === 204 || response.status === 205) {
			return undefined as ResponseType;
		}

		return (await response.json()) as ResponseType;
	};

	return performRequest(initialOwnerId, false);
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
				createFallbackError(
					`Request timed out after ${timeoutMs}ms`,
					"request",
				),
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

const buildAgentTeamsPath = (machineId?: string) => {
	if (!machineId) {
		return "/acp/agent-teams";
	}
	const params = new URLSearchParams({ machineId });
	return `/acp/agent-teams?${params.toString()}`;
};

const buildAgentTeamPath = (agentTeamId: string, machineId?: string) => {
	const basePath = `/acp/agent-teams/${encodeURIComponent(agentTeamId)}`;
	if (!machineId) {
		return basePath;
	}
	const params = new URLSearchParams({ machineId });
	return `${basePath}?${params.toString()}`;
};

export type CreateAgentTeamPayload = {
	machineId: string;
	title?: string;
	workspaceRootCwd: string;
	leaderBackendId: string;
	workspaceMode?: TeamWorkspaceMode;
	worktreeSourceCwd?: string;
	worktreeBranch?: string;
};

export const fetchAgentTeams = async (
	machineId?: string,
): Promise<ListAgentTeamsRpcResult> =>
	requestJson<ListAgentTeamsRpcResult>(buildAgentTeamsPath(machineId));

export const fetchAgentTeam = async (
	agentTeamId: string,
	machineId?: string,
): Promise<GetAgentTeamRpcResult> =>
	requestJson<GetAgentTeamRpcResult>(
		buildAgentTeamPath(agentTeamId, machineId),
	);

export const createAgentTeam = async (
	payload: CreateAgentTeamPayload,
): Promise<CreateAgentTeamRpcResult> =>
	requestJson<CreateAgentTeamRpcResult>("/acp/agent-teams", {
		method: "POST",
		body: JSON.stringify({
			machineId: payload.machineId,
			title: payload.title,
			workspaceRootCwd: payload.workspaceRootCwd,
			leaderBackendId: payload.leaderBackendId,
			workspaceMode: payload.workspaceMode,
			worktreeSourceCwd: payload.worktreeSourceCwd,
			worktreeBranch: payload.worktreeBranch,
		}),
	});

export const fetchNotificationVapidPublicKey = async (): Promise<{
	enabled: boolean;
	publicKey: string | null;
}> => requestJson("/api/notifications/vapid-public-key");

export const registerWebPushSubscription = async (payload: {
	subscription: PushSubscriptionJSON;
	userAgent?: string;
	locale?: string;
}): Promise<void> => {
	await requestJson("/api/notifications/web-subscription", {
		method: "PUT",
		body: JSON.stringify(payload),
	});
};

export const unregisterWebPushSubscription = async (payload: {
	endpoint: string;
}): Promise<void> => {
	await requestJson("/api/notifications/web-subscription", {
		method: "DELETE",
		body: JSON.stringify(payload),
	});
};

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
		branch?: string;
		baseBranch?: string;
		sourceCwd: string;
		relativeCwd?: string;
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

export const setSessionConfigOption = async (
	payload: SetSessionConfigOptionParams,
): Promise<SessionSummary> =>
	requestJson<SessionSummary>("/acp/session/config-option", {
		method: "POST",
		body: JSON.stringify(payload),
	});

export const sendMessage = async (payload: {
	sessionId: string;
	messageId: string;
	prompt: ContentBlock[];
	revision: number;
	encryptionRequired: boolean;
}): Promise<SendMessageResult> => {
	const { revision, encryptionRequired, ...requestPayload } = payload;
	const encryptedPrompt = e2ee.encryptPayloadForSession(
		payload.sessionId,
		payload.prompt,
		revision,
		encryptionRequired,
	);
	return requestJsonWithTimeout<SendMessageResult>(
		"/acp/message",
		SEND_MESSAGE_TIMEOUT_MS,
		{
			method: "POST",
			body: JSON.stringify({
				...requestPayload,
				prompt: encryptedPrompt,
				expectedRevision: revision,
			}),
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
	requestJsonWithTimeout<SessionSummary>(
		"/acp/session/load",
		SESSION_LOAD_TIMEOUT_MS,
		{
			method: "POST",
			body: JSON.stringify(payload),
		},
	);

export const reloadSession = async (payload: {
	sessionId: string;
	cwd: string;
	backendId: string;
	machineId?: string;
}): Promise<SessionSummary> =>
	requestJsonWithTimeout<SessionSummary>(
		"/acp/session/reload",
		SESSION_LOAD_TIMEOUT_MS,
		{
			method: "POST",
			body: JSON.stringify(payload),
		},
	);

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
	if (payload.maxCount != null)
		params.set("maxCount", String(payload.maxCount));
	if (payload.skip != null) params.set("skip", String(payload.skip));
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
	if (payload.startLine != null)
		params.set("startLine", String(payload.startLine));
	if (payload.endLine != null) params.set("endLine", String(payload.endLine));
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
	if (payload.maxCount != null)
		params.set("maxCount", String(payload.maxCount));
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
	if (payload.maxCount != null)
		params.set("maxCount", String(payload.maxCount));
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
