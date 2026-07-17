import { beforeEach, describe, expect, it, mock } from "bun:test";

// Mock the SDK
mock.module("@agentclientprotocol/sdk", () => ({
	client: mock(() => {}),
	methods: {
		agent: {
			initialize: "initialize",
			session: {
				cancel: "session/cancel",
				list: "session/list",
				load: "session/load",
				new: "session/new",
				prompt: "session/prompt",
				resume: "session/resume",
				setConfigOption: "session/set_config_option",
				setMode: "session/set_mode",
			},
		},
		client: {
			session: {
				requestPermission: "session/request_permission",
				update: "session/update",
			},
			terminal: {
				create: "terminal/create",
				kill: "terminal/kill",
				output: "terminal/output",
				release: "terminal/release",
				waitForExit: "terminal/wait_for_exit",
			},
		},
	},
	ndJsonStream: mock(() => {}),
	PROTOCOL_VERSION: "0.1.0",
}));

// Mock child_process wrapper so other tests can safely mock node:child_process
mock.module("../../lib/child-process.js", () => ({
	spawn: mock(() => ({
		stdin: { pipe: mock(() => {}) },
		stdout: { pipe: mock(() => {}) },
		stderr: { pipe: mock(() => {}) },
		on: mock(() => {}),
		once: mock(() => {}),
		kill: mock(() => {}),
		exitCode: null,
		killed: false,
		pid: 12345,
	})),
}));

// Mock stream
mock.module("node:stream", () => ({
	Readable: { toWeb: mock(() => ({})) },
	Writable: { toWeb: mock(() => ({})) },
}));

import type { AcpBackendConfig } from "../../config.js";
import {
	AcpConnection,
	normalizeAdditionalDirectories,
} from "../acp-connection.js";

const createMockBackendConfig = (): AcpBackendConfig => ({
	id: "test-backend",
	label: "Test Backend",
	command: "test-command",
	args: ["--arg1"],
});

describe("AcpConnection", () => {
	let connection: AcpConnection;
	let mockBackend: AcpBackendConfig;

	beforeEach(() => {
		mockBackend = createMockBackendConfig();
		connection = new AcpConnection({
			backend: mockBackend,
			client: { name: "test-client", version: "1.0.0" },
		});
	});

	describe("getSessionCapabilities", () => {
		it("returns all false when agentCapabilities is undefined", () => {
			const capabilities = connection.getSessionCapabilities();

			expect(capabilities.list).toBe(false);
			expect(capabilities.load).toBe(false);
			expect(capabilities.prompt).toEqual({
				audio: false,
				embeddedContext: false,
				image: false,
			});
		});

		it("returns correct capabilities when sessionCapabilities.list is defined", () => {
			// @ts-expect-error - accessing private property for testing
			connection.agentCapabilities = {
				sessionCapabilities: {
					list: {},
				},
			};

			const capabilities = connection.getSessionCapabilities();

			expect(capabilities.list).toBe(true);
			expect(capabilities.load).toBe(false);
			expect(capabilities.prompt?.image).toBe(false);
		});

		it("returns correct capabilities when loadSession is true", () => {
			// @ts-expect-error - accessing private property for testing
			connection.agentCapabilities = {
				loadSession: true,
			};

			const capabilities = connection.getSessionCapabilities();

			expect(capabilities.list).toBe(false);
			expect(capabilities.load).toBe(true);
			expect(capabilities.prompt?.image).toBe(false);
		});

		it("maps prompt capabilities from agent initialize response", () => {
			// @ts-expect-error - accessing private property for testing
			connection.agentCapabilities = {
				promptCapabilities: {
					image: true,
					audio: false,
					embeddedContext: true,
				},
			};

			const capabilities = connection.getSessionCapabilities();

			expect(capabilities.prompt).toEqual({
				image: true,
				audio: false,
				embeddedContext: true,
			});
		});

		it("maps the additionalDirectories session capability", () => {
			// @ts-expect-error - accessing private property for testing
			connection.agentCapabilities = {
				sessionCapabilities: { additionalDirectories: {} },
			};

			expect(connection.getSessionCapabilities().additionalDirectories).toBe(
				true,
			);
		});

		it("maps the resume session capability", () => {
			// @ts-expect-error - accessing private property for testing
			connection.agentCapabilities = {
				sessionCapabilities: { resume: {} },
			};

			expect(connection.getSessionCapabilities().resume).toBe(true);
			expect(connection.supportsSessionResume()).toBe(true);
		});
	});

	describe("additionalDirectories", () => {
		it("preserves order while removing exact duplicates and cwd", () => {
			expect(
				normalizeAdditionalDirectories("/repo", [
					"/repo",
					"/data",
					"/data/nested",
					"/data",
					"C:\\workspace",
				]),
			).toEqual(["/data", "/data/nested", "C:\\workspace"]);
		});

		it("rejects relative directories", () => {
			expect(() =>
				normalizeAdditionalDirectories("/repo", ["relative/path"]),
			).toThrow("absolute paths");
		});

		it("gates and forwards the complete list for load", async () => {
			const request = mock(() => Promise.resolve({}));
			const internal = connection as unknown as {
				state: "ready";
				agentCapabilities: {
					loadSession: boolean;
					sessionCapabilities: {
						additionalDirectories: Record<string, never>;
					};
				};
				connection: { agent: { request: typeof request } };
			};
			internal.state = "ready";
			internal.agentCapabilities = {
				loadSession: true,
				sessionCapabilities: { additionalDirectories: {} },
			};
			internal.connection = { agent: { request } };

			await connection.loadSession("session-1", "/repo", [
				"/repo",
				"/data",
				"/data",
			]);

			expect(request).toHaveBeenCalledWith("session/load", {
				sessionId: "session-1",
				cwd: "/repo",
				mcpServers: [],
				additionalDirectories: ["/data"],
			});
		});

		it("rejects non-empty roots when the capability is absent", async () => {
			const request = mock(() => Promise.resolve({ sessionId: "session-1" }));
			const internal = connection as unknown as {
				state: "ready";
				agentCapabilities: Record<string, never>;
				connection: { agent: { request: typeof request } };
			};
			internal.state = "ready";
			internal.agentCapabilities = {};
			internal.connection = { agent: { request } };

			await expect(
				connection.createSession({
					cwd: "/repo",
					additionalDirectories: ["/data"],
				}),
			).rejects.toThrow("additionalDirectories capability");
			expect(request).not.toHaveBeenCalled();
		});
	});

	describe("supportsSessionList", () => {
		it("returns false when agentCapabilities is undefined", () => {
			expect(connection.supportsSessionList()).toBe(false);
		});

		it("returns false when sessionCapabilities is undefined", () => {
			// @ts-expect-error - accessing private property for testing
			connection.agentCapabilities = {};

			expect(connection.supportsSessionList()).toBe(false);
		});

		it("returns false when sessionCapabilities.list is null", () => {
			// @ts-expect-error - accessing private property for testing
			connection.agentCapabilities = {
				sessionCapabilities: {
					list: null,
				},
			};

			expect(connection.supportsSessionList()).toBe(false);
		});

		it("returns true when sessionCapabilities.list is defined", () => {
			// @ts-expect-error - accessing private property for testing
			connection.agentCapabilities = {
				sessionCapabilities: {
					list: {},
				},
			};

			expect(connection.supportsSessionList()).toBe(true);
		});
	});

	describe("supportsSessionLoad", () => {
		it("returns false when agentCapabilities is undefined", () => {
			expect(connection.supportsSessionLoad()).toBe(false);
		});

		it("returns false when loadSession is false", () => {
			// @ts-expect-error - accessing private property for testing
			connection.agentCapabilities = {
				loadSession: false,
			};

			expect(connection.supportsSessionLoad()).toBe(false);
		});

		it("returns false when loadSession is undefined", () => {
			// @ts-expect-error - accessing private property for testing
			connection.agentCapabilities = {};

			expect(connection.supportsSessionLoad()).toBe(false);
		});

		it("returns true when loadSession is true", () => {
			// @ts-expect-error - accessing private property for testing
			connection.agentCapabilities = {
				loadSession: true,
			};

			expect(connection.supportsSessionLoad()).toBe(true);
		});
	});

	describe("listSessions", () => {
		it("returns empty array when session list not supported", async () => {
			// agentCapabilities is undefined, so supportsSessionList() returns false
			const result = await connection.listSessions();

			expect(result).toEqual({ sessions: [] });
		});
	});

	describe("loadSession", () => {
		it("throws error when session load not supported", async () => {
			// agentCapabilities is undefined, so supportsSessionLoad() returns false
			await expect(
				connection.loadSession("session-1", "/home/user/project"),
			).rejects.toThrow("Agent does not support session/load capability");
		});
	});

	describe("resumeSession", () => {
		it("rejects when the agent does not advertise resume", async () => {
			await expect(
				connection.resumeSession("session-1", "/home/user/project"),
			).rejects.toThrow("Agent does not support session/resume capability");
		});

		it("forwards cwd, MCP servers, and normalized additional roots", async () => {
			const request = mock(() =>
				Promise.resolve({ modes: null, configOptions: null }),
			);
			const internal = connection as unknown as {
				state: "ready";
				agentCapabilities: {
					sessionCapabilities: {
						resume: Record<string, never>;
						additionalDirectories: Record<string, never>;
					};
				};
				connection: { agent: { request: typeof request } };
			};
			internal.state = "ready";
			internal.agentCapabilities = {
				sessionCapabilities: { resume: {}, additionalDirectories: {} },
			};
			internal.connection = { agent: { request } };

			await connection.resumeSession("session-1", "/repo", [
				"/repo",
				"/data",
				"/data",
			]);

			expect(request).toHaveBeenCalledWith("session/resume", {
				sessionId: "session-1",
				cwd: "/repo",
				mcpServers: [],
				additionalDirectories: ["/data"],
			});
			expect(connection.getStatus().sessionId).toBe("session-1");
		});
	});

	describe("cancel", () => {
		it("cancels the prompt request and sends session/cancel", async () => {
			let resolvePrompt:
				| ((value: { stopReason: "cancelled" }) => void)
				| undefined;
			const request = mock(
				(
					_method: string,
					_params: unknown,
					_options?: { cancellationSignal?: AbortSignal },
				) =>
					new Promise<{ stopReason: "cancelled" }>((resolve) => {
						resolvePrompt = resolve;
					}),
			);
			const notify = mock(() => Promise.resolve());
			const internal = connection as unknown as {
				state: "ready";
				connection: {
					agent: {
						request: typeof request;
						notify: typeof notify;
					};
				};
			};
			internal.state = "ready";
			internal.connection = { agent: { request, notify } };

			const prompt = connection.prompt("session-1", [
				{ type: "text", text: "hello" },
			]);
			await Promise.resolve();

			const options = request.mock.calls[0]?.[2];
			expect(options?.cancellationSignal?.aborted).toBe(false);

			await connection.cancel("session-1");

			expect(options?.cancellationSignal?.aborted).toBe(true);
			expect(notify).toHaveBeenCalledWith("session/cancel", {
				sessionId: "session-1",
			});

			resolvePrompt?.({ stopReason: "cancelled" });
			await expect(prompt).resolves.toEqual({ stopReason: "cancelled" });
		});

		it("cancels every concurrent prompt for the session", async () => {
			const pending: Array<{
				signal?: AbortSignal;
				resolve: (value: { stopReason: "cancelled" }) => void;
			}> = [];
			const request = mock(
				(
					_method: string,
					_params: unknown,
					options?: { cancellationSignal?: AbortSignal },
				) =>
					new Promise<{ stopReason: "cancelled" }>((resolve) => {
						pending.push({ signal: options?.cancellationSignal, resolve });
					}),
			);
			const notify = mock(() => Promise.resolve());
			const internal = connection as unknown as {
				state: "ready";
				connection: {
					agent: {
						request: typeof request;
						notify: typeof notify;
					};
				};
			};
			internal.state = "ready";
			internal.connection = { agent: { request, notify } };

			const first = connection.prompt("session-1", [
				{ type: "text", text: "first" },
			]);
			const second = connection.prompt("session-1", [
				{ type: "text", text: "second" },
			]);
			await Promise.resolve();

			await connection.cancel("session-1");

			expect(pending).toHaveLength(2);
			expect(pending.every(({ signal }) => signal?.aborted)).toBe(true);
			for (const item of pending) {
				item.resolve({ stopReason: "cancelled" });
			}
			await expect(Promise.all([first, second])).resolves.toEqual([
				{ stopReason: "cancelled" },
				{ stopReason: "cancelled" },
			]);
		});
	});

	describe("setSessionConfigOption", () => {
		it("sends select and boolean values with their protocol-specific shapes", async () => {
			const request = mock((_method: string, _params: unknown) =>
				Promise.resolve({ configOptions: [] }),
			);
			const internal = connection as unknown as {
				state: "ready";
				connection: {
					agent: {
						request: typeof request;
					};
				};
			};
			internal.state = "ready";
			internal.connection = { agent: { request } };

			await connection.setSessionConfigOption(
				"session-1",
				"reasoning",
				"deep",
				{ requestSource: "webui" },
			);
			await connection.setSessionConfigOption(
				"session-1",
				"auto-approve",
				true,
				null,
			);

			expect(request.mock.calls[0]).toEqual([
				"session/set_config_option",
				{
					sessionId: "session-1",
					configId: "reasoning",
					value: "deep",
					_meta: { requestSource: "webui" },
				},
			]);
			expect(request.mock.calls[1]).toEqual([
				"session/set_config_option",
				{
					sessionId: "session-1",
					configId: "auto-approve",
					type: "boolean",
					value: true,
					_meta: null,
				},
			]);
		});
	});

	describe("getStatus", () => {
		it("returns backend info in status", () => {
			const status = connection.getStatus();

			expect(status.backendId).toBe("test-backend");
			expect(status.backendLabel).toBe("Test Backend");
			expect(status.command).toBe("test-command");
			expect(status.args).toEqual(["--arg1"]);
			expect(status.state).toBe("idle");
		});
	});
});
