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
