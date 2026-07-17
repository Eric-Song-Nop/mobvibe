import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, it, mock } from "bun:test";
import type {
	JsonRpcId,
	NewSessionResponse,
	RequestPermissionRequest,
	RequestPermissionResponse,
	SessionNotification,
} from "@agentclientprotocol/sdk";
import {
	decryptPayload,
	deriveContentKeyPair,
	generateMasterSecret,
	initCrypto,
	isEncryptedPayload,
	unwrapDEK,
} from "@mobvibe/shared";
import type { CliConfig } from "../../config.js";
import { CliCryptoService } from "../../e2ee/crypto-service.js";
import { WalStore } from "../../wal/wal-store.js";
import type { AcpConnection } from "../acp-connection.js";
import type { SessionManagerDependencies } from "../session-manager.js";

// Mock the logger
mock.module("../../lib/logger.js", () => ({
	logger: {
		info: mock(() => {}),
		debug: mock(() => {}),
		warn: mock(() => {}),
		error: mock(() => {}),
	},
}));

const mockIsGitRepo = mock(() => Promise.resolve(true));
const mockCreateGitWorktree = mock(
	(
		_cwd: string,
		opts: { branch: string; targetPath: string; baseBranch?: string },
	) =>
		Promise.resolve({
			path: opts.targetPath,
			branch: opts.branch,
		}),
);
const mockResolveGitProjectContext = mock((cwd: string) =>
	Promise.resolve({
		isGitRepo: true,
		repoRoot: cwd.startsWith("/home/user/project")
			? "/home/user/project"
			: cwd.startsWith("/home/user/project1")
				? "/home/user/project1"
				: cwd.startsWith("/home/user/project2")
					? "/home/user/project2"
					: cwd,
		repoName: cwd.split("/").filter(Boolean).at(-1) ?? "project",
		relativeCwd: undefined as string | undefined,
		isRepoRoot: true,
	}),
);

// Dynamic import so that the logger mock above is registered first.
const { SessionManager: BaseSessionManager } = await import(
	"../session-manager.js"
);

const gitDependencies = {
	createGitWorktree: mockCreateGitWorktree,
	isGitRepo: mockIsGitRepo,
	resolveGitProjectContext: mockResolveGitProjectContext,
} satisfies SessionManagerDependencies;

class SessionManager extends BaseSessionManager {
	constructor(
		config: CliConfig,
		cryptoService?: CliCryptoService,
		dependencies?: SessionManagerDependencies,
	) {
		super(config, cryptoService, {
			...gitDependencies,
			...dependencies,
		});
	}
}

/**
 * Captured callback from `onSessionUpdate`.
 * Allows tests to trigger session update notifications.
 */
let sessionUpdateCallback:
	| ((notification: SessionNotification) => void)
	| undefined;
let statusChangeCallback: ((status: { error?: unknown }) => void) | undefined;
let terminalOutputCallback: ((event: unknown) => void) | undefined;
let permissionHandlerCallback:
	| ((
			params: RequestPermissionRequest,
			requestId: JsonRpcId,
			signal: AbortSignal,
	  ) => Promise<RequestPermissionResponse>)
	| undefined;

const createMockConnection = () => ({
	connect: mock(() => Promise.resolve(undefined)),
	disconnect: mock(() => Promise.resolve(undefined)),
	createSession: mock(
		(): Promise<NewSessionResponse> =>
			Promise.resolve({
				sessionId: "new-session-1",
				modes: null,
				configOptions: null,
			}),
	),
	getStatus: mock(() => ({
		backendId: "backend-1",
		backendLabel: "Claude Code",
		state: "ready",
		command: "claude-code",
		args: [],
		pid: 12345,
	})),
	getAgentInfo: mock(() => ({
		name: "claude-code",
		title: "Claude Code",
	})),
	getSessionCapabilities: mock(() => ({
		list: true,
		load: true,
	})),
	supportsSessionList: mock(() => true),
	supportsSessionLoad: mock(() => true),
	listSessions: mock(() =>
		Promise.resolve({
			sessions: [
				{
					sessionId: "discovered-1",
					cwd: "/home/user/project1",
					title: "Project 1",
					updatedAt: new Date().toISOString(),
				},
				{
					sessionId: "discovered-2",
					cwd: "/home/user/project2",
					title: "Project 2",
				},
			],
			nextCursor: undefined,
		}),
	),
	loadSession: mock(() =>
		Promise.resolve({
			modes: null,
			configOptions: null,
		}),
	),
	setSessionModel: mock(
		(_sessionId: string, configId: string, modelId: string) =>
			Promise.resolve({
				configOptions: [
					{
						id: configId,
						name: "Model",
						category: "model",
						type: "select" as const,
						currentValue: modelId,
						options: [
							{ value: "fast", name: "Fast" },
							{ value: "smart", name: "Smart" },
						],
					},
				],
			}),
	),
	setPermissionHandler: mock(
		(
			handler?: (
				params: RequestPermissionRequest,
				requestId: JsonRpcId,
				signal: AbortSignal,
			) => Promise<RequestPermissionResponse>,
		) => {
			permissionHandlerCallback = handler;
		},
	),
	onSessionUpdate: mock((cb: (n: SessionNotification) => void) => {
		sessionUpdateCallback = cb;
		return () => {
			sessionUpdateCallback = undefined;
		};
	}),
	onTerminalOutput: mock((cb: (event: unknown) => void) => {
		terminalOutputCallback = cb;
		return () => {
			terminalOutputCallback = undefined;
		};
	}),
	onStatusChange: mock((cb: (status: { error?: unknown }) => void) => {
		statusChangeCallback = cb;
		return () => {
			statusChangeCallback = undefined;
		};
	}),
});

const createMockConfig = (): CliConfig => ({
	gatewayUrl: "http://localhost:3005",
	clientName: "test-client",
	clientVersion: "1.0.0",
	acpBackends: [
		{
			id: "backend-1",
			label: "Claude Code",
			command: "claude-code",
			args: [],
		},
	],
	registryAgents: [],
	detectedBackends: [],
	registrySource: "fresh-cache",
	homePath: "/tmp/mobvibe-test",
	logPath: "/tmp/mobvibe-test/logs",
	pidFile: "/tmp/mobvibe-test/daemon.pid",
	walDbPath: "/tmp/mobvibe-test/events.db",
	machineId: "test-machine-id",
	hostname: "test-host",
	platform: "linux",
	compaction: {
		enabled: false,
		ackedEventRetentionDays: 7,
		keepLatestRevisionsCount: 2,
		runOnStartup: false,
		runIntervalHours: 24,
		minEventsToKeep: 1000,
	},
	consolidation: {
		enabled: false,
	},
	worktreeBaseDir: "/tmp/mobvibe-test/worktrees",
});

describe("SessionManager", () => {
	let sessionManager: InstanceType<typeof SessionManager>;
	let mockConfig: CliConfig;
	let mockConnection: ReturnType<typeof createMockConnection>;

	beforeEach(() => {
		mockConfig = createMockConfig();
		mockConfig.walDbPath = `/tmp/mobvibe-test/events-${Date.now()}-${Math.random()
			.toString(36)
			.slice(2)}.db`;
		sessionManager = new SessionManager(mockConfig, undefined, {
			validateWorkspacePath: async () => true,
		});
		mockConnection = createMockConnection();
		sessionUpdateCallback = undefined;
		statusChangeCallback = undefined;
		terminalOutputCallback = undefined;
		permissionHandlerCallback = undefined;
		mockIsGitRepo.mockClear();
		mockCreateGitWorktree.mockClear();
		mockResolveGitProjectContext.mockClear();
		sessionManager.createConnection = () =>
			mockConnection as unknown as AcpConnection;
	});

	describe("discoverSessions", () => {
		it("discovers sessions from agent", async () => {
			const result = await sessionManager.discoverSessions({
				backendId: "backend-1",
			});

			expect(result.sessions).toHaveLength(2);
			expect(result.sessions[0].sessionId).toBe("discovered-1");
			expect(result.sessions[0].cwd).toBe("/home/user/project1");
			expect(result.sessions[0].title).toBe("Project 1");
			expect(result.sessions[1].sessionId).toBe("discovered-2");
			expect(result.capabilities.list).toBe(true);
			expect(result.capabilities.load).toBe(true);
		});

		it("discovers sessions with cwd filter", async () => {
			const result = await sessionManager.discoverSessions({
				backendId: "backend-1",
				cwd: "/home/user/project1",
			});

			expect(result.sessions).toHaveLength(2);
			// The mock doesn't filter, but we verify the parameter is passed
		});

		it("discovers sessions with specific backend", async () => {
			const result = await sessionManager.discoverSessions({
				backendId: "backend-1",
			});

			expect(result.sessions).toHaveLength(2);
		});

		it("throws error for invalid backend", async () => {
			await expect(
				sessionManager.discoverSessions({ backendId: "invalid-backend" }),
			).rejects.toThrow("Invalid backend ID");
		});
	});

	describe("loadSession", () => {
		const getWalStore = () =>
			(
				sessionManager as unknown as {
					walStore: WalStore;
				}
			).walStore;

		it("preserves the current WAL revision when loading fails", async () => {
			const created = await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});
			sessionUpdateCallback?.({
				sessionId: created.sessionId,
				update: {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "durable history" },
				},
			} as SessionNotification);
			await sessionManager.closeSession(created.sessionId);

			const historyBefore = sessionManager.getSessionEvents({
				sessionId: created.sessionId,
				revision: 1,
				afterSeq: 0,
			});
			expect(historyBefore.events).toHaveLength(1);
			mockConnection.loadSession.mockRejectedValueOnce(
				new Error("load failed"),
			);

			await expect(
				sessionManager.loadSession(
					created.sessionId,
					"/home/user/project",
					"backend-1",
				),
			).rejects.toThrow("load failed");

			expect(
				sessionManager.getSessionEvents({
					sessionId: created.sessionId,
					revision: 1,
					afterSeq: 0,
				}).events,
			).toEqual(historyBefore.events);
		});

		it("unsubscribes buffered updates when loading fails", async () => {
			mockConnection.loadSession.mockRejectedValueOnce(
				new Error("load failed"),
			);

			await expect(
				sessionManager.loadSession(
					"session-to-load",
					"/home/user/project",
					"backend-1",
				),
			).rejects.toThrow("load failed");

			expect(sessionUpdateCallback).toBeUndefined();
		});

		it("rejects an unattached load whose replay exceeds the event budget without advancing WAL", async () => {
			const created = await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});
			sessionUpdateCallback?.({
				sessionId: created.sessionId,
				update: {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "durable history" },
				},
			} as SessionNotification);
			await sessionManager.closeSession(created.sessionId);
			mockConnection.loadSession.mockImplementationOnce(async () => {
				for (let index = 0; index <= 20_000; index += 1) {
					sessionUpdateCallback?.({
						sessionId: created.sessionId,
						update: {
							sessionUpdate: "agent_message_chunk",
							content: { type: "text", text: `replay ${index}` },
						},
					} as SessionNotification);
				}
				return { modes: null, configOptions: null };
			});

			await expect(
				sessionManager.loadSession(
					created.sessionId,
					"/home/user/project",
					"backend-1",
				),
			).rejects.toThrow("Reload replay exceeds local buffer limit");

			expect(getWalStore().getSession(created.sessionId)?.currentRevision).toBe(
				1,
			);
			expect(
				sessionManager.getSessionEvents({
					sessionId: created.sessionId,
					revision: 2,
					afterSeq: 0,
				}).events,
			).toHaveLength(0);
			expect(sessionManager.getSession(created.sessionId)).toBeUndefined();
			expect(mockConnection.disconnect).toHaveBeenCalled();
		});

		it("rejects an unattached load whose replay exceeds the byte budget without advancing WAL", async () => {
			const created = await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});
			sessionUpdateCallback?.({
				sessionId: created.sessionId,
				update: {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "durable history" },
				},
			} as SessionNotification);
			await sessionManager.closeSession(created.sessionId);
			mockConnection.loadSession.mockImplementationOnce(async () => {
				sessionUpdateCallback?.({
					sessionId: created.sessionId,
					update: {
						sessionUpdate: "agent_message_chunk",
						content: { type: "text", text: "x".repeat(8 * 1024 * 1024) },
					},
				} as SessionNotification);
				return { modes: null, configOptions: null };
			});

			await expect(
				sessionManager.loadSession(
					created.sessionId,
					"/home/user/project",
					"backend-1",
				),
			).rejects.toThrow("Reload replay exceeds local buffer limit");

			expect(getWalStore().getSession(created.sessionId)?.currentRevision).toBe(
				1,
			);
			expect(
				sessionManager.getSessionEvents({
					sessionId: created.sessionId,
					revision: 2,
					afterSeq: 0,
				}).events,
			).toHaveLength(0);
			expect(sessionManager.getSession(created.sessionId)).toBeUndefined();
			expect(mockConnection.disconnect).toHaveBeenCalled();
		});

		it("does not expose a partial revision when a later replay event cannot be serialized", async () => {
			const created = await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});
			sessionUpdateCallback?.({
				sessionId: created.sessionId,
				update: {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "durable history" },
				},
			} as SessionNotification);
			await sessionManager.closeSession(created.sessionId);
			mockConnection.loadSession.mockImplementationOnce(async () => {
				sessionUpdateCallback?.({
					sessionId: created.sessionId,
					update: {
						sessionUpdate: "agent_message_chunk",
						content: { type: "text", text: "first replay event" },
					},
				} as SessionNotification);
				const cyclicNotification = {
					sessionId: created.sessionId,
					update: {
						sessionUpdate: "agent_message_chunk",
						content: { type: "text", text: "second replay event" },
					},
				} as SessionNotification & { cyclic?: unknown };
				cyclicNotification.cyclic = cyclicNotification;
				sessionUpdateCallback?.(cyclicNotification);
				return { modes: null, configOptions: null };
			});

			await expect(
				sessionManager.loadSession(
					created.sessionId,
					"/home/user/project",
					"backend-1",
				),
			).rejects.toThrow();

			expect(getWalStore().getSession(created.sessionId)?.currentRevision).toBe(
				1,
			);
			expect(
				sessionManager.getSessionEvents({
					sessionId: created.sessionId,
					revision: 2,
					afterSeq: 0,
				}).events,
			).toHaveLength(0);
			expect(sessionManager.getSession(created.sessionId)).toBeUndefined();
		});

		it("rolls back the whole unattached replay when a later WAL insert fails", async () => {
			const created = await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});
			sessionUpdateCallback?.({
				sessionId: created.sessionId,
				update: {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "durable history" },
				},
			} as SessionNotification);
			await sessionManager.closeSession(created.sessionId);
			mockConnection.loadSession.mockImplementationOnce(async () => {
				for (const text of ["first replay event", "second replay event"]) {
					sessionUpdateCallback?.({
						sessionId: created.sessionId,
						update: {
							sessionUpdate: "agent_message_chunk",
							content: { type: "text", text },
						},
					} as SessionNotification);
				}
				return { modes: null, configOptions: null };
			});
			const faultDb = new Database(mockConfig.walDbPath);
			faultDb.exec(`
				CREATE TRIGGER fail_second_unattached_load_event
				BEFORE INSERT ON session_events
				WHEN NEW.session_id = '${created.sessionId}' AND NEW.revision = 2 AND NEW.seq = 2
				BEGIN
					SELECT RAISE(ABORT, 'injected unattached replay failure');
				END;
			`);
			faultDb.close();

			await expect(
				sessionManager.loadSession(
					created.sessionId,
					"/home/user/project",
					"backend-1",
				),
			).rejects.toThrow("injected unattached replay failure");

			expect(getWalStore().getSession(created.sessionId)?.currentRevision).toBe(
				1,
			);
			expect(
				sessionManager.getSessionEvents({
					sessionId: created.sessionId,
					revision: 2,
					afterSeq: 0,
				}).events,
			).toHaveLength(0);
			expect(sessionManager.getSession(created.sessionId)).toBeUndefined();
		});

		it("commits a fresh unattached replay to revision one", async () => {
			mockConnection.loadSession.mockImplementationOnce(async () => {
				sessionUpdateCallback?.({
					sessionId: "fresh-session",
					update: {
						sessionUpdate: "agent_message_chunk",
						content: { type: "text", text: "fresh replay" },
					},
				} as SessionNotification);
				return { modes: null, configOptions: null };
			});

			await sessionManager.loadSession(
				"fresh-session",
				"/home/user/project",
				"backend-1",
			);

			expect(getWalStore().getSession("fresh-session")?.currentRevision).toBe(
				1,
			);
			expect(
				sessionManager.getSessionEvents({
					sessionId: "fresh-session",
					revision: 1,
					afterSeq: 0,
				}).events,
			).toEqual([
				expect.objectContaining({
					revision: 1,
					seq: 1,
					payload: expect.objectContaining({
						update: expect.objectContaining({
							content: { type: "text", text: "fresh replay" },
						}),
					}),
				}),
			]);
		});

		it("does not expose a fresh session or revision key when its replay commit fails", async () => {
			await initCrypto();
			await sessionManager.shutdown();
			sessionManager = new SessionManager(
				mockConfig,
				new CliCryptoService(generateMasterSecret()),
			);
			sessionManager.createConnection = () =>
				mockConnection as unknown as AcpConnection;
			mockConnection.loadSession.mockImplementationOnce(async () => {
				for (const text of ["first replay event", "second replay event"]) {
					sessionUpdateCallback?.({
						sessionId: "fresh-failing-session",
						update: {
							sessionUpdate: "agent_message_chunk",
							content: { type: "text", text },
						},
					} as SessionNotification);
				}
				return { modes: null, configOptions: null };
			});
			const faultDb = new Database(mockConfig.walDbPath);
			faultDb.exec(`
				CREATE TRIGGER fail_fresh_session_second_event
				BEFORE INSERT ON session_events
				WHEN NEW.session_id = 'fresh-failing-session' AND NEW.revision = 1 AND NEW.seq = 2
				BEGIN
					SELECT RAISE(ABORT, 'injected fresh replay failure');
				END;
			`);
			faultDb.close();

			await expect(
				sessionManager.loadSession(
					"fresh-failing-session",
					"/home/user/project",
					"backend-1",
				),
			).rejects.toThrow("injected fresh replay failure");

			expect(getWalStore().getSession("fresh-failing-session")).toBeNull();
			expect(
				getWalStore().getSessionRevisionKey("fresh-failing-session", 1),
			).toBeUndefined();
			expect(
				sessionManager
					.listAllSessions()
					.find((session) => session.sessionId === "fresh-failing-session"),
			).toBeUndefined();
			expect(
				sessionManager.getSession("fresh-failing-session"),
			).toBeUndefined();
		});

		it("loads a historical session", async () => {
			const result = await sessionManager.loadSession(
				"session-to-load",
				"/home/user/project",
				"backend-1",
			);

			expect(result.sessionId).toBe("session-to-load");
			expect(result.title).toBe("session-to-load");
			expect(result.cwd).toBe("/home/user/project");
			expect(result.sessionId).toBeDefined();
		});

		it("returns existing session if already loaded", async () => {
			// First, create a session
			const created = await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});

			// Try to load the same session
			const loaded = await sessionManager.loadSession(
				created.sessionId,
				"/home/user/project",
				"backend-1",
			);

			expect(loaded.sessionId).toBe(created.sessionId);
		});

		it("emits sessions:changed event when session loaded", async () => {
			const changedListener = mock(() => {});
			sessionManager.onSessionsChanged(changedListener);

			await sessionManager.loadSession(
				"session-to-load",
				"/home/user/project",
				"backend-1",
			);

			expect(changedListener).toHaveBeenCalledWith(
				expect.objectContaining({
					added: expect.arrayContaining([
						expect.objectContaining({ sessionId: "session-to-load" }),
					]),
					updated: [],
					removed: [],
				}),
			);
		});

		it("emits session:attached event when loading already-loaded session", async () => {
			const attachedListener = mock(() => {});
			sessionManager.onSessionAttached(attachedListener);

			// First load
			await sessionManager.loadSession(
				"test-session",
				"/home/user/project",
				"backend-1",
			);
			expect(attachedListener).toHaveBeenCalledTimes(1);

			// Second load (same session) - should still emit due to force flag
			await sessionManager.loadSession(
				"test-session",
				"/home/user/project",
				"backend-1",
			);
			expect(attachedListener).toHaveBeenCalledTimes(2);
		});

		it("never revives an archived session through load or reload", async () => {
			const created = await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});
			await sessionManager.archiveSession(created.sessionId);
			mockConnection.loadSession.mockClear();

			await expect(
				sessionManager.loadSession(
					created.sessionId,
					"/home/user/project",
					"backend-1",
				),
			).rejects.toMatchObject({
				detail: expect.objectContaining({ code: "SESSION_NOT_FOUND" }),
			});
			await expect(
				sessionManager.reloadSession(
					created.sessionId,
					"/home/user/project",
					"backend-1",
				),
			).rejects.toMatchObject({
				detail: expect.objectContaining({ code: "SESSION_NOT_FOUND" }),
			});

			expect(mockConnection.loadSession).not.toHaveBeenCalled();
			expect(sessionManager.getSession(created.sessionId)).toBeUndefined();
			const walStore = (
				sessionManager as unknown as {
					walStore: {
						getSession: (sessionId: string) => unknown;
						isArchived: (sessionId: string) => boolean;
					};
				}
			).walStore;
			expect(walStore.getSession(created.sessionId)).toBeNull();
			expect(walStore.isArchived(created.sessionId)).toBe(true);
		});
	});

	describe("reloadSession", () => {
		it("buffers terminal and status events into the successful reload revision", async () => {
			const created = await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});
			mockConnection.loadSession.mockImplementationOnce(async () => {
				terminalOutputCallback?.({ stream: "stdout", data: "replayed output" });
				statusChangeCallback?.({ error: { message: "replayed failure" } });
				return { modes: null, configOptions: null };
			});

			await sessionManager.reloadSession(
				created.sessionId,
				"/home/user/project",
				"backend-1",
			);

			expect(
				sessionManager.getSessionEvents({
					sessionId: created.sessionId,
					revision: 1,
					afterSeq: 0,
				}).events,
			).toHaveLength(0);
			expect(
				sessionManager
					.getSessionEvents({
						sessionId: created.sessionId,
						revision: 2,
						afterSeq: 0,
					})
					.events.map((event) => event.kind),
			).toEqual(["terminal_output", "session_error"]);
		});

		it("serializes concurrent reloads and preserves each replay revision", async () => {
			const created = await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});
			let resolveFirstReload:
				| ((value: { modes: null; configOptions: null }) => void)
				| undefined;
			let resolveSecondReload:
				| ((value: { modes: null; configOptions: null }) => void)
				| undefined;
			let loadCount = 0;
			mockConnection.loadSession.mockImplementation(() => {
				loadCount += 1;
				sessionUpdateCallback?.({
					sessionId: created.sessionId,
					update: {
						sessionUpdate: "agent_message_chunk",
						content: { type: "text", text: `reload ${loadCount}` },
					},
				} as SessionNotification);
				if (loadCount === 1) {
					return new Promise<{ modes: null; configOptions: null }>(
						(resolve) => {
							resolveFirstReload = resolve;
						},
					);
				}
				return new Promise<{ modes: null; configOptions: null }>((resolve) => {
					resolveSecondReload = resolve;
				});
			});

			const first = sessionManager.reloadSession(
				created.sessionId,
				"/home/user/project",
				"backend-1",
			);
			const second = sessionManager.reloadSession(
				created.sessionId,
				"/home/user/project",
				"backend-1",
			);
			await Promise.resolve();

			expect(mockConnection.loadSession).toHaveBeenCalledTimes(1);
			resolveFirstReload?.({ modes: null, configOptions: null });
			await first;
			await Promise.resolve();

			expect(mockConnection.loadSession).toHaveBeenCalledTimes(2);
			expect(
				sessionManager.getSessionEvents({
					sessionId: created.sessionId,
					revision: 2,
					afterSeq: 0,
				}).events,
			).toEqual([
				expect.objectContaining({
					payload: expect.objectContaining({
						update: expect.objectContaining({
							content: { type: "text", text: "reload 1" },
						}),
					}),
				}),
			]);

			resolveSecondReload?.({ modes: null, configOptions: null });
			await second;
			expect(
				sessionManager.getSessionEvents({
					sessionId: created.sessionId,
					revision: 3,
					afterSeq: 0,
				}).events,
			).toEqual([
				expect.objectContaining({
					payload: expect.objectContaining({
						update: expect.objectContaining({
							content: { type: "text", text: "reload 2" },
						}),
					}),
				}),
			]);
		});

		it("writes replay updates to the new revision after reload succeeds", async () => {
			const created = await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});
			sessionUpdateCallback?.({
				sessionId: created.sessionId,
				update: {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "revision one" },
				},
			} as SessionNotification);
			mockConnection.loadSession.mockImplementationOnce(async () => {
				sessionUpdateCallback?.({
					sessionId: created.sessionId,
					update: {
						sessionUpdate: "agent_message_chunk",
						content: { type: "text", text: "revision two" },
					},
				} as SessionNotification);
				return { modes: null, configOptions: null };
			});

			await sessionManager.reloadSession(
				created.sessionId,
				"/home/user/project",
				"backend-1",
			);

			expect(
				sessionManager.getSessionEvents({
					sessionId: created.sessionId,
					revision: 2,
					afterSeq: 0,
				}).events,
			).toEqual([
				expect.objectContaining({
					revision: 2,
					seq: 1,
					payload: expect.objectContaining({
						update: expect.objectContaining({
							content: { type: "text", text: "revision two" },
						}),
					}),
				}),
			]);
		});

		it("durably commits the full replay before emitting buffered events", async () => {
			const created = await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});
			mockConnection.loadSession.mockImplementationOnce(async () => {
				sessionUpdateCallback?.({
					sessionId: created.sessionId,
					update: {
						sessionUpdate: "agent_message_chunk",
						content: { type: "text", text: "first replay event" },
					},
				} as SessionNotification);
				terminalOutputCallback?.({
					stream: "stdout",
					data: "second replay event",
				});
				return { modes: null, configOptions: null };
			});
			sessionManager.onSessionEvent(() => {
				throw new Error("injected subscriber failure");
			});

			await sessionManager.reloadSession(
				created.sessionId,
				"/home/user/project",
				"backend-1",
			);

			expect(
				sessionManager
					.getSessionEvents({
						sessionId: created.sessionId,
						revision: 2,
						afterSeq: 0,
					})
					.events.map((event) => event.kind),
			).toEqual(["agent_message_chunk", "terminal_output"]);
		});

		it("closes the active session when the local replay commit fails", async () => {
			const created = await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});
			const lateUpdate = sessionUpdateCallback;
			mockConnection.loadSession.mockImplementationOnce(async () => {
				sessionUpdateCallback?.({
					sessionId: created.sessionId,
					update: {
						sessionUpdate: "agent_message_chunk",
						content: { type: "text", text: "uncommitted replay" },
					},
				} as SessionNotification);
				return { modes: null, configOptions: null };
			});
			const faultDb = new Database(mockConfig.walDbPath);
			faultDb.exec(`
				CREATE TRIGGER fail_session_reload_commit
				BEFORE INSERT ON session_events
				WHEN NEW.session_id = '${created.sessionId}' AND NEW.revision = 2
				BEGIN
					SELECT RAISE(ABORT, 'injected session reload commit failure');
				END;
			`);
			faultDb.close();

			await expect(
				sessionManager.reloadSession(
					created.sessionId,
					"/home/user/project",
					"backend-1",
				),
			).rejects.toThrow("injected session reload commit failure");

			expect(sessionManager.getSession(created.sessionId)).toBeUndefined();
			expect(mockConnection.disconnect).toHaveBeenCalled();
			expect(
				sessionManager.getSessionEvents({
					sessionId: created.sessionId,
					revision: 1,
					afterSeq: 0,
				}).events,
			).toHaveLength(0);

			lateUpdate?.({
				sessionId: created.sessionId,
				update: {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "late after failed commit" },
				},
			} as SessionNotification);
			expect(
				sessionManager.getSessionEvents({
					sessionId: created.sessionId,
					revision: 1,
					afterSeq: 0,
				}).events,
			).toHaveLength(0);
		});

		it("drops partial replay and closes an uncertain connection when reload fails", async () => {
			const created = await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});
			sessionUpdateCallback?.({
				sessionId: created.sessionId,
				update: {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "history before reload" },
				},
			} as SessionNotification);
			const historyBefore = sessionManager.getSessionEvents({
				sessionId: created.sessionId,
				revision: 1,
				afterSeq: 0,
			});
			mockConnection.loadSession.mockImplementationOnce(async () => {
				sessionUpdateCallback?.({
					sessionId: created.sessionId,
					update: {
						sessionUpdate: "agent_message_chunk",
						content: { type: "text", text: "partial failed replay" },
					},
				} as SessionNotification);
				throw new Error("reload failed");
			});

			await expect(
				sessionManager.reloadSession(
					created.sessionId,
					"/home/user/project",
					"backend-1",
				),
			).rejects.toThrow("reload failed");

			const restoredHistory = sessionManager.getSessionEvents({
				sessionId: created.sessionId,
				revision: 1,
				afterSeq: 0,
			}).events;
			expect(restoredHistory).toEqual(historyBefore.events);
			expect(sessionManager.getSession(created.sessionId)).toBeUndefined();
			expect(mockConnection.disconnect).toHaveBeenCalled();

			const lateUpdate = sessionUpdateCallback;
			lateUpdate?.({
				sessionId: created.sessionId,
				update: {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "live after failure" },
				},
			} as SessionNotification);
			const resumedHistory = sessionManager.getSessionEvents({
				sessionId: created.sessionId,
				revision: 1,
				afterSeq: 0,
			}).events;
			expect(resumedHistory).toEqual(historyBefore.events);
		});

		it("drops every buffered replay event when reload fails", async () => {
			const created = await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});
			mockConnection.loadSession.mockImplementationOnce(async () => {
				sessionUpdateCallback?.({
					sessionId: created.sessionId,
					update: {
						sessionUpdate: "agent_message_chunk",
						content: { type: "text", text: "buffered update" },
					},
				} as SessionNotification);
				terminalOutputCallback?.({ stream: "stdout", data: "buffered output" });
				statusChangeCallback?.({ error: { message: "buffered status" } });
				sessionManager.recordTurnEnd(created.sessionId, "end_turn");
				throw new Error("reload failed");
			});

			await expect(
				sessionManager.reloadSession(
					created.sessionId,
					"/home/user/project",
					"backend-1",
				),
			).rejects.toThrow("reload failed");

			expect(
				sessionManager
					.getSessionEvents({
						sessionId: created.sessionId,
						revision: 1,
						afterSeq: 0,
					})
					.events.map((event) => event.kind),
			).toEqual([]);
			expect(sessionManager.getSession(created.sessionId)).toBeUndefined();
		});

		it("rejects and closes a reload whose provisional replay exceeds its byte budget", async () => {
			const created = await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});
			mockConnection.loadSession.mockImplementationOnce(async () => {
				sessionUpdateCallback?.({
					sessionId: created.sessionId,
					update: {
						sessionUpdate: "agent_message_chunk",
						content: { type: "text", text: "x".repeat(8 * 1024 * 1024) },
					},
				} as SessionNotification);
				return { modes: null, configOptions: null };
			});

			await expect(
				sessionManager.reloadSession(
					created.sessionId,
					"/home/user/project",
					"backend-1",
				),
			).rejects.toThrow("Reload replay exceeds local buffer limit");

			expect(sessionManager.getSession(created.sessionId)).toBeUndefined();
			expect(mockConnection.disconnect).toHaveBeenCalled();
			expect(
				sessionManager.getSessionEvents({
					sessionId: created.sessionId,
					revision: 1,
					afterSeq: 0,
				}).events,
			).toHaveLength(0);
		});

		it("rechecks the replay budget after asynchronous project resolution", async () => {
			const created = await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});
			let resolveProject:
				| ((value: {
						isGitRepo: boolean;
						repoRoot: string;
						repoName: string;
						relativeCwd: undefined;
						isRepoRoot: boolean;
				  }) => void)
				| undefined;
			mockResolveGitProjectContext.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						resolveProject = resolve;
					}),
			);

			const reload = sessionManager.reloadSession(
				created.sessionId,
				"/home/user/project",
				"backend-1",
			);
			await Promise.resolve();
			await Promise.resolve();
			sessionUpdateCallback?.({
				sessionId: created.sessionId,
				update: {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "x".repeat(8 * 1024 * 1024) },
				},
			} as SessionNotification);
			resolveProject?.({
				isGitRepo: true,
				repoRoot: "/home/user/project",
				repoName: "project",
				relativeCwd: undefined,
				isRepoRoot: true,
			});

			await expect(reload).rejects.toThrow(
				"Reload replay exceeds local buffer limit",
			);
			expect(sessionManager.getSession(created.sessionId)).toBeUndefined();
			expect(mockConnection.disconnect).toHaveBeenCalled();
			expect(
				sessionManager.getSessionEvents({
					sessionId: created.sessionId,
					revision: 2,
					afterSeq: 0,
				}).events,
			).toHaveLength(0);
		});

		it("emits session:attached event even if already attached", async () => {
			const attachedListener = mock(() => {});
			sessionManager.onSessionAttached(attachedListener);

			// First load
			await sessionManager.loadSession(
				"test-session",
				"/home/user/project",
				"backend-1",
			);
			expect(attachedListener).toHaveBeenCalledTimes(1);

			// Reload - should emit again due to force flag
			await sessionManager.reloadSession(
				"test-session",
				"/home/user/project",
				"backend-1",
			);
			expect(attachedListener).toHaveBeenCalledTimes(2);
		});
	});

	describe("listSessions", () => {
		it("returns empty array initially", () => {
			const sessions = sessionManager.listSessions();
			expect(sessions).toEqual([]);
		});

		it("returns sessions after creating one", async () => {
			await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});

			const sessions = sessionManager.listSessions();
			expect(sessions).toHaveLength(1);
			expect(sessions[0].sessionId).toBeDefined();
		});

		it("sets workspaceRootCwd for subdirectory sessions", async () => {
			mockResolveGitProjectContext.mockResolvedValueOnce({
				isGitRepo: true,
				repoRoot: "/home/user/project",
				repoName: "project",
				relativeCwd: "apps/webui",
				isRepoRoot: false,
			});

			await sessionManager.createSession({
				cwd: "/home/user/project/apps/webui",
				backendId: "backend-1",
			});

			const sessions = sessionManager.listSessions();
			expect(sessions[0].cwd).toBe("/home/user/project/apps/webui");
			expect(sessions[0].workspaceRootCwd).toBe("/home/user/project");
		});

		it("preserves relative cwd when creating a worktree session", async () => {
			mockCreateGitWorktree.mockResolvedValueOnce({
				path: "/tmp/mobvibe-test/worktrees/project/feat-branch",
				branch: "feat-branch",
			});

			const created = await sessionManager.createSession({
				cwd: "/home/user/project/apps/webui",
				backendId: "backend-1",
				worktree: {
					branch: "feat-branch",
					sourceCwd: "/home/user/project",
					relativeCwd: "apps/webui",
				},
			});

			expect(created.cwd).toBe(
				"/tmp/mobvibe-test/worktrees/project/feat-branch/apps/webui",
			);
			expect(created.workspaceRootCwd).toBe("/home/user/project");
			expect(created.worktreeSourceCwd).toBe("/home/user/project");
			expect(created.worktreeBranch).toBe("feat-branch");
		});

		it("generates a default branch name when a worktree branch is omitted", async () => {
			mockCreateGitWorktree.mockImplementationOnce((_cwd, opts) =>
				Promise.resolve({
					path: opts.targetPath,
					branch: opts.branch,
				}),
			);

			const created = await sessionManager.createSession({
				cwd: "/home/user/project/apps/webui",
				backendId: "backend-1",
				worktree: {
					sourceCwd: "/home/user/project",
					relativeCwd: "apps/webui",
				},
			});

			expect(mockCreateGitWorktree).toHaveBeenCalledTimes(1);
			const worktreeOptions = mockCreateGitWorktree.mock.calls[0]?.[1] as
				| { branch: string; targetPath: string; baseBranch?: string }
				| undefined;
			expect(worktreeOptions).toBeDefined();
			if (!worktreeOptions) {
				throw new Error("Expected createGitWorktree to be called");
			}
			expect(worktreeOptions.branch).toMatch(/^[a-z]+-[a-z]+-[a-z0-9]{2}$/);
			expect(worktreeOptions.targetPath).toBe(
				`/tmp/mobvibe-test/worktrees/project/${worktreeOptions.branch}`,
			);
			expect(created.cwd).toBe(`${worktreeOptions.targetPath}/apps/webui`);
			expect(created.worktreeBranch).toBe(worktreeOptions.branch);
			expect(created.worktreeSourceCwd).toBe("/home/user/project");
		});

		it("rejects worktree relative paths that escape the worktree root", async () => {
			await expect(
				sessionManager.createSession({
					cwd: "/home/user/project/apps/webui",
					backendId: "backend-1",
					worktree: {
						branch: "feat-branch",
						sourceCwd: "/home/user/project",
						relativeCwd: "../secrets",
					},
				}),
			).rejects.toMatchObject({
				status: 400,
				detail: expect.objectContaining({
					code: "REQUEST_VALIDATION_FAILED",
				}),
			});
			expect(mockConnection.createSession).not.toHaveBeenCalled();
		});

		it("rejects absolute worktree relative paths", async () => {
			await expect(
				sessionManager.createSession({
					cwd: "/home/user/project/apps/webui",
					backendId: "backend-1",
					worktree: {
						branch: "feat-branch",
						sourceCwd: "/home/user/project",
						relativeCwd: "/tmp/outside",
					},
				}),
			).rejects.toMatchObject({
				status: 400,
				detail: expect.objectContaining({
					code: "REQUEST_VALIDATION_FAILED",
				}),
			});
			expect(mockConnection.createSession).not.toHaveBeenCalled();
		});

		it("includes persisted workspaceRootCwd for discovered sessions from WAL", () => {
			(
				sessionManager as unknown as {
					walStore: {
						saveDiscoveredSessions: (
							sessions: Array<{
								sessionId: string;
								backendId: string;
								cwd?: string;
								workspaceRootCwd?: string;
								discoveredAt: string;
								isStale: boolean;
							}>,
						) => void;
					};
				}
			).walStore.saveDiscoveredSessions([
				{
					sessionId: "historical-1",
					backendId: "backend-1",
					cwd: "/home/user/project/apps/webui",
					workspaceRootCwd: "/home/user/project",
					discoveredAt: new Date().toISOString(),
					isStale: false,
				},
			]);

			const sessions = sessionManager.listAllSessions();
			expect(sessions).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						sessionId: "historical-1",
						cwd: "/home/user/project/apps/webui",
						workspaceRootCwd: "/home/user/project",
					}),
				]),
			);
		});

		it("prefers newer discovered metadata over a detached WAL summary", async () => {
			mockResolveGitProjectContext.mockResolvedValueOnce({
				isGitRepo: true,
				repoRoot: "/home/user/project",
				repoName: "project",
				relativeCwd: "apps/webui",
				isRepoRoot: false,
			});
			const created = await sessionManager.createSession({
				cwd: "/home/user/project/apps/webui",
				backendId: "backend-1",
			});
			await sessionManager.closeSession(created.sessionId);

			(
				sessionManager as unknown as {
					walStore: {
						saveDiscoveredSessions: (
							sessions: Array<{
								sessionId: string;
								backendId: string;
								cwd?: string;
								workspaceRootCwd?: string;
								title?: string;
								agentUpdatedAt?: string;
								discoveredAt: string;
								isStale: boolean;
							}>,
						) => void;
					};
				}
			).walStore.saveDiscoveredSessions([
				{
					sessionId: created.sessionId,
					backendId: "backend-1",
					cwd: "/home/user/project/apps/webui",
					workspaceRootCwd: "/home/user/project",
					title: "Agent title",
					agentUpdatedAt: "2100-01-01T00:00:00.000Z",
					discoveredAt: "2099-01-01T00:00:00.000Z",
					isStale: false,
				},
			]);

			const restored = sessionManager
				.listAllSessions()
				.find((session) => session.sessionId === created.sessionId);
			expect(restored).toEqual(
				expect.objectContaining({
					title: "Agent title",
					cwd: "/home/user/project/apps/webui",
					workspaceRootCwd: "/home/user/project",
					updatedAt: "2100-01-01T00:00:00.000Z",
				}),
			);
		});
	});

	describe("E2EE session summaries", () => {
		it("recovers a revision DEK and unacked WAL events after a daemon restart", async () => {
			await initCrypto();
			const masterSecret = generateMasterSecret();
			const restartConfig = {
				...mockConfig,
				walDbPath: `/tmp/mobvibe-test/restart-events-${Date.now()}-${Math.random()
					.toString(36)
					.slice(2)}.db`,
			};
			const firstCrypto = new CliCryptoService(masterSecret);
			const firstManager = new SessionManager(restartConfig, firstCrypto);
			const firstConnection = createMockConnection();
			firstManager.createConnection = () =>
				firstConnection as unknown as AcpConnection;

			const created = await firstManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});
			sessionUpdateCallback?.({
				sessionId: created.sessionId,
				update: {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "survives restart" },
				},
			} as SessionNotification);
			if (!created.wrappedDek) {
				throw new Error("created session should expose a wrapped DEK");
			}
			await firstManager.shutdown();

			const secondCrypto = new CliCryptoService(masterSecret);
			const secondManager = new SessionManager(restartConfig, secondCrypto);
			try {
				const [backfillEvent] = secondManager.getSessionEvents({
					sessionId: created.sessionId,
					revision: 1,
					afterSeq: 0,
				}).events;
				expect(backfillEvent).toBeDefined();
				expect(
					isEncryptedPayload(secondCrypto.encryptEvent(backfillEvent).payload),
				).toBe(true);

				const restored = secondManager
					.listAllSessions()
					.find((session) => session.sessionId === created.sessionId);
				expect(restored).toEqual(
					expect.objectContaining({
						sessionId: created.sessionId,
						revision: 1,
						wrappedDek: created.wrappedDek,
						isAttached: false,
					}),
				);
				const revisions = secondManager.listUnackedSessionRevisions();
				expect(revisions).toEqual([
					{ sessionId: created.sessionId, revision: 1 },
				]);
				const [event] = secondManager.getUnackedEvents(created.sessionId, 1);
				expect(event).toBeDefined();

				const encrypted = secondCrypto.encryptEvent(event);
				if (!isEncryptedPayload(encrypted.payload)) {
					throw new Error("restored WAL event should be encrypted");
				}
				const contentKeyPair = deriveContentKeyPair(masterSecret);
				const dek = unwrapDEK(
					created.wrappedDek,
					contentKeyPair.publicKey,
					contentKeyPair.secretKey,
				);
				expect(decryptPayload(encrypted.payload, dek)).toEqual(event.payload);
			} finally {
				await secondManager.shutdown();
			}
		});

		it("rejects a WAL opened with a different master-secret identity", async () => {
			await initCrypto();
			const identityConfig = {
				...mockConfig,
				walDbPath: `/tmp/mobvibe-test/key-identity-${Date.now()}-${Math.random()
					.toString(36)
					.slice(2)}.db`,
			};
			const firstManager = new SessionManager(
				identityConfig,
				new CliCryptoService(generateMasterSecret()),
			);
			firstManager.createConnection = () =>
				createMockConnection() as unknown as AcpConnection;
			await firstManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});
			await firstManager.shutdown();

			expect(
				() =>
					new SessionManager(
						identityConfig,
						new CliCryptoService(generateMasterSecret()),
					),
			).toThrow("WAL encryption identity mismatch");
		});

		it("verifies a legacy wrapped key before binding the WAL identity", async () => {
			await initCrypto();
			const originalSecret = generateMasterSecret();
			const originalCrypto = new CliCryptoService(originalSecret);
			const legacyConfig = {
				...mockConfig,
				walDbPath: `/tmp/mobvibe-test/legacy-key-identity-${Date.now()}-${Math.random()
					.toString(36)
					.slice(2)}.db`,
			};
			const legacyStore = new WalStore(legacyConfig.walDbPath);
			legacyStore.ensureSession({
				sessionId: "legacy-session",
				machineId: "test-machine-id",
				backendId: "backend-1",
			});
			const { wrappedDek } = originalCrypto.initSessionDek("legacy-session", 1);
			if (!wrappedDek) {
				throw new Error("expected wrapped legacy key");
			}
			legacyStore.recordSessionRevisionKey("legacy-session", 1, wrappedDek);
			legacyStore.close();

			expect(
				() =>
					new SessionManager(
						legacyConfig,
						new CliCryptoService(generateMasterSecret()),
					),
			).toThrow("WAL encryption identity mismatch");
			const inspectionDb = new Database(legacyConfig.walDbPath);
			expect(
				inspectionDb
					.query(
						"SELECT key_identity FROM wal_encryption_identity WHERE id = 1",
					)
					.get(),
			).toBeNull();
			inspectionDb.close();

			const recovered = new SessionManager(legacyConfig, originalCrypto);
			try {
				expect(
					recovered
						.listAllSessions()
						.find((session) => session.sessionId === "legacy-session")
						?.wrappedDek,
				).toBe(wrappedDek);
			} finally {
				await recovered.shutdown();
			}
		});

		it("binds a genuinely empty legacy WAL to the first device identity", async () => {
			await initCrypto();
			const emptyConfig = {
				...mockConfig,
				walDbPath: `/tmp/mobvibe-test/empty-key-identity-${Date.now()}-${Math.random()
					.toString(36)
					.slice(2)}.db`,
			};
			const crypto = new CliCryptoService(generateMasterSecret());
			const manager = new SessionManager(emptyConfig, crypto);
			await manager.shutdown();

			const inspection = new WalStore(emptyConfig.walDbPath);
			try {
				expect(inspection.getEncryptionIdentity()).toBe(
					crypto.getKeyIdentity(),
				);
			} finally {
				inspection.close();
			}
		});

		it("migrates a schema-v7 WAL with durable data to the current identity", async () => {
			await initCrypto();
			const legacyConfig = {
				...mockConfig,
				walDbPath: `/tmp/mobvibe-test/schema-v7-key-identity-${Date.now()}-${Math.random()
					.toString(36)
					.slice(2)}.db`,
			};
			const legacyStore = new WalStore(legacyConfig.walDbPath);
			legacyStore.ensureSession({
				sessionId: "legacy-session",
				machineId: "test-machine-id",
				backendId: "backend-1",
			});
			legacyStore.appendEvent({
				sessionId: "legacy-session",
				revision: 1,
				kind: "user_message",
				payload: { text: "created before identity binding" },
			});
			legacyStore.close();

			const legacyDb = new Database(legacyConfig.walDbPath);
			legacyDb.exec(`
				DELETE FROM schema_version WHERE version > 7;
				DROP TABLE message_send_results;
				DROP TABLE session_revision_keys;
				DROP TABLE message_send_claims;
				DROP TABLE wal_encryption_identity;
			`);
			legacyDb.close();

			const crypto = new CliCryptoService(generateMasterSecret());
			const migrated = new SessionManager(legacyConfig, crypto);
			try {
				expect(migrated.listAllSessions()).toEqual([
					expect.objectContaining({ sessionId: "legacy-session" }),
				]);
			} finally {
				await migrated.shutdown();
			}

			const inspection = new WalStore(legacyConfig.walDbPath);
			try {
				expect(inspection.getEncryptionIdentity()).toBe(
					crypto.getKeyIdentity(),
				);
			} finally {
				inspection.close();
			}
		});

		it("rejects current-schema session data after its identity is removed", async () => {
			await initCrypto();
			const legacyConfig = {
				...mockConfig,
				walDbPath: `/tmp/mobvibe-test/unverifiable-key-identity-${Date.now()}-${Math.random()
					.toString(36)
					.slice(2)}.db`,
			};
			const legacyStore = new WalStore(legacyConfig.walDbPath);
			legacyStore.ensureSession({
				sessionId: "legacy-session",
				machineId: "test-machine-id",
				backendId: "backend-1",
			});
			legacyStore.close();

			expect(
				() =>
					new SessionManager(
						legacyConfig,
						new CliCryptoService(generateMasterSecret()),
					),
			).toThrow("cannot verify the original master secret");
			const inspection = new WalStore(legacyConfig.walDbPath);
			try {
				expect(inspection.getEncryptionIdentity()).toBeUndefined();
			} finally {
				inspection.close();
			}
		});

		it("rejects current-schema agent-team data after its identity is removed", async () => {
			await initCrypto();
			const legacyConfig = {
				...mockConfig,
				walDbPath: `/tmp/mobvibe-test/unverifiable-team-identity-${Date.now()}-${Math.random()
					.toString(36)
					.slice(2)}.db`,
			};
			const legacyStore = new WalStore(legacyConfig.walDbPath);
			legacyStore.close();
			const db = new Database(legacyConfig.walDbPath);
			const now = new Date().toISOString();
			db.query(`
				INSERT INTO agent_teams (
					agent_team_id, machine_id, workspace_root_cwd, title, lifecycle,
					leader_member_id, workspace_mode, created_at, updated_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			`).run(
				"legacy-team",
				"test-machine-id",
				"/tmp/project",
				"Legacy team",
				"active",
				"leader-1",
				"shared",
				now,
				now,
			);
			db.close();

			expect(
				() =>
					new SessionManager(
						legacyConfig,
						new CliCryptoService(generateMasterSecret()),
					),
			).toThrow("cannot verify the original master secret");
		});

		it("rejects a legacy WAL when any persisted revision key uses another secret", async () => {
			await initCrypto();
			const originalCrypto = new CliCryptoService(generateMasterSecret());
			const foreignCrypto = new CliCryptoService(generateMasterSecret());
			const legacyConfig = {
				...mockConfig,
				walDbPath: `/tmp/mobvibe-test/legacy-mixed-key-identity-${Date.now()}-${Math.random()
					.toString(36)
					.slice(2)}.db`,
			};
			const legacyStore = new WalStore(legacyConfig.walDbPath);
			legacyStore.ensureSession({
				sessionId: "legacy-session",
				machineId: "test-machine-id",
				backendId: "backend-1",
			});
			for (let revision = 1; revision <= 100; revision += 1) {
				const { wrappedDek } = originalCrypto.initSessionDek(
					"legacy-session",
					revision,
				);
				if (!wrappedDek) {
					throw new Error("expected wrapped legacy key");
				}
				legacyStore.recordSessionRevisionKey(
					"legacy-session",
					revision,
					wrappedDek,
				);
			}
			const foreignKey = foreignCrypto.initSessionDek("legacy-session", 101);
			if (!foreignKey.wrappedDek) {
				throw new Error("expected foreign wrapped legacy key");
			}
			legacyStore.recordSessionRevisionKey(
				"legacy-session",
				101,
				foreignKey.wrappedDek,
			);
			legacyStore.close();

			let opened: InstanceType<typeof SessionManager> | undefined;
			let constructionError: unknown;
			try {
				opened = new SessionManager(legacyConfig, originalCrypto);
			} catch (error) {
				constructionError = error;
			}
			await opened?.shutdown();

			expect(constructionError).toBeInstanceOf(Error);
			expect((constructionError as Error).message).toContain(
				"WAL encryption identity mismatch",
			);
			const inspectionDb = new Database(legacyConfig.walDbPath);
			expect(
				inspectionDb
					.query(
						"SELECT key_identity FROM wal_encryption_identity WHERE id = 1",
					)
					.get(),
			).toBeNull();
			inspectionDb.close();
		});

		it("includes wrappedDek and initializes a DEK when creating a session", async () => {
			const cryptoService = {
				initSessionDek: mock(() => ({
					dek: new Uint8Array([1, 2, 3]),
					wrappedDek: "wrapped-dek-1",
				})),
				getWrappedDek: mock(() => "wrapped-dek-1"),
			};
			const managerWithCrypto = new SessionManager(
				mockConfig,
				cryptoService as never,
			);
			managerWithCrypto.createConnection = () =>
				mockConnection as unknown as AcpConnection;

			const created = await managerWithCrypto.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});

			expect(cryptoService.initSessionDek).toHaveBeenCalledWith(
				created.sessionId,
				1,
			);
			expect(cryptoService.getWrappedDek).toHaveBeenCalledWith(
				created.sessionId,
				1,
			);
			expect(created.wrappedDek).toBe("wrapped-dek-1");
		});

		it("does not advertise a persisted DEK when content encryption is disabled", async () => {
			await initCrypto();
			const masterSecret = generateMasterSecret();
			const noE2eeConfig = {
				...mockConfig,
				walDbPath: `/tmp/mobvibe-test/no-e2ee-events-${Date.now()}-${Math.random()
					.toString(36)
					.slice(2)}.db`,
			};
			const enabledManager = new SessionManager(
				noE2eeConfig,
				new CliCryptoService(masterSecret),
			);
			enabledManager.createConnection = () =>
				createMockConnection() as unknown as AcpConnection;
			const created = await enabledManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});
			sessionUpdateCallback?.({
				sessionId: created.sessionId,
				update: {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "plaintext replay" },
				},
			} as SessionNotification);
			expect(created.wrappedDek).toBeDefined();
			await enabledManager.shutdown();

			const disabledCrypto = new CliCryptoService(masterSecret, {
				contentEncryptionEnabled: false,
			});
			const disabledManager = new SessionManager(noE2eeConfig, disabledCrypto);
			try {
				const restored = disabledManager
					.listAllSessions()
					.find((session) => session.sessionId === created.sessionId);
				expect(restored?.wrappedDek).toBeUndefined();

				const [event] = disabledManager.getUnackedEvents(created.sessionId, 1);
				expect(disabledCrypto.encryptEvent(event)).toBe(event);
				const prompt = [{ type: "text", text: "plaintext prompt" }];
				expect(
					disabledCrypto.decryptRpcPayload<typeof prompt>(
						created.sessionId,
						prompt,
					),
				).toBe(prompt);
			} finally {
				await disabledManager.shutdown();
			}
		});

		it("omits wrappedDek when crypto service returns null", async () => {
			const cryptoService = {
				initSessionDek: mock(() => ({
					dek: new Uint8Array(),
					wrappedDek: null,
				})),
				getWrappedDek: mock(() => null),
			};
			const managerWithCrypto = new SessionManager(
				mockConfig,
				cryptoService as never,
			);
			managerWithCrypto.createConnection = () =>
				mockConnection as unknown as AcpConnection;

			const created = await managerWithCrypto.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});

			expect(cryptoService.initSessionDek).toHaveBeenCalledWith(
				created.sessionId,
				1,
			);
			expect(created.wrappedDek).toBeUndefined();
		});

		it("initializes a fresh DEK when loading an existing session", async () => {
			const cryptoService = {
				initSessionDek: mock(() => ({
					dek: new Uint8Array([4, 5, 6]),
					wrappedDek: "wrapped-load",
				})),
				getWrappedDek: mock(() => "wrapped-load"),
			};
			const managerWithCrypto = new SessionManager(
				mockConfig,
				cryptoService as never,
			);
			managerWithCrypto.createConnection = () =>
				mockConnection as unknown as AcpConnection;

			const loaded = await managerWithCrypto.loadSession(
				"session-to-load",
				"/home/user/project",
				"backend-1",
			);

			expect(cryptoService.initSessionDek).toHaveBeenCalledWith(
				"session-to-load",
				1,
			);
			expect(loaded.wrappedDek).toBe("wrapped-load");
		});
	});

	describe("backfillDiscoveredWorkspaceRoots", () => {
		it("upgrades legacy discovered sessions using repoRoot for git subdirectories", async () => {
			const walStore = (
				sessionManager as unknown as {
					walStore: {
						saveDiscoveredSessions: (
							sessions: Array<{
								sessionId: string;
								backendId: string;
								cwd?: string;
								workspaceRootCwd?: string;
								discoveredAt: string;
								isStale: boolean;
							}>,
						) => void;
						getDiscoveredSessions: () => Array<{
							sessionId: string;
							cwd?: string;
							workspaceRootCwd?: string;
						}>;
					};
				}
			).walStore;
			walStore.saveDiscoveredSessions([
				{
					sessionId: "legacy-subdir",
					backendId: "backend-1",
					cwd: "/home/user/project/apps/webui",
					workspaceRootCwd: "/home/user/project/apps/webui",
					discoveredAt: new Date().toISOString(),
					isStale: false,
				},
			]);

			mockResolveGitProjectContext.mockResolvedValueOnce({
				isGitRepo: true,
				repoRoot: "/home/user/project",
				repoName: "project",
				relativeCwd: "apps/webui",
				isRepoRoot: false,
			});

			await sessionManager.backfillDiscoveredWorkspaceRoots();

			const [session] = walStore.getDiscoveredSessions();
			expect(session.workspaceRootCwd).toBe("/home/user/project");
		});

		it("falls back to cwd for non-git discovered sessions", async () => {
			const walStore = (
				sessionManager as unknown as {
					walStore: {
						saveDiscoveredSessions: (
							sessions: Array<{
								sessionId: string;
								backendId: string;
								cwd?: string;
								workspaceRootCwd?: string;
								discoveredAt: string;
								isStale: boolean;
							}>,
						) => void;
						getDiscoveredSessions: () => Array<{
							sessionId: string;
							cwd?: string;
							workspaceRootCwd?: string;
						}>;
					};
				}
			).walStore;
			walStore.saveDiscoveredSessions([
				{
					sessionId: "legacy-folder",
					backendId: "backend-1",
					cwd: "/home/user/folder",
					workspaceRootCwd: "/home/user/folder",
					discoveredAt: new Date().toISOString(),
					isStale: false,
				},
			]);

			mockResolveGitProjectContext.mockResolvedValueOnce({
				isGitRepo: false,
				repoRoot: "/home/user/folder",
				repoName: "folder",
				relativeCwd: undefined,
				isRepoRoot: false,
			});

			await sessionManager.backfillDiscoveredWorkspaceRoots();

			const [session] = walStore
				.getDiscoveredSessions()
				.filter((item) => item.sessionId === "legacy-folder");
			expect(session.workspaceRootCwd).toBe("/home/user/folder");
		});
	});

	describe("model config compatibility", () => {
		it("derives and updates the model picker through session config options", async () => {
			mockConnection.createSession.mockResolvedValueOnce({
				sessionId: "new-session-1",
				modes: null,
				configOptions: [
					{
						id: "model-selector",
						name: "Model",
						category: "model",
						type: "select",
						currentValue: "fast",
						options: [
							{
								group: "recommended",
								name: "Recommended",
								options: [
									{ value: "fast", name: "Fast" },
									{
										value: "smart",
										name: "Smart",
										description: "More capable",
									},
								],
							},
						],
					},
				],
			});

			const created = await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});

			expect(created).toEqual(
				expect.objectContaining({
					modelId: "fast",
					modelName: "Fast",
					availableModels: [
						{ id: "fast", name: "Fast" },
						{
							id: "smart",
							name: "Smart",
							description: "More capable",
						},
					],
				}),
			);

			const updated = await sessionManager.setSessionModel(
				created.sessionId,
				"smart",
			);

			expect(mockConnection.setSessionModel).toHaveBeenCalledWith(
				created.sessionId,
				"model-selector",
				"smart",
			);
			expect(updated.modelId).toBe("smart");
			expect(updated.modelName).toBe("Smart");
		});
	});

	describe("permission request cancellation", () => {
		it("keeps numeric and string request IDs distinct and clears both on abort", async () => {
			const requestIds: string[] = [];
			const resultIds: string[] = [];
			sessionManager.onPermissionRequest((payload) => {
				requestIds.push(payload.requestId);
			});
			sessionManager.onPermissionResult((payload) => {
				resultIds.push(payload.requestId);
			});
			await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});
			if (!permissionHandlerCallback) {
				throw new Error("Permission handler was not registered");
			}
			const params: RequestPermissionRequest = {
				sessionId: "new-session-1",
				toolCall: { toolCallId: "tool-1" },
				options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }],
			};
			const numericController = new AbortController();
			const stringController = new AbortController();

			const numericResult = permissionHandlerCallback(
				params,
				1,
				numericController.signal,
			);
			const stringResult = permissionHandlerCallback(
				params,
				"1",
				stringController.signal,
			);

			expect(requestIds).toEqual(["number:1", "string:1"]);
			numericController.abort();
			stringController.abort();

			await expect(numericResult).resolves.toEqual({
				outcome: { outcome: "cancelled" },
			});
			await expect(stringResult).resolves.toEqual({
				outcome: { outcome: "cancelled" },
			});
			expect(resultIds).toEqual(["number:1", "string:1"]);
		});
	});

	describe("closeSession", () => {
		it("closes and removes session", async () => {
			const created = await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});

			const result = await sessionManager.closeSession(created.sessionId);

			expect(result).toBe(true);
			expect(sessionManager.listSessions()).toHaveLength(0);
		});

		it("emits sessions:changed event when session closed", async () => {
			const created = await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});

			const changedListener = mock(() => {});
			sessionManager.onSessionsChanged(changedListener);

			await sessionManager.closeSession(created.sessionId);

			expect(changedListener).toHaveBeenCalledWith(
				expect.objectContaining({
					added: [],
					updated: [],
					removed: [created.sessionId],
				}),
			);
		});

		it("returns false for unknown session", async () => {
			const result = await sessionManager.closeSession("unknown-session");
			expect(result).toBe(false);
		});
	});

	describe("recordTurnEnd", () => {
		it("writes and emits turn_end event for active session", async () => {
			await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});
			const sessions = sessionManager.listSessions();
			const sessionId = sessions[0].sessionId;
			const eventListener = mock(() => {});
			sessionManager.onSessionEvent(eventListener);

			sessionManager.recordTurnEnd(sessionId, "end_turn");

			expect(eventListener).toHaveBeenCalledWith(
				expect.objectContaining({
					sessionId,
					kind: "turn_end",
					payload: expect.objectContaining({ stopReason: "end_turn" }),
				}),
			);

			const events = sessionManager.getSessionEvents({
				sessionId,
				revision: 1,
				afterSeq: 0,
			});
			expect(events.events.some((event) => event.kind === "turn_end")).toBe(
				true,
			);
		});
	});

	describe("completeMessageSend", () => {
		it("commits the result and emits its turn_end as one terminal operation", async () => {
			const created = await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});
			const claim = sessionManager.claimMessageSend(
				created.sessionId,
				"message-atomic",
			);
			if (claim.status !== "claimed") {
				throw new Error("expected message claim");
			}
			const eventListener = mock(() => {});
			sessionManager.onSessionEvent(eventListener);

			sessionManager.completeMessageSend(
				created.sessionId,
				"message-atomic",
				claim.claimId,
				"end_turn",
			);

			expect(
				sessionManager.getMessageSendResult(
					created.sessionId,
					"message-atomic",
				),
			).toEqual({ stopReason: "end_turn" });
			expect(eventListener).toHaveBeenCalledTimes(1);
			expect(eventListener).toHaveBeenCalledWith(
				expect.objectContaining({
					kind: "turn_end",
					payload: { stopReason: "end_turn" },
				}),
			);
		});
	});

	describe("getSessionEvents", () => {
		const createConsolidatedManager = () => {
			const consolidatedConfig = {
				...createMockConfig(),
				walDbPath: `/tmp/mobvibe-test/events-consolidated-${Date.now()}-${Math.random()
					.toString(36)
					.slice(2)}.db`,
				consolidation: {
					enabled: true,
				},
			} satisfies CliConfig;
			const manager = new SessionManager(consolidatedConfig);
			const connection = createMockConnection();
			sessionUpdateCallback = undefined;
			manager.createConnection = () => connection as unknown as AcpConnection;
			return { manager, connection };
		};

		it("returns empty events when requested revision does not match actual revision (Fix 2)", async () => {
			// Create a session first to have it in WAL
			await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});
			const sessions = sessionManager.listSessions();
			const sessionId = sessions[0].sessionId;

			// Query with a different revision than what the session has
			const result = sessionManager.getSessionEvents({
				sessionId,
				revision: 999, // Wrong revision
				afterSeq: 0,
			});

			// Should return empty events but with actual revision
			expect(result.events).toHaveLength(0);
			expect(result.revision).toBe(1); // Actual revision is 1
			expect(result.hasMore).toBe(false);
		});

		it("returns events when requested revision matches actual revision", async () => {
			// Create a session
			await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});
			const sessions = sessionManager.listSessions();
			const sessionId = sessions[0].sessionId;

			// Query with correct revision
			const result = sessionManager.getSessionEvents({
				sessionId,
				revision: 1, // Correct revision
				afterSeq: 0,
			});

			// Should return events (may be empty if no events written yet, but no error)
			expect(result.revision).toBe(1);
			expect(Array.isArray(result.events)).toBe(true);
		});

		it("returns empty for non-existent session", () => {
			const result = sessionManager.getSessionEvents({
				sessionId: "non-existent-session",
				revision: 1,
				afterSeq: 0,
			});

			expect(result.events).toHaveLength(0);
			expect(result.hasMore).toBe(false);
		});

		it("consolidates consecutive assistant chunks and advances nextAfterSeq to the final chunk seq", async () => {
			const { manager } = createConsolidatedManager();
			await manager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});
			const sessionId = manager.listSessions()[0].sessionId;

			expect(sessionUpdateCallback).toBeDefined();
			sessionUpdateCallback?.({
				sessionId,
				update: {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "Consolidated " },
				},
			} as SessionNotification);
			sessionUpdateCallback?.({
				sessionId,
				update: {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "assistant " },
				},
			} as SessionNotification);
			sessionUpdateCallback?.({
				sessionId,
				update: {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "reply" },
				},
			} as SessionNotification);

			const result = manager.getSessionEvents({
				sessionId,
				revision: 1,
				afterSeq: 0,
			});

			expect(result.events).toHaveLength(1);
			expect(result.events[0]).toEqual(
				expect.objectContaining({
					sessionId,
					kind: "agent_message_chunk",
					seq: 3,
				}),
			);
			expect(
				(
					result.events[0].payload as {
						update: { content: { text: string } };
					}
				).update.content.text,
			).toBe("Consolidated assistant reply");
			expect(result.nextAfterSeq).toBe(3);
		});

		it("consolidates tool_call updates and returns the terminal seq in backfill", async () => {
			const { manager } = createConsolidatedManager();
			await manager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});
			const sessionId = manager.listSessions()[0].sessionId;

			expect(sessionUpdateCallback).toBeDefined();
			sessionUpdateCallback?.({
				sessionId,
				update: {
					sessionUpdate: "tool_call",
					toolCallId: "tool-1",
					status: "in_progress",
					title: "Read file",
				},
			} as SessionNotification);
			sessionUpdateCallback?.({
				sessionId,
				update: {
					sessionUpdate: "tool_call_update",
					toolCallId: "tool-1",
					status: "completed",
					title: "Read file",
					rawOutput: { content: "done" },
				},
			} as SessionNotification);

			const result = manager.getSessionEvents({
				sessionId,
				revision: 1,
				afterSeq: 0,
			});

			expect(result.events).toHaveLength(1);
			expect(result.events[0]).toEqual(
				expect.objectContaining({
					sessionId,
					kind: "tool_call",
					seq: 2,
				}),
			);
			expect(
				(
					result.events[0].payload as {
						update: {
							sessionUpdate: string;
							status: string;
							toolCallId: string;
						};
					}
				).update,
			).toEqual(
				expect.objectContaining({
					sessionUpdate: "tool_call",
					status: "completed",
					toolCallId: "tool-1",
				}),
			);
			expect(result.nextAfterSeq).toBe(2);
		});

		it("advances past a raw page containing only consolidation stubs", async () => {
			const { manager } = createConsolidatedManager();
			await manager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});
			const sessionId = manager.listSessions()[0].sessionId;
			const walStore = (
				manager as unknown as {
					walStore: {
						appendEvent: (params: {
							sessionId: string;
							revision: number;
							kind: "agent_message_chunk";
							payload: unknown;
						}) => unknown;
					};
				}
			).walStore;

			walStore.appendEvent({
				sessionId,
				revision: 1,
				kind: "agent_message_chunk",
				payload: { _c: true },
			});
			walStore.appendEvent({
				sessionId,
				revision: 1,
				kind: "agent_message_chunk",
				payload: { _c: true },
			});
			walStore.appendEvent({
				sessionId,
				revision: 1,
				kind: "agent_message_chunk",
				payload: {
					sessionId,
					update: {
						sessionUpdate: "agent_message_chunk",
						content: { type: "text", text: "next page" },
					},
				},
			});

			const firstPage = manager.getSessionEvents({
				sessionId,
				revision: 1,
				afterSeq: 0,
				limit: 2,
			});
			expect(firstPage.events).toEqual([]);
			expect(firstPage.hasMore).toBe(true);
			expect(firstPage.nextAfterSeq).toBe(2);

			const secondPage = manager.getSessionEvents({
				sessionId,
				revision: 1,
				afterSeq: firstPage.nextAfterSeq ?? 0,
				limit: 2,
			});
			expect(secondPage.events).toEqual([
				expect.objectContaining({ seq: 3, kind: "agent_message_chunk" }),
			]);
		});
	});

	// =========================================================================
	// isAttached field in session summaries
	// =========================================================================
	describe("isAttached in session summaries", () => {
		it("active sessions have isAttached=true in listSessions", async () => {
			await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});

			const sessions = sessionManager.listSessions();
			expect(sessions).toHaveLength(1);
			expect(sessions[0].isAttached).toBe(true);
		});

		it("sessions:changed event includes isAttached=true for created sessions", async () => {
			const changedListener = mock(() => {});
			sessionManager.onSessionsChanged(changedListener);

			await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});

			expect(changedListener).toHaveBeenCalledWith(
				expect.objectContaining({
					added: expect.arrayContaining([
						expect.objectContaining({ isAttached: true }),
					]),
				}),
			);
		});

		it("sessions:changed event from recordTurnEnd includes isAttached=true", async () => {
			await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});
			const sessions = sessionManager.listSessions();
			const sessionId = sessions[0].sessionId;

			const changedListener = mock(() => {});
			sessionManager.onSessionsChanged(changedListener);

			sessionManager.recordTurnEnd(sessionId, "end_turn");

			expect(changedListener).toHaveBeenCalledWith(
				expect.objectContaining({
					updated: expect.arrayContaining([
						expect.objectContaining({
							sessionId,
							isAttached: true,
						}),
					]),
				}),
			);
		});
	});

	// =========================================================================
	// 2.1 message event mapping (writeSessionUpdateToWal)
	// =========================================================================
	describe("message event mapping (writeSessionUpdateToWal)", () => {
		/**
		 * Helper: create a session, get the sessionId, and attach an event listener.
		 * Returns `{ sessionId, eventListener }`.
		 */
		const setupSessionWithListener = async () => {
			await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});
			const sessions = sessionManager.listSessions();
			const sessionId = sessions[0].sessionId;
			const eventListener = mock(() => {});
			sessionManager.onSessionEvent(eventListener);
			return { sessionId, eventListener };
		};

		it("maps user_message_chunk → user_message WAL event", async () => {
			const { sessionId, eventListener } = await setupSessionWithListener();
			expect(sessionUpdateCallback).toBeDefined();

			sessionUpdateCallback?.({
				sessionId,
				update: {
					sessionUpdate: "user_message_chunk",
					content: { type: "text", text: "Hello" },
				},
			} as SessionNotification);

			expect(eventListener).toHaveBeenCalledWith(
				expect.objectContaining({
					sessionId,
					kind: "user_message",
				}),
			);

			const events = sessionManager.getSessionEvents({
				sessionId,
				revision: 1,
				afterSeq: 0,
			});
			expect(events.events.some((event) => event.kind === "user_message")).toBe(
				true,
			);
		});

		it("persists the active messageId on matching user message events", async () => {
			const { sessionId, eventListener } = await setupSessionWithListener();
			expect(sessionUpdateCallback).toBeDefined();
			sessionManager.beginMessageSend(sessionId, "message-123");

			sessionUpdateCallback?.({
				sessionId,
				update: {
					sessionUpdate: "user_message_chunk",
					content: { type: "text", text: "Hello" },
				},
			} as SessionNotification);
			sessionManager.endMessageSend(sessionId, "message-123");

			expect(eventListener).toHaveBeenCalledWith(
				expect.objectContaining({
					sessionId,
					kind: "user_message",
					payload: expect.objectContaining({ messageId: "message-123" }),
				}),
			);
			const events = sessionManager.getSessionEvents({
				sessionId,
				revision: 1,
				afterSeq: 0,
			});
			expect(events.events[0]?.payload).toEqual(
				expect.objectContaining({ messageId: "message-123" }),
			);
		});

		it("maps agent_message_chunk → agent_message_chunk WAL event", async () => {
			const { sessionId, eventListener } = await setupSessionWithListener();

			sessionUpdateCallback?.({
				sessionId,
				update: {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "Hello from assistant" },
				},
			} as SessionNotification);

			expect(eventListener).toHaveBeenCalledWith(
				expect.objectContaining({
					sessionId,
					kind: "agent_message_chunk",
				}),
			);
		});

		it("maps agent_thought_chunk → agent_thought_chunk WAL event", async () => {
			const { sessionId, eventListener } = await setupSessionWithListener();

			sessionUpdateCallback?.({
				sessionId,
				update: {
					sessionUpdate: "agent_thought_chunk",
					content: { type: "text", text: "Thinking..." },
				},
			} as SessionNotification);

			expect(eventListener).toHaveBeenCalledWith(
				expect.objectContaining({
					sessionId,
					kind: "agent_thought_chunk",
				}),
			);
		});

		it("maps tool_call → tool_call WAL event", async () => {
			const { sessionId, eventListener } = await setupSessionWithListener();

			sessionUpdateCallback?.({
				sessionId,
				update: {
					sessionUpdate: "tool_call",
					toolCallId: "tc-1",
					status: "in_progress",
					title: "Reading file",
				},
			} as SessionNotification);

			expect(eventListener).toHaveBeenCalledWith(
				expect.objectContaining({
					sessionId,
					kind: "tool_call",
				}),
			);
		});

		it("maps tool_call_update → tool_call_update WAL event", async () => {
			const { sessionId, eventListener } = await setupSessionWithListener();

			sessionUpdateCallback?.({
				sessionId,
				update: {
					sessionUpdate: "tool_call_update",
					toolCallId: "tc-1",
					status: "completed",
				},
			} as SessionNotification);

			expect(eventListener).toHaveBeenCalledWith(
				expect.objectContaining({
					sessionId,
					kind: "tool_call_update",
				}),
			);
		});

		it("maps session_info_update → session_info_update WAL event", async () => {
			const { sessionId, eventListener } = await setupSessionWithListener();

			sessionUpdateCallback?.({
				sessionId,
				update: {
					sessionUpdate: "session_info_update",
					title: "Updated Title",
				},
			} as SessionNotification);

			expect(eventListener).toHaveBeenCalledWith(
				expect.objectContaining({
					sessionId,
					kind: "session_info_update",
				}),
			);
		});

		it("maps current_mode_update → session_info_update WAL event", async () => {
			const { sessionId, eventListener } = await setupSessionWithListener();

			sessionUpdateCallback?.({
				sessionId,
				update: {
					sessionUpdate: "current_mode_update",
					currentModeId: "architect",
				},
			} as SessionNotification);

			expect(eventListener).toHaveBeenCalledWith(
				expect.objectContaining({
					sessionId,
					kind: "session_info_update",
				}),
			);
		});

		it("maps usage_update → usage_update WAL event", async () => {
			const { sessionId, eventListener } = await setupSessionWithListener();

			sessionUpdateCallback?.({
				sessionId,
				update: {
					sessionUpdate: "usage_update",
					used: 100,
					size: 200,
				},
			} as SessionNotification);

			expect(eventListener).toHaveBeenCalledWith(
				expect.objectContaining({
					sessionId,
					kind: "usage_update",
				}),
			);
		});

		it("maps unknown update type → unknown_update WAL event", async () => {
			const { sessionId, eventListener } = await setupSessionWithListener();

			sessionUpdateCallback?.({
				sessionId,
				update: {
					sessionUpdate: "totally_new_type",
				},
			} as unknown as SessionNotification);

			expect(eventListener).toHaveBeenCalledWith(
				expect.objectContaining({
					sessionId,
					kind: "unknown_update",
				}),
			);
		});
	});

	// =========================================================================
	// 2.2 recordTurnEnd — sessionsChanged emission
	// =========================================================================
	describe("recordTurnEnd (sessionsChanged)", () => {
		it("emits sessionsChanged with updated session summary", async () => {
			await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});
			const sessions = sessionManager.listSessions();
			const sessionId = sessions[0].sessionId;

			const changedListener = mock(() => {});
			sessionManager.onSessionsChanged(changedListener);

			sessionManager.recordTurnEnd(sessionId, "end_turn");

			expect(changedListener).toHaveBeenCalledWith(
				expect.objectContaining({
					added: [],
					updated: expect.arrayContaining([
						expect.objectContaining({ sessionId }),
					]),
					removed: [],
				}),
			);
		});

		it("updates session.updatedAt before emitting", async () => {
			await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});
			const sessions = sessionManager.listSessions();
			const sessionId = sessions[0].sessionId;
			const beforeUpdatedAt = sessions[0].updatedAt;

			// Small delay to ensure time difference
			await new Promise((resolve) => setTimeout(resolve, 10));

			sessionManager.recordTurnEnd(sessionId, "end_turn");

			const updatedSessions = sessionManager.listSessions();
			const afterUpdatedAt = updatedSessions[0].updatedAt;
			expect(afterUpdatedAt >= beforeUpdatedAt).toBe(true);
		});

		it("no-op for non-existent session", () => {
			const eventListener = mock(() => {});
			sessionManager.onSessionEvent(eventListener);

			// Should not throw or emit any event
			sessionManager.recordTurnEnd("non-existent-session", "end_turn");

			expect(eventListener).not.toHaveBeenCalled();
		});
	});

	// =========================================================================
	// 2.3 message event sequence integrity
	// =========================================================================
	describe("message event sequence integrity", () => {
		it("emits events with incrementing seq numbers", async () => {
			await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});
			const sessions = sessionManager.listSessions();
			const sessionId = sessions[0].sessionId;
			expect(sessionUpdateCallback).toBeDefined();

			// Trigger multiple updates
			sessionUpdateCallback?.({
				sessionId,
				update: {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "A" },
				},
			} as SessionNotification);
			sessionUpdateCallback?.({
				sessionId,
				update: {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "B" },
				},
			} as SessionNotification);
			sessionUpdateCallback?.({
				sessionId,
				update: {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "C" },
				},
			} as SessionNotification);

			const events = sessionManager.getSessionEvents({
				sessionId,
				revision: 1,
				afterSeq: 0,
			});

			// Verify seq numbers increment
			const seqs = events.events.map((e) => e.seq);
			for (let i = 1; i < seqs.length; i++) {
				expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
			}
		});

		it("maintains correct seq across mixed event types", async () => {
			await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});
			const sessions = sessionManager.listSessions();
			const sessionId = sessions[0].sessionId;
			expect(sessionUpdateCallback).toBeDefined();

			// Mix different event types
			sessionUpdateCallback?.({
				sessionId,
				update: {
					sessionUpdate: "user_message_chunk",
					content: { type: "text", text: "Hello" },
				},
			} as SessionNotification);
			sessionUpdateCallback?.({
				sessionId,
				update: {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "Hi" },
				},
			} as SessionNotification);
			sessionUpdateCallback?.({
				sessionId,
				update: {
					sessionUpdate: "tool_call",
					toolCallId: "tc-1",
					status: "in_progress",
					title: "Test tool",
				},
			} as SessionNotification);

			const events = sessionManager.getSessionEvents({
				sessionId,
				revision: 1,
				afterSeq: 0,
			});

			expect(events.events.length).toBeGreaterThanOrEqual(3);
			// Kinds should match the order of dispatch
			const kinds = events.events.map((e) => e.kind);
			expect(kinds).toContain("user_message");
			expect(kinds).toContain("agent_message_chunk");
			expect(kinds).toContain("tool_call");

			// Seqs should be strictly increasing
			const seqs = events.events.map((e) => e.seq);
			for (let i = 1; i < seqs.length; i++) {
				expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
			}
		});

		it("events carry correct revision number", async () => {
			await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});
			const sessions = sessionManager.listSessions();
			const sessionId = sessions[0].sessionId;
			expect(sessionUpdateCallback).toBeDefined();

			sessionUpdateCallback?.({
				sessionId,
				update: {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "text" },
				},
			} as SessionNotification);

			const events = sessionManager.getSessionEvents({
				sessionId,
				revision: 1,
				afterSeq: 0,
			});

			for (const event of events.events) {
				expect(event.revision).toBe(1);
			}
		});
	});

	// =========================================================================
	// 2.4 session update subscription lifecycle
	// =========================================================================
	describe("session update subscription lifecycle", () => {
		it("persists updates emitted while session creation is in flight", async () => {
			mockConnection.createSession.mockImplementationOnce(async () => {
				sessionUpdateCallback?.({
					sessionId: "new-session-1",
					update: {
						sessionUpdate: "agent_message_chunk",
						content: { type: "text", text: "early update" },
					},
				} as SessionNotification);
				return {
					sessionId: "new-session-1",
					modes: null,
					configOptions: null,
				};
			});

			const created = await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});

			const events = sessionManager.getSessionEvents({
				sessionId: created.sessionId,
				revision: 1,
				afterSeq: 0,
			});
			expect(events.events).toEqual([
				expect.objectContaining({
					seq: 1,
					kind: "agent_message_chunk",
					payload: expect.objectContaining({
						update: expect.objectContaining({
							content: { type: "text", text: "early update" },
						}),
					}),
				}),
			]);
		});

		it("subscribes to onSessionUpdate when session is created", async () => {
			await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});

			// onSessionUpdate should have been called during createSession
			expect(mockConnection.onSessionUpdate).toHaveBeenCalled();
			expect(sessionUpdateCallback).toBeDefined();
		});

		it("unsubscribes when session is closed", async () => {
			const created = await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});

			expect(sessionUpdateCallback).toBeDefined();

			await sessionManager.closeSession(created.sessionId);

			// After close, the callback should have been cleared by the unsubscribe function
			expect(sessionUpdateCallback).toBeUndefined();
		});

		it("handles updates after session is closed gracefully", async () => {
			const created = await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});
			const sessionId = created.sessionId;

			// Capture the callback before close
			const capturedCallback = sessionUpdateCallback;
			expect(capturedCallback).toBeDefined();

			// Record count of events before close
			const beforeEvents = sessionManager.getSessionEvents({
				sessionId,
				revision: 1,
				afterSeq: 0,
			});
			const eventCountBeforeClose = beforeEvents.events.length;

			// Close the session (clears callback via unsubscribe)
			await sessionManager.closeSession(sessionId);

			// After close, the callback should have been cleared by the unsubscribe function
			expect(sessionUpdateCallback).toBeUndefined();

			// Verify no new events were written post-close
			const afterEvents = sessionManager.getSessionEvents({
				sessionId,
				revision: 1,
				afterSeq: 0,
			});
			expect(afterEvents.events.length).toBe(eventCountBeforeClose);
		});

		it("ignores late connection status errors after a session is closed", async () => {
			const created = await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});
			expect(statusChangeCallback).toBeDefined();

			await sessionManager.closeSession(created.sessionId);
			expect(statusChangeCallback).toBeUndefined();

			const events = sessionManager.getSessionEvents({
				sessionId: created.sessionId,
				revision: 1,
				afterSeq: 0,
			});
			expect(events.events).toEqual([]);
		});
	});
});
