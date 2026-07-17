import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import {
	chmod,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Mock the SDK
mock.module("@agentclientprotocol/sdk", () => ({
	client: mock(() => {}),
	methods: {
		agent: {
			initialize: "initialize",
			session: {
				cancel: "session/cancel",
				close: "session/close",
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
			fs: {
				readTextFile: "fs/read_text_file",
				writeTextFile: "fs/write_text_file",
			},
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
	ACP_FILE_SYSTEM_CAPABILITIES,
	AcpConnection,
	MAX_ACP_FILE_BYTES,
	MAX_ACP_FILE_LINES,
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
	let temporaryDirectories: string[];

	beforeEach(() => {
		temporaryDirectories = [];
		mockBackend = createMockBackendConfig();
		connection = new AcpConnection({
			backend: mockBackend,
			client: { name: "test-client", version: "1.0.0" },
		});
	});

	afterEach(async () => {
		await Promise.all(
			temporaryDirectories.map((directory) =>
				rm(directory, { force: true, recursive: true }),
			),
		);
	});

	const createFileSystemWorkspace = async () => {
		const container = await mkdtemp(path.join(tmpdir(), "mobvibe-acp-fs-"));
		temporaryDirectories.push(container);
		const root = path.join(container, "root");
		const additionalRoot = path.join(container, "additional");
		const outside = path.join(container, "outside");
		await Promise.all([mkdir(root), mkdir(additionalRoot), mkdir(outside)]);
		return { additionalRoot, outside, root };
	};

	const bindFileSystemSession = async (
		root: string,
		additionalDirectories: string[] = [],
		sessionId = "session-fs",
	) => {
		const request = mock(() => Promise.resolve({ sessionId }));
		const internal = connection as unknown as {
			state: "ready";
			agentCapabilities: {
				sessionCapabilities?: {
					additionalDirectories: Record<string, never>;
				};
			};
			connection: { agent: { request: typeof request } };
		};
		internal.state = "ready";
		internal.agentCapabilities =
			additionalDirectories.length > 0
				? { sessionCapabilities: { additionalDirectories: {} } }
				: {};
		internal.connection = { agent: { request } };
		await connection.createSession({
			cwd: root,
			additionalDirectories,
		});
	};

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

		it("maps the close session capability", () => {
			// @ts-expect-error - accessing private property for testing
			connection.agentCapabilities = {
				sessionCapabilities: { close: {} },
			};

			expect(connection.getSessionCapabilities().close).toBe(true);
			expect(connection.supportsSessionClose()).toBe(true);
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

	describe("file system methods", () => {
		it("advertises both file system methods as a complete capability", () => {
			expect(ACP_FILE_SYSTEM_CAPABILITIES).toEqual({
				readTextFile: true,
				writeTextFile: true,
			});
		});

		it("rejects requests for a session other than the active session", async () => {
			const { root } = await createFileSystemWorkspace();
			const filePath = path.join(root, "message.txt");
			await writeFile(filePath, "hello", "utf8");
			await bindFileSystemSession(root);

			await expect(
				connection.readTextFile({
					sessionId: "different-session",
					path: filePath,
				}),
			).rejects.toThrow("does not match the active session");
			await expect(
				connection.writeTextFile({
					sessionId: "different-session",
					path: filePath,
					content: "changed",
				}),
			).rejects.toThrow("does not match the active session");
		});

		it("requires native absolute paths and rejects traversal outside roots", async () => {
			const { outside, root } = await createFileSystemWorkspace();
			const outsideFile = path.join(outside, "secret.txt");
			await writeFile(outsideFile, "secret", "utf8");
			await bindFileSystemSession(root);

			await expect(
				connection.readTextFile({
					sessionId: "session-fs",
					path: "relative.txt",
				}),
			).rejects.toThrow("must be absolute");

			const traversalPath = `${root}${path.sep}..${path.sep}outside${path.sep}secret.txt`;
			await expect(
				connection.readTextFile({
					sessionId: "session-fs",
					path: traversalPath,
				}),
			).rejects.toThrow("outside the active session roots");
			await expect(
				connection.writeTextFile({
					sessionId: "session-fs",
					path: traversalPath,
					content: "changed",
				}),
			).rejects.toThrow("outside the active session roots");
			expect(await readFile(outsideFile, "utf8")).toBe("secret");
		});

		it("prevents read and write escapes through symbolic links", async () => {
			const { outside, root } = await createFileSystemWorkspace();
			const outsideFile = path.join(outside, "secret.txt");
			const linkPath = path.join(root, "linked.txt");
			const directoryLink = path.join(root, "linked-directory");
			await writeFile(outsideFile, "secret", "utf8");
			await symlink(outsideFile, linkPath);
			await symlink(
				outside,
				directoryLink,
				process.platform === "win32" ? "junction" : "dir",
			);
			await bindFileSystemSession(root);

			await expect(
				connection.readTextFile({
					sessionId: "session-fs",
					path: linkPath,
				}),
			).rejects.toThrow("outside the active session roots");
			await expect(
				connection.writeTextFile({
					sessionId: "session-fs",
					path: linkPath,
					content: "changed",
				}),
			).rejects.toThrow("symbolic links");
			await expect(
				connection.readTextFile({
					sessionId: "session-fs",
					path: path.join(directoryLink, "secret.txt"),
				}),
			).rejects.toThrow("outside the active session roots");
			await expect(
				connection.writeTextFile({
					sessionId: "session-fs",
					path: path.join(directoryLink, "created.txt"),
					content: "created",
				}),
			).rejects.toThrow("outside the active session roots");
			expect(await readFile(outsideFile, "utf8")).toBe("secret");
			await expect(
				readFile(path.join(outside, "created.txt"), "utf8"),
			).rejects.toThrow();
		});

		it("does not return or write through an in-flight session switch", async () => {
			const { additionalRoot, root } = await createFileSystemWorkspace();
			const readPath = path.join(root, "read.txt");
			const writePath = path.join(root, "write.txt");
			await writeFile(readPath, "old session data", "utf8");
			await writeFile(writePath, "before", "utf8");
			await bindFileSystemSession(root);

			type FileSystemSessionForTest = {
				sessionId: string;
				roots: string[];
				canonicalRoots?: Promise<string[]>;
			};
			const internal = connection as unknown as {
				resolveCanonicalRoots: (
					session: FileSystemSessionForTest,
					signal?: AbortSignal,
				) => Promise<string[]>;
			};
			const originalResolve = internal.resolveCanonicalRoots.bind(connection);
			let releaseRequests = () => {};
			const requestGate = new Promise<void>((resolve) => {
				releaseRequests = resolve;
			});
			let markBothWaiting = () => {};
			const bothWaiting = new Promise<void>((resolve) => {
				markBothWaiting = resolve;
			});
			let waitingCount = 0;
			internal.resolveCanonicalRoots = async (session, signal) => {
				const roots = await originalResolve(session, signal);
				waitingCount += 1;
				if (waitingCount === 2) {
					markBothWaiting();
				}
				await requestGate;
				return roots;
			};

			const outcomesPromise = Promise.allSettled([
				connection.readTextFile({
					sessionId: "session-fs",
					path: readPath,
				}),
				connection.writeTextFile({
					sessionId: "session-fs",
					path: writePath,
					content: "after",
				}),
			]);
			await bothWaiting;
			await bindFileSystemSession(additionalRoot, [], "session-next");
			releaseRequests();

			const outcomes = await outcomesPromise;
			expect(outcomes.every((outcome) => outcome.status === "rejected")).toBe(
				true,
			);
			for (const outcome of outcomes) {
				if (outcome.status === "rejected") {
					expect(String(outcome.reason)).toContain(
						"no longer belongs to the active session",
					);
				}
			}
			expect(await readFile(writePath, "utf8")).toBe("before");
			expect(
				(await readdir(root)).some((file) => file.endsWith(".mobvibe-tmp")),
			).toBe(false);
		});

		it("applies 1-based line slicing and enforces the line limit", async () => {
			const { root } = await createFileSystemWorkspace();
			const filePath = path.join(root, "lines.txt");
			await writeFile(filePath, "one\n二\nthree\nfour\n", "utf8");
			await bindFileSystemSession(root);

			await expect(
				connection.readTextFile({
					sessionId: "session-fs",
					path: filePath,
					line: 2,
					limit: 2,
				}),
			).resolves.toEqual({ content: "二\nthree" });
			await expect(
				connection.readTextFile({
					sessionId: "session-fs",
					path: filePath,
					limit: MAX_ACP_FILE_LINES + 1,
				}),
			).rejects.toThrow(`${MAX_ACP_FILE_LINES} lines`);
		});

		it("rejects oversized reads, invalid UTF-8, and oversized writes", async () => {
			const { root } = await createFileSystemWorkspace();
			const oversizedPath = path.join(root, "oversized.txt");
			const invalidUtf8Path = path.join(root, "invalid.txt");
			const bomPath = path.join(root, "bom.txt");
			await writeFile(oversizedPath, Buffer.alloc(MAX_ACP_FILE_BYTES + 1, 97));
			await writeFile(invalidUtf8Path, Buffer.from([0xff]));
			await writeFile(bomPath, "\ufeffhello", "utf8");
			await bindFileSystemSession(root);

			await expect(
				connection.readTextFile({
					sessionId: "session-fs",
					path: oversizedPath,
				}),
			).rejects.toThrow(`${MAX_ACP_FILE_BYTES} bytes`);
			await expect(
				connection.readTextFile({
					sessionId: "session-fs",
					path: invalidUtf8Path,
				}),
			).rejects.toThrow("valid UTF-8");
			await expect(
				connection.readTextFile({
					sessionId: "session-fs",
					path: bomPath,
				}),
			).resolves.toEqual({ content: "\ufeffhello" });
			await expect(
				connection.writeTextFile({
					sessionId: "session-fs",
					path: path.join(root, "new.txt"),
					content: "a".repeat(MAX_ACP_FILE_BYTES + 1),
				}),
			).rejects.toThrow(`${MAX_ACP_FILE_BYTES} bytes`);
			await expect(
				connection.writeTextFile({
					sessionId: "session-fs",
					path: path.join(root, "invalid-write.txt"),
					content: "\ud800",
				}),
			).rejects.toThrow("valid Unicode text");
		});

		it("writes atomically inside cwd and additional directory roots", async () => {
			const { additionalRoot, root } = await createFileSystemWorkspace();
			const existingPath = path.join(root, "existing.txt");
			const additionalPath = path.join(additionalRoot, "created.txt");
			await writeFile(existingPath, "before", "utf8");
			await chmod(existingPath, 0o600);
			await bindFileSystemSession(root, [additionalRoot]);

			await connection.writeTextFile({
				sessionId: "session-fs",
				path: existingPath,
				content: "after",
			});
			await connection.writeTextFile({
				sessionId: "session-fs",
				path: additionalPath,
				content: "\ufeffcreated",
			});

			expect(await readFile(existingPath, "utf8")).toBe("after");
			expect((await stat(existingPath)).mode & 0o777).toBe(0o600);
			expect(await readFile(additionalPath, "utf8")).toBe("\ufeffcreated");
			expect((await stat(additionalPath)).mode & 0o777).toBe(
				0o666 & ~process.umask(),
			);
			const remainingFiles = [
				...(await readdir(root)),
				...(await readdir(additionalRoot)),
			];
			expect(remainingFiles.some((file) => file.endsWith(".mobvibe-tmp"))).toBe(
				false,
			);
		});

		it("honors an already cancelled file request", async () => {
			const { root } = await createFileSystemWorkspace();
			const filePath = path.join(root, "message.txt");
			await writeFile(filePath, "hello", "utf8");
			await bindFileSystemSession(root);
			const controller = new AbortController();
			controller.abort();

			await expect(
				connection.readTextFile(
					{ sessionId: "session-fs", path: filePath },
					controller.signal,
				),
			).rejects.toThrow("cancelled");
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

	describe("closeSession", () => {
		it("rejects when the agent does not advertise close", async () => {
			await expect(connection.closeSession("session-1")).rejects.toThrow(
				"Agent does not support session/close capability",
			);
		});

		it("sends session/close after capability negotiation", async () => {
			const request = mock(() => Promise.resolve({}));
			const internal = connection as unknown as {
				state: "ready";
				sessionId: string;
				agentCapabilities: {
					sessionCapabilities: { close: Record<string, never> };
				};
				connection: { agent: { request: typeof request } };
			};
			internal.state = "ready";
			internal.sessionId = "session-1";
			internal.agentCapabilities = { sessionCapabilities: { close: {} } };
			internal.connection = { agent: { request } };

			await connection.closeSession("session-1");

			expect(request).toHaveBeenCalledWith("session/close", {
				sessionId: "session-1",
			});
			expect(connection.getStatus().sessionId).toBeUndefined();
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
