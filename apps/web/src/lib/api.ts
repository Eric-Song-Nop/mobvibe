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

export type SessionState = AcpConnectionState;

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
	agentName?: string;
	modelId?: string;
	modelName?: string;
	modeId?: string;
	modeName?: string;
};

export type SessionsResponse = {
	sessions: SessionSummary[];
};

export type CreateSessionResponse = SessionSummary;

export type SendMessageResponse = {
	stopReason: string;
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

const API_BASE_URL =
	import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3757";

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
