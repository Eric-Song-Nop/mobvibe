import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockFetch = vi.fn();

describe("api (browser environment)", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.stubEnv("VITE_GATEWAY_URL", "http://localhost:3005");
		vi.doMock("../auth", () => ({ isInTauri: () => false }));
		vi.doMock("../auth-token", () => ({ getAuthToken: () => null }));
		vi.doMock("../tauri-fetch", () => ({
			platformFetch: mockFetch,
		}));
		global.fetch = mockFetch;
	});

	afterEach(() => {
		vi.restoreAllMocks();
		mockFetch.mockReset();
	});

	it("sends requests with credentials: include and no Authorization header", async () => {
		mockFetch.mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ sessions: [] }),
		});

		const { fetchSessions } = await import("../api");
		await fetchSessions();

		expect(mockFetch).toHaveBeenCalledWith(
			"http://localhost:3005/acp/sessions",
			expect.objectContaining({
				credentials: "include",
			}),
		);
		const callHeaders = mockFetch.mock.calls[0][1].headers;
		expect(callHeaders.Authorization).toBeUndefined();
	});
});

describe("api (Tauri environment)", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.stubEnv("VITE_GATEWAY_URL", "http://localhost:3005");
		vi.doMock("../tauri-fetch", () => ({
			platformFetch: mockFetch,
		}));
		global.fetch = mockFetch;
	});

	afterEach(() => {
		vi.restoreAllMocks();
		mockFetch.mockReset();
	});

	it("sends requests with Bearer token when token exists", async () => {
		vi.doMock("../auth", () => ({ isInTauri: () => true }));
		vi.doMock("../auth-token", () => ({
			getAuthToken: () => "my-test-token",
		}));
		mockFetch.mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ sessions: [] }),
		});

		const { fetchSessions } = await import("../api");
		await fetchSessions();

		expect(mockFetch).toHaveBeenCalledWith(
			"http://localhost:3005/acp/sessions",
			expect.objectContaining({
				credentials: "omit",
			}),
		);
		const callHeaders = mockFetch.mock.calls[0][1].headers;
		expect(callHeaders.Authorization).toBe("Bearer my-test-token");
	});

	it("sends requests without Authorization when no token", async () => {
		vi.doMock("../auth", () => ({ isInTauri: () => true }));
		vi.doMock("../auth-token", () => ({ getAuthToken: () => null }));
		mockFetch.mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ sessions: [] }),
		});

		const { fetchSessions } = await import("../api");
		await fetchSessions();

		expect(mockFetch).toHaveBeenCalledWith(
			"http://localhost:3005/acp/sessions",
			expect.objectContaining({
				credentials: "omit",
			}),
		);
		const callHeaders = mockFetch.mock.calls[0][1].headers;
		expect(callHeaders.Authorization).toBeUndefined();
	});
});

describe("api error handling", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.stubEnv("VITE_GATEWAY_URL", "http://localhost:3005");
		vi.doMock("../auth", () => ({ isInTauri: () => false }));
		vi.doMock("../auth-token", () => ({ getAuthToken: () => null }));
		vi.doMock("../tauri-fetch", () => ({
			platformFetch: mockFetch,
		}));
		global.fetch = mockFetch;
	});

	afterEach(() => {
		vi.restoreAllMocks();
		mockFetch.mockReset();
	});

	it("throws ApiError with ErrorDetail when server returns structured error", async () => {
		mockFetch.mockResolvedValue({
			ok: false,
			status: 400,
			statusText: "Bad Request",
			json: () =>
				Promise.resolve({
					error: {
						code: "VALIDATION_ERROR",
						message: "Invalid session ID",
						retryable: false,
						scope: "request",
					},
				}),
		});

		const { fetchSessions, ApiError } = await import("../api");

		await expect(fetchSessions()).rejects.toThrow(ApiError);
		try {
			await fetchSessions();
		} catch (e) {
			const err = e as InstanceType<typeof ApiError>;
			expect(err.detail.code).toBe("VALIDATION_ERROR");
			expect(err.detail.message).toBe("Invalid session ID");
		}
	});

	it("throws ApiError with fallback message for non-ErrorDetail errors", async () => {
		mockFetch.mockResolvedValue({
			ok: false,
			status: 500,
			statusText: "Internal Server Error",
			json: () => Promise.resolve({ error: "something went wrong" }),
		});

		const { fetchSessions, ApiError } = await import("../api");

		await expect(fetchSessions()).rejects.toThrow(ApiError);
		try {
			await fetchSessions();
		} catch (e) {
			const err = e as InstanceType<typeof ApiError>;
			expect(err.detail.message).toBe("something went wrong");
		}
	});

	it("throws ApiError with status text fallback when JSON parse fails", async () => {
		mockFetch.mockResolvedValue({
			ok: false,
			status: 502,
			statusText: "Bad Gateway",
			json: () => Promise.reject(new Error("invalid json")),
		});

		const { fetchSessions, ApiError } = await import("../api");

		await expect(fetchSessions()).rejects.toThrow(ApiError);
		try {
			await fetchSessions();
		} catch (e) {
			const err = e as InstanceType<typeof ApiError>;
			expect(err.detail.message).toBe("502 Bad Gateway");
		}
	});
});

describe("Agent Team API", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.stubEnv("VITE_GATEWAY_URL", "http://localhost:3005");
		vi.doMock("../auth", () => ({ isInTauri: () => false }));
		vi.doMock("../auth-token", () => ({ getAuthToken: () => null }));
		vi.doMock("../tauri-fetch", () => ({
			platformFetch: mockFetch,
		}));
		global.fetch = mockFetch;
	});

	afterEach(() => {
		vi.restoreAllMocks();
		mockFetch.mockReset();
	});

	it("fetches Agent Teams with an optional machineId query", async () => {
		mockFetch.mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ teams: [] }),
		});

		const { fetchAgentTeams } = await import("../api");
		const result = await fetchAgentTeams("machine-1");

		expect(result).toEqual({ teams: [] });
		expect(mockFetch).toHaveBeenCalledWith(
			"http://localhost:3005/acp/agent-teams?machineId=machine-1",
			expect.objectContaining({ credentials: "include" }),
		);
		expect(mockFetch.mock.calls[0][1].method).toBeUndefined();
	});

	it("fetches a single Agent Team and preserves ApiError details", async () => {
		mockFetch.mockResolvedValue({
			ok: false,
			status: 404,
			statusText: "Not Found",
			json: () =>
				Promise.resolve({
					error: {
						code: "SESSION_NOT_FOUND",
						message: "Agent Team not found",
						retryable: false,
						scope: "request",
					},
				}),
		});

		const { fetchAgentTeam, ApiError } = await import("../api");

		await expect(fetchAgentTeam("team-1", "machine-1")).rejects.toThrow(
			ApiError,
		);
		try {
			await fetchAgentTeam("team-1", "machine-1");
		} catch (e) {
			const err = e as InstanceType<typeof ApiError>;
			expect(err.detail.code).toBe("SESSION_NOT_FOUND");
			expect(err.detail.message).toBe("Agent Team not found");
		}
		expect(mockFetch.mock.calls[0][0]).toBe(
			"http://localhost:3005/acp/agent-teams/team-1?machineId=machine-1",
		);
	});

	it("creates Agent Teams with metadata-only fields", async () => {
		mockFetch.mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ team: { agentTeamId: "team-1" } }),
		});

		const { createAgentTeam } = await import("../api");
		await createAgentTeam({
			machineId: "machine-1",
			title: "Team One",
			workspaceRootCwd: "/repo",
			leaderBackendId: "backend-1",
			workspaceMode: "per_member_worktree",
			worktreeSourceCwd: "/repo",
			worktreeBranch: "team/one",
			prompt: "do not serialize",
			content: "do not serialize",
			body: "do not serialize",
			description: "do not serialize",
			summaryText: "do not serialize",
			agentOutput: "do not serialize",
			providerToken: "do not serialize",
			masterSecret: "do not serialize",
			dek: "do not serialize",
			secret: "do not serialize",
		} as Parameters<typeof createAgentTeam>[0] & Record<string, unknown>);

		expect(mockFetch.mock.calls[0][0]).toBe(
			"http://localhost:3005/acp/agent-teams",
		);
		expect(mockFetch.mock.calls[0][1].method).toBe("POST");
		const body = JSON.parse(
			mockFetch.mock.calls[0][1].body as string,
		) as Record<string, unknown>;
		expect(body).toEqual({
			machineId: "machine-1",
			title: "Team One",
			workspaceRootCwd: "/repo",
			leaderBackendId: "backend-1",
			workspaceMode: "per_member_worktree",
			worktreeSourceCwd: "/repo",
			worktreeBranch: "team/one",
		});
		expect(JSON.stringify(body)).not.toMatch(
			/prompt|content|body|description|summaryText|agentOutput|providerToken|masterSecret|dek|secret/,
		);
	});
});
