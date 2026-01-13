export type OpencodeConnectionState =
	| "idle"
	| "connecting"
	| "ready"
	| "error"
	| "stopped";

export type OpencodeStatus = {
	state: OpencodeConnectionState;
	command: string;
	args: string[];
	connectedAt?: string;
	lastError?: string;
	sessionId?: string;
	pid?: number;
};

export type CreateSessionResponse = {
	sessionId: string;
};

export type SendMessageResponse = {
	stopReason: string;
};

const API_BASE_URL =
	import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3757";

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
		let message = `${response.status} ${response.statusText}`;
		try {
			const payload = (await response.json()) as { error?: string };
			if (payload?.error) {
				message = payload.error;
			}
		} catch {}
		throw new Error(message);
	}

	return (await response.json()) as ResponseType;
};

export const fetchOpencodeStatus = async (): Promise<OpencodeStatus> =>
	requestJson<OpencodeStatus>("/acp/opencode");

export const createSession = async (
	cwd?: string,
): Promise<CreateSessionResponse> =>
	requestJson<CreateSessionResponse>("/acp/session", {
		method: "POST",
		body: JSON.stringify({ cwd }),
	});

export const sendMessage = async (payload: {
	sessionId: string;
	prompt: string;
}): Promise<SendMessageResponse> =>
	requestJson<SendMessageResponse>("/acp/message", {
		method: "POST",
		body: JSON.stringify(payload),
	});

export const createSessionEventSource = (sessionId: string) =>
	new EventSource(
		`${API_BASE_URL}/acp/session/stream?sessionId=${encodeURIComponent(
			sessionId,
		)}`,
	);
