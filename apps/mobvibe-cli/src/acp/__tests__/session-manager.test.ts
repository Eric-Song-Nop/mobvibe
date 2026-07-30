import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, it, mock } from "bun:test";
import type {
	JsonRpcId,
	ListSessionsResponse,
	LoadSessionResponse,
	NewSessionResponse,
	RequestPermissionRequest,
	RequestPermissionResponse,
	ResumeSessionResponse,
	SessionNotification,
	SetSessionConfigOptionResponse,
} from "@agentclientprotocol/sdk";
import { RequestError } from "@agentclientprotocol/sdk";
import {
	ACP_PLAN_MARKDOWN_MAX_BYTES,
	type AgentSessionCapabilities,
	AppError,
	createErrorDetail,
	decryptPayload,
	deriveContentKeyPair,
	generateMasterSecret,
	initCrypto,
	isEncryptedPayload,
	type PermissionDecisionPayload,
	type PermissionRequestPayload,
	type PlaceTeamRelayPeerParams,
	type PlaceTeamRelayPeerResult,
	type ResolveTeamRelayPeerParams,
	type ResolveTeamRelayPeerResult,
	type SendTeamRelayParams,
	type SendTeamRelayResult,
	type TeamRelayExecuteRpcParams,
	type TeamRelayExecuteRpcResult,
	unwrapDEK,
} from "@mobvibe/shared";
import type { CliConfig } from "../../config.js";
import { CliCryptoService } from "../../e2ee/crypto-service.js";
import type { AgentTeamStore } from "../../team/agent-team-store.js";
import { buildTeamMcpServerId } from "../../team/team-capability.js";
import { TEAM_COMMAND_ENVELOPE_VERSION } from "../../team/team-command-bus.js";
import type { TeamRelayWireTransport } from "../../team/team-relay-client.js";
import {
	TeamRelayProtocol,
	TeamRelayRemoteError,
	type VerifiedTeamRelayRequest,
} from "../../team/team-relay-protocol.js";
import { TeamRelayStore } from "../../team/team-relay-store.js";
import type { TeamRuntime } from "../../team/team-runtime.js";
import { createTeamTurnCompletedRelayPayload } from "../../team/team-runtime-relay.js";
import { WalStore } from "../../wal/wal-store.js";
import type { AcpBackendStatus, AcpConnection } from "../acp-connection.js";
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
const { logger: mockedLogger } = await import("../../lib/logger.js");
const loggerWarnMock = mockedLogger.warn as unknown as ReturnType<typeof mock>;

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

type SessionManagerTeamInternals = {
	agentTeamStore: AgentTeamStore;
	permissionRequests: Map<string, unknown>;
	teamRelayStore: TeamRelayStore;
	teamRuntime: TeamRuntime;
	walStore: WalStore;
	waitForTeamToolsReady(agentTeamId: string, memberId: string): Promise<void>;
};

type SessionManagerTeamRelayApi = {
	attachTeamRelayTransport(transport: TeamRelayWireTransport): void;
	bindTeamRelayMachineIdentity(machineId: string): void;
	handleTeamRelayRequest(params: unknown): Promise<TeamRelayExecuteRpcResult>;
	setTeamRelayTransportReady(ready: boolean): boolean;
};

type SessionManagerBackendInternals = {
	resolveBackend(backendId: string): unknown;
};

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
	prompt: mock(() => Promise.resolve({ stopReason: "end_turn" as const })),
	getStatus: mock(
		(): AcpBackendStatus => ({
			backendId: "backend-1",
			backendLabel: "Claude Code",
			state: "ready",
			command: "claude-code",
			args: [],
			pid: 12345,
		}),
	),
	getAgentInfo: mock(() => ({
		name: "claude-code",
		title: "Claude Code",
	})),
	getSessionCapabilities: mock(
		(): AgentSessionCapabilities => ({
			list: true,
			load: true,
			resume: true,
			close: true,
			delete: true,
		}),
	),
	getAuthenticationCapabilities: mock(() => ({
		methods: [{ id: "browser", name: "Browser sign-in" }],
		logout: true,
	})),
	supportsLogout: mock(() => true),
	authenticate: mock((): Promise<void> => Promise.resolve()),
	logout: mock((): Promise<void> => Promise.resolve()),
	supportsSessionList: mock(() => true),
	supportsSessionLoad: mock(() => true),
	supportsSessionResume: mock(() => true),
	supportsSessionClose: mock(() => true),
	supportsSessionDelete: mock(() => true),
	closeSession: mock(() => Promise.resolve({})),
	deleteSession: mock(() => Promise.resolve({})),
	listSessions: mock(
		(): Promise<ListSessionsResponse> =>
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
	loadSession: mock(
		(): Promise<LoadSessionResponse> =>
			Promise.resolve({
				modes: null,
				configOptions: null,
			}),
	),
	resumeSession: mock(
		(): Promise<ResumeSessionResponse> =>
			Promise.resolve({
				modes: null,
				configOptions: null,
			}),
	),
	setSessionConfigOption: mock(
		(
			_sessionId: string,
			configId: string,
			value: string | boolean,
			_meta?: Record<string, unknown> | null,
		): Promise<SetSessionConfigOptionResponse> =>
			Promise.resolve({
				configOptions: [
					{
						id: configId,
						name: "Model",
						category: "model",
						type: "select" as const,
						currentValue: String(value),
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

type TeamMcpTestHandlers = {
	handleConnect(input: { serverId: string }): unknown;
	handleListTools(input: { serverId: string; toolNames: string[] }): void;
	handleDisconnect(input: { serverId: string }): unknown;
};

type TeamMcpTestBinding = {
	handlers: TeamMcpTestHandlers;
	serverId: string;
};

const bindTeamMcpForTest = (
	params: unknown,
	toolNames?: string[],
): TeamMcpTestBinding => {
	const options = params as {
		teamMcpDeclaration?: { serverId?: string };
		teamMcpHandlers?: TeamMcpTestHandlers;
	};
	const serverId = options.teamMcpDeclaration?.serverId;
	const handlers = options.teamMcpHandlers;
	if (!handlers || !serverId) {
		throw new Error("Expected Team MCP options");
	}
	handlers.handleConnect({ serverId });
	if (toolNames) {
		handlers.handleListTools({ serverId, toolNames });
	}
	return { handlers, serverId };
};

const prepareTeamSessionConnection = (
	connection: ReturnType<typeof createMockConnection>,
	sessionId: string,
	toolNames?: string[],
): void => {
	let binding: TeamMcpTestBinding | undefined;
	connection.getSessionCapabilities.mockReturnValue({
		list: true,
		load: true,
		close: true,
		mcp: { acp: true },
	});
	connection.createSession.mockImplementationOnce(
		async (...args: unknown[]) => {
			binding = bindTeamMcpForTest(args[0], toolNames);
			return { sessionId, modes: null, configOptions: null };
		},
	);
	connection.disconnect.mockImplementation(async () => {
		if (binding) {
			binding.handlers.handleDisconnect({ serverId: binding.serverId });
		}
	});
};

const requirePermissionHandler = () => {
	if (!permissionHandlerCallback) {
		throw new Error("Permission handler was not registered");
	}
	return permissionHandlerCallback;
};

const requireSessionRevision = <T extends { revision?: number }>(
	session: T | undefined,
): T & { revision: number } => {
	if (!session || session.revision === undefined) {
		throw new Error("Expected session revision");
	}
	return session as T & { revision: number };
};

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

	const expectedRemoteTeamTools = [
		"mobvibe_team_send_message",
		"mobvibe_team_members",
		"mobvibe_team_spawn_member",
		"mobvibe_team_task_create",
		"mobvibe_team_task_list",
		"mobvibe_team_task_update",
	];

	type RemoteWorkerRelayBehavior = {
		attachTransport?: boolean;
		leaderMachineId?: string;
		outgoingError?: Error;
		outgoingResponse?: (
			request: VerifiedTeamRelayRequest,
		) => unknown | Promise<unknown>;
		workerMachineId?: string;
	};

	const prepareEncryptedRemoteWorker = async (
		behavior: RemoteWorkerRelayBehavior = {},
	) => {
		await initCrypto();
		await sessionManager.shutdown();

		const workerCrypto = new CliCryptoService(new Uint8Array(32).fill(42));
		const leaderCrypto = new CliCryptoService(new Uint8Array(32).fill(41));
		sessionManager = new SessionManager(mockConfig, workerCrypto, {
			validateWorkspacePath: async () => true,
		});
		mockConnection = createMockConnection();
		sessionManager.createConnection = () =>
			mockConnection as unknown as AcpConnection;

		const workerProtocol = new TeamRelayProtocol({
			machineId: behavior.workerMachineId ?? mockConfig.machineId,
			cryptoService: workerCrypto,
		});
		const leaderProtocol = new TeamRelayProtocol({
			machineId: behavior.leaderMachineId ?? "leader-machine",
			cryptoService: leaderCrypto,
		});
		const outgoingRequests: VerifiedTeamRelayRequest[] = [];
		const sendTeamRelay = mock(
			async (params: SendTeamRelayParams): Promise<SendTeamRelayResult> => {
				const request = leaderProtocol.openRequest({
					operationId: params.operationId,
					sourceMachineId: workerProtocol.machineId,
					sourceRelayKey: workerProtocol.relayKey,
					ciphertext: params.ciphertext,
				});
				outgoingRequests.push(request);
				if (behavior.outgoingError) {
					throw behavior.outgoingError;
				}
				if (!behavior.outgoingResponse) {
					throw new Error("Unexpected outgoing Team relay");
				}
				const response = leaderProtocol.sealSuccess(
					request,
					await behavior.outgoingResponse(request),
				);
				return {
					operationId: params.operationId,
					targetMachineId: params.targetMachineId,
					ciphertext: response.ciphertext,
				};
			},
		);
		const transport: TeamRelayWireTransport = {
			placeTeamRelayPeer: () =>
				Promise.resolve({
					targetMachineId: leaderProtocol.machineId,
					relayKey: leaderProtocol.relayKey,
				}),
			resolveTeamRelayPeer: ({ targetMachineId }) =>
				Promise.resolve({
					targetMachineId,
					relayKey: leaderProtocol.relayKey,
				}),
			sendTeamRelay,
		};
		const relayApi = sessionManager as unknown as SessionManagerTeamRelayApi;
		relayApi.bindTeamRelayMachineIdentity(workerProtocol.machineId);
		if (behavior.attachTransport !== false) {
			relayApi.attachTeamRelayTransport(transport);
			relayApi.setTeamRelayTransportReady(true);
		}
		return {
			internals: sessionManager as unknown as SessionManagerTeamInternals,
			leaderProtocol,
			outgoingRequests,
			relayApi,
			sendTeamRelay,
			transport,
			workerProtocol,
		};
	};

	const createRemoteBootstrapFixture = (
		operationId: string,
		suffix: string,
	) => {
		const agentTeamId = `remote-team-${suffix}`;
		const memberId = `remote-member-${suffix}`;
		return {
			operationId,
			agentTeamId,
			memberId,
			serverId: buildTeamMcpServerId({ agentTeamId, memberId }),
			backendId: "backend-1",
			cwd: "/home/user/project",
			additionalDirectories: ["/home/user/shared"],
		};
	};

	const sealRemoteBootstrap = (
		harness: Awaited<ReturnType<typeof prepareEncryptedRemoteWorker>>,
		fixture: ReturnType<typeof createRemoteBootstrapFixture>,
	): TeamRelayExecuteRpcParams => {
		const sealed = harness.leaderProtocol.sealRequest({
			operationId: fixture.operationId,
			operation: "member.bootstrap",
			targetMachineId: harness.workerProtocol.machineId,
			targetRelayKey: harness.workerProtocol.relayKey,
			payload: fixture,
		});
		return {
			operationId: fixture.operationId,
			sourceMachineId: harness.leaderProtocol.machineId,
			sourceRelayKey: harness.leaderProtocol.relayKey,
			ciphertext: sealed.ciphertext,
		};
	};

	const openRemoteBootstrapResponse = (
		harness: Awaited<ReturnType<typeof prepareEncryptedRemoteWorker>>,
		operationId: string,
		response: TeamRelayExecuteRpcResult,
	): unknown =>
		harness.leaderProtocol.openResponse({
			operationId,
			operation: "member.bootstrap",
			targetMachineId: harness.workerProtocol.machineId,
			targetRelayKey: harness.workerProtocol.relayKey,
			ciphertext: response.ciphertext,
		});

	type RemoteSpawnRelayBehavior = {
		placeError?: Error;
		remoteFailure?: Error;
		sendError?: Error;
		response?: (request: VerifiedTeamRelayRequest) => unknown;
	};

	const prepareEncryptedLeaderForRemoteSpawn = async (
		behavior: RemoteSpawnRelayBehavior = {},
	) => {
		await initCrypto();
		await sessionManager.shutdown();

		const leaderCrypto = new CliCryptoService(new Uint8Array(32).fill(51));
		const workerCrypto = new CliCryptoService(new Uint8Array(32).fill(52));
		sessionManager = new SessionManager(mockConfig, leaderCrypto, {
			validateWorkspacePath: async () => true,
		});
		mockConnection = createMockConnection();
		prepareTeamSessionConnection(
			mockConnection,
			"leader-session-for-remote-spawn",
			expectedRemoteTeamTools,
		);
		const createConnection = mock(
			() => mockConnection as unknown as AcpConnection,
		);
		sessionManager.createConnection = createConnection;

		const leaderProtocol = new TeamRelayProtocol({
			machineId: mockConfig.machineId,
			cryptoService: leaderCrypto,
		});
		const workerProtocol = new TeamRelayProtocol({
			machineId: "remote-worker-machine",
			cryptoService: workerCrypto,
		});
		const verifiedRequests: VerifiedTeamRelayRequest[] = [];
		const placeTeamRelayPeer = mock(
			async (
				_params: PlaceTeamRelayPeerParams,
			): Promise<PlaceTeamRelayPeerResult> => {
				if (behavior.placeError) {
					throw behavior.placeError;
				}
				return {
					targetMachineId: workerProtocol.machineId,
					relayKey: workerProtocol.relayKey,
				};
			},
		);
		const resolveTeamRelayPeer = mock(
			async (
				_params: ResolveTeamRelayPeerParams,
			): Promise<ResolveTeamRelayPeerResult> => {
				throw new Error("Placed relay key must be used directly");
			},
		);
		const sendTeamRelay = mock(
			async (params: SendTeamRelayParams): Promise<SendTeamRelayResult> => {
				const verified = workerProtocol.openRequest({
					operationId: params.operationId,
					sourceMachineId: leaderProtocol.machineId,
					sourceRelayKey: leaderProtocol.relayKey,
					ciphertext: params.ciphertext,
				});
				verifiedRequests.push(verified);
				if (behavior.sendError) {
					throw behavior.sendError;
				}
				const payload = verified.payload as { serverId?: unknown };
				if (behavior.remoteFailure) {
					const response = workerProtocol.sealFailure(
						verified,
						behavior.remoteFailure,
					);
					return {
						operationId: params.operationId,
						targetMachineId: params.targetMachineId,
						ciphertext: response.ciphertext,
					};
				}
				const value = behavior.response
					? behavior.response(verified)
					: {
							operationId: verified.operationId,
							serverId: payload.serverId,
							sessionId: "remote-member-session",
						};
				const response = workerProtocol.sealSuccess(verified, value);
				return {
					operationId: params.operationId,
					targetMachineId: params.targetMachineId,
					ciphertext: response.ciphertext,
				};
			},
		);
		const transport: TeamRelayWireTransport = {
			placeTeamRelayPeer,
			resolveTeamRelayPeer,
			sendTeamRelay,
		};
		const relayApi = sessionManager as unknown as SessionManagerTeamRelayApi;
		relayApi.bindTeamRelayMachineIdentity(leaderProtocol.machineId);
		relayApi.attachTeamRelayTransport(transport);
		relayApi.setTeamRelayTransportReady(true);

		const created = await sessionManager.createAgentTeamRun({
			machineId: mockConfig.machineId,
			backendId: "backend-1",
			workspaceRootCwd: "/home/user/project",
			title: "Cross-machine Team",
			leaderName: "Leader",
		});
		const backendInternals =
			sessionManager as unknown as SessionManagerBackendInternals;
		const originalResolveBackend =
			backendInternals.resolveBackend.bind(sessionManager);
		const resolveBackend = mock((backendId: string) =>
			originalResolveBackend(backendId),
		);
		backendInternals.resolveBackend = resolveBackend;

		return {
			createConnection,
			created,
			internals: sessionManager as unknown as SessionManagerTeamInternals,
			leaderProtocol,
			placeTeamRelayPeer,
			resolveBackend,
			resolveTeamRelayPeer,
			sendTeamRelay,
			verifiedRequests,
			workerProtocol,
		};
	};

	describe("Agent-managed authentication", () => {
		it("probes capabilities without creating a session", async () => {
			mockConnection.getSessionCapabilities.mockReturnValue({
				list: true,
				load: false,
				auth: {
					methods: [{ id: "browser", name: "Browser sign-in" }],
					logout: true,
				},
			});

			const capabilities =
				await sessionManager.getAgentCapabilities("backend-1");

			expect(capabilities.auth).toEqual({
				methods: [{ id: "browser", name: "Browser sign-in" }],
				logout: true,
			});
			expect(mockConnection.connect).toHaveBeenCalledTimes(1);
			expect(mockConnection.createSession).not.toHaveBeenCalled();
		});

		it("reuses the authenticated process for the next session", async () => {
			await sessionManager.authenticateAgent("backend-1", "browser");
			await sessionManager.createSession({
				backendId: "backend-1",
				cwd: "/home/user/project",
			});

			expect(mockConnection.authenticate).toHaveBeenCalledWith("browser");
			expect(mockConnection.connect).toHaveBeenCalledTimes(1);
			expect(mockConnection.createSession).toHaveBeenCalledTimes(1);
		});

		it("discards a connection when authentication fails", async () => {
			mockConnection.authenticate.mockRejectedValueOnce(
				new Error("agent failed"),
			);

			await expect(
				sessionManager.authenticateAgent("backend-1", "browser"),
			).rejects.toMatchObject({
				detail: { code: "AGENT_AUTHENTICATION_FAILED" },
			});
			expect(mockConnection.disconnect).toHaveBeenCalledTimes(1);

			await sessionManager.getAgentCapabilities("backend-1");
			expect(mockConnection.connect).toHaveBeenCalledTimes(2);
		});

		it("rejects logout while that backend has an active session", async () => {
			await sessionManager.createSession({
				backendId: "backend-1",
				cwd: "/home/user/project",
			});

			await expect(
				sessionManager.logoutAgent("backend-1"),
			).rejects.toMatchObject({ detail: { code: "SESSION_BUSY" } });
			expect(mockConnection.logout).not.toHaveBeenCalled();
		});

		it("disconnects the process after logout success or failure", async () => {
			await sessionManager.logoutAgent("backend-1");
			expect(mockConnection.logout).toHaveBeenCalledTimes(1);
			expect(mockConnection.disconnect).toHaveBeenCalledTimes(1);

			mockConnection.logout.mockRejectedValueOnce(new Error("logout failed"));
			await expect(
				sessionManager.logoutAgent("backend-1"),
			).rejects.toMatchObject({
				detail: { code: "AGENT_AUTHENTICATION_FAILED" },
			});
			expect(mockConnection.disconnect).toHaveBeenCalledTimes(2);
		});

		it("serializes process lifecycle operations for one backend", async () => {
			let markConnectStarted = () => {};
			const connectStarted = new Promise<void>((resolve) => {
				markConnectStarted = resolve;
			});
			let releaseConnect = () => {};
			const connectGate = new Promise<void>((resolve) => {
				releaseConnect = resolve;
			});
			mockConnection.connect.mockImplementationOnce(async () => {
				markConnectStarted();
				await connectGate;
			});

			const first = sessionManager.getAgentCapabilities("backend-1");
			await connectStarted;
			const second = sessionManager.getAgentCapabilities("backend-1");
			await Promise.resolve();
			expect(mockConnection.connect).toHaveBeenCalledTimes(1);

			releaseConnect();
			await Promise.all([first, second]);
			expect(mockConnection.connect).toHaveBeenCalledTimes(1);
		});

		it("does not serialize different backend IDs together", async () => {
			const secondBackendConfig: CliConfig = {
				...mockConfig,
				walDbPath: `${mockConfig.walDbPath}-backend-isolation`,
				acpBackends: [
					...mockConfig.acpBackends,
					{
						id: "backend-2",
						label: "Second",
						command: "second",
						args: [],
					},
				],
			};
			const manager = new SessionManager(secondBackendConfig);
			const firstConnection = createMockConnection();
			const secondConnection = createMockConnection();
			let markFirstStarted = () => {};
			const firstStarted = new Promise<void>((resolve) => {
				markFirstStarted = resolve;
			});
			let releaseFirst = () => {};
			const firstGate = new Promise<void>((resolve) => {
				releaseFirst = resolve;
			});
			firstConnection.connect.mockImplementationOnce(async () => {
				markFirstStarted();
				await firstGate;
			});
			manager.createConnection = (backend) =>
				(backend.id === "backend-1"
					? firstConnection
					: secondConnection) as unknown as AcpConnection;

			const first = manager.getAgentCapabilities("backend-1");
			await firstStarted;
			const second = manager.getAgentCapabilities("backend-2");
			await Promise.resolve();
			expect(secondConnection.connect).toHaveBeenCalledTimes(1);
			releaseFirst();
			await Promise.all([first, second]);
			await manager.shutdown();
		});

		it("waits for backend lifecycle tails during shutdown", async () => {
			let markConnectStarted = () => {};
			const connectStarted = new Promise<void>((resolve) => {
				markConnectStarted = resolve;
			});
			let releaseConnect = () => {};
			const connectGate = new Promise<void>((resolve) => {
				releaseConnect = resolve;
			});
			mockConnection.connect.mockImplementationOnce(async () => {
				markConnectStarted();
				await connectGate;
			});

			const probe = sessionManager.getAgentCapabilities("backend-1");
			await connectStarted;
			let shutdownComplete = false;
			const shutdown = sessionManager.shutdown().then(() => {
				shutdownComplete = true;
			});
			await Promise.resolve();
			expect(shutdownComplete).toBe(false);

			releaseConnect();
			await Promise.all([probe, shutdown]);
			expect(mockConnection.disconnect).toHaveBeenCalled();
		});

		it("stops the pending Team wake sweep before closing its durable store", async () => {
			const internals =
				sessionManager as unknown as SessionManagerTeamInternals;
			const shutdownOrder: string[] = [];
			const originalStop = internals.teamRuntime.stop.bind(
				internals.teamRuntime,
			);
			const originalClose = internals.agentTeamStore.close.bind(
				internals.agentTeamStore,
			);
			internals.teamRuntime.stop = mock(() => {
				shutdownOrder.push("runtime.stop");
				originalStop();
			});
			internals.agentTeamStore.close = mock(() => {
				shutdownOrder.push("store.close");
				originalClose();
			});

			await sessionManager.shutdown();

			expect(shutdownOrder).toEqual(["runtime.stop", "store.close"]);
		});

		it("times out an Agent authentication flow and discards the process", async () => {
			const timeoutManager = new SessionManager(
				{
					...mockConfig,
					walDbPath: `${mockConfig.walDbPath}-auth-timeout`,
				},
				undefined,
				{ agentAuthOperationTimeoutMs: 5 },
			);
			const timeoutConnection = createMockConnection();
			timeoutConnection.authenticate.mockImplementationOnce(
				() => new Promise<void>(() => {}),
			);
			timeoutManager.createConnection = () =>
				timeoutConnection as unknown as AcpConnection;

			await expect(
				timeoutManager.authenticateAgent("backend-1", "browser"),
			).rejects.toMatchObject({
				detail: { code: "AGENT_AUTHENTICATION_FAILED" },
			});
			expect(timeoutConnection.disconnect).toHaveBeenCalledTimes(1);
			await timeoutManager.shutdown();
		});

		it("maps ACP auth_required without exposing protocol error data", async () => {
			mockConnection.createSession.mockRejectedValueOnce(
				new RequestError(-32000, "private agent detail", {
					tokenHint: "must-not-cross",
				}),
			);

			await expect(
				sessionManager.createSession({
					backendId: "backend-1",
					cwd: "/home/user/project",
				}),
			).rejects.toMatchObject({
				detail: {
					code: "AGENT_AUTHENTICATION_REQUIRED",
					message: "Agent authentication is required",
				},
			});
		});
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

		it("drops overlong Agent session IDs before local persistence", async () => {
			const overlongSessionId = "x".repeat(1025);
			mockConnection.listSessions.mockResolvedValueOnce({
				sessions: [
					{
						sessionId: overlongSessionId,
						cwd: "/home/user/project1",
					},
					{
						sessionId: "bounded-session",
						cwd: "/home/user/project2",
					},
				],
			});

			const result = await sessionManager.discoverSessions({
				backendId: "backend-1",
			});

			expect(result.sessions.map((session) => session.sessionId)).toEqual([
				"bounded-session",
			]);
			expect(
				(
					sessionManager as unknown as { walStore: WalStore }
				).walStore.getDiscoveredSessionBackendId(overlongSessionId),
			).toBeUndefined();
		});

		it("preserves and clears complete session list metadata snapshots", async () => {
			mockConnection.listSessions.mockResolvedValueOnce({
				sessions: [
					{
						sessionId: "discovered-meta",
						cwd: "/home/user/project1",
						title: "Metadata session",
						updatedAt: "2026-07-01T00:00:00.000Z",
						_meta: { source: "agent", nested: { keep: null } },
					},
				],
			});
			const first = await sessionManager.discoverSessions({
				backendId: "backend-1",
			});
			expect(first.sessions[0]?._meta).toEqual({
				source: "agent",
				nested: { keep: null },
			});
			expect(
				sessionManager
					.listAllSessions()
					.find((session) => session.sessionId === "discovered-meta")?._meta,
			).toEqual({ source: "agent", nested: { keep: null } });

			mockConnection.listSessions.mockResolvedValueOnce({
				sessions: [
					{
						sessionId: "discovered-meta",
						cwd: "/home/user/project1",
						title: null,
						updatedAt: null,
						_meta: null,
					},
				],
			});
			const cleared = await sessionManager.discoverSessions({
				backendId: "backend-1",
			});
			expect(cleared.sessions[0]).toEqual(
				expect.objectContaining({
					title: null,
					updatedAt: null,
					_meta: null,
				}),
			);
			expect(
				sessionManager
					.listAllSessions()
					.find((session) => session.sessionId === "discovered-meta")?._meta,
			).toBeNull();
		});

		it("throws error for invalid backend", async () => {
			await expect(
				sessionManager.discoverSessions({ backendId: "invalid-backend" }),
			).rejects.toThrow("Invalid backend ID");
		});
	});

	describe("additional directories", () => {
		const getWalStore = () =>
			(
				sessionManager as unknown as {
					walStore: WalStore;
				}
			).walStore;

		it("normalizes create roots and persists them in summaries and WAL", async () => {
			const created = await sessionManager.createSession({
				cwd: "/home/user/project",
				additionalDirectories: [
					"/home/user/project",
					"/data",
					"/data/nested",
					"/data",
				],
				backendId: "backend-1",
			});

			expect(mockConnection.createSession).toHaveBeenCalledWith({
				cwd: "/home/user/project",
				additionalDirectories: ["/data", "/data/nested"],
			});
			expect(created.additionalDirectories).toEqual(["/data", "/data/nested"]);
			expect(
				getWalStore().getSession(created.sessionId)?.additionalDirectories,
			).toEqual(["/data", "/data/nested"]);
			expect(
				sessionManager
					.listAllSessions()
					.find((session) => session.sessionId === created.sessionId)
					?.additionalDirectories,
			).toEqual(["/data", "/data/nested"]);
		});

		it("persists discovered ordered roots into listAllSessions", async () => {
			mockConnection.listSessions.mockResolvedValueOnce({
				sessions: [
					{
						sessionId: "discovered-roots",
						cwd: "/home/user/project1",
						additionalDirectories: ["/shared", "/shared/nested"],
						title: "Roots",
					},
				],
				nextCursor: undefined,
			});

			const discovered = await sessionManager.discoverSessions({
				backendId: "backend-1",
			});

			expect(discovered.sessions[0]?.additionalDirectories).toEqual([
				"/shared",
				"/shared/nested",
			]);
			expect(
				getWalStore().getDiscoveredSessions()[0]?.additionalDirectories,
			).toEqual(["/shared", "/shared/nested"]);
			expect(
				sessionManager
					.listAllSessions()
					.find((session) => session.sessionId === "discovered-roots")
					?.additionalDirectories,
			).toEqual(["/shared", "/shared/nested"]);
		});
	});

	describe("resumeSession", () => {
		const getWalStore = () =>
			(
				sessionManager as unknown as {
					walStore: WalStore;
				}
			).walStore;

		it("rejects a relative cwd before acquiring an agent connection", async () => {
			await expect(
				sessionManager.resumeSession(
					"resume-only",
					"relative/project",
					"backend-1",
				),
			).rejects.toMatchObject({ status: 400 });
			expect(mockConnection.connect).not.toHaveBeenCalled();
			expect(getWalStore().getSession("resume-only")).toBeNull();
		});

		it("preserves durable revision and history while attaching", async () => {
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
			const historyBefore = sessionManager.getSessionEvents({
				sessionId: created.sessionId,
				revision: 1,
				afterSeq: 0,
			});
			await sessionManager.closeSession(created.sessionId);

			const resumed = await sessionManager.resumeSession(
				created.sessionId,
				"/home/user/project",
				"backend-1",
				["/shared"],
			);

			expect(mockConnection.resumeSession).toHaveBeenCalledWith(
				created.sessionId,
				"/home/user/project",
				["/shared"],
			);
			expect(resumed.revision).toBe(1);
			expect(resumed.additionalDirectories).toEqual(["/shared"]);
			expect(
				sessionManager.getSessionEvents({
					sessionId: created.sessionId,
					revision: 1,
					afterSeq: 0,
				}),
			).toEqual(historyBefore);
		});

		it("rejects a cwd change before calling the agent or mutating WAL", async () => {
			const created = await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});
			await sessionManager.closeSession(created.sessionId);
			mockConnection.resumeSession.mockClear();

			await expect(
				sessionManager.resumeSession(
					created.sessionId,
					"/home/user/project2",
					"backend-1",
				),
			).rejects.toMatchObject({ status: 400 });

			expect(mockConnection.resumeSession).not.toHaveBeenCalled();
			expect(getWalStore().getSession(created.sessionId)?.cwd).toBe(
				"/home/user/project",
			);
		});

		it("validates persisted discovery affinity after a daemon restart", async () => {
			const persistedConfig = {
				...mockConfig,
				walDbPath: `/tmp/mobvibe-test/resume-discovery-${Date.now()}-${Math.random()
					.toString(36)
					.slice(2)}.db`,
			};
			const seedStore = new WalStore(persistedConfig.walDbPath);
			seedStore.saveDiscoveredSessions([
				{
					sessionId: "persisted-discovery",
					backendId: "backend-1",
					cwd: "/home/user/project",
					discoveredAt: new Date().toISOString(),
					isStale: false,
				},
			]);
			seedStore.close();
			const restartedManager = new SessionManager(persistedConfig, undefined, {
				validateWorkspacePath: async () => true,
			});
			const restartedConnection = createMockConnection();
			restartedManager.createConnection = () =>
				restartedConnection as unknown as AcpConnection;

			try {
				await expect(
					restartedManager.resumeSession(
						"persisted-discovery",
						"/home/user/project2",
						"backend-1",
					),
				).rejects.toMatchObject({ status: 400 });
				await expect(
					restartedManager.resumeSession(
						"persisted-discovery",
						"/home/user/project",
						"backend-2",
					),
				).rejects.toMatchObject({ status: 400 });
				expect(restartedConnection.resumeSession).not.toHaveBeenCalled();
			} finally {
				await restartedManager.shutdown();
			}
		});

		it("uses a durable discovery snapshot after restart and clears a stale unpinned WAL title", async () => {
			const persistedConfig = {
				...mockConfig,
				walDbPath: `/tmp/mobvibe-test/resume-title-${Date.now()}-${Math.random()
					.toString(36)
					.slice(2)}.db`,
			};
			const sessionId = "persisted-resume-title";
			const seedStore = new WalStore(persistedConfig.walDbPath);
			seedStore.ensureSession({
				sessionId,
				machineId: persistedConfig.machineId,
				backendId: "backend-1",
				cwd: "/home/user/project",
				title: "Stale WAL title",
				isTitlePinned: false,
			});
			seedStore.saveDiscoveredSessions([
				{
					sessionId,
					backendId: "backend-1",
					cwd: "/home/user/project",
					title: null,
					_meta: { source: "durable discovery" },
					discoveredAt: new Date().toISOString(),
					isStale: false,
				},
			]);
			seedStore.close();

			const restartedManager = new SessionManager(persistedConfig, undefined, {
				validateWorkspacePath: async () => true,
			});
			const restartedConnection = createMockConnection();
			restartedManager.createConnection = () =>
				restartedConnection as unknown as AcpConnection;

			try {
				const resumed = await restartedManager.resumeSession(
					sessionId,
					"/home/user/project",
					"backend-1",
				);

				expect(resumed.title).toBe("Session persiste");
				expect(resumed._meta).toEqual({ source: "durable discovery" });
				const persisted = (
					restartedManager as unknown as {
						walStore: WalStore;
					}
				).walStore.getSession(sessionId);
				expect(persisted?.title).toBe("Session persiste");
				expect(persisted?.isTitlePinned).not.toBe(true);
			} finally {
				await restartedManager.shutdown();
			}
		});

		it("preserves a pinned WAL title over a durable discovery snapshot", async () => {
			const created = await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
				title: "Pinned local title",
			});
			await sessionManager.closeSession(created.sessionId);
			getWalStore().saveDiscoveredSessions([
				{
					sessionId: created.sessionId,
					backendId: "backend-1",
					cwd: "/home/user/project",
					title: "New agent title",
					discoveredAt: new Date().toISOString(),
					isStale: false,
				},
			]);

			const resumed = await sessionManager.resumeSession(
				created.sessionId,
				"/home/user/project",
				"backend-1",
			);

			expect(resumed.title).toBe("Pinned local title");
			expect(resumed.isTitlePinned).toBe(true);
		});

		it("replaces an attached session when the requested root list changes", async () => {
			const created = await sessionManager.createSession({
				cwd: "/home/user/project",
				additionalDirectories: ["/old"],
				backendId: "backend-1",
			});
			mockConnection.getStatus.mockReturnValue({
				backendId: "backend-1",
				backendLabel: "Claude Code",
				state: "ready",
				command: "claude-code",
				args: [],
				pid: 12345,
				sessionId: created.sessionId,
			});
			const replacement = createMockConnection();
			sessionManager.createConnection = () =>
				replacement as unknown as AcpConnection;
			getWalStore().saveDiscoveredSessions([
				{
					sessionId: created.sessionId,
					backendId: "backend-1",
					cwd: "/home/user/project",
					title: "Stale discovered title",
					discoveredAt: new Date().toISOString(),
					isStale: false,
				},
			]);

			const resumed = await sessionManager.resumeSession(
				created.sessionId,
				"/home/user/project",
				"backend-1",
				["/new"],
			);

			expect(mockConnection.disconnect).toHaveBeenCalledTimes(1);
			expect(replacement.resumeSession).toHaveBeenCalledWith(
				created.sessionId,
				"/home/user/project",
				["/new"],
			);
			expect(resumed.additionalDirectories).toEqual(["/new"]);
			expect(resumed.title).toBe(created.title);
		});

		it("leaves a failed replacement detached and permits a later resume", async () => {
			const created = await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});
			const detachedListener = mock(() => {});
			sessionManager.onSessionDetached(detachedListener);
			mockConnection.getStatus.mockReturnValue({
				backendId: "backend-1",
				backendLabel: "Claude Code",
				state: "error",
				command: "claude-code",
				args: [],
				pid: 12345,
			});
			const failedConnection = createMockConnection();
			failedConnection.connect.mockRejectedValueOnce(
				new Error("replacement failed"),
			);
			sessionManager.createConnection = () =>
				failedConnection as unknown as AcpConnection;

			await expect(
				sessionManager.resumeSession(
					created.sessionId,
					"/home/user/project",
					"backend-1",
				),
			).rejects.toThrow("replacement failed");
			expect(detachedListener).toHaveBeenCalledWith(
				expect.objectContaining({ sessionId: created.sessionId }),
			);
			expect(
				sessionManager
					.listAllSessions()
					.find((session) => session.sessionId === created.sessionId)
					?.isAttached,
			).toBe(false);

			const recoveredConnection = createMockConnection();
			sessionManager.createConnection = () =>
				recoveredConnection as unknown as AcpConnection;
			const resumed = await sessionManager.resumeSession(
				created.sessionId,
				"/home/user/project",
				"backend-1",
			);

			expect(resumed.isAttached).toBe(true);
			expect(recoveredConnection.resumeSession).toHaveBeenCalledTimes(1);
		});

		it("clears stale model and mode projections when resume returns null", async () => {
			mockConnection.createSession.mockResolvedValueOnce({
				sessionId: "new-session-1",
				configOptions: [
					{
						id: "model-selector",
						name: "Model",
						category: "model",
						type: "select",
						currentValue: "fast",
						options: [{ value: "fast", name: "Fast" }],
					},
				],
				modes: {
					currentModeId: "architect",
					availableModes: [{ id: "architect", name: "Architect" }],
				},
			});
			const created = await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});
			mockConnection.getStatus.mockReturnValue({
				backendId: "backend-1",
				backendLabel: "Claude Code",
				state: "error",
				command: "claude-code",
				args: [],
				pid: 12345,
			});
			const resumedConnection = createMockConnection();
			resumedConnection.resumeSession.mockResolvedValueOnce({
				configOptions: null,
				modes: null,
			});
			sessionManager.createConnection = () =>
				resumedConnection as unknown as AcpConnection;

			const resumed = await sessionManager.resumeSession(
				created.sessionId,
				"/home/user/project",
				"backend-1",
			);

			expect(resumed.configOptions).toEqual([]);
			expect(resumed.modelId).toBeUndefined();
			expect(resumed.availableModels).toBeUndefined();
			expect(resumed.modeId).toBeUndefined();
			expect(resumed.availableModes).toBeUndefined();
		});

		it("keeps the wrapped DEK for the existing WAL revision", async () => {
			await initCrypto();
			const secureConfig = {
				...mockConfig,
				walDbPath: `/tmp/mobvibe-test/resume-dek-${Date.now()}-${Math.random()
					.toString(36)
					.slice(2)}.db`,
			};
			const secureManager = new SessionManager(
				secureConfig,
				new CliCryptoService(generateMasterSecret()),
				{ validateWorkspacePath: async () => true },
			);
			const secureConnection = createMockConnection();
			secureManager.createConnection = () =>
				secureConnection as unknown as AcpConnection;
			try {
				const created = await secureManager.createSession({
					cwd: "/home/user/project",
					backendId: "backend-1",
				});
				const secureWal = (secureManager as unknown as { walStore: WalStore })
					.walStore;
				const keyBefore = secureWal.getSessionRevisionKey(created.sessionId, 1);
				expect(created.wrappedDek).toBe(keyBefore);
				await secureManager.closeSession(created.sessionId);

				const resumed = await secureManager.resumeSession(
					created.sessionId,
					"/home/user/project",
					"backend-1",
				);

				expect(resumed.revision).toBe(1);
				expect(resumed.wrappedDek).toBe(created.wrappedDek);
				expect(secureWal.getSessionRevisionKey(created.sessionId, 1)).toBe(
					keyBefore,
				);
			} finally {
				await secureManager.shutdown();
			}
		});

		it("creates revision one for a resume-only session without local history", async () => {
			const resumed = await sessionManager.resumeSession(
				"resume-only",
				"/home/user/project",
				"backend-1",
			);

			expect(resumed.revision).toBe(1);
			expect(getWalStore().getSession("resume-only")?.currentRevision).toBe(1);
			expect(
				sessionManager.getSessionEvents({
					sessionId: "resume-only",
					revision: 1,
					afterSeq: 0,
				}).events,
			).toEqual([]);
		});

		it("rejects archived sessions before calling the agent", async () => {
			const created = await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});
			await sessionManager.archiveSession(created.sessionId);
			expect(mockConnection.closeSession).not.toHaveBeenCalled();
			mockConnection.resumeSession.mockClear();

			await expect(
				sessionManager.resumeSession(
					created.sessionId,
					"/home/user/project",
					"backend-1",
				),
			).rejects.toMatchObject({ status: 410 });
			expect(mockConnection.resumeSession).not.toHaveBeenCalled();
		});

		it("caches and rejects an explicitly unsupported capability", async () => {
			mockConnection.getSessionCapabilities.mockReturnValueOnce({
				list: true,
				load: true,
				resume: false,
				close: true,
				delete: true,
			});
			mockConnection.supportsSessionResume.mockReturnValueOnce(false);

			await expect(
				sessionManager.resumeSession(
					"unsupported",
					"/home/user/project",
					"backend-1",
				),
			).rejects.toMatchObject({ status: 409 });
			expect(sessionManager.getBackendCapabilities()["backend-1"]?.resume).toBe(
				false,
			);
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
			expect(result.title).toBe("Session session-");
			expect(result.cwd).toBe("/home/user/project");
			expect(result.sessionId).toBeDefined();
		});

		it("restores durable discovered title and metadata when loading after restart", async () => {
			const persistedConfig = {
				...mockConfig,
				walDbPath: `/tmp/mobvibe-test/load-discovery-${Date.now()}-${Math.random()
					.toString(36)
					.slice(2)}.db`,
			};
			const sessionId = "persisted-load-session";
			const seedStore = new WalStore(persistedConfig.walDbPath);
			seedStore.saveDiscoveredSessions([
				{
					sessionId,
					backendId: "backend-1",
					cwd: "/home/user/project",
					title: "Durable discovered title",
					_meta: {
						source: "durable discovery",
						nested: { keep: null },
					},
					discoveredAt: new Date().toISOString(),
					isStale: false,
				},
			]);
			seedStore.close();

			const restartedManager = new SessionManager(persistedConfig, undefined, {
				validateWorkspacePath: async () => true,
			});
			const restartedConnection = createMockConnection();
			restartedManager.createConnection = () =>
				restartedConnection as unknown as AcpConnection;

			try {
				const loaded = await restartedManager.loadSession(
					sessionId,
					"/home/user/project",
					"backend-1",
				);

				expect(loaded.title).toBe("Durable discovered title");
				expect(loaded._meta).toEqual({
					source: "durable discovery",
					nested: { keep: null },
				});
				expect(
					(
						restartedManager as unknown as {
							walStore: WalStore;
						}
					).walStore.getSession(sessionId)?.title,
				).toBe("Durable discovered title");
			} finally {
				await restartedManager.shutdown();
			}
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

		it("replays plan operations in order alongside legacy plans", async () => {
			const created = await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});
			const planUpdate = {
				sessionId: created.sessionId,
				update: {
					sessionUpdate: "plan_update",
					plan: {
						type: "markdown",
						planId: "implementation",
						content: "## Implementation\n\nShip the WAL mapping.",
					},
				},
			} as SessionNotification;
			const legacyPlan = {
				sessionId: created.sessionId,
				update: {
					sessionUpdate: "plan",
					entries: [
						{
							content: "Keep legacy clients working",
							priority: "high",
							status: "in_progress",
						},
					],
				},
			} as SessionNotification;
			const planRemoved = {
				sessionId: created.sessionId,
				update: {
					sessionUpdate: "plan_removed",
					planId: "implementation",
				},
			} as SessionNotification;
			mockConnection.loadSession.mockImplementationOnce(async () => {
				sessionUpdateCallback?.(planUpdate);
				sessionUpdateCallback?.(legacyPlan);
				sessionUpdateCallback?.(planRemoved);
				return { modes: null, configOptions: null };
			});

			await sessionManager.reloadSession(
				created.sessionId,
				"/home/user/project",
				"backend-1",
			);

			const events = sessionManager.getSessionEvents({
				sessionId: created.sessionId,
				revision: 2,
				afterSeq: 0,
			}).events;
			expect(events).toEqual([
				expect.objectContaining({
					revision: 2,
					seq: 1,
					kind: "plan_update",
					payload: planUpdate,
				}),
				expect.objectContaining({
					revision: 2,
					seq: 2,
					kind: "session_info_update",
					payload: legacyPlan,
				}),
				expect.objectContaining({
					revision: 2,
					seq: 3,
					kind: "plan_removed",
					payload: planRemoved,
				}),
			]);
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
		it("rejects an overlong session/new ID without persisting it", async () => {
			const overlongSessionId = "x".repeat(1025);
			mockConnection.createSession.mockResolvedValueOnce({
				sessionId: overlongSessionId,
				modes: null,
				configOptions: null,
			});

			await expect(
				sessionManager.createSession({
					cwd: "/home/user/project",
					backendId: "backend-1",
				}),
			).rejects.toMatchObject({ status: 502 });

			expect(sessionManager.listAllSessions()).toEqual([]);
			expect(mockConnection.disconnect).toHaveBeenCalled();
			expect(
				(
					sessionManager as unknown as {
						currentSessionIncarnationIds: Set<string>;
					}
				).currentSessionIncarnationIds.has(overlongSessionId),
			).toBe(false);
		});

		it("returns empty array initially", () => {
			const sessions = sessionManager.listSessions();
			expect(sessions).toEqual([]);
		});

		it("returns sessions after creating one", async () => {
			const created = await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});

			const sessions = sessionManager.listSessions();
			expect(sessions).toHaveLength(1);
			expect(sessions[0].sessionId).toBeDefined();
			expect(created).not.toHaveProperty("agentTeamOwned");
			expect(sessions[0]).not.toHaveProperty("agentTeamOwned");
			expect(sessionManager.listAllSessions()[0]).not.toHaveProperty(
				"agentTeamOwned",
			);
		});

		it("restores detached remote Team ownership from the durable binding after restart", async () => {
			const created = await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});
			const internals =
				sessionManager as unknown as SessionManagerTeamInternals;
			const serverId = buildTeamMcpServerId({
				agentTeamId: "remote-team-persisted-classification",
				memberId: "remote-member-persisted-classification",
			});
			internals.teamRelayStore.createRemoteSessionBinding({
				serverId,
				agentTeamId: "remote-team-persisted-classification",
				memberId: "remote-member-persisted-classification",
				leaderMachineId: "leader-machine",
				backendId: "backend-1",
			});
			internals.teamRelayStore.activateRemoteSessionBinding({
				serverId,
				sessionId: created.sessionId,
			});
			await sessionManager.closeSession(created.sessionId);
			await sessionManager.shutdown();

			const restartedManager = new SessionManager(mockConfig, undefined, {
				validateWorkspacePath: async () => true,
			});
			try {
				expect(restartedManager.listSessions()).toEqual([]);
				expect(
					restartedManager
						.listAllSessions()
						.find((session) => session.sessionId === created.sessionId),
				).toEqual(
					expect.objectContaining({
						agentTeamOwned: true,
						isAttached: false,
					}),
				);
			} finally {
				await restartedManager.shutdown();
			}
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

		it("clears detached agent metadata without reordering local activity", async () => {
			const created = await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});
			const detached = await sessionManager.closeSession(created.sessionId);
			const walStore = (sessionManager as unknown as { walStore: WalStore })
				.walStore;

			walStore.saveDiscoveredSessions([
				{
					sessionId: created.sessionId,
					backendId: "backend-1",
					cwd: "/home/user/project",
					title: null,
					agentUpdatedAt: null,
					discoveredAt: "2100-01-01T00:00:00.000Z",
					isStale: false,
				},
			]);

			const restored = sessionManager
				.listAllSessions()
				.find((session) => session.sessionId === created.sessionId);
			expect(restored).toEqual(
				expect.objectContaining({
					title: `Session ${created.sessionId.slice(0, 8)}`,
					updatedAt: detached.updatedAt,
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
				ALTER TABLE sessions DROP COLUMN additional_directories_json;
				ALTER TABLE discovered_sessions DROP COLUMN additional_directories_json;
				ALTER TABLE discovered_sessions DROP COLUMN meta_json;
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

			expect(mockConnection.setSessionConfigOption).toHaveBeenCalledWith(
				created.sessionId,
				"model-selector",
				"smart",
			);
			expect(updated.modelId).toBe("smart");
			expect(updated.modelName).toBe("Smart");
		});
	});

	describe("generic session config options", () => {
		it("preserves the complete ordered option list when creating a session", async () => {
			mockConnection.createSession.mockResolvedValueOnce({
				sessionId: "new-session-1",
				modes: null,
				configOptions: [
					{
						id: "reasoning",
						name: "Reasoning",
						category: "thought_level",
						type: "select",
						currentValue: "medium",
						options: [
							{ value: "low", name: "Low" },
							{ value: "medium", name: "Medium" },
						],
					},
					{
						id: "auto-approve",
						name: "Auto approve",
						type: "boolean",
						currentValue: false,
					},
					{
						id: "custom-option",
						name: "Custom",
						category: "_vendor_custom",
						type: "select",
						currentValue: "one",
						options: [{ value: "one", name: "One" }],
					},
				],
			});

			const created = await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});

			expect(
				sessionManager
					.getSession(created.sessionId)
					?.configOptions.map((option) => option.id),
			).toEqual(["reasoning", "auto-approve", "custom-option"]);
			expect(created.configOptions?.map((option) => option.id)).toEqual([
				"reasoning",
				"auto-approve",
				"custom-option",
			]);
		});

		it("preserves the complete ordered option list when loading a session", async () => {
			mockConnection.loadSession.mockResolvedValueOnce({
				modes: null,
				configOptions: [
					{
						id: "first",
						name: "First",
						type: "boolean",
						currentValue: true,
					},
					{
						id: "second",
						name: "Second",
						type: "select",
						currentValue: "two",
						options: [{ value: "two", name: "Two" }],
					},
				],
			});

			await sessionManager.loadSession(
				"loaded-session",
				"/home/user/project",
				"backend-1",
			);

			expect(
				sessionManager
					.getSession("loaded-session")
					?.configOptions.map((option) => option.id),
			).toEqual(["first", "second"]);
		});

		it("validates select values and replaces the full list from the response", async () => {
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
						options: [{ value: "fast", name: "Fast" }],
					},
					{
						id: "reasoning",
						name: "Reasoning",
						type: "select",
						currentValue: "low",
						options: [
							{
								group: "levels",
								name: "Levels",
								options: [
									{ value: "low", name: "Low" },
									{ value: "deep", name: "Deep" },
								],
							},
						],
					},
				],
			});
			mockConnection.setSessionConfigOption.mockResolvedValueOnce({
				configOptions: [
					{
						id: "reasoning",
						name: "Reasoning",
						type: "select",
						currentValue: "deep",
						options: [
							{ value: "low", name: "Low" },
							{ value: "deep", name: "Deep" },
						],
					},
				],
			});
			const created = await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});

			await expect(
				sessionManager.setSessionConfigOption(
					created.sessionId,
					"reasoning",
					true,
				),
			).rejects.toMatchObject({
				detail: expect.objectContaining({ code: "REQUEST_VALIDATION_FAILED" }),
			});
			await expect(
				sessionManager.setSessionConfigOption(
					created.sessionId,
					"reasoning",
					"unknown",
				),
			).rejects.toMatchObject({
				detail: expect.objectContaining({ code: "REQUEST_VALIDATION_FAILED" }),
			});
			await expect(
				sessionManager.setSessionConfigOption(
					created.sessionId,
					"unknown-option",
					"deep",
				),
			).rejects.toMatchObject({
				detail: expect.objectContaining({ code: "REQUEST_VALIDATION_FAILED" }),
			});
			expect(mockConnection.setSessionConfigOption).not.toHaveBeenCalled();

			const updated = await sessionManager.setSessionConfigOption(
				created.sessionId,
				"reasoning",
				"deep",
				{ requestSource: "webui" },
			);

			expect(mockConnection.setSessionConfigOption).toHaveBeenCalledWith(
				created.sessionId,
				"reasoning",
				"deep",
				{ requestSource: "webui" },
			);
			expect(
				sessionManager
					.getSession(created.sessionId)
					?.configOptions.map((option) => option.id),
			).toEqual(["reasoning"]);
			expect(updated.modelId).toBeUndefined();
			expect(updated.availableModels).toBeUndefined();
		});

		it("validates boolean values before forwarding them", async () => {
			mockConnection.createSession.mockResolvedValueOnce({
				sessionId: "new-session-1",
				modes: null,
				configOptions: [
					{
						id: "auto-approve",
						name: "Auto approve",
						type: "boolean",
						currentValue: false,
					},
				],
			});
			mockConnection.setSessionConfigOption.mockResolvedValueOnce({
				configOptions: [
					{
						id: "auto-approve",
						name: "Auto approve",
						type: "boolean",
						currentValue: true,
					},
				],
			});
			const created = await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});

			await expect(
				sessionManager.setSessionConfigOption(
					created.sessionId,
					"auto-approve",
					"true",
				),
			).rejects.toMatchObject({
				detail: expect.objectContaining({ code: "REQUEST_VALIDATION_FAILED" }),
			});
			await sessionManager.setSessionConfigOption(
				created.sessionId,
				"auto-approve",
				true,
			);

			expect(mockConnection.setSessionConfigOption).toHaveBeenCalledTimes(1);
			expect(mockConnection.setSessionConfigOption).toHaveBeenCalledWith(
				created.sessionId,
				"auto-approve",
				true,
			);
		});

		it("replaces config state and emits sessions:changed for agent updates", async () => {
			mockConnection.createSession.mockResolvedValueOnce({
				sessionId: "new-session-1",
				modes: null,
				configOptions: [
					{
						id: "old-option",
						name: "Old",
						type: "boolean",
						currentValue: false,
					},
				],
			});
			const created = await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});
			const changedListener = mock(() => {});
			sessionManager.onSessionsChanged(changedListener);

			sessionUpdateCallback?.({
				sessionId: created.sessionId,
				update: {
					sessionUpdate: "config_option_update",
					configOptions: [
						{
							id: "replacement",
							name: "Replacement",
							type: "boolean",
							currentValue: true,
						},
					],
				},
			} as SessionNotification);

			expect(
				sessionManager
					.getSession(created.sessionId)
					?.configOptions.map((option) => option.id),
			).toEqual(["replacement"]);
			expect(changedListener).toHaveBeenCalledWith({
				added: [],
				updated: [
					expect.objectContaining({
						sessionId: created.sessionId,
						configOptions: [expect.objectContaining({ id: "replacement" })],
					}),
				],
				removed: [],
			});
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
		it("publishes close support when a fresh session initializes the backend", async () => {
			const changedListener = mock(() => {});
			sessionManager.onSessionsChanged(changedListener);

			await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});

			expect(sessionManager.getBackendCapabilities()).toEqual({
				"backend-1": expect.objectContaining({ close: true }),
			});
			expect(changedListener).toHaveBeenCalledWith(
				expect.objectContaining({
					backendCapabilities: {
						"backend-1": expect.objectContaining({ close: true }),
					},
				}),
			);
		});

		it("closes the agent session and keeps durable history detached", async () => {
			const created = await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});

			const result = await sessionManager.closeSession(created.sessionId);

			expect(result).toEqual(
				expect.objectContaining({
					sessionId: created.sessionId,
					isAttached: false,
				}),
			);
			expect(mockConnection.closeSession).toHaveBeenCalledWith(
				created.sessionId,
			);
			expect(sessionManager.listSessions()).toHaveLength(0);
			expect(sessionManager.listAllSessions()).toEqual([
				expect.objectContaining({
					sessionId: created.sessionId,
					isAttached: false,
				}),
			]);
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
					updated: [
						expect.objectContaining({
							sessionId: created.sessionId,
							isAttached: false,
						}),
					],
					removed: [],
				}),
			);
		});

		it("returns session metadata emitted while protocol close completes", async () => {
			const created = await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});
			mockConnection.closeSession.mockImplementationOnce(() => {
				sessionUpdateCallback?.({
					sessionId: created.sessionId,
					update: {
						sessionUpdate: "session_info_update",
						title: "Final agent title",
					},
				} as SessionNotification);
				return Promise.resolve({});
			});

			const result = await sessionManager.closeSession(created.sessionId);

			expect(result).toEqual(
				expect.objectContaining({
					title: "Final agent title",
					isAttached: false,
				}),
			);
		});

		it("rejects an unknown session", async () => {
			await expect(
				sessionManager.closeSession("unknown-session"),
			).rejects.toMatchObject({ status: 404 });
		});

		it("keeps the active session intact when protocol close fails", async () => {
			const created = await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});
			mockConnection.closeSession.mockImplementationOnce(() =>
				Promise.reject(new Error("agent refused close")),
			);

			await expect(
				sessionManager.closeSession(created.sessionId),
			).rejects.toThrow("agent refused close");

			expect(sessionManager.listSessions()).toEqual([
				expect.objectContaining({
					sessionId: created.sessionId,
					isAttached: true,
				}),
			]);
			expect(mockConnection.disconnect).not.toHaveBeenCalled();
		});
	});

	describe("deleteSession", () => {
		it("serializes detached deletion while suppressing in-flight discovery", async () => {
			await sessionManager.discoverSessions({ backendId: "backend-1" });
			let resolveList: ((response: ListSessionsResponse) => void) | undefined;
			let markListStarted: (() => void) | undefined;
			const listStarted = new Promise<void>((resolve) => {
				markListStarted = resolve;
			});
			mockConnection.listSessions.mockImplementationOnce(
				() =>
					new Promise<ListSessionsResponse>((resolve) => {
						resolveList = resolve;
						markListStarted?.();
					}),
			);
			const staleDiscovery = sessionManager.discoverSessions({
				backendId: "backend-1",
			});
			await listStarted;

			let deletionSettled = false;
			const deletion = sessionManager.deleteSession("discovered-1").then(() => {
				deletionSettled = true;
			});
			await Promise.resolve();
			expect(deletionSettled).toBe(false);

			resolveList?.({
				sessions: [
					{
						sessionId: "discovered-1",
						cwd: "/home/user/project1",
						title: "Discovery before delete",
					},
				],
			});
			expect((await staleDiscovery).sessions).toEqual([]);
			await deletion;
			const recentDeletes = (
				sessionManager as unknown as {
					recentlyDeletedSessions: Map<
						string,
						{ generation: number; expiresAt: number }
					>;
				}
			).recentlyDeletedSessions;
			const recentDelete = recentDeletes.get("discovered-1");
			if (!recentDelete) {
				throw new Error("recent delete tombstone missing");
			}
			recentDelete.expiresAt = 0;
			expect(
				(
					sessionManager as unknown as { walStore: WalStore }
				).walStore.getDiscoveredSessionBackendId("discovered-1"),
			).toBeUndefined();
			expect(
				sessionManager
					.listAllSessions()
					.some((session) => session.sessionId === "discovered-1"),
			).toBe(false);
		});

		it("invalidates a bounded old observation without changing unrelated current tokens", async () => {
			const current = await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});
			const internals = sessionManager as unknown as {
				beginAgentSessionObservation: () => {
					generation: number;
					deletedSessionIds: Set<string>;
					invalidated: boolean;
					tracked: boolean;
				};
				finishAgentSessionObservation: (observation: unknown) => void;
				markSessionRecentlyDeleted: (sessionId: string) => void;
				acceptAgentSessionObservation: (
					sessionId: string,
					observation: unknown,
				) => boolean;
				reuseQuarantineUntil: number;
				sessionIncarnationGenerationBySession: Map<string, number>;
			};
			const currentToken = sessionManager.getSessionIncarnationGeneration(
				current.sessionId,
			);
			const oldObservation = internals.beginAgentSessionObservation();
			for (let index = 0; index < 1025; index++) {
				internals.markSessionRecentlyDeleted(`overflow-delete-${index}`);
			}

			expect(oldObservation.invalidated).toBe(true);
			expect(oldObservation.deletedSessionIds.size).toBe(0);
			expect(
				internals.sessionIncarnationGenerationBySession.size,
			).toBeLessThanOrEqual(1024);
			expect(
				sessionManager.getSessionIncarnationGeneration(current.sessionId),
			).toBe(currentToken);
			internals.reuseQuarantineUntil = 0;
			expect(
				internals.acceptAgentSessionObservation(
					"overflow-delete-0",
					oldObservation,
				),
			).toBe(false);
			internals.finishAgentSessionObservation(oldObservation);
		});

		it("keeps an evicted delete tombstone retry-idempotent during quarantine", async () => {
			const internals = sessionManager as unknown as {
				markSessionRecentlyDeleted: (sessionId: string) => void;
				recentlyDeletedSessions: Map<string, unknown>;
				reuseQuarantineUntil: number;
			};
			for (let index = 0; index < 1025; index++) {
				internals.markSessionRecentlyDeleted(`overflow-delete-${index}`);
			}

			expect(internals.recentlyDeletedSessions.has("overflow-delete-0")).toBe(
				false,
			);
			expect(internals.reuseQuarantineUntil).toBeGreaterThan(Date.now());
			expect(() =>
				sessionManager.assertSessionDeleteSupported("overflow-delete-0"),
			).not.toThrow();
			await sessionManager.deleteSession("overflow-delete-0");

			expect(mockConnection.deleteSession).not.toHaveBeenCalled();
		});

		it("treats an immediate retry after a completed delete as successful", async () => {
			const created = await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});

			await sessionManager.deleteSession(created.sessionId);
			await sessionManager.deleteSession(created.sessionId);

			expect(mockConnection.deleteSession).toHaveBeenCalledTimes(1);
		});

		it("quarantines immediate session/new ID reuse and accepts it after TTL", async () => {
			const created = await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});
			await sessionManager.deleteSession(created.sessionId);
			const deletedIncarnation = sessionManager.getSessionIncarnationGeneration(
				created.sessionId,
			);

			await expect(
				sessionManager.createSession({
					cwd: "/home/user/project",
					backendId: "backend-1",
				}),
			).rejects.toMatchObject({ status: 409 });
			expect(mockConnection.deleteSession).toHaveBeenCalledTimes(2);
			expect(
				(
					sessionManager as unknown as { walStore: WalStore }
				).walStore.getSession(created.sessionId),
			).toBeNull();

			const recentDeletes = (
				sessionManager as unknown as {
					recentlyDeletedSessions: Map<
						string,
						{ generation: number; expiresAt: number }
					>;
				}
			).recentlyDeletedSessions;
			const recentDelete = recentDeletes.get(created.sessionId);
			if (!recentDelete) {
				throw new Error("recent delete tombstone missing");
			}
			recentDelete.expiresAt = 0;

			const recreated = await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});
			expect(recreated.sessionId).toBe(created.sessionId);
			expect(
				sessionManager.getSessionIncarnationGeneration(created.sessionId),
			).toBe(deletedIncarnation);
			expect(sessionManager.isSessionDeletionGuarded(created.sessionId)).toBe(
				false,
			);
		});

		it("does not apply an old-incarnation ACK to a reused session ID", async () => {
			const first = await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});
			const oldIncarnation = sessionManager.getSessionIncarnationGeneration(
				first.sessionId,
			);
			await sessionManager.deleteSession(first.sessionId);
			const recentDeletes = (
				sessionManager as unknown as {
					recentlyDeletedSessions: Map<
						string,
						{ generation: number; expiresAt: number }
					>;
				}
			).recentlyDeletedSessions;
			const recentDelete = recentDeletes.get(first.sessionId);
			if (!recentDelete) {
				throw new Error("recent delete tombstone missing");
			}
			recentDelete.expiresAt = 0;
			const second = await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});
			const currentIncarnation = sessionManager.getSessionIncarnationGeneration(
				second.sessionId,
			);
			sessionManager.recordTurnEnd(second.sessionId, "end_turn");

			expect(sessionManager.getUnackedEvents(second.sessionId, 1)).toHaveLength(
				1,
			);
			sessionManager.ackEvents(second.sessionId, 1, 100, oldIncarnation);
			sessionManager.ackEvents(second.sessionId, 1, 100);
			expect(sessionManager.getUnackedEvents(second.sessionId, 1)).toHaveLength(
				1,
			);

			sessionManager.ackEvents(second.sessionId, 1, 100, currentIncarnation);
			expect(sessionManager.getUnackedEvents(second.sessionId, 1)).toHaveLength(
				0,
			);
		});

		it("zeroes cached session keys only after local deletion commits", async () => {
			await initCrypto();
			const secureConfig = {
				...mockConfig,
				walDbPath: `/tmp/mobvibe-test/delete-crypto-${Date.now()}-${Math.random()
					.toString(36)
					.slice(2)}.db`,
			};
			const crypto = new CliCryptoService(generateMasterSecret());
			const secureManager = new SessionManager(secureConfig, crypto, {
				validateWorkspacePath: async () => true,
			});
			const secureConnection = createMockConnection();
			secureManager.createConnection = () =>
				secureConnection as unknown as AcpConnection;
			try {
				const created = await secureManager.createSession({
					cwd: "/home/user/project",
					backendId: "backend-1",
				});
				const dek = crypto.getDek(created.sessionId, 1);
				expect(dek).not.toBeNull();

				await secureManager.deleteSession(created.sessionId);

				expect(dek?.every((byte) => byte === 0)).toBe(true);
				expect(crypto.getDek(created.sessionId)).toBeNull();
				expect(crypto.getDek(created.sessionId, 1)).toBeNull();
			} finally {
				await secureManager.shutdown();
			}
		});

		it("deletes remotely before removing an active session locally", async () => {
			const changedListener = mock(() => {});
			sessionManager.onSessionsChanged(changedListener);
			const created = await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});

			await sessionManager.deleteSession(created.sessionId);

			expect(mockConnection.deleteSession).toHaveBeenCalledWith(
				created.sessionId,
			);
			expect(mockConnection.closeSession).not.toHaveBeenCalled();
			expect(sessionManager.getSession(created.sessionId)).toBeUndefined();
			expect(
				(
					sessionManager as unknown as { walStore: WalStore }
				).walStore.getSession(created.sessionId),
			).toBeNull();
			expect(changedListener).toHaveBeenCalledWith(
				expect.objectContaining({ removed: [created.sessionId] }),
			);
		});

		it("uses durable backend affinity for a detached session", async () => {
			const created = await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});
			await sessionManager.closeSession(created.sessionId);
			mockConnection.deleteSession.mockClear();
			mockConnection.disconnect.mockClear();

			await sessionManager.deleteSession(created.sessionId);

			expect(mockConnection.deleteSession).toHaveBeenCalledWith(
				created.sessionId,
			);
			expect(mockConnection.closeSession).toHaveBeenCalledTimes(1);
			expect(sessionManager.listAllSessions()).toEqual([]);
		});

		it("uses discovered backend affinity without loading the session", async () => {
			await sessionManager.discoverSessions({ backendId: "backend-1" });
			mockConnection.deleteSession.mockClear();
			mockConnection.loadSession.mockClear();

			await sessionManager.deleteSession("discovered-1");

			expect(mockConnection.deleteSession).toHaveBeenCalledWith("discovered-1");
			expect(mockConnection.loadSession).not.toHaveBeenCalled();
			expect(
				sessionManager
					.listAllSessions()
					.some((session) => session.sessionId === "discovered-1"),
			).toBe(false);
		});

		it("quarantines immediate session/list ID reuse and accepts it after TTL", async () => {
			await sessionManager.discoverSessions({ backendId: "backend-1" });
			await sessionManager.deleteSession("discovered-1");

			const quarantined = await sessionManager.discoverSessions({
				backendId: "backend-1",
			});
			expect(
				quarantined.sessions.some(
					(session) => session.sessionId === "discovered-1",
				),
			).toBe(false);

			const recentDeletes = (
				sessionManager as unknown as {
					recentlyDeletedSessions: Map<
						string,
						{ generation: number; expiresAt: number }
					>;
				}
			).recentlyDeletedSessions;
			const recentDelete = recentDeletes.get("discovered-1");
			if (!recentDelete) {
				throw new Error("recent delete tombstone missing");
			}
			recentDelete.expiresAt = 0;

			const accepted = await sessionManager.discoverSessions({
				backendId: "backend-1",
			});
			expect(
				accepted.sessions.some(
					(session) => session.sessionId === "discovered-1",
				),
			).toBe(true);
		});

		it("preserves active and durable state when the agent rejects deletion", async () => {
			const created = await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});
			mockConnection.deleteSession.mockImplementationOnce(() =>
				Promise.reject(new Error("agent refused delete")),
			);

			await expect(
				sessionManager.deleteSession(created.sessionId),
			).rejects.toThrow("agent refused delete");

			expect(sessionManager.getSession(created.sessionId)).toBeDefined();
			expect(
				(
					sessionManager as unknown as { walStore: WalStore }
				).walStore.getSession(created.sessionId),
			).not.toBeNull();
			expect(mockConnection.disconnect).not.toHaveBeenCalled();
		});

		it("keeps local state retryable when WAL cleanup fails after remote success", async () => {
			const created = await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});
			const walStore = (sessionManager as unknown as { walStore: WalStore })
				.walStore;
			const originalDelete = walStore.deleteSession.bind(walStore);
			walStore.deleteSession = mock(() => {
				throw new Error("local cleanup failed");
			});

			await expect(
				sessionManager.deleteSession(created.sessionId),
			).rejects.toThrow("local cleanup failed");
			expect(sessionManager.getSession(created.sessionId)).toBeUndefined();
			expect(walStore.getSession(created.sessionId)).not.toBeNull();
			expect(
				sessionManager
					.listAllSessions()
					.some((session) => session.sessionId === created.sessionId),
			).toBe(true);
			expect(() =>
				sessionManager.updateTitle(created.sessionId, "blocked"),
			).toThrow("Session is deleting");
			await expect(
				sessionManager.closeSession(created.sessionId),
			).rejects.toThrow("Session is deleting");
			await expect(
				sessionManager.archiveSession(created.sessionId),
			).rejects.toThrow("Session is deleting");

			walStore.deleteSession = originalDelete;
			await sessionManager.deleteSession(created.sessionId);
			expect(mockConnection.deleteSession).toHaveBeenCalledTimes(2);
			expect(sessionManager.getSession(created.sessionId)).toBeUndefined();
		});

		it("rejects unsupported and unknown sessions before remote deletion", async () => {
			const created = await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});
			mockConnection.supportsSessionDelete.mockReturnValueOnce(false);

			expect(() =>
				sessionManager.assertSessionDeleteSupported(created.sessionId),
			).toThrow();
			await expect(
				sessionManager.deleteSession("unknown-session"),
			).rejects.toMatchObject({ status: 404 });
			expect(mockConnection.deleteSession).not.toHaveBeenCalled();
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

		it("marks non-leader team member completed and emits team projection update", async () => {
			const expectedTeamTools = [
				"mobvibe_team_send_message",
				"mobvibe_team_members",
				"mobvibe_team_spawn_member",
				"mobvibe_team_task_create",
				"mobvibe_team_task_list",
				"mobvibe_team_task_update",
			];
			mockConnection.getSessionCapabilities.mockReturnValue({
				list: true,
				load: true,
				mcp: { acp: true },
			});
			let createdCount = 0;
			mockConnection.createSession.mockImplementation(
				async (...args: unknown[]) => {
					createdCount += 1;
					const params = args[0] as {
						teamMcpDeclaration?: { serverId?: string };
						teamMcpHandlers?: {
							handleConnect(input: { serverId: string }): unknown;
							handleListTools(input: {
								serverId: string;
								toolNames: string[];
							}): void;
						};
					};
					const serverId = params.teamMcpDeclaration?.serverId;
					if (params.teamMcpHandlers && serverId) {
						params.teamMcpHandlers.handleConnect({ serverId });
						params.teamMcpHandlers.handleListTools({
							serverId,
							toolNames: expectedTeamTools,
						});
					}
					return {
						sessionId:
							createdCount === 1 ? "leader-session-1" : "member-session-1",
						modes: null,
						configOptions: null,
					};
				},
			);
			const created = await sessionManager.createAgentTeamRun({
				machineId: mockConfig.machineId,
				backendId: "backend-1",
				workspaceRootCwd: "/home/user/project",
			});
			await sessionManager.spawnAgentTeamMember({
				agentTeamId: created.team.agentTeamId,
				requestedByMemberId: created.team.leaderMemberId,
				name: "Worker",
			});
			expect(
				sessionManager
					.listSessions()
					.find((session) => session.sessionId === "member-session-1")
					?.agentTeamOwned,
			).toBe(true);
			const teamChanged = mock(() => {});
			sessionManager.onAgentTeamChanged(teamChanged);

			sessionManager.recordTurnEnd("member-session-1", "end_turn");
			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(teamChanged).toHaveBeenCalledWith(
				expect.objectContaining({
					updated: [
						expect.objectContaining({
							agentTeamId: created.team.agentTeamId,
							members: expect.arrayContaining([
								expect.objectContaining({
									sessionId: "member-session-1",
									lifecycle: "completed",
								}),
							]),
						}),
					],
				}),
			);
		});
	});

	describe("injectTeamMailboxPrompt", () => {
		it("calls ordinary session prompt and records a session_event source ref", async () => {
			const created = await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});
			const eventListener = mock(() => {});
			sessionManager.onSessionEvent(eventListener);

			const ref = await sessionManager.injectTeamMailboxPrompt({
				agentTeamId: "team-1",
				memberId: "member-1",
				sessionId: created.sessionId,
				text: "Mobvibe Agent Team mailbox delivery\nhello teammate",
			});

			expect(mockConnection.prompt).toHaveBeenCalledWith(created.sessionId, [
				{
					type: "text",
					text: "Mobvibe Agent Team mailbox delivery\nhello teammate",
				},
			]);
			expect(ref).toEqual(
				expect.objectContaining({
					type: "session_event",
					agentTeamId: "team-1",
					memberId: "member-1",
					sessionId: created.sessionId,
					revision: 1,
				}),
			);
			if (ref.type !== "session_event") {
				throw new Error("Expected session_event source ref");
			}
			expect(ref.seq).toBeNumber();
			expect(eventListener).toHaveBeenCalledWith(
				expect.objectContaining({
					sessionId: created.sessionId,
					kind: "user_message",
					payload: expect.objectContaining({
						source: "mobvibe_team_mailbox",
						agentTeamId: "team-1",
						memberId: "member-1",
					}),
				}),
			);
		});
	});

	describe("createAgentTeamRun", () => {
		const expectedTeamTools = [
			"mobvibe_team_send_message",
			"mobvibe_team_members",
			"mobvibe_team_spawn_member",
			"mobvibe_team_task_create",
			"mobvibe_team_task_list",
			"mobvibe_team_task_update",
		];

		it("creates durable team rows, starts the leader session, and waits for MCP tools readiness", async () => {
			mockConnection.getSessionCapabilities.mockReturnValueOnce({
				list: true,
				load: true,
				mcp: { acp: true },
			});
			mockConnection.createSession.mockImplementationOnce(
				async (...args: unknown[]) => {
					const params = args[0];
					const handlers = (
						params as {
							teamMcpHandlers?: {
								handleConnect(input: { serverId: string }): unknown;
								handleListTools(input: {
									serverId: string;
									toolNames: string[];
								}): void;
							};
						}
					).teamMcpHandlers;
					const serverId = (
						params as { teamMcpDeclaration?: { serverId?: string } }
					).teamMcpDeclaration?.serverId;
					if (!handlers || !serverId) {
						throw new Error("Expected team MCP handlers");
					}
					handlers.handleConnect({ serverId });
					handlers.handleListTools({ serverId, toolNames: expectedTeamTools });
					return {
						sessionId: "leader-session-1",
						modes: null,
						configOptions: null,
					};
				},
			);

			const result = await sessionManager.createAgentTeamRun({
				machineId: mockConfig.machineId,
				backendId: "backend-1",
				workspaceRootCwd: "/home/user/project",
				title: "Launch Team",
				leaderName: "Lead",
			});

			expect(result.leaderSession?.sessionId).toBe("leader-session-1");
			expect(result.leaderSession?.agentTeamOwned).toBe(true);
			expect(
				sessionManager
					.listSessions()
					.find((session) => session.sessionId === "leader-session-1")
					?.agentTeamOwned,
			).toBe(true);
			await sessionManager.closeSession("leader-session-1");
			expect(
				sessionManager
					.listAllSessions()
					.find((session) => session.sessionId === "leader-session-1")
					?.agentTeamOwned,
			).toBe(true);
			expect(result.team.lifecycle).toBe("running");
			expect(result.team.members[0]).toEqual(
				expect.objectContaining({
					role: "leader",
					name: "Lead",
					sessionId: "leader-session-1",
					lifecycle: "running",
					mcp: expect.objectContaining({ phase: "tools_ready" }),
				}),
			);
		});

		it("auto-approves leader permissions with allow_always without entering the UI pending flow", async () => {
			prepareTeamSessionConnection(
				mockConnection,
				"leader-session-auto-permission",
				expectedTeamTools,
			);
			const permissionRequests: PermissionRequestPayload[] = [];
			const permissionResults: PermissionDecisionPayload[] = [];
			const emittedPermissionKinds: string[] = [];
			sessionManager.onPermissionRequest((payload) => {
				permissionRequests.push(payload);
			});
			sessionManager.onPermissionResult((payload) => {
				permissionResults.push(payload);
			});
			sessionManager.onSessionEvent((event) => {
				if (
					event.kind === "permission_request" ||
					event.kind === "permission_result"
				) {
					emittedPermissionKinds.push(event.kind);
				}
			});
			const created = await sessionManager.createAgentTeamRun({
				machineId: mockConfig.machineId,
				backendId: "backend-1",
				workspaceRootCwd: "/home/user/project",
			});
			const leaderSession = requireSessionRevision(created.leaderSession);
			const controller = new AbortController();
			const decisionPromise = requirePermissionHandler()(
				{
					sessionId: leaderSession.sessionId,
					toolCall: {
						toolCallId: "leader-tool-auto",
						title: "Leader tool",
					},
					options: [
						{
							optionId: "leader-allow-once",
							name: "Allow once",
							kind: "allow_once",
						},
						{
							optionId: "leader-reject",
							name: "Reject",
							kind: "reject_once",
						},
						{
							optionId: "leader-allow-always",
							name: "Always allow",
							kind: "allow_always",
						},
					],
				},
				"leader-auto-permission",
				controller.signal,
			);
			controller.abort();
			const decision = await Promise.race([
				decisionPromise,
				new Promise<"pending">((resolve) =>
					setTimeout(() => resolve("pending"), 10),
				),
			]);

			expect(decision).toEqual({
				outcome: {
					outcome: "selected",
					optionId: "leader-allow-always",
				},
			});
			expect(permissionRequests).toEqual([]);
			expect(permissionResults).toEqual([
				{
					sessionId: leaderSession.sessionId,
					requestId: "string:leader-auto-permission",
					outcome: {
						outcome: "selected",
						optionId: "leader-allow-always",
					},
				},
			]);
			expect(emittedPermissionKinds).toEqual([
				"permission_request",
				"permission_result",
			]);
			const internals =
				sessionManager as unknown as SessionManagerTeamInternals;
			expect(internals.permissionRequests.size).toBe(0);
			const team = internals.agentTeamStore.getAgentTeam({
				agentTeamId: created.team.agentTeamId,
			}).team;
			expect(team?.members[0]?.pendingPermissionCount).toBe(0);
			expect(
				sessionManager
					.getSessionEvents({
						sessionId: leaderSession.sessionId,
						revision: leaderSession.revision,
						afterSeq: 0,
					})
					.events.filter((event) => event.kind.startsWith("permission_")),
			).toEqual([
				expect.objectContaining({
					kind: "permission_request",
					payload: expect.objectContaining({
						sessionId: leaderSession.sessionId,
						requestId: "string:leader-auto-permission",
					}),
				}),
				expect.objectContaining({
					kind: "permission_result",
					payload: {
						sessionId: leaderSession.sessionId,
						requestId: "string:leader-auto-permission",
						outcome: {
							outcome: "selected",
							optionId: "leader-allow-always",
						},
					},
				}),
			]);
		});

		it("auto-approves member permissions with allow_once when allow_always is unavailable", async () => {
			const leaderConnection = createMockConnection();
			const memberConnection = createMockConnection();
			prepareTeamSessionConnection(
				leaderConnection,
				"leader-session-before-member-permission",
				expectedTeamTools,
			);
			prepareTeamSessionConnection(
				memberConnection,
				"member-session-auto-permission",
				expectedTeamTools,
			);
			const connections = [leaderConnection, memberConnection];
			sessionManager.createConnection = () => {
				const connection = connections.shift();
				if (!connection) throw new Error("Unexpected connection request");
				return connection as unknown as AcpConnection;
			};
			const permissionRequests: PermissionRequestPayload[] = [];
			const emittedPermissionKinds: string[] = [];
			sessionManager.onPermissionRequest((payload) => {
				permissionRequests.push(payload);
			});
			sessionManager.onSessionEvent((event) => {
				if (
					event.kind === "permission_request" ||
					event.kind === "permission_result"
				) {
					emittedPermissionKinds.push(event.kind);
				}
			});
			const created = await sessionManager.createAgentTeamRun({
				machineId: mockConfig.machineId,
				backendId: "backend-1",
				workspaceRootCwd: "/home/user/project",
			});
			const spawned = await sessionManager.spawnAgentTeamMember({
				agentTeamId: created.team.agentTeamId,
				requestedByMemberId: created.team.leaderMemberId,
				name: "Auto Worker",
			});
			if (!spawned.ok) {
				throw new Error("Expected member spawn to succeed");
			}
			const controller = new AbortController();
			const decisionPromise = requirePermissionHandler()(
				{
					sessionId: spawned.sessionId,
					toolCall: {
						toolCallId: "member-tool-auto",
						title: "Member tool",
					},
					options: [
						{
							optionId: "member-reject",
							name: "Reject",
							kind: "reject_once",
						},
						{
							optionId: "member-allow-once",
							name: "Allow once",
							kind: "allow_once",
						},
					],
				},
				"member-auto-permission",
				controller.signal,
			);
			const decision = await Promise.race([
				decisionPromise,
				new Promise<"pending">((resolve) =>
					setTimeout(() => resolve("pending"), 10),
				),
			]);
			if (decision === "pending") {
				controller.abort();
			}

			expect(decision).toEqual({
				outcome: {
					outcome: "selected",
					optionId: "member-allow-once",
				},
			});
			expect(permissionRequests).toEqual([]);
			expect(emittedPermissionKinds).toEqual([
				"permission_request",
				"permission_result",
			]);
			const internals =
				sessionManager as unknown as SessionManagerTeamInternals;
			expect(internals.permissionRequests.size).toBe(0);
			const team = internals.agentTeamStore.getAgentTeam({
				agentTeamId: created.team.agentTeamId,
			}).team;
			expect(
				team?.members.find((member) => member.memberId === spawned.memberId)
					?.pendingPermissionCount,
			).toBe(0);
			const memberSession = sessionManager
				.listSessions()
				.find((session) => session.sessionId === spawned.sessionId);
			const memberSessionWithRevision = requireSessionRevision(memberSession);
			expect(
				sessionManager
					.getSessionEvents({
						sessionId: spawned.sessionId,
						revision: memberSessionWithRevision.revision,
						afterSeq: 0,
					})
					.events.filter((event) => event.kind.startsWith("permission_")),
			).toEqual([
				expect.objectContaining({
					kind: "permission_request",
					payload: expect.objectContaining({
						sessionId: spawned.sessionId,
						requestId: "string:member-auto-permission",
					}),
				}),
				expect.objectContaining({
					kind: "permission_result",
					payload: expect.objectContaining({
						sessionId: spawned.sessionId,
						requestId: "string:member-auto-permission",
						outcome: {
							outcome: "selected",
							optionId: "member-allow-once",
						},
					}),
				}),
			]);
		});

		it("keeps ordinary session permissions in the existing UI confirmation flow", async () => {
			const permissionRequests: PermissionRequestPayload[] = [];
			sessionManager.onPermissionRequest((payload) => {
				permissionRequests.push(payload);
			});
			const created = await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});
			const ordinarySession = requireSessionRevision(created);
			const decisionPromise = requirePermissionHandler()(
				{
					sessionId: created.sessionId,
					toolCall: {
						toolCallId: "ordinary-tool",
						title: "Ordinary tool",
					},
					options: [
						{
							optionId: "ordinary-allow-always",
							name: "Always allow",
							kind: "allow_always",
						},
						{
							optionId: "ordinary-allow-once",
							name: "Allow once",
							kind: "allow_once",
						},
					],
				},
				"ordinary-permission",
				new AbortController().signal,
			);

			expect(permissionRequests).toEqual([
				expect.objectContaining({
					sessionId: created.sessionId,
					requestId: "string:ordinary-permission",
				}),
			]);
			const internals =
				sessionManager as unknown as SessionManagerTeamInternals;
			expect(internals.permissionRequests.size).toBe(1);
			sessionManager.resolvePermissionRequest(
				created.sessionId,
				"string:ordinary-permission",
				{
					outcome: "selected",
					optionId: "ordinary-allow-once",
				},
			);
			await expect(decisionPromise).resolves.toEqual({
				outcome: {
					outcome: "selected",
					optionId: "ordinary-allow-once",
				},
			});
			expect(
				sessionManager
					.getSessionEvents({
						sessionId: created.sessionId,
						revision: ordinarySession.revision,
						afterSeq: 0,
					})
					.events.filter((event) => event.kind.startsWith("permission_"))
					.map((event) => event.kind),
			).toEqual(["permission_request", "permission_result"]);
		});

		it("uses the ordinary confirmation flow for a Team permission without an allow option", async () => {
			prepareTeamSessionConnection(
				mockConnection,
				"leader-session-reject-only-permission",
				expectedTeamTools,
			);
			const permissionRequests: PermissionRequestPayload[] = [];
			sessionManager.onPermissionRequest((payload) => {
				permissionRequests.push(payload);
			});
			const created = await sessionManager.createAgentTeamRun({
				machineId: mockConfig.machineId,
				backendId: "backend-1",
				workspaceRootCwd: "/home/user/project",
			});
			const leaderSession = requireSessionRevision(created.leaderSession);
			const decisionPromise = requirePermissionHandler()(
				{
					sessionId: leaderSession.sessionId,
					toolCall: {
						toolCallId: "team-reject-only-tool",
						title: "Reject-only tool",
					},
					options: [
						{
							optionId: "team-reject-once",
							name: "Reject",
							kind: "reject_once",
						},
						{
							optionId: "team-reject-always",
							name: "Always reject",
							kind: "reject_always",
						},
					],
				},
				"team-reject-only-permission",
				new AbortController().signal,
			);

			expect(permissionRequests).toEqual([
				expect.objectContaining({
					sessionId: leaderSession.sessionId,
					requestId: "string:team-reject-only-permission",
				}),
			]);
			const internals =
				sessionManager as unknown as SessionManagerTeamInternals;
			expect(internals.permissionRequests.size).toBe(1);
			sessionManager.resolvePermissionRequest(
				leaderSession.sessionId,
				"string:team-reject-only-permission",
				{
					outcome: "selected",
					optionId: "team-reject-once",
				},
			);
			await expect(decisionPromise).resolves.toEqual({
				outcome: {
					outcome: "selected",
					optionId: "team-reject-once",
				},
			});
		});

		it("cleans up a created leader session when Team MCP readiness times out", async () => {
			prepareTeamSessionConnection(
				mockConnection,
				"leader-session-readiness-timeout",
			);
			const readinessError = new AppError(
				createErrorDetail({
					code: "SESSION_NOT_READY",
					message: "Timed out waiting for Team MCP tools readiness",
					retryable: true,
					scope: "session",
				}),
				504,
			);
			const internals =
				sessionManager as unknown as SessionManagerTeamInternals;
			internals.waitForTeamToolsReady = mock(() =>
				Promise.reject(readinessError),
			);

			await expect(
				sessionManager.createAgentTeamRun({
					machineId: mockConfig.machineId,
					backendId: "backend-1",
					workspaceRootCwd: "/home/user/project",
					title: "Timeout Team",
				}),
			).rejects.toBe(readinessError);

			expect(mockConnection.closeSession).toHaveBeenCalledWith(
				"leader-session-readiness-timeout",
			);
			expect(mockConnection.disconnect).toHaveBeenCalledTimes(1);
			expect(
				sessionManager
					.listSessions()
					.some(
						(session) =>
							session.sessionId === "leader-session-readiness-timeout",
					),
			).toBe(false);
			const [failedTeam] = internals.agentTeamStore.listAgentTeams().teams;
			expect(failedTeam.lifecycle).toBe("failed");
			expect(failedTeam.members[0]).toEqual(
				expect.objectContaining({
					sessionId: "leader-session-readiness-timeout",
					lifecycle: "failed",
					health: "error",
					error: expect.objectContaining({ code: "SESSION_NOT_READY" }),
					mcp: expect.objectContaining({ phase: "not_started" }),
				}),
			);
		});

		it("keeps the readiness error primary when leader cleanup fails", async () => {
			prepareTeamSessionConnection(mockConnection, "leader-session-degraded", [
				...expectedTeamTools.slice(0, -1),
			]);
			const cleanupSecret = "provider cleanup secret";
			mockConnection.closeSession.mockRejectedValueOnce(
				new Error(cleanupSecret),
			);
			loggerWarnMock.mockClear();

			await expect(
				sessionManager.createAgentTeamRun({
					machineId: mockConfig.machineId,
					backendId: "backend-1",
					workspaceRootCwd: "/home/user/project",
					title: "Degraded Team",
				}),
			).rejects.toMatchObject({
				detail: expect.objectContaining({
					code: "CAPABILITY_NOT_SUPPORTED",
				}),
			});

			expect(mockConnection.closeSession).toHaveBeenCalledWith(
				"leader-session-degraded",
			);
			expect(mockConnection.disconnect).toHaveBeenCalledTimes(1);
			const internals =
				sessionManager as unknown as SessionManagerTeamInternals;
			const [failedTeam] = internals.agentTeamStore.listAgentTeams().teams;
			expect(failedTeam.lifecycle).toBe("failed");
			expect(failedTeam.members[0]).toEqual(
				expect.objectContaining({
					sessionId: "leader-session-degraded",
					lifecycle: "failed",
					health: "error",
					error: expect.objectContaining({
						code: "CAPABILITY_NOT_SUPPORTED",
					}),
					mcp: expect.objectContaining({ phase: "not_started" }),
				}),
			);
			expect(loggerWarnMock).toHaveBeenCalledWith(
				expect.objectContaining({
					agentTeamId: failedTeam.agentTeamId,
					memberId: failedTeam.leaderMemberId,
					sessionId: "leader-session-degraded",
					cleanupStep: "session_close",
					errorCode: "INTERNAL_ERROR",
				}),
				"agent_team_readiness_cleanup_failed",
			);
			expect(JSON.stringify(loggerWarnMock.mock.calls)).not.toContain(
				cleanupSecret,
			);
		});

		it("restores Team MCP options when reloading, resuming, and loading a leader session", async () => {
			mockConnection.getSessionCapabilities.mockReturnValue({
				list: true,
				load: true,
				resume: true,
				close: true,
				mcp: { acp: true },
			});
			mockConnection.createSession.mockImplementationOnce(
				async (...args: unknown[]) => {
					const params = args[0] as {
						teamMcpDeclaration?: { serverId?: string };
						teamMcpHandlers?: {
							handleConnect(input: { serverId: string }): unknown;
							handleListTools(input: {
								serverId: string;
								toolNames: string[];
							}): void;
						};
					};
					const serverId = params.teamMcpDeclaration?.serverId;
					if (!params.teamMcpHandlers || !serverId) {
						throw new Error("Expected Team MCP options");
					}
					params.teamMcpHandlers.handleConnect({ serverId });
					params.teamMcpHandlers.handleListTools({
						serverId,
						toolNames: expectedTeamTools,
					});
					return {
						sessionId: "leader-session-restore",
						modes: null,
						configOptions: null,
					};
				},
			);
			const created = await sessionManager.createAgentTeamRun({
				machineId: mockConfig.machineId,
				backendId: "backend-1",
				workspaceRootCwd: "/home/user/project",
			});
			const expectedTeamMcp = expect.objectContaining({
				teamMcpDeclaration: expect.objectContaining({
					type: "acp",
					serverId: `mobvibe-team:${created.team.agentTeamId}:${created.team.leaderMemberId}`,
				}),
				teamMcpHandlers: expect.any(Object),
			});

			await sessionManager.reloadSession(
				"leader-session-restore",
				"/home/user/project",
				"backend-1",
			);
			expect(mockConnection.loadSession).toHaveBeenLastCalledWith(
				"leader-session-restore",
				"/home/user/project",
				[],
				expectedTeamMcp,
			);

			await sessionManager.closeSession("leader-session-restore");
			await sessionManager.resumeSession(
				"leader-session-restore",
				"/home/user/project",
				"backend-1",
			);
			expect(mockConnection.resumeSession).toHaveBeenLastCalledWith(
				"leader-session-restore",
				"/home/user/project",
				[],
				expectedTeamMcp,
			);

			await sessionManager.closeSession("leader-session-restore");
			await sessionManager.loadSession(
				"leader-session-restore",
				"/home/user/project",
				"backend-1",
			);
			expect(mockConnection.loadSession).toHaveBeenLastCalledWith(
				"leader-session-restore",
				"/home/user/project",
				[],
				expectedTeamMcp,
			);
		});

		it("leaves failed team and leader projection when leader session creation fails", async () => {
			mockConnection.getSessionCapabilities.mockReturnValueOnce({
				list: true,
				load: true,
				mcp: { acp: true },
			});
			mockConnection.createSession.mockRejectedValueOnce(
				new Error("agent refused session"),
			);

			await expect(
				sessionManager.createAgentTeamRun({
					machineId: mockConfig.machineId,
					backendId: "backend-1",
					workspaceRootCwd: "/home/user/project",
					title: "Broken Team",
				}),
			).rejects.toThrow("agent refused session");

			const internals =
				sessionManager as unknown as SessionManagerTeamInternals;
			const [failedTeam] = internals.agentTeamStore.listAgentTeams().teams;

			expect(failedTeam.lifecycle).toBe("failed");
			expect(failedTeam.members[0]).toEqual(
				expect.objectContaining({
					role: "leader",
					lifecycle: "failed",
					health: "error",
					error: expect.objectContaining({
						code: "INTERNAL_ERROR",
					}),
				}),
			);
		});

		it("rejects unsupported backend MCP before ACP session creation", async () => {
			mockConnection.getSessionCapabilities.mockReturnValueOnce({
				list: true,
				load: true,
				mcp: { acp: false, http: false, sse: false },
			});

			await expect(
				sessionManager.createAgentTeamRun({
					machineId: mockConfig.machineId,
					backendId: "backend-1",
					workspaceRootCwd: "/home/user/project",
					title: "Unsupported Team",
				}),
			).rejects.toMatchObject({
				status: 409,
				detail: expect.objectContaining({
					code: "CAPABILITY_NOT_SUPPORTED",
				}),
			});
			expect(mockConnection.createSession).not.toHaveBeenCalled();
		});

		it("spawns a member ordinary session with leader shared checkout metadata", async () => {
			mockConnection.getSessionCapabilities.mockReturnValue({
				list: true,
				load: true,
				mcp: { acp: true },
			});
			let createdCount = 0;
			mockConnection.createSession.mockImplementation(
				async (...args: unknown[]) => {
					createdCount += 1;
					const params = args[0] as {
						cwd?: string;
						teamMcpDeclaration?: { serverId?: string };
						teamMcpHandlers?: {
							handleConnect(input: { serverId: string }): unknown;
							handleListTools(input: {
								serverId: string;
								toolNames: string[];
							}): void;
						};
					};
					const serverId = params.teamMcpDeclaration?.serverId;
					if (params.teamMcpHandlers && serverId) {
						params.teamMcpHandlers.handleConnect({ serverId });
						params.teamMcpHandlers.handleListTools({
							serverId,
							toolNames: expectedTeamTools,
						});
					}
					return {
						sessionId:
							createdCount === 1 ? "leader-session-1" : "member-session-1",
						modes: null,
						configOptions: null,
					};
				},
			);

			const created = await sessionManager.createAgentTeamRun({
				machineId: mockConfig.machineId,
				backendId: "backend-1",
				workspaceRootCwd: "/home/user/project",
				title: "Shared Checkout Team",
				worktree: {
					sourceCwd: "/home/user/project",
					branch: "team/run",
					relativeCwd: "packages/cli",
				},
			});
			const result = await sessionManager.spawnAgentTeamMember({
				agentTeamId: created.team.agentTeamId,
				requestedByMemberId: created.team.leaderMemberId,
				name: "Worker",
			});

			expect(result).toEqual(
				expect.objectContaining({
					ok: true,
					memberId: expect.any(String),
					sessionId: "member-session-1",
					backendId: "backend-1",
				}),
			);
			expect(mockCreateGitWorktree).toHaveBeenCalledTimes(1);
			const memberCreateCall = mockConnection.createSession.mock.calls[1] as
				| unknown[]
				| undefined;
			if (!memberCreateCall) {
				throw new Error("Expected member createSession call");
			}
			expect(memberCreateCall[0]).toEqual(
				expect.objectContaining({
					cwd: "/tmp/mobvibe-test/worktrees/project/team-run/packages/cli",
				}),
			);
			const member = sessionManager
				.listSessions()
				.find((session) => session.sessionId === "member-session-1");
			expect(member).toEqual(
				expect.objectContaining({
					workspaceRootCwd: "/home/user/project",
					worktreeSourceCwd: "/home/user/project",
					worktreeBranch: "team/run",
				}),
			);
		});

		it("places and bootstraps a remote member while keeping Team facts authoritative on the leader", async () => {
			const harness = await prepareEncryptedLeaderForRemoteSpawn();

			const result = await sessionManager.spawnAgentTeamMember({
				agentTeamId: harness.created.team.agentTeamId,
				requestedByMemberId: harness.created.team.leaderMemberId,
				name: "Remote Worker",
				backendId: "backend-remote",
			});

			expect(result).toEqual({
				ok: true,
				memberId: expect.any(String),
				sessionId: "remote-member-session",
				backendId: "backend-remote",
				name: "Remote Worker",
				requestedByMemberId: harness.created.team.leaderMemberId,
			});
			if (!result.ok) {
				throw new Error("Expected remote member spawn to succeed");
			}
			expect(harness.resolveBackend).not.toHaveBeenCalled();
			expect(harness.createConnection).toHaveBeenCalledTimes(1);
			expect(mockConnection.createSession).toHaveBeenCalledTimes(1);
			expect(harness.placeTeamRelayPeer).toHaveBeenCalledWith({
				backendId: "backend-remote",
			});
			expect(harness.resolveTeamRelayPeer).not.toHaveBeenCalled();
			expect(harness.sendTeamRelay).toHaveBeenCalledTimes(1);

			const [request] = harness.verifiedRequests;
			if (!request) {
				throw new Error("Expected encrypted remote bootstrap request");
			}
			const serverId = buildTeamMcpServerId({
				agentTeamId: harness.created.team.agentTeamId,
				memberId: result.memberId,
			});
			expect(request).toEqual(
				expect.objectContaining({
					operation: "member.bootstrap",
					sourceMachineId: mockConfig.machineId,
					targetMachineId: harness.workerProtocol.machineId,
				}),
			);
			expect(request.payload).toEqual({
				operationId: request.operationId,
				agentTeamId: harness.created.team.agentTeamId,
				memberId: result.memberId,
				serverId,
				backendId: "backend-remote",
				cwd: "/home/user/project",
				additionalDirectories: [],
			});
			expect(
				Object.keys(request.payload as Record<string, unknown>).sort(),
			).toEqual([
				"additionalDirectories",
				"agentTeamId",
				"backendId",
				"cwd",
				"memberId",
				"operationId",
				"serverId",
			]);

			const execution = harness.internals.agentTeamStore.getTeamMemberExecution(
				harness.created.team.agentTeamId,
				result.memberId,
			);
			expect(execution).toEqual(
				expect.objectContaining({
					agentTeamId: harness.created.team.agentTeamId,
					memberId: result.memberId,
					executionMachineId: harness.workerProtocol.machineId,
					workerRelayKeyId: harness.workerProtocol.relayKey.keyId,
					bootstrapOperationId: request.operationId,
				}),
			);
			const authoritativeTeam = harness.internals.agentTeamStore.getAgentTeam({
				agentTeamId: harness.created.team.agentTeamId,
			}).team;
			expect(authoritativeTeam?.members).toContainEqual(
				expect.objectContaining({
					memberId: result.memberId,
					role: "member",
					name: "Remote Worker",
					backendId: "backend-remote",
					sessionId: "remote-member-session",
					lifecycle: "running",
					health: "healthy",
					mcp: expect.objectContaining({
						transport: "acp",
						phase: "tools_ready",
						serverId,
					}),
				}),
			);
			expect(
				sessionManager.listSessions().map((session) => session.sessionId),
			).toEqual(["leader-session-for-remote-spawn"]);
			expect(
				harness.internals.teamRelayStore.getRemoteSessionBindingByServerId(
					serverId,
				),
			).toBeUndefined();
		});

		it("executes a remote member command only against the leader Team store", async () => {
			const harness = await prepareEncryptedLeaderForRemoteSpawn();
			const spawned = await sessionManager.spawnAgentTeamMember({
				agentTeamId: harness.created.team.agentTeamId,
				requestedByMemberId: harness.created.team.leaderMemberId,
				name: "Remote Command Worker",
				backendId: "backend-remote",
			});
			if (!spawned.ok) {
				throw new Error("Expected remote member spawn to succeed");
			}

			const operationId = "remote-command-create-task";
			const command = {
				version: TEAM_COMMAND_ENVELOPE_VERSION,
				operationId,
				agentTeamId: harness.created.team.agentTeamId,
				callerMemberId: spawned.memberId,
				toolName: "mobvibe_team_task_create",
				args: {
					title: "Leader-owned remote task",
					description: "Persist this only on the leader machine",
				},
			};
			const sealed = harness.workerProtocol.sealRequest({
				operationId,
				operation: "team.command",
				targetMachineId: harness.leaderProtocol.machineId,
				targetRelayKey: harness.leaderProtocol.relayKey,
				payload: command,
			});
			const response = await (
				sessionManager as unknown as SessionManagerTeamRelayApi
			).handleTeamRelayRequest({
				operationId,
				sourceMachineId: harness.workerProtocol.machineId,
				sourceRelayKey: harness.workerProtocol.relayKey,
				ciphertext: sealed.ciphertext,
			});
			const execution = harness.workerProtocol.openResponse({
				operationId,
				operation: "team.command",
				targetMachineId: harness.leaderProtocol.machineId,
				targetRelayKey: harness.leaderProtocol.relayKey,
				ciphertext: response.ciphertext,
			});

			expect(execution).toEqual(
				expect.objectContaining({
					operationId,
					result: expect.objectContaining({
						caller: {
							agentTeamId: harness.created.team.agentTeamId,
							memberId: spawned.memberId,
							role: "member",
						},
						toolName: "mobvibe_team_task_create",
					}),
				}),
			);
			const [storedTask] = harness.internals.agentTeamStore.listLocalTasks(
				harness.created.team.agentTeamId,
			);
			expect(storedTask).toEqual(
				expect.objectContaining({
					agent_team_id: harness.created.team.agentTeamId,
					owner_member_id: spawned.memberId,
					status: "todo",
				}),
			);
			if (!storedTask) {
				throw new Error("Expected the leader to persist the remote task");
			}
			const storedBody: unknown = JSON.parse(storedTask.body_local_json);
			expect(storedBody).toEqual({
				title: "Leader-owned remote task",
				description: "Persist this only on the leader machine",
			});
		});

		it("applies a remote member turn completion only to leader Team facts", async () => {
			const harness = await prepareEncryptedLeaderForRemoteSpawn();
			const spawned = await sessionManager.spawnAgentTeamMember({
				agentTeamId: harness.created.team.agentTeamId,
				requestedByMemberId: harness.created.team.leaderMemberId,
				name: "Remote Runtime Worker",
				backendId: "backend-remote",
			});
			if (!spawned.ok) {
				throw new Error("Expected remote member spawn to succeed");
			}

			const payload = createTeamTurnCompletedRelayPayload({
				agentTeamId: harness.created.team.agentTeamId,
				memberId: spawned.memberId,
				sessionId: "remote-member-session",
				revision: 1,
				seq: 2,
			});
			const { operationId } = payload;
			const sealed = harness.workerProtocol.sealRequest({
				operationId,
				operation: "member.runtime",
				targetMachineId: harness.leaderProtocol.machineId,
				targetRelayKey: harness.leaderProtocol.relayKey,
				payload,
			});
			const relayRequest = {
				operationId,
				sourceMachineId: harness.workerProtocol.machineId,
				sourceRelayKey: harness.workerProtocol.relayKey,
				ciphertext: sealed.ciphertext,
			};
			const response = await (
				sessionManager as unknown as SessionManagerTeamRelayApi
			).handleTeamRelayRequest(relayRequest);
			const result = harness.workerProtocol.openResponse({
				operationId,
				operation: "member.runtime",
				targetMachineId: harness.leaderProtocol.machineId,
				targetRelayKey: harness.leaderProtocol.relayKey,
				ciphertext: response.ciphertext,
			});

			expect(result).toEqual({ operationId, accepted: true });
			expect(
				harness.internals.agentTeamStore
					.getAgentTeam({
						agentTeamId: harness.created.team.agentTeamId,
					})
					.team?.members.find((member) => member.memberId === spawned.memberId)
					?.lifecycle,
			).toBe("completed");
			expect(
				sessionManager
					.listSessions()
					.some((session) => session.sessionId === "remote-member-session"),
			).toBe(false);

			const replayResponse = await (
				sessionManager as unknown as SessionManagerTeamRelayApi
			).handleTeamRelayRequest(relayRequest);
			expect(
				harness.workerProtocol.openResponse({
					operationId,
					operation: "member.runtime",
					targetMachineId: harness.leaderProtocol.machineId,
					targetRelayKey: harness.leaderProtocol.relayKey,
					ciphertext: replayResponse.ciphertext,
				}),
			).toEqual({ operationId, accepted: true });
			expect(mockConnection.prompt).toHaveBeenCalledTimes(1);
		});

		it("treats remote bootstrap results containing leader-owned facts as outcome unknown", async () => {
			const harness = await prepareEncryptedLeaderForRemoteSpawn({
				response: (request) => {
					const payload = request.payload as { serverId: string };
					return {
						operationId: request.operationId,
						serverId: payload.serverId,
						sessionId: "untrusted-remote-session",
						role: "leader",
					};
				},
			});

			const result = await sessionManager.spawnAgentTeamMember({
				agentTeamId: harness.created.team.agentTeamId,
				requestedByMemberId: harness.created.team.leaderMemberId,
				name: "Untrusted Result Worker",
				backendId: "backend-remote",
			});

			expect(result).toEqual(
				expect.objectContaining({
					ok: false,
					memberId: expect.any(String),
					error: expect.objectContaining({
						code: "MESSAGE_OUTCOME_UNKNOWN",
					}),
				}),
			);
			const team = harness.internals.agentTeamStore.getAgentTeam({
				agentTeamId: harness.created.team.agentTeamId,
			}).team;
			const failedMember = team?.members.find(
				(member) => member.name === "Untrusted Result Worker",
			);
			expect(failedMember).toEqual(
				expect.objectContaining({
					sessionId: undefined,
					lifecycle: "creating_session",
					health: "degraded",
					error: expect.objectContaining({
						code: "MESSAGE_OUTCOME_UNKNOWN",
					}),
					mcp: expect.objectContaining({
						phase: "degraded",
						error: expect.objectContaining({
							code: "MESSAGE_OUTCOME_UNKNOWN",
						}),
					}),
				}),
			);
			if (!failedMember) {
				throw new Error("Expected failed remote member fact");
			}
			expect(
				harness.internals.agentTeamStore.getTeamMemberExecution(
					harness.created.team.agentTeamId,
					failedMember.memberId,
				),
			).toEqual(
				expect.objectContaining({
					executionMachineId: harness.workerProtocol.machineId,
					workerRelayKeyId: harness.workerProtocol.relayKey.keyId,
					bootstrapOperationId: harness.verifiedRequests[0]?.operationId,
				}),
			);
		});

		it("does not invent a member or execution route when placement fails", async () => {
			const harness = await prepareEncryptedLeaderForRemoteSpawn({
				placeError: new Error("no eligible remote worker"),
			});

			const result = await sessionManager.spawnAgentTeamMember({
				agentTeamId: harness.created.team.agentTeamId,
				requestedByMemberId: harness.created.team.leaderMemberId,
				name: "Unplaced Worker",
				backendId: "backend-remote",
			});

			expect(result).toEqual(
				expect.objectContaining({
					ok: false,
					error: expect.objectContaining({ code: "INTERNAL_ERROR" }),
				}),
			);
			expect(result).not.toHaveProperty("memberId");
			const team = harness.internals.agentTeamStore.getAgentTeam({
				agentTeamId: harness.created.team.agentTeamId,
			}).team;
			expect(
				team?.members.find((member) => member.name === "Unplaced Worker"),
			).toBeUndefined();
			expect(
				harness.internals.agentTeamStore.listTeamMemberExecutions(
					harness.created.team.agentTeamId,
				),
			).toEqual([]);
			expect(harness.sendTeamRelay).not.toHaveBeenCalled();
			expect(harness.resolveBackend).not.toHaveBeenCalled();
			expect(harness.createConnection).toHaveBeenCalledTimes(1);
		});

		it("keeps the member non-terminal and retains its route when bootstrap delivery has an unknown outcome", async () => {
			const cases: Array<{
				label: string;
				behavior: RemoteSpawnRelayBehavior;
			}> = [
				{
					label: "transport",
					behavior: { sendError: new Error("relay response lost") },
				},
				{
					label: "worker",
					behavior: {
						remoteFailure: new AppError(
							createErrorDetail({
								code: "MESSAGE_OUTCOME_UNKNOWN",
								message: "Worker cannot prove bootstrap outcome",
								retryable: true,
								scope: "session",
							}),
							500,
						),
					},
				},
			];

			for (const testCase of cases) {
				const harness = await prepareEncryptedLeaderForRemoteSpawn(
					testCase.behavior,
				);
				const memberName = `Uncertain ${testCase.label} Worker`;
				const result = await sessionManager.spawnAgentTeamMember({
					agentTeamId: harness.created.team.agentTeamId,
					requestedByMemberId: harness.created.team.leaderMemberId,
					name: memberName,
					backendId: "backend-remote",
				});

				expect(result).toEqual(
					expect.objectContaining({
						ok: false,
						memberId: expect.any(String),
						error: expect.objectContaining({
							code: "MESSAGE_OUTCOME_UNKNOWN",
						}),
					}),
				);
				const team = harness.internals.agentTeamStore.getAgentTeam({
					agentTeamId: harness.created.team.agentTeamId,
				}).team;
				const uncertainMember = team?.members.find(
					(member) => member.name === memberName,
				);
				expect(uncertainMember).toEqual(
					expect.objectContaining({
						sessionId: undefined,
						lifecycle: "creating_session",
						health: "degraded",
						error: expect.objectContaining({
							code: "MESSAGE_OUTCOME_UNKNOWN",
						}),
						mcp: expect.objectContaining({
							phase: "degraded",
							error: expect.objectContaining({
								code: "MESSAGE_OUTCOME_UNKNOWN",
							}),
						}),
					}),
				);
				const [request] = harness.verifiedRequests;
				if (!uncertainMember || !request) {
					throw new Error("Expected uncertain member and delivered bootstrap");
				}
				expect(
					harness.internals.agentTeamStore.getTeamMemberExecution(
						harness.created.team.agentTeamId,
						uncertainMember.memberId,
					),
				).toEqual(
					expect.objectContaining({
						executionMachineId: harness.workerProtocol.machineId,
						workerRelayKeyId: harness.workerProtocol.relayKey.keyId,
						bootstrapOperationId: request.operationId,
					}),
				);
				expect(harness.resolveBackend).not.toHaveBeenCalled();
				expect(harness.createConnection).toHaveBeenCalledTimes(1);
				expect(
					sessionManager.listSessions().map((session) => session.sessionId),
				).toEqual(["leader-session-for-remote-spawn"]);
			}
		});

		it("marks a proven remote bootstrap failure terminal while retaining its bound route", async () => {
			const harness = await prepareEncryptedLeaderForRemoteSpawn({
				remoteFailure: new AppError(
					createErrorDetail({
						code: "CAPABILITY_NOT_SUPPORTED",
						message: "Remote backend lacks native MCP-over-ACP",
						retryable: false,
						scope: "session",
					}),
					409,
				),
			});

			const result = await sessionManager.spawnAgentTeamMember({
				agentTeamId: harness.created.team.agentTeamId,
				requestedByMemberId: harness.created.team.leaderMemberId,
				name: "Rejected Remote Worker",
				backendId: "backend-remote",
			});

			expect(result).toEqual(
				expect.objectContaining({
					ok: false,
					memberId: expect.any(String),
					error: expect.objectContaining({
						code: "CAPABILITY_NOT_SUPPORTED",
					}),
				}),
			);
			const team = harness.internals.agentTeamStore.getAgentTeam({
				agentTeamId: harness.created.team.agentTeamId,
			}).team;
			const failedMember = team?.members.find(
				(member) => member.name === "Rejected Remote Worker",
			);
			expect(failedMember).toEqual(
				expect.objectContaining({
					sessionId: undefined,
					lifecycle: "failed",
					health: "error",
					error: expect.objectContaining({
						code: "CAPABILITY_NOT_SUPPORTED",
					}),
					mcp: expect.objectContaining({
						phase: "error",
						error: expect.objectContaining({
							code: "CAPABILITY_NOT_SUPPORTED",
						}),
					}),
				}),
			);
			const [request] = harness.verifiedRequests;
			if (!failedMember || !request) {
				throw new Error("Expected terminal remote failure and route");
			}
			expect(
				harness.internals.agentTeamStore.getTeamMemberExecution(
					harness.created.team.agentTeamId,
					failedMember.memberId,
				),
			).toEqual(
				expect.objectContaining({
					executionMachineId: harness.workerProtocol.machineId,
					workerRelayKeyId: harness.workerProtocol.relayKey.keyId,
					bootstrapOperationId: request.operationId,
				}),
			);
		});

		it("keeps a locally available backend on the existing local spawn path", async () => {
			const harness = await prepareEncryptedLeaderForRemoteSpawn();
			prepareTeamSessionConnection(
				mockConnection,
				"local-member-session",
				expectedTeamTools,
			);

			const result = await sessionManager.spawnAgentTeamMember({
				agentTeamId: harness.created.team.agentTeamId,
				requestedByMemberId: harness.created.team.leaderMemberId,
				name: "Local Worker",
				backendId: "backend-1",
			});

			expect(result).toEqual(
				expect.objectContaining({
					ok: true,
					memberId: expect.any(String),
					sessionId: "local-member-session",
					backendId: "backend-1",
				}),
			);
			if (!result.ok) {
				throw new Error("Expected local member spawn to succeed");
			}
			expect(harness.resolveBackend).toHaveBeenCalledWith("backend-1");
			expect(harness.placeTeamRelayPeer).not.toHaveBeenCalled();
			expect(harness.resolveTeamRelayPeer).not.toHaveBeenCalled();
			expect(harness.sendTeamRelay).not.toHaveBeenCalled();
			expect(harness.createConnection).toHaveBeenCalledTimes(2);
			expect(mockConnection.createSession).toHaveBeenCalledTimes(2);
			expect(
				harness.internals.agentTeamStore.getTeamMemberExecution(
					harness.created.team.agentTeamId,
					result.memberId,
				),
			).toBeNull();
		});

		it("normalizes a local backend ID before deciding whether to place remotely", async () => {
			const harness = await prepareEncryptedLeaderForRemoteSpawn();
			prepareTeamSessionConnection(
				mockConnection,
				"normalized-local-member-session",
				expectedTeamTools,
			);

			const result = await sessionManager.spawnAgentTeamMember({
				agentTeamId: harness.created.team.agentTeamId,
				requestedByMemberId: harness.created.team.leaderMemberId,
				name: "Normalized Local Worker",
				backendId: " backend-1 ",
			});

			expect(result).toEqual(
				expect.objectContaining({
					ok: true,
					sessionId: "normalized-local-member-session",
					backendId: "backend-1",
				}),
			);
			expect(harness.resolveBackend).toHaveBeenCalledWith("backend-1");
			expect(harness.placeTeamRelayPeer).not.toHaveBeenCalled();
			expect(harness.sendTeamRelay).not.toHaveBeenCalled();
		});

		it("cleans up a created member session when Team MCP readiness times out", async () => {
			const leaderConnection = createMockConnection();
			const memberConnection = createMockConnection();
			prepareTeamSessionConnection(
				leaderConnection,
				"leader-session-before-member-timeout",
				expectedTeamTools,
			);
			prepareTeamSessionConnection(
				memberConnection,
				"member-session-readiness-timeout",
			);
			const connections = [leaderConnection, memberConnection];
			sessionManager.createConnection = () => {
				const connection = connections.shift();
				if (!connection) throw new Error("Unexpected connection request");
				return connection as unknown as AcpConnection;
			};
			const created = await sessionManager.createAgentTeamRun({
				machineId: mockConfig.machineId,
				backendId: "backend-1",
				workspaceRootCwd: "/home/user/project",
			});
			const readinessError = new AppError(
				createErrorDetail({
					code: "SESSION_NOT_READY",
					message: "Timed out waiting for Team MCP tools readiness",
					retryable: true,
					scope: "session",
				}),
				504,
			);
			const internals =
				sessionManager as unknown as SessionManagerTeamInternals;
			internals.waitForTeamToolsReady = mock(() =>
				Promise.reject(readinessError),
			);

			const result = await sessionManager.spawnAgentTeamMember({
				agentTeamId: created.team.agentTeamId,
				requestedByMemberId: created.team.leaderMemberId,
				name: "Timeout Worker",
			});

			expect(result).toEqual(
				expect.objectContaining({
					ok: false,
					memberId: expect.any(String),
					error: expect.objectContaining({ code: "SESSION_NOT_READY" }),
				}),
			);
			expect(memberConnection.closeSession).toHaveBeenCalledWith(
				"member-session-readiness-timeout",
			);
			expect(memberConnection.disconnect).toHaveBeenCalledTimes(1);
			expect(leaderConnection.closeSession).not.toHaveBeenCalled();
			expect(leaderConnection.disconnect).not.toHaveBeenCalled();
			expect(
				sessionManager
					.listSessions()
					.map((session) => session.sessionId)
					.sort(),
			).toEqual(["leader-session-before-member-timeout"]);
			const team = internals.agentTeamStore.getAgentTeam({
				agentTeamId: created.team.agentTeamId,
			}).team;
			expect(team?.lifecycle).toBe("running");
			expect(team?.members).toContainEqual(
				expect.objectContaining({
					name: "Timeout Worker",
					sessionId: "member-session-readiness-timeout",
					lifecycle: "failed",
					health: "error",
					error: expect.objectContaining({ code: "SESSION_NOT_READY" }),
					mcp: expect.objectContaining({ phase: "not_started" }),
				}),
			);
		});

		it("keeps a degraded member error primary when member cleanup fails", async () => {
			const leaderConnection = createMockConnection();
			const memberConnection = createMockConnection();
			prepareTeamSessionConnection(
				leaderConnection,
				"leader-session-before-member-degraded",
				expectedTeamTools,
			);
			prepareTeamSessionConnection(
				memberConnection,
				"member-session-degraded",
				expectedTeamTools.slice(0, -1),
			);
			const cleanupSecret = "member cleanup provider secret";
			memberConnection.closeSession.mockRejectedValueOnce(
				new Error(cleanupSecret),
			);
			const connections = [leaderConnection, memberConnection];
			sessionManager.createConnection = () => {
				const connection = connections.shift();
				if (!connection) throw new Error("Unexpected connection request");
				return connection as unknown as AcpConnection;
			};
			const created = await sessionManager.createAgentTeamRun({
				machineId: mockConfig.machineId,
				backendId: "backend-1",
				workspaceRootCwd: "/home/user/project",
			});
			loggerWarnMock.mockClear();

			const result = await sessionManager.spawnAgentTeamMember({
				agentTeamId: created.team.agentTeamId,
				requestedByMemberId: created.team.leaderMemberId,
				name: "Degraded Worker",
			});

			expect(result).toEqual(
				expect.objectContaining({
					ok: false,
					memberId: expect.any(String),
					error: expect.objectContaining({
						code: "CAPABILITY_NOT_SUPPORTED",
					}),
				}),
			);
			expect(memberConnection.closeSession).toHaveBeenCalledWith(
				"member-session-degraded",
			);
			expect(memberConnection.disconnect).toHaveBeenCalledTimes(1);
			const internals =
				sessionManager as unknown as SessionManagerTeamInternals;
			const team = internals.agentTeamStore.getAgentTeam({
				agentTeamId: created.team.agentTeamId,
			}).team;
			const failedMember = team?.members.find(
				(member) => member.name === "Degraded Worker",
			);
			expect(team?.lifecycle).toBe("running");
			expect(failedMember).toEqual(
				expect.objectContaining({
					sessionId: "member-session-degraded",
					lifecycle: "failed",
					health: "error",
					error: expect.objectContaining({
						code: "CAPABILITY_NOT_SUPPORTED",
					}),
					mcp: expect.objectContaining({ phase: "not_started" }),
				}),
			);
			expect(loggerWarnMock).toHaveBeenCalledWith(
				expect.objectContaining({
					agentTeamId: created.team.agentTeamId,
					memberId: failedMember?.memberId,
					sessionId: "member-session-degraded",
					cleanupStep: "session_close",
					errorCode: "INTERNAL_ERROR",
				}),
				"agent_team_readiness_cleanup_failed",
			);
			expect(JSON.stringify(loggerWarnMock.mock.calls)).not.toContain(
				cleanupSecret,
			);
		});

		it("leaves a failed member slot when spawned session creation fails", async () => {
			mockConnection.getSessionCapabilities.mockReturnValue({
				list: true,
				load: true,
				mcp: { acp: true },
			});
			mockConnection.createSession
				.mockImplementationOnce(async (...args: unknown[]) => {
					const params = args[0] as {
						teamMcpDeclaration?: { serverId?: string };
						teamMcpHandlers?: {
							handleConnect(input: { serverId: string }): unknown;
							handleListTools(input: {
								serverId: string;
								toolNames: string[];
							}): void;
						};
					};
					const serverId = params.teamMcpDeclaration?.serverId;
					if (params.teamMcpHandlers && serverId) {
						params.teamMcpHandlers.handleConnect({ serverId });
						params.teamMcpHandlers.handleListTools({
							serverId,
							toolNames: expectedTeamTools,
						});
					}
					return {
						sessionId: "leader-session-1",
						modes: null,
						configOptions: null,
					};
				})
				.mockRejectedValueOnce(new Error("member backend refused"));

			const created = await sessionManager.createAgentTeamRun({
				machineId: mockConfig.machineId,
				backendId: "backend-1",
				workspaceRootCwd: "/home/user/project",
			});
			const result = await sessionManager.spawnAgentTeamMember({
				agentTeamId: created.team.agentTeamId,
				requestedByMemberId: created.team.leaderMemberId,
				name: "Broken Worker",
			});

			expect(result).toEqual(
				expect.objectContaining({
					ok: false,
					memberId: expect.any(String),
					error: expect.objectContaining({ code: "INTERNAL_ERROR" }),
				}),
			);
			const internals =
				sessionManager as unknown as SessionManagerTeamInternals;
			const team = internals.agentTeamStore.getAgentTeam({
				agentTeamId: created.team.agentTeamId,
			}).team;
			expect(team?.members).toContainEqual(
				expect.objectContaining({
					name: "Broken Worker",
					lifecycle: "failed",
					health: "error",
					error: expect.objectContaining({ code: "INTERNAL_ERROR" }),
				}),
			);
		});
	});

	describe("remote Team worker bootstrap", () => {
		it("keeps the Team relay lifecycle terminal after SessionManager shutdown", async () => {
			const harness = await prepareEncryptedRemoteWorker();

			await sessionManager.shutdown();

			expect(harness.relayApi.setTeamRelayTransportReady(true)).toBe(false);
			expect(harness.relayApi.setTeamRelayTransportReady(false)).toBe(false);
			expect(() =>
				harness.relayApi.attachTeamRelayTransport(harness.transport),
			).toThrow("Session manager is shutting down");
			expect(() =>
				harness.relayApi.bindTeamRelayMachineIdentity(
					harness.workerProtocol.machineId,
				),
			).toThrow("Session manager is shutting down");
		});

		it("uses the Gateway canonical machine identity for real encrypted relay roundtrips", async () => {
			const canonicalWorkerMachineId = "user-1:test-machine-id";
			const canonicalLeaderMachineId = "user-1:leader-machine";
			const harness = await prepareEncryptedRemoteWorker({
				workerMachineId: canonicalWorkerMachineId,
				leaderMachineId: canonicalLeaderMachineId,
				outgoingResponse: (request) => ({
					operationId: request.operationId,
					accepted: true,
				}),
			});
			const fixture = createRemoteBootstrapFixture(
				"bootstrap-canonical-machine-identity",
				"canonical-machine-identity",
			);
			prepareTeamSessionConnection(
				mockConnection,
				"remote-worker-session-canonical",
				expectedRemoteTeamTools,
			);

			const response = await harness.relayApi.handleTeamRelayRequest(
				sealRemoteBootstrap(harness, fixture),
			);
			expect(
				openRemoteBootstrapResponse(harness, fixture.operationId, response),
			).toEqual(
				expect.objectContaining({
					sessionId: "remote-worker-session-canonical",
				}),
			);

			const claim = sessionManager.claimMessageSend(
				"remote-worker-session-canonical",
				"remote-worker-message-canonical",
			);
			if (claim.status !== "claimed") {
				throw new Error("Expected canonical remote worker message claim");
			}
			sessionManager.completeMessageSend(
				"remote-worker-session-canonical",
				"remote-worker-message-canonical",
				claim.claimId,
				"end_turn",
			);
			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(harness.outgoingRequests).toContainEqual(
				expect.objectContaining({
					sourceMachineId: canonicalWorkerMachineId,
					targetMachineId: canonicalLeaderMachineId,
				}),
			);
		});

		it("persists a creating binding before ACP session/new and activates it without local Team facts", async () => {
			const harness = await prepareEncryptedRemoteWorker();
			const fixture = createRemoteBootstrapFixture(
				"bootstrap-before-session-new",
				"ordering",
			);
			mockConnection.getSessionCapabilities.mockReturnValue({
				list: true,
				load: true,
				resume: true,
				close: true,
				mcp: { acp: true },
			});
			let bindingDuringCreate:
				| ReturnType<TeamRelayStore["getRemoteSessionBindingByServerId"]>
				| undefined;
			let bindingDuringPermissionRegistration:
				| ReturnType<TeamRelayStore["getRemoteSessionBindingByServerId"]>
				| undefined;
			let createParams: unknown;
			mockConnection.createSession.mockImplementationOnce(
				async (...args: unknown[]) => {
					createParams = args[0];
					bindingDuringCreate =
						harness.internals.teamRelayStore.getRemoteSessionBindingByServerId(
							fixture.serverId,
						);
					bindTeamMcpForTest(args[0], expectedRemoteTeamTools);
					return {
						sessionId: "remote-worker-session-ordering",
						modes: null,
						configOptions: null,
					};
				},
			);
			mockConnection.setPermissionHandler.mockImplementationOnce((handler) => {
				permissionHandlerCallback = handler;
				bindingDuringPermissionRegistration =
					harness.internals.teamRelayStore.getRemoteSessionBindingByServerId(
						fixture.serverId,
					);
			});
			const request = sealRemoteBootstrap(harness, fixture);

			const response = await harness.relayApi.handleTeamRelayRequest(request);

			expect(
				openRemoteBootstrapResponse(harness, fixture.operationId, response),
			).toEqual(
				expect.objectContaining({
					sessionId: "remote-worker-session-ordering",
				}),
			);
			expect(bindingDuringCreate).toEqual(
				expect.objectContaining({
					serverId: fixture.serverId,
					agentTeamId: fixture.agentTeamId,
					memberId: fixture.memberId,
					leaderMachineId: harness.leaderProtocol.machineId,
					backendId: fixture.backendId,
					lifecycle: "creating",
					sessionId: undefined,
				}),
			);
			expect(createParams).toEqual(
				expect.objectContaining({
					cwd: fixture.cwd,
					additionalDirectories: fixture.additionalDirectories,
					teamMcpDeclaration: expect.objectContaining({
						type: "acp",
						serverId: fixture.serverId,
					}),
					teamMcpHandlers: expect.any(Object),
				}),
			);
			expect(
				(
					createParams as {
						teamMcpHandlers?: unknown;
					}
				).teamMcpHandlers,
			).not.toBe(harness.internals.teamRuntime.mcpRouter);
			expect(
				harness.internals.teamRelayStore.getRemoteSessionBindingByServerId(
					fixture.serverId,
				),
			).toEqual(
				expect.objectContaining({
					sessionId: "remote-worker-session-ordering",
					lifecycle: "active",
				}),
			);
			expect(bindingDuringPermissionRegistration?.lifecycle).toBe("active");
			expect(
				sessionManager
					.listSessions()
					.find(
						(session) => session.sessionId === "remote-worker-session-ordering",
					)?.agentTeamOwned,
			).toBe(true);
			await sessionManager.closeSession("remote-worker-session-ordering");
			expect(
				sessionManager
					.listAllSessions()
					.find(
						(session) => session.sessionId === "remote-worker-session-ordering",
					)?.agentTeamOwned,
			).toBe(true);
			const replay = await harness.relayApi.handleTeamRelayRequest(request);
			expect(
				openRemoteBootstrapResponse(harness, fixture.operationId, replay),
			).toEqual(
				openRemoteBootstrapResponse(harness, fixture.operationId, response),
			);
			expect(mockConnection.createSession).toHaveBeenCalledTimes(1);
			expect(harness.internals.agentTeamStore.listAgentTeams().teams).toEqual(
				[],
			);
		});

		it("relays a durable worker turn completion to the leader", async () => {
			const harness = await prepareEncryptedRemoteWorker({
				outgoingResponse: (request) => ({
					operationId: request.operationId,
					accepted: true,
				}),
			});
			const fixture = createRemoteBootstrapFixture(
				"bootstrap-runtime-completion",
				"runtime-completion",
			);
			prepareTeamSessionConnection(
				mockConnection,
				"remote-worker-session-runtime",
				expectedRemoteTeamTools,
			);
			const bootstrapResponse = await harness.relayApi.handleTeamRelayRequest(
				sealRemoteBootstrap(harness, fixture),
			);
			openRemoteBootstrapResponse(
				harness,
				fixture.operationId,
				bootstrapResponse,
			);
			const claim = sessionManager.claimMessageSend(
				"remote-worker-session-runtime",
				"remote-worker-message-runtime",
			);
			if (claim.status !== "claimed") {
				throw new Error("Expected remote worker message claim");
			}

			sessionManager.completeMessageSend(
				"remote-worker-session-runtime",
				"remote-worker-message-runtime",
				claim.claimId,
				"end_turn",
			);
			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(harness.outgoingRequests).toHaveLength(1);
			const [runtimeRequest] = harness.outgoingRequests;
			if (!runtimeRequest) {
				throw new Error("Expected a remote runtime relay request");
			}
			expect(runtimeRequest).toEqual(
				expect.objectContaining({
					operation: "member.runtime",
					sourceMachineId: harness.workerProtocol.machineId,
					targetMachineId: harness.leaderProtocol.machineId,
					payload: {
						version: 1,
						type: "turn_completed",
						operationId: expect.stringMatching(
							/^team-runtime:v1:[0-9a-f]{64}$/,
						),
						agentTeamId: fixture.agentTeamId,
						memberId: fixture.memberId,
						turnId: expect.stringMatching(/^[0-9a-f]{64}$/),
					},
				}),
			);
			const runtimeOperationId = (
				runtimeRequest.payload as { operationId?: unknown }
			).operationId;
			if (typeof runtimeOperationId !== "string") {
				throw new Error("Expected a string runtime relay operation ID");
			}
			expect(runtimeRequest.operationId).toBe(runtimeOperationId);
			expect(harness.internals.teamRelayStore.listRuntimeOutbox()).toEqual([
				expect.objectContaining({
					operationId: runtimeOperationId,
					status: "delivered",
					attemptCount: 1,
				}),
			]);
			expect(
				sessionManager.getMessageSendResult(
					"remote-worker-session-runtime",
					"remote-worker-message-runtime",
				),
			).toEqual({ stopReason: "end_turn" });
			expect(harness.internals.agentTeamStore.listAgentTeams().teams).toEqual(
				[],
			);
			expect(
				harness.internals.teamRelayStore.getRemoteSessionBindingBySessionId(
					"remote-worker-session-runtime",
				)?.lifecycle,
			).toBe("active");
		});

		it("waits for registered relay readiness before draining a durable worker completion", async () => {
			const harness = await prepareEncryptedRemoteWorker({
				attachTransport: false,
				outgoingResponse: (request) => ({
					operationId: request.operationId,
					accepted: true,
				}),
			});
			const fixture = createRemoteBootstrapFixture(
				"bootstrap-runtime-attach",
				"runtime-attach",
			);
			prepareTeamSessionConnection(
				mockConnection,
				"remote-worker-session-runtime-attach",
				expectedRemoteTeamTools,
			);
			const bootstrapResponse = await harness.relayApi.handleTeamRelayRequest(
				sealRemoteBootstrap(harness, fixture),
			);
			openRemoteBootstrapResponse(
				harness,
				fixture.operationId,
				bootstrapResponse,
			);
			const claim = sessionManager.claimMessageSend(
				"remote-worker-session-runtime-attach",
				"remote-worker-message-runtime-attach",
			);
			if (claim.status !== "claimed") {
				throw new Error("Expected remote worker message claim");
			}

			sessionManager.completeMessageSend(
				"remote-worker-session-runtime-attach",
				"remote-worker-message-runtime-attach",
				claim.claimId,
				"end_turn",
			);
			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(harness.outgoingRequests).toHaveLength(0);
			expect(harness.internals.teamRelayStore.listRuntimeOutbox()).toEqual([
				expect.objectContaining({ status: "pending", attemptCount: 0 }),
			]);
			expect(
				sessionManager.getMessageSendResult(
					"remote-worker-session-runtime-attach",
					"remote-worker-message-runtime-attach",
				),
			).toEqual({ stopReason: "end_turn" });

			harness.relayApi.attachTeamRelayTransport(harness.transport);
			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(harness.outgoingRequests).toHaveLength(0);
			expect(harness.internals.teamRelayStore.listRuntimeOutbox()).toEqual([
				expect.objectContaining({ status: "pending", attemptCount: 0 }),
			]);

			harness.relayApi.setTeamRelayTransportReady(true);
			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(harness.outgoingRequests).toHaveLength(1);
			expect(harness.internals.teamRelayStore.listRuntimeOutbox()).toEqual([
				expect.objectContaining({ status: "delivered", attemptCount: 1 }),
			]);
		});

		it("keeps a worker prompt completed when runtime relay fails", async () => {
			const harness = await prepareEncryptedRemoteWorker({
				outgoingError: new Error("runtime relay unavailable"),
			});
			const fixture = createRemoteBootstrapFixture(
				"bootstrap-runtime-failure",
				"runtime-failure",
			);
			prepareTeamSessionConnection(
				mockConnection,
				"remote-worker-session-runtime-failure",
				expectedRemoteTeamTools,
			);
			const bootstrapResponse = await harness.relayApi.handleTeamRelayRequest(
				sealRemoteBootstrap(harness, fixture),
			);
			openRemoteBootstrapResponse(
				harness,
				fixture.operationId,
				bootstrapResponse,
			);
			const claim = sessionManager.claimMessageSend(
				"remote-worker-session-runtime-failure",
				"remote-worker-message-runtime-failure",
			);
			if (claim.status !== "claimed") {
				throw new Error("Expected remote worker message claim");
			}
			loggerWarnMock.mockClear();

			expect(() =>
				sessionManager.completeMessageSend(
					"remote-worker-session-runtime-failure",
					"remote-worker-message-runtime-failure",
					claim.claimId,
					"end_turn",
				),
			).not.toThrow();
			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(harness.sendTeamRelay).toHaveBeenCalledTimes(1);
			expect(harness.internals.teamRelayStore.listRuntimeOutbox()).toEqual([
				expect.objectContaining({
					status: "pending",
					attemptCount: 1,
					lastErrorCode: "TEAM_RELAY_TRANSPORT_FAILED",
				}),
			]);
			expect(
				sessionManager.getMessageSendResult(
					"remote-worker-session-runtime-failure",
					"remote-worker-message-runtime-failure",
				),
			).toEqual({ stopReason: "end_turn" });
			expect(loggerWarnMock).toHaveBeenCalledWith(
				expect.objectContaining({
					sessionId: "remote-worker-session-runtime-failure",
					agentTeamId: fixture.agentTeamId,
					memberId: fixture.memberId,
					errorName: "Error",
				}),
				"remote_team_turn_completion_relay_failed",
			);
			expect(harness.internals.agentTeamStore.listAgentTeams().teams).toEqual(
				[],
			);
			await sessionManager.shutdown();
		});

		it("shuts down without waiting for an in-flight runtime relay", async () => {
			let resolveRuntimeRelay: ((value: unknown) => void) | undefined;
			const runtimeRelayResult = new Promise<unknown>((resolve) => {
				resolveRuntimeRelay = resolve;
			});
			const harness = await prepareEncryptedRemoteWorker({
				outgoingResponse: () => runtimeRelayResult,
			});
			const fixture = createRemoteBootstrapFixture(
				"bootstrap-runtime-shutdown",
				"runtime-shutdown",
			);
			prepareTeamSessionConnection(
				mockConnection,
				"remote-worker-session-runtime-shutdown",
				expectedRemoteTeamTools,
			);
			const bootstrapResponse = await harness.relayApi.handleTeamRelayRequest(
				sealRemoteBootstrap(harness, fixture),
			);
			openRemoteBootstrapResponse(
				harness,
				fixture.operationId,
				bootstrapResponse,
			);
			const claim = sessionManager.claimMessageSend(
				"remote-worker-session-runtime-shutdown",
				"remote-worker-message-runtime-shutdown",
			);
			if (claim.status !== "claimed") {
				throw new Error("Expected remote worker message claim");
			}
			sessionManager.completeMessageSend(
				"remote-worker-session-runtime-shutdown",
				"remote-worker-message-runtime-shutdown",
				claim.claimId,
				"end_turn",
			);
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(harness.outgoingRequests).toHaveLength(1);
			expect(
				harness.internals.teamRelayStore.listRuntimeOutbox()[0]?.status,
			).toBe("in_flight");

			const shutdown = sessionManager.shutdown();
			let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
			const shutdownOutcome = await Promise.race([
				shutdown.then(() => "shutdown" as const),
				new Promise<"timeout">((resolve) => {
					timeoutHandle = setTimeout(() => resolve("timeout"), 100);
				}),
			]);
			if (timeoutHandle) {
				clearTimeout(timeoutHandle);
			}
			if (shutdownOutcome === "timeout") {
				const request = harness.outgoingRequests[0];
				resolveRuntimeRelay?.({
					operationId: request?.operationId,
					accepted: true,
				});
				await shutdown;
			}
			expect(shutdownOutcome).toBe("shutdown");

			let reopenedStore = new TeamRelayStore(mockConfig.walDbPath);
			expect(reopenedStore.listRuntimeOutbox()[0]).toEqual(
				expect.objectContaining({
					status: "in_flight",
					attemptCount: 1,
					deliveredAt: undefined,
				}),
			);
			reopenedStore.close();

			loggerWarnMock.mockClear();
			const request = harness.outgoingRequests[0];
			resolveRuntimeRelay?.({
				operationId: request?.operationId,
				accepted: true,
			});
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(loggerWarnMock).not.toHaveBeenCalledWith(
				expect.anything(),
				"remote_team_runtime_outbox_dispatch_failed",
			);
			reopenedStore = new TeamRelayStore(mockConfig.walDbPath);
			expect(reopenedStore.listRuntimeOutbox()[0]).toEqual(
				expect.objectContaining({
					status: "in_flight",
					attemptCount: 1,
					deliveredAt: undefined,
				}),
			);
			reopenedStore.close();
		});

		it("auto-approves permissions for an active remote member binding", async () => {
			const harness = await prepareEncryptedRemoteWorker();
			const fixture = createRemoteBootstrapFixture(
				"bootstrap-remote-permission",
				"permission",
			);
			prepareTeamSessionConnection(
				mockConnection,
				"remote-worker-session-permission",
				expectedRemoteTeamTools,
			);
			const response = await harness.relayApi.handleTeamRelayRequest(
				sealRemoteBootstrap(harness, fixture),
			);
			openRemoteBootstrapResponse(harness, fixture.operationId, response);
			const permissionRequests: PermissionRequestPayload[] = [];
			sessionManager.onPermissionRequest((payload) => {
				permissionRequests.push(payload);
			});

			const decision = await requirePermissionHandler()(
				{
					sessionId: "remote-worker-session-permission",
					toolCall: {
						toolCallId: "remote-member-tool",
						title: "Remote member tool",
					},
					options: [
						{
							optionId: "remote-reject",
							name: "Reject",
							kind: "reject_once",
						},
						{
							optionId: "remote-allow-always",
							name: "Always allow",
							kind: "allow_always",
						},
					],
				},
				"remote-member-permission",
				new AbortController().signal,
			);

			expect(decision).toEqual({
				outcome: {
					outcome: "selected",
					optionId: "remote-allow-always",
				},
			});
			expect(permissionRequests).toEqual([]);
			expect(harness.internals.permissionRequests.size).toBe(0);
			expect(
				harness.internals.teamRelayStore.getRemoteSessionBindingBySessionId(
					"remote-worker-session-permission",
				),
			).toEqual(
				expect.objectContaining({
					agentTeamId: fixture.agentTeamId,
					memberId: fixture.memberId,
					lifecycle: "active",
				}),
			);
			expect(harness.internals.agentTeamStore.listAgentTeams().teams).toEqual(
				[],
			);
		});

		it("marks the remote binding failed when ACP session creation fails without leaking leader Team projections", async () => {
			const harness = await prepareEncryptedRemoteWorker();
			const fixture = createRemoteBootstrapFixture(
				"bootstrap-session-failure",
				"failure",
			);
			mockConnection.getSessionCapabilities.mockReturnValue({
				list: true,
				load: true,
				close: true,
				mcp: { acp: true },
			});
			mockConnection.createSession.mockRejectedValueOnce(
				new Error("worker provider refused session"),
			);

			const response = await harness.relayApi.handleTeamRelayRequest(
				sealRemoteBootstrap(harness, fixture),
			);
			let remoteError: unknown;
			try {
				openRemoteBootstrapResponse(harness, fixture.operationId, response);
			} catch (error) {
				remoteError = error;
			}

			expect(remoteError).toBeInstanceOf(TeamRelayRemoteError);
			expect((remoteError as TeamRelayRemoteError).detail.code).toBe(
				"INTERNAL_ERROR",
			);
			expect(
				harness.internals.teamRelayStore.getRemoteSessionBindingByServerId(
					fixture.serverId,
				),
			).toEqual(
				expect.objectContaining({
					lifecycle: "failed",
					sessionId: undefined,
				}),
			);
			expect(harness.internals.agentTeamStore.listAgentTeams().teams).toEqual(
				[],
			);
			expect(sessionManager.listSessions()).toEqual([]);
			expect(mockConnection.disconnect).toHaveBeenCalledTimes(1);
		});

		it("rolls back a newly created worker WAL session when post-session setup fails", async () => {
			const harness = await prepareEncryptedRemoteWorker();
			const fixture = createRemoteBootstrapFixture(
				"bootstrap-post-session-failure",
				"post-session-failure",
			);
			const sessionId = "remote-worker-session-post-failure";
			mockConnection.getSessionCapabilities.mockReturnValue({
				list: true,
				load: true,
				close: true,
				delete: true,
				mcp: { acp: true },
			});
			mockConnection.createSession.mockImplementationOnce(
				async (...args: unknown[]) => {
					bindTeamMcpForTest(args[0], expectedRemoteTeamTools);
					return {
						sessionId,
						modes: null,
						configOptions: null,
					};
				},
			);
			mockConnection.onTerminalOutput.mockImplementationOnce(() => {
				throw new Error("terminal subscription failed");
			});

			const response = await harness.relayApi.handleTeamRelayRequest(
				sealRemoteBootstrap(harness, fixture),
			);
			expect(() =>
				openRemoteBootstrapResponse(harness, fixture.operationId, response),
			).toThrow(TeamRelayRemoteError);

			expect(mockConnection.deleteSession).toHaveBeenCalledWith(sessionId);
			expect(mockConnection.disconnect).toHaveBeenCalledTimes(1);
			expect(harness.internals.walStore.getSession(sessionId)).toBeNull();
			expect(
				harness.internals.teamRelayStore.getRemoteSessionBindingByServerId(
					fixture.serverId,
				)?.lifecycle,
			).toBe("failed");
			expect(sessionManager.listSessions()).toEqual([]);
		});

		it("fails the binding before ACP session/new when native MCP-over-ACP is unavailable", async () => {
			const harness = await prepareEncryptedRemoteWorker();
			const fixture = createRemoteBootstrapFixture(
				"bootstrap-mcp-unsupported",
				"unsupported",
			);
			mockConnection.getSessionCapabilities.mockReturnValue({
				list: true,
				load: true,
				close: true,
				mcp: { acp: false, http: false, sse: false },
			});

			const response = await harness.relayApi.handleTeamRelayRequest(
				sealRemoteBootstrap(harness, fixture),
			);
			let remoteError: unknown;
			try {
				openRemoteBootstrapResponse(harness, fixture.operationId, response);
			} catch (error) {
				remoteError = error;
			}

			expect(remoteError).toBeInstanceOf(TeamRelayRemoteError);
			expect((remoteError as TeamRelayRemoteError).detail.code).toBe(
				"CAPABILITY_NOT_SUPPORTED",
			);
			expect(mockConnection.createSession).not.toHaveBeenCalled();
			expect(
				harness.internals.teamRelayStore.getRemoteSessionBindingByServerId(
					fixture.serverId,
				),
			).toEqual(
				expect.objectContaining({
					lifecycle: "failed",
					sessionId: undefined,
				}),
			);
			expect(harness.internals.agentTeamStore.listAgentTeams().teams).toEqual(
				[],
			);
		});

		it("rejects remote MCP restore through a different backend affinity", async () => {
			mockConfig.acpBackends.push({
				id: "backend-2",
				label: "Other Agent",
				command: "other-agent",
				args: [],
			});
			const harness = await prepareEncryptedRemoteWorker();
			const fixture = createRemoteBootstrapFixture(
				"bootstrap-backend-affinity",
				"backend-affinity",
			);
			prepareTeamSessionConnection(
				mockConnection,
				"remote-worker-session-backend-affinity",
				expectedRemoteTeamTools,
			);
			const response = await harness.relayApi.handleTeamRelayRequest(
				sealRemoteBootstrap(harness, fixture),
			);
			openRemoteBootstrapResponse(harness, fixture.operationId, response);
			await sessionManager.closeSession(
				"remote-worker-session-backend-affinity",
			);
			mockConnection.loadSession.mockClear();

			try {
				await sessionManager.loadSession(
					"remote-worker-session-backend-affinity",
					fixture.cwd,
					"backend-2",
					fixture.additionalDirectories,
				);
				throw new Error("Expected remote backend affinity mismatch");
			} catch (error) {
				expect(error).toBeInstanceOf(AppError);
				expect((error as AppError).detail.code).toBe(
					"INSTANCE_AFFINITY_CHANGED",
				);
			}
			expect(mockConnection.loadSession).not.toHaveBeenCalled();
			expect(
				harness.internals.teamRelayStore.getRemoteSessionBindingBySessionId(
					"remote-worker-session-backend-affinity",
				)?.lifecycle,
			).toBe("active");
		});

		it("dispatches a worker turn buffered during reload after its durable commit", async () => {
			const harness = await prepareEncryptedRemoteWorker({
				outgoingResponse: (request) => ({
					operationId: request.operationId,
					accepted: true,
				}),
			});
			const fixture = createRemoteBootstrapFixture(
				"bootstrap-remote-buffered-turn",
				"buffered-turn",
			);
			const sessionId = "remote-worker-session-buffered-turn";
			prepareTeamSessionConnection(
				mockConnection,
				sessionId,
				expectedRemoteTeamTools,
			);
			const response = await harness.relayApi.handleTeamRelayRequest(
				sealRemoteBootstrap(harness, fixture),
			);
			openRemoteBootstrapResponse(harness, fixture.operationId, response);
			let outboxSizeDuringReload = -1;
			mockConnection.loadSession.mockImplementationOnce(async () => {
				sessionManager.recordTurnEnd(sessionId, "end_turn");
				outboxSizeDuringReload =
					harness.internals.teamRelayStore.listRuntimeOutbox().length;
				return { modes: null, configOptions: null };
			});

			await sessionManager.reloadSession(
				sessionId,
				fixture.cwd,
				fixture.backendId,
				fixture.additionalDirectories,
			);
			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(outboxSizeDuringReload).toBe(0);
			expect(harness.outgoingRequests).toHaveLength(1);
			expect(harness.internals.teamRelayStore.listRuntimeOutbox()).toEqual([
				expect.objectContaining({
					sourceSessionId: sessionId,
					sourceRevision: 2,
					sourceSeq: 1,
					status: "delivered",
					attemptCount: 1,
				}),
			]);
		});

		it("restores the remote MCP router for reload, resume, and load", async () => {
			const harness = await prepareEncryptedRemoteWorker();
			const fixture = createRemoteBootstrapFixture(
				"bootstrap-remote-restore",
				"restore",
			);
			mockConnection.getSessionCapabilities.mockReturnValue({
				list: true,
				load: true,
				resume: true,
				close: true,
				mcp: { acp: true },
			});
			mockConnection.createSession.mockImplementationOnce(
				async (...args: unknown[]) => {
					bindTeamMcpForTest(args[0], expectedRemoteTeamTools);
					return {
						sessionId: "remote-worker-session-restore",
						modes: null,
						configOptions: null,
					};
				},
			);
			const response = await harness.relayApi.handleTeamRelayRequest(
				sealRemoteBootstrap(harness, fixture),
			);
			openRemoteBootstrapResponse(harness, fixture.operationId, response);

			const expectRemoteMcpOptions = (options: unknown) => {
				expect(options).toEqual(
					expect.objectContaining({
						teamMcpDeclaration: expect.objectContaining({
							type: "acp",
							serverId: fixture.serverId,
						}),
						teamMcpHandlers: expect.any(Object),
					}),
				);
				expect(
					(options as { teamMcpHandlers?: unknown }).teamMcpHandlers,
				).not.toBe(harness.internals.teamRuntime.mcpRouter);
			};

			await sessionManager.reloadSession(
				"remote-worker-session-restore",
				fixture.cwd,
				fixture.backendId,
				fixture.additionalDirectories,
			);
			expectRemoteMcpOptions(
				(mockConnection.loadSession.mock.calls as unknown as unknown[][]).at(
					-1,
				)?.[3],
			);

			await sessionManager.closeSession("remote-worker-session-restore");
			await sessionManager.resumeSession(
				"remote-worker-session-restore",
				fixture.cwd,
				fixture.backendId,
				fixture.additionalDirectories,
			);
			expectRemoteMcpOptions(
				(mockConnection.resumeSession.mock.calls as unknown as unknown[][]).at(
					-1,
				)?.[3],
			);

			await sessionManager.closeSession("remote-worker-session-restore");
			await sessionManager.loadSession(
				"remote-worker-session-restore",
				fixture.cwd,
				fixture.backendId,
				fixture.additionalDirectories,
			);
			expectRemoteMcpOptions(
				(mockConnection.loadSession.mock.calls as unknown as unknown[][]).at(
					-1,
				)?.[3],
			);
			expect(
				harness.internals.teamRelayStore.getRemoteSessionBindingBySessionId(
					"remote-worker-session-restore",
				)?.lifecycle,
			).toBe("active");
			expect(harness.internals.agentTeamStore.listAgentTeams().teams).toEqual(
				[],
			);
		});
	});

	describe("completeMessageSend", () => {
		const prepareLocalTeamMember = async () => {
			mockConnection.getSessionCapabilities.mockReturnValue({
				list: true,
				load: true,
				mcp: { acp: true },
			});
			let createdCount = 0;
			mockConnection.createSession.mockImplementation(
				async (...args: unknown[]) => {
					createdCount += 1;
					const params = args[0] as {
						teamMcpDeclaration?: { serverId?: string };
						teamMcpHandlers?: {
							handleConnect(input: { serverId: string }): unknown;
							handleListTools(input: {
								serverId: string;
								toolNames: string[];
							}): void;
						};
					};
					const serverId = params.teamMcpDeclaration?.serverId;
					if (params.teamMcpHandlers && serverId) {
						params.teamMcpHandlers.handleConnect({ serverId });
						params.teamMcpHandlers.handleListTools({
							serverId,
							toolNames: expectedRemoteTeamTools,
						});
					}
					return {
						sessionId:
							createdCount === 1
								? "leader-completion-session"
								: "member-completion-session",
						modes: null,
						configOptions: null,
					};
				},
			);
			const created = await sessionManager.createAgentTeamRun({
				machineId: mockConfig.machineId,
				backendId: "backend-1",
				workspaceRootCwd: "/home/user/project",
			});
			const spawned = await sessionManager.spawnAgentTeamMember({
				agentTeamId: created.team.agentTeamId,
				requestedByMemberId: created.team.leaderMemberId,
				name: "Completion Worker",
			});
			if (!spawned.ok) {
				throw new Error("Expected local Team member spawn to succeed");
			}
			return {
				agentTeamId: created.team.agentTeamId,
				memberId: spawned.memberId,
				sessionId: "member-completion-session",
			};
		};

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

		it("completes a local Team member on the production message path exactly once", async () => {
			const teamMember = await prepareLocalTeamMember();
			const claim = sessionManager.claimMessageSend(
				teamMember.sessionId,
				"message-team-completion",
			);
			if (claim.status !== "claimed") {
				throw new Error("Expected Team message claim");
			}

			sessionManager.completeMessageSend(
				teamMember.sessionId,
				"message-team-completion",
				claim.claimId,
				"end_turn",
			);
			await new Promise((resolve) => setTimeout(resolve, 0));

			const internals =
				sessionManager as unknown as SessionManagerTeamInternals;
			expect(
				internals.agentTeamStore
					.getAgentTeam({ agentTeamId: teamMember.agentTeamId })
					.team?.members.find(
						(member) => member.memberId === teamMember.memberId,
					)?.lifecycle,
			).toBe("completed");
			expect(mockConnection.prompt).toHaveBeenCalledTimes(1);
			expect(mockConnection.prompt).toHaveBeenCalledWith(
				"leader-completion-session",
				[
					expect.objectContaining({
						type: "text",
						text: expect.stringContaining("Turn completed"),
					}),
				],
			);

			sessionManager.recordTurnEnd(teamMember.sessionId, "end_turn");
			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(mockConnection.prompt).toHaveBeenCalledTimes(1);
		});

		it("does not apply Team completion to an ordinary session", async () => {
			const created = await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});
			const teamChanged = mock(() => {});
			sessionManager.onAgentTeamChanged(teamChanged);
			const claim = sessionManager.claimMessageSend(
				created.sessionId,
				"message-ordinary-completion",
			);
			if (claim.status !== "claimed") {
				throw new Error("Expected ordinary message claim");
			}

			sessionManager.completeMessageSend(
				created.sessionId,
				"message-ordinary-completion",
				claim.claimId,
				"end_turn",
			);
			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(teamChanged).not.toHaveBeenCalled();
			expect(mockConnection.prompt).not.toHaveBeenCalled();
		});

		it("keeps a completed prompt durable when Team completion handling fails", async () => {
			const teamMember = await prepareLocalTeamMember();
			const internals =
				sessionManager as unknown as SessionManagerTeamInternals;
			const completionFailure = mock(
				(_agentTeamId: string, _memberId: string) =>
					Promise.reject(new Error("injected Team completion failure")),
			);
			internals.teamRuntime.onMemberTurnCompleted = completionFailure;
			loggerWarnMock.mockClear();
			const claim = sessionManager.claimMessageSend(
				teamMember.sessionId,
				"message-team-completion-failure",
			);
			if (claim.status !== "claimed") {
				throw new Error("Expected Team message claim");
			}

			expect(() =>
				sessionManager.completeMessageSend(
					teamMember.sessionId,
					"message-team-completion-failure",
					claim.claimId,
					"end_turn",
				),
			).not.toThrow();
			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(completionFailure).toHaveBeenCalledWith(
				teamMember.agentTeamId,
				teamMember.memberId,
			);
			expect(
				sessionManager.getMessageSendResult(
					teamMember.sessionId,
					"message-team-completion-failure",
				),
			).toEqual({ stopReason: "end_turn" });
			expect(loggerWarnMock).toHaveBeenCalledWith(
				expect.objectContaining({
					sessionId: teamMember.sessionId,
					agentTeamId: teamMember.agentTeamId,
					memberId: teamMember.memberId,
					errorCode: "INTERNAL_ERROR",
				}),
				"agent_team_turn_completion_failed",
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

		it("keeps send idempotency and ACP message IDs distinct", async () => {
			const { sessionId, eventListener } = await setupSessionWithListener();
			expect(sessionUpdateCallback).toBeDefined();
			sessionManager.beginMessageSend(sessionId, "message-123");

			sessionUpdateCallback?.({
				sessionId,
				update: {
					sessionUpdate: "user_message_chunk",
					content: { type: "text", text: "Hello" },
					messageId: "acp-user-message-1",
				},
			} as SessionNotification);
			sessionManager.endMessageSend(sessionId, "message-123");

			expect(eventListener).toHaveBeenCalledWith(
				expect.objectContaining({
					sessionId,
					kind: "user_message",
					protocolMessageId: "acp-user-message-1",
					payload: expect.objectContaining({ messageId: "message-123" }),
				}),
			);
			const events = sessionManager.getSessionEvents({
				sessionId,
				revision: 1,
				afterSeq: 0,
			});
			expect(events.events[0]).toEqual(
				expect.objectContaining({
					protocolMessageId: "acp-user-message-1",
					payload: expect.objectContaining({
						messageId: "message-123",
						update: expect.objectContaining({
							messageId: "acp-user-message-1",
						}),
					}),
				}),
			);
		});

		it("maps agent_message_chunk → agent_message_chunk WAL event", async () => {
			const { sessionId, eventListener } = await setupSessionWithListener();

			sessionUpdateCallback?.({
				sessionId,
				update: {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "Hello from assistant" },
					messageId: "acp-assistant-message-1",
				},
			} as SessionNotification);

			expect(eventListener).toHaveBeenCalledWith(
				expect.objectContaining({
					sessionId,
					kind: "agent_message_chunk",
					protocolMessageId: "acp-assistant-message-1",
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
					messageId: "acp-thought-message-1",
				},
			} as SessionNotification);

			expect(eventListener).toHaveBeenCalledWith(
				expect.objectContaining({
					sessionId,
					kind: "agent_thought_chunk",
					protocolMessageId: "acp-thought-message-1",
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

		it("maps plan operations to dedicated WAL events without rewriting them", async () => {
			const { sessionId, eventListener } = await setupSessionWithListener();
			const planUpdate = {
				sessionId,
				update: {
					sessionUpdate: "plan_update",
					plan: {
						type: "file",
						planId: "release",
						uri: "file:///workspace/RELEASE.md",
					},
				},
			} as SessionNotification;
			const planRemoved = {
				sessionId,
				update: {
					sessionUpdate: "plan_removed",
					planId: "release",
				},
			} as SessionNotification;

			sessionUpdateCallback?.(planUpdate);
			sessionUpdateCallback?.(planRemoved);

			expect(eventListener).toHaveBeenNthCalledWith(
				1,
				expect.objectContaining({
					sessionId,
					kind: "plan_update",
					payload: planUpdate,
				}),
			);
			expect(eventListener).toHaveBeenNthCalledWith(
				2,
				expect.objectContaining({
					sessionId,
					kind: "plan_removed",
					payload: planRemoved,
				}),
			);
			expect(
				sessionManager.getSessionEvents({
					sessionId,
					revision: 1,
					afterSeq: 0,
				}).events,
			).toEqual([
				expect.objectContaining({
					seq: 1,
					kind: "plan_update",
					payload: planUpdate,
				}),
				expect.objectContaining({
					seq: 2,
					kind: "plan_removed",
					payload: planRemoved,
				}),
			]);
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

		it("replaces opaque session metadata without interpreting null keys", async () => {
			const { sessionId } = await setupSessionWithListener();

			sessionUpdateCallback?.({
				sessionId,
				update: {
					sessionUpdate: "session_info_update",
					_meta: { stale: true, nested: { old: 1 } },
				},
			} as SessionNotification);
			sessionUpdateCallback?.({
				sessionId,
				update: {
					sessionUpdate: "session_info_update",
					_meta: {
						fresh: true,
						nested: { keep: null },
						preservedNull: null,
					},
				},
			} as SessionNotification);

			expect(sessionManager.listSessions()[0]._meta).toEqual({
				fresh: true,
				nested: { keep: null },
				preservedNull: null,
			});

			sessionUpdateCallback?.({
				sessionId,
				update: {
					sessionUpdate: "session_info_update",
					title: "Metadata unchanged",
				},
			} as SessionNotification);
			expect(sessionManager.listSessions()[0]._meta).toEqual({
				fresh: true,
				nested: { keep: null },
				preservedNull: null,
			});

			sessionUpdateCallback?.({
				sessionId,
				update: { sessionUpdate: "session_info_update", _meta: {} },
			} as SessionNotification);
			expect(sessionManager.listSessions()[0]._meta).toEqual({});

			sessionUpdateCallback?.({
				sessionId,
				update: { sessionUpdate: "session_info_update", _meta: null },
			} as SessionNotification);
			expect(sessionManager.listSessions()[0]._meta).toBeNull();
		});

		it("clears only unpinned agent titles", async () => {
			const unpinned = await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});
			sessionUpdateCallback?.({
				sessionId: unpinned.sessionId,
				update: {
					sessionUpdate: "session_info_update",
					title: "Agent title",
				},
			} as SessionNotification);
			sessionUpdateCallback?.({
				sessionId: unpinned.sessionId,
				update: { sessionUpdate: "session_info_update", title: null },
			} as SessionNotification);
			expect(sessionManager.listSessions()[0].title).toBe(
				`Session ${unpinned.sessionId.slice(0, 8)}`,
			);

			await sessionManager.closeSession(unpinned.sessionId);
			const pinned = await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
				title: "Pinned title",
			});
			for (const title of ["Ignored agent title", null]) {
				sessionUpdateCallback?.({
					sessionId: pinned.sessionId,
					update: { sessionUpdate: "session_info_update", title },
				} as SessionNotification);
			}
			expect(sessionManager.listSessions()[0]).toEqual(
				expect.objectContaining({
					title: "Pinned title",
					isTitlePinned: true,
				}),
			);
		});

		it("keeps local activity monotonic across invalid and null timestamps", async () => {
			const { sessionId } = await setupSessionWithListener();
			const initial = sessionManager.listSessions()[0].updatedAt;

			for (const updatedAt of ["2000-01-01T00:00:00.000Z", "not-a-timestamp"]) {
				sessionUpdateCallback?.({
					sessionId,
					update: { sessionUpdate: "session_info_update", updatedAt },
				} as SessionNotification);
			}
			expect(sessionManager.listSessions()[0].updatedAt >= initial).toBe(true);

			sessionUpdateCallback?.({
				sessionId,
				update: {
					sessionUpdate: "session_info_update",
					updatedAt: "2100-01-01T00:00:00.000Z",
				},
			} as SessionNotification);
			expect(sessionManager.listSessions()[0].updatedAt).toBe(
				"2100-01-01T00:00:00.000Z",
			);

			sessionUpdateCallback?.({
				sessionId,
				update: { sessionUpdate: "session_info_update", updatedAt: null },
			} as SessionNotification);
			expect(sessionManager.listSessions()[0].updatedAt).toBe(
				"2100-01-01T00:00:00.000Z",
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

		it("persists ordered plan operations emitted during session creation", async () => {
			const planUpdate = {
				sessionId: "new-session-1",
				update: {
					sessionUpdate: "plan_update",
					plan: {
						type: "markdown",
						planId: "implementation",
						content: "## Implementation\n\nShip the bounded creation buffer.",
					},
				},
			} as SessionNotification;
			const replacementPlan = {
				sessionId: "new-session-1",
				update: {
					sessionUpdate: "plan_update",
					plan: {
						type: "markdown",
						planId: "implementation",
						content: "## Implementation\n\nVerify the bounded creation buffer.",
					},
				},
			} as SessionNotification;
			const planRemoved = {
				sessionId: "new-session-1",
				update: {
					sessionUpdate: "plan_removed",
					planId: "implementation",
				},
			} as SessionNotification;
			mockConnection.createSession.mockImplementationOnce(async () => {
				sessionUpdateCallback?.(planUpdate);
				sessionUpdateCallback?.(replacementPlan);
				sessionUpdateCallback?.(planRemoved);
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
			}).events;
			expect(events).toEqual([
				expect.objectContaining({
					seq: 1,
					kind: "plan_update",
					payload: planUpdate,
				}),
				expect.objectContaining({
					seq: 2,
					kind: "plan_update",
					payload: replacementPlan,
				}),
				expect.objectContaining({
					seq: 3,
					kind: "plan_removed",
					payload: planRemoved,
				}),
			]);
		});

		it("rejects an oversized creation replay without exposing partial state", async () => {
			mockConnection.createSession.mockImplementationOnce(async () => {
				// Each update is independently valid at the ACP boundary; their
				// aggregate exceeds the creation replay's 8 MiB local cap.
				for (let index = 0; index < 33; index += 1) {
					sessionUpdateCallback?.({
						sessionId: "new-session-1",
						update: {
							sessionUpdate: "plan_update",
							plan: {
								type: "markdown",
								planId: "bounded",
								content: "x".repeat(ACP_PLAN_MARKDOWN_MAX_BYTES),
							},
						},
					} as SessionNotification);
				}
				return {
					sessionId: "new-session-1",
					modes: null,
					configOptions: null,
				};
			});

			await expect(
				sessionManager.createSession({
					cwd: "/home/user/project",
					backendId: "backend-1",
				}),
			).rejects.toThrow("Reload replay exceeds local buffer limit");

			const walStore = (
				sessionManager as unknown as {
					walStore: WalStore;
				}
			).walStore;
			expect(walStore.getSession("new-session-1")).toBeNull();
			expect(sessionManager.getSession("new-session-1")).toBeUndefined();
			expect(sessionManager.listSessions()).toEqual([]);
			expect(sessionUpdateCallback).toBeUndefined();
			expect(mockConnection.disconnect).toHaveBeenCalledTimes(1);
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
