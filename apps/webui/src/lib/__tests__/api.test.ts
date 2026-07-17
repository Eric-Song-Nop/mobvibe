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

describe("api Fly owner routing", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.stubEnv("VITE_GATEWAY_URL", "https://api.mobvibe.net");
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

	it("resolves the owner before a first-request large message", async () => {
		mockFetch
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				headers: new Headers({ "x-mobvibe-instance-id": "owner-machine-1" }),
				json: () => Promise.resolve({ ok: true }),
			})
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				headers: new Headers({ "x-mobvibe-instance-id": "owner-machine-1" }),
				json: () => Promise.resolve({ stopReason: "end_turn" }),
			});

		const { sendMessage } = await import("../api");
		await sendMessage({
			sessionId: "session-1",
			messageId: "message-1",
			revision: 7,
			encryptionRequired: false,
			prompt: [{ type: "text", text: "x".repeat(1_100_000) }],
		});

		expect(mockFetch.mock.calls[0][0]).toBe(
			"https://api.mobvibe.net/acp/routing",
		);
		expect(mockFetch.mock.calls[0][1]).toEqual(
			expect.objectContaining({ method: "GET", credentials: "include" }),
		);
		const largeRequest = mockFetch.mock.calls[1][1];
		expect(largeRequest.headers["fly-force-instance-id"]).toBe(
			"owner-machine-1",
		);
		expect((largeRequest.body as string).length).toBeGreaterThan(1_000_000);
		expect(JSON.parse(largeRequest.body as string)).toEqual(
			expect.objectContaining({
				sessionId: "session-1",
				messageId: "message-1",
				expectedRevision: 7,
			}),
		);
		expect(JSON.parse(largeRequest.body as string)).not.toHaveProperty(
			"revision",
		);
	});

	it("caches owner resolution across later stateful requests", async () => {
		mockFetch
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				headers: new Headers({ "x-mobvibe-instance-id": "owner-machine-1" }),
				json: () => Promise.resolve({ ok: true }),
			})
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				headers: new Headers({ "x-mobvibe-instance-id": "owner-machine-1" }),
				json: () => Promise.resolve({ sessions: [] }),
			})
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				headers: new Headers(),
				json: () => Promise.resolve({ stopReason: "end_turn" }),
			});

		const { fetchSessions, sendMessage } = await import("../api");
		await fetchSessions();
		await sendMessage({
			sessionId: "session-1",
			messageId: "message-1",
			revision: 1,
			encryptionRequired: false,
			prompt: [{ type: "text", text: "x".repeat(1_100_000) }],
		});

		const sessionsRequest = mockFetch.mock.calls[1][1];
		const largeRequest = mockFetch.mock.calls[2][1];
		expect(sessionsRequest.headers["fly-force-instance-id"]).toBe(
			"owner-machine-1",
		);
		expect(largeRequest.headers["fly-force-instance-id"]).toBe(
			"owner-machine-1",
		);
		expect((largeRequest.body as string).length).toBeGreaterThan(1_000_000);
		expect(
			mockFetch.mock.calls.filter(([url]) =>
				String(url).endsWith("/acp/routing"),
			),
		).toHaveLength(1);
	});

	it("deduplicates concurrent owner resolution", async () => {
		let resolveRouting: ((response: unknown) => void) | undefined;
		const routingResponse = new Promise((resolve) => {
			resolveRouting = resolve;
		});
		mockFetch.mockImplementation((url: string) => {
			if (url.endsWith("/acp/routing")) {
				return routingResponse;
			}
			if (url.endsWith("/acp/sessions")) {
				return Promise.resolve({
					ok: true,
					status: 200,
					headers: new Headers(),
					json: () => Promise.resolve({ sessions: [] }),
				});
			}
			if (url.endsWith("/api/machines")) {
				return Promise.resolve({
					ok: true,
					status: 200,
					headers: new Headers(),
					json: () => Promise.resolve({ machines: [] }),
				});
			}
			throw new Error(`Unexpected URL: ${url}`);
		});

		const { fetchMachines, fetchSessions } = await import("../api");
		const sessionsRequest = fetchSessions();
		const machinesRequest = fetchMachines();
		await vi.waitFor(() => {
			expect(
				mockFetch.mock.calls.filter(([url]) =>
					String(url).endsWith("/acp/routing"),
				),
			).toHaveLength(1);
		});

		resolveRouting?.({
			ok: true,
			status: 200,
			headers: new Headers({ "x-mobvibe-instance-id": "owner-machine-1" }),
			json: () => Promise.resolve({ ok: true }),
		});
		await Promise.all([sessionsRequest, machinesRequest]);

		const statefulCalls = mockFetch.mock.calls.filter(
			([url]) => !String(url).endsWith("/acp/routing"),
		);
		expect(statefulCalls).toHaveLength(2);
		for (const [, options] of statefulCalls) {
			expect(options.headers["fly-force-instance-id"]).toBe("owner-machine-1");
		}
	});

	it.each([
		"network error",
		"unauthorized",
		"no-content",
	] as const)("retries owner resolution after a transient %s response", async (failureMode) => {
		vi.useFakeTimers();
		try {
			let routingAttempts = 0;
			mockFetch.mockImplementation((url: string) => {
				if (url.endsWith("/acp/routing")) {
					routingAttempts += 1;
					if (routingAttempts === 1) {
						if (failureMode === "network error") {
							return Promise.reject(new Error("temporarily offline"));
						}
						return Promise.resolve({
							ok: failureMode !== "unauthorized",
							status: failureMode === "unauthorized" ? 401 : 204,
							statusText:
								failureMode === "unauthorized" ? "Unauthorized" : "No Content",
							headers: new Headers(),
							json: () => Promise.resolve({}),
						});
					}
					return Promise.resolve({
						ok: true,
						status: 204,
						headers: new Headers({
							"x-mobvibe-instance-id": "recovered-owner",
						}),
						json: () => Promise.resolve({}),
					});
				}
				if (url.endsWith("/acp/sessions")) {
					return Promise.resolve({
						ok: true,
						status: 200,
						headers: new Headers(),
						json: () => Promise.resolve({ sessions: [] }),
					});
				}
				if (url.endsWith("/api/machines")) {
					return Promise.resolve({
						ok: true,
						status: 200,
						headers: new Headers(),
						json: () => Promise.resolve({ machines: [] }),
					});
				}
				if (url.includes("/fs/session/roots")) {
					return Promise.resolve({
						ok: true,
						status: 200,
						headers: new Headers(),
						json: () => Promise.resolve({ roots: [] }),
					});
				}
				throw new Error(`Unexpected URL: ${url}`);
			});

			const { fetchMachines, fetchSessionFsRoots, fetchSessions } =
				await import("../api");
			await fetchSessions();
			await fetchMachines();
			expect(routingAttempts).toBe(1);

			await vi.advanceTimersByTimeAsync(1_001);
			await fetchSessionFsRoots({ sessionId: "session-1" });

			expect(routingAttempts).toBe(2);
			const fsRequest = mockFetch.mock.calls.find(([url]) =>
				String(url).includes("/fs/session/roots"),
			);
			expect(fsRequest?.[1].headers["fly-force-instance-id"]).toBe(
				"recovered-owner",
			);
		} finally {
			vi.useRealTimers();
		}
	});

	it("bounds a shared owner resolution independently of caller timeouts", async () => {
		vi.useFakeTimers();
		try {
			let routingSignal: AbortSignal | null | undefined;
			mockFetch.mockImplementation((url: string, options?: RequestInit) => {
				if (url.endsWith("/acp/routing")) {
					routingSignal = options?.signal;
					return new Promise(() => {});
				}
				if (url.endsWith("/acp/sessions")) {
					return Promise.resolve({
						ok: true,
						status: 200,
						headers: new Headers(),
						json: () => Promise.resolve({ sessions: [] }),
					});
				}
				throw new Error(`Unexpected URL: ${url}`);
			});

			const { fetchSessions } = await import("../api");
			const sessionsRequest = fetchSessions();
			await Promise.resolve();
			expect(mockFetch).toHaveBeenCalledTimes(1);

			await vi.advanceTimersByTimeAsync(3_001);
			const sessionsCall = mockFetch.mock.calls.find(([url]) =>
				String(url).endsWith("/acp/sessions"),
			);
			expect(sessionsCall).toBeDefined();
			await expect(sessionsRequest).resolves.toEqual({ sessions: [] });
			expect(routingSignal?.aborted).toBe(true);
		} finally {
			vi.useRealTimers();
		}
	});

	it("lets one caller abort without cancelling shared owner resolution", async () => {
		const NativeAbortController = globalThis.AbortController;
		const controllers: AbortController[] = [];
		class TrackingAbortController extends NativeAbortController {
			constructor() {
				super();
				controllers.push(this);
			}
		}
		Object.defineProperty(globalThis, "AbortController", {
			configurable: true,
			writable: true,
			value: TrackingAbortController,
		});

		try {
			let resolveRouting: ((response: unknown) => void) | undefined;
			let routingSignal: AbortSignal | null | undefined;
			mockFetch.mockImplementation((url: string, options?: RequestInit) => {
				if (url.endsWith("/acp/routing")) {
					routingSignal = options?.signal;
					return new Promise((resolve, reject) => {
						resolveRouting = resolve;
						options?.signal?.addEventListener(
							"abort",
							() => reject(new DOMException("Aborted", "AbortError")),
							{ once: true },
						);
					});
				}
				if (url.endsWith("/acp/message")) {
					if (options?.signal?.aborted) {
						return Promise.reject(new DOMException("Aborted", "AbortError"));
					}
					return Promise.resolve({
						ok: true,
						status: 200,
						headers: new Headers(),
						json: () => Promise.resolve({ stopReason: "end_turn" }),
					});
				}
				if (url.endsWith("/acp/sessions")) {
					return Promise.resolve({
						ok: true,
						status: 200,
						headers: new Headers(),
						json: () => Promise.resolve({ sessions: [] }),
					});
				}
				throw new Error(`Unexpected URL: ${url}`);
			});

			const { fetchSessions, sendMessage } = await import("../api");
			const messageRequest = sendMessage({
				sessionId: "session-1",
				messageId: "message-1",
				revision: 1,
				encryptionRequired: false,
				prompt: [{ type: "text", text: "Hello" }],
			});
			await vi.waitFor(() => expect(resolveRouting).toBeTypeOf("function"));
			const sessionsRequest = fetchSessions();
			expect(
				mockFetch.mock.calls.filter(([url]) =>
					String(url).endsWith("/acp/routing"),
				),
			).toHaveLength(1);

			controllers[0]?.abort();
			resolveRouting?.({
				ok: true,
				status: 204,
				headers: new Headers({
					"x-mobvibe-instance-id": "shared-owner",
				}),
				json: () => Promise.resolve({}),
			});

			await expect(messageRequest).rejects.toThrow("Request timed out");
			await expect(sessionsRequest).resolves.toEqual({ sessions: [] });
			expect(routingSignal?.aborted).toBe(false);
			const sessionsCall = mockFetch.mock.calls.find(([url]) =>
				String(url).endsWith("/acp/sessions"),
			);
			expect(sessionsCall?.[1].headers["fly-force-instance-id"]).toBe(
				"shared-owner",
			);
		} finally {
			Object.defineProperty(globalThis, "AbortController", {
				configurable: true,
				writable: true,
				value: NativeAbortController,
			});
		}
	});

	it("uses the latest owner advertised by a stateful response", async () => {
		mockFetch
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				headers: new Headers({ "x-mobvibe-instance-id": "owner-machine-1" }),
				json: () => Promise.resolve({ ok: true }),
			})
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				headers: new Headers({ "x-mobvibe-instance-id": "owner-machine-1" }),
				json: () => Promise.resolve({ sessions: [] }),
			})
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				headers: new Headers({ "x-mobvibe-instance-id": "owner-machine-2" }),
				json: () => Promise.resolve({ machines: [] }),
			})
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				headers: new Headers(),
				json: () => Promise.resolve({ roots: [] }),
			});

		const { fetchMachines, fetchSessionFsRoots, fetchSessions } = await import(
			"../api"
		);
		await fetchSessions();
		await fetchMachines();
		await fetchSessionFsRoots({ sessionId: "session-1" });

		expect(mockFetch.mock.calls[2][1].headers["fly-force-instance-id"]).toBe(
			"owner-machine-1",
		);
		expect(mockFetch.mock.calls[3][1].headers["fly-force-instance-id"]).toBe(
			"owner-machine-2",
		);
	});

	it("retries one idempotent message with the owner returned by a stale-owner response", async () => {
		mockFetch
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				headers: new Headers({ "x-mobvibe-instance-id": "owner-machine-1" }),
				json: () => Promise.resolve({ ok: true }),
			})
			.mockResolvedValueOnce({
				ok: false,
				status: 409,
				statusText: "Conflict",
				headers: new Headers({ "x-mobvibe-instance-id": "owner-machine-2" }),
				json: () =>
					Promise.resolve({
						error: {
							code: "INSTANCE_AFFINITY_CHANGED",
							message: "The session owner changed. Retry on the new owner.",
							retryable: true,
							scope: "request",
						},
					}),
			})
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				headers: new Headers({ "x-mobvibe-instance-id": "owner-machine-2" }),
				json: () => Promise.resolve({ stopReason: "end_turn" }),
			});

		const { sendMessage } = await import("../api");
		await sendMessage({
			sessionId: "session-1",
			messageId: "idempotent-message-1",
			revision: 1,
			encryptionRequired: false,
			prompt: [{ type: "text", text: "Hello" }],
		});

		const firstAttempt = mockFetch.mock.calls[1][1];
		const retryAttempt = mockFetch.mock.calls[2][1];
		expect(firstAttempt.headers["fly-force-instance-id"]).toBe(
			"owner-machine-1",
		);
		expect(retryAttempt.headers["fly-force-instance-id"]).toBe(
			"owner-machine-2",
		);
		expect(retryAttempt.body).toBe(firstAttempt.body);
		expect(JSON.parse(retryAttempt.body as string)).toEqual(
			expect.objectContaining({ messageId: "idempotent-message-1" }),
		);
		expect(mockFetch).toHaveBeenCalledTimes(3);
	});

	it("retries one safe read with the owner returned by a stale-owner response", async () => {
		mockFetch
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				headers: new Headers({ "x-mobvibe-instance-id": "owner-machine-1" }),
				json: () => Promise.resolve({ ok: true }),
			})
			.mockResolvedValueOnce({
				ok: false,
				status: 409,
				statusText: "Conflict",
				headers: new Headers({ "x-mobvibe-instance-id": "owner-machine-2" }),
				json: () =>
					Promise.resolve({
						error: {
							code: "INSTANCE_AFFINITY_CHANGED",
							message: "The session owner changed.",
							retryable: true,
							scope: "request",
						},
					}),
			})
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				headers: new Headers({ "x-mobvibe-instance-id": "owner-machine-2" }),
				json: () => Promise.resolve({ sessions: [] }),
			});

		const { fetchSessions } = await import("../api");
		await expect(fetchSessions()).resolves.toEqual({ sessions: [] });

		expect(mockFetch.mock.calls[1][1].headers["fly-force-instance-id"]).toBe(
			"owner-machine-1",
		);
		expect(mockFetch.mock.calls[2][1].headers["fly-force-instance-id"]).toBe(
			"owner-machine-2",
		);
		expect(mockFetch).toHaveBeenCalledTimes(3);
	});

	it("surfaces an affinity error without replaying a non-idempotent mutation", async () => {
		const affinityError = {
			code: "INSTANCE_AFFINITY_CHANGED" as const,
			message: "The session owner changed. Submit the mutation again.",
			retryable: true,
			scope: "request" as const,
		};
		mockFetch
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				headers: new Headers({ "x-mobvibe-instance-id": "owner-machine-1" }),
				json: () => Promise.resolve({ ok: true }),
			})
			.mockResolvedValueOnce({
				ok: false,
				status: 409,
				statusText: "Conflict",
				headers: new Headers({ "x-mobvibe-instance-id": "owner-machine-2" }),
				json: () => Promise.resolve({ error: affinityError }),
			})
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				headers: new Headers(),
				json: () => Promise.resolve({ sessions: [] }),
			});

		const { ApiError, createSession, fetchSessions } = await import("../api");
		await expect(createSession()).rejects.toMatchObject({
			constructor: ApiError,
			detail: affinityError,
		});
		await fetchSessions();

		expect(
			mockFetch.mock.calls.filter(([url]) =>
				String(url).endsWith("/acp/session"),
			),
		).toHaveLength(1);
		expect(mockFetch.mock.calls[2][1].headers["fly-force-instance-id"]).toBe(
			"owner-machine-2",
		);
	});

	it("does not add Fly routing headers when a self-hosted gateway advertises no owner", async () => {
		mockFetch.mockResolvedValue({
			ok: true,
			status: 200,
			headers: new Headers(),
			json: () => Promise.resolve({ sessions: [] }),
		});

		const { fetchMachines, fetchSessions, setApiBaseUrl } = await import(
			"../api"
		);
		setApiBaseUrl("https://self-hosted.example");
		await fetchSessions();
		await fetchMachines();

		expect(
			mockFetch.mock.calls[1][1].headers["fly-force-instance-id"],
		).toBeUndefined();
		expect(
			mockFetch.mock.calls[2][1].headers["fly-force-instance-id"],
		).toBeUndefined();
		expect(mockFetch).toHaveBeenCalledTimes(3);
	});

	it("clears a learned owner when the gateway URL changes", async () => {
		mockFetch
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				headers: new Headers({ "x-mobvibe-instance-id": "old-owner" }),
				json: () => Promise.resolve({ ok: true }),
			})
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				headers: new Headers({ "x-mobvibe-instance-id": "old-owner" }),
				json: () => Promise.resolve({ sessions: [] }),
			})
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				headers: new Headers(),
				json: () => Promise.resolve({ ok: true }),
			})
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				headers: new Headers(),
				json: () => Promise.resolve({ machines: [] }),
			});

		const { fetchMachines, fetchSessions, setApiBaseUrl } = await import(
			"../api"
		);
		await fetchSessions();
		setApiBaseUrl("https://self-hosted.example");
		await fetchMachines();

		expect(mockFetch.mock.calls[3][0]).toBe(
			"https://self-hosted.example/api/machines",
		);
		expect(
			mockFetch.mock.calls[3][1].headers["fly-force-instance-id"],
		).toBeUndefined();
	});

	it("does not reuse an in-flight owner resolution after the gateway URL changes", async () => {
		let resolveOldRouting: ((response: unknown) => void) | undefined;
		const oldRoutingResponse = new Promise((resolve) => {
			resolveOldRouting = resolve;
		});
		mockFetch.mockImplementation((url: string) => {
			if (url === "https://api.mobvibe.net/acp/routing") {
				return oldRoutingResponse;
			}
			if (url === "https://new-gateway.example/acp/routing") {
				return Promise.resolve({
					ok: true,
					status: 200,
					headers: new Headers({ "x-mobvibe-instance-id": "new-owner" }),
					json: () => Promise.resolve({ ok: true }),
				});
			}
			if (url.endsWith("/acp/message")) {
				return Promise.resolve({
					ok: true,
					status: 200,
					headers: new Headers(),
					json: () => Promise.resolve({ stopReason: "end_turn" }),
				});
			}
			throw new Error(`Unexpected URL: ${url}`);
		});

		const { sendMessage, setApiBaseUrl } = await import("../api");
		const oldRequest = sendMessage({
			sessionId: "session-old",
			messageId: "message-old",
			revision: 1,
			encryptionRequired: false,
			prompt: [{ type: "text", text: "Old gateway" }],
		});
		await vi.waitFor(() => {
			expect(mockFetch).toHaveBeenCalledWith(
				"https://api.mobvibe.net/acp/routing",
				expect.any(Object),
			);
		});

		setApiBaseUrl("https://new-gateway.example");
		await sendMessage({
			sessionId: "session-new",
			messageId: "message-new",
			revision: 1,
			encryptionRequired: false,
			prompt: [{ type: "text", text: "New gateway" }],
		});

		const newMessageCall = mockFetch.mock.calls.find(
			([url]) => url === "https://new-gateway.example/acp/message",
		);
		expect(newMessageCall?.[1].headers["fly-force-instance-id"]).toBe(
			"new-owner",
		);

		resolveOldRouting?.({
			ok: true,
			status: 200,
			headers: new Headers({ "x-mobvibe-instance-id": "old-owner" }),
			json: () => Promise.resolve({ ok: true }),
		});
		await oldRequest;
		await sendMessage({
			sessionId: "session-new",
			messageId: "message-new-2",
			revision: 1,
			encryptionRequired: false,
			prompt: [{ type: "text", text: "Still on the new gateway" }],
		});

		const latestNewMessageCall = mockFetch.mock.calls
			.filter(([url]) => url === "https://new-gateway.example/acp/message")
			.at(-1);
		expect(latestNewMessageCall?.[1].headers["fly-force-instance-id"]).toBe(
			"new-owner",
		);
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
		const teamRequest = mockFetch.mock.calls.find(
			([url]) =>
				url === "http://localhost:3005/acp/agent-teams?machineId=machine-1",
		);
		expect(teamRequest?.[1].method).toBeUndefined();
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
		expect(mockFetch).toHaveBeenCalledWith(
			"http://localhost:3005/acp/agent-teams/team-1?machineId=machine-1",
			expect.any(Object),
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

		const createRequest = mockFetch.mock.calls.find(
			([url]) => url === "http://localhost:3005/acp/agent-teams",
		);
		expect(createRequest?.[1].method).toBe("POST");
		const body = JSON.parse(createRequest?.[1].body as string) as Record<
			string,
			unknown
		>;
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
