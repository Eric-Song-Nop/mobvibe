import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import type {
	CliToGatewayEvents,
	ContentBlock,
	EventsAckPayload,
	FsEntry,
	FsRoot,
	GatewayToCliEvents,
	GitBranchesForCwdResponse,
	RpcResponse,
	SendMessageParams,
	SendMessageResult,
	SessionEventsResponse,
	SessionFsFilePreview,
	SessionFsResourceEntry,
	StopReason,
} from "@mobvibe/shared";
import {
	AppError,
	createErrorDetail,
	createSignedToken,
	getPromptImageBlocks,
	validatePromptImageBlocks,
} from "@mobvibe/shared";
import ignore, { type Ignore } from "ignore";
import { io, type Socket } from "socket.io-client";
import type { SessionManager } from "../acp/session-manager.js";
import type { CliConfig } from "../config.js";
import type { CliCryptoService } from "../e2ee/crypto-service.js";
import {
	aggregateDirStatus,
	getFileDiff,
	getGitBlame,
	getGitBranch,
	getGitBranches,
	getGitFileHistory,
	getGitLog,
	getGitShow,
	getGitStashList,
	getGitStatus,
	getGitStatusExtended,
	isGitRepo,
	resolveGitProjectContext,
	searchFileContents,
	searchGitLog,
} from "../lib/git-utils.js";
import { logger } from "../lib/logger.js";
import { AgentTeamStore } from "../team/agent-team-store.js";
import { buildHostFsEntries, buildHostFsRoots } from "./host-fs.js";
import { resolveWithinCwd } from "./path-utils.js";

type SocketClientOptions = {
	config: CliConfig;
	sessionManager: SessionManager;
	/** Crypto service for E2EE */
	cryptoService: CliCryptoService;
	agentTeamStore?: AgentTeamStore;
};

const SESSION_ROOT_NAME = "Working Directory";
const MAX_RESOURCE_FILES = 2000;
const createMessageOutcomeUnknownError = (detail?: string) =>
	new AppError(
		createErrorDetail({
			code: "MESSAGE_OUTCOME_UNKNOWN",
			message:
				"Message execution outcome is unknown; send it again as a new message",
			retryable: false,
			scope: "request",
			detail,
		}),
		409,
	);
const DEFAULT_IGNORES = [
	"node_modules",
	".git",
	"dist",
	"build",
	".next",
	".nuxt",
	".output",
	".cache",
	"__pycache__",
	".venv",
	"venv",
	"target",
];

const loadGitignore = async (rootPath: string): Promise<Ignore> => {
	const ig = ignore().add(DEFAULT_IGNORES);
	try {
		const gitignorePath = path.join(rootPath, ".gitignore");
		const content = await fs.readFile(gitignorePath, "utf8");
		ig.add(content);
	} catch {
		// No .gitignore file, use defaults only
	}
	return ig;
};

const resolveImageMimeType = (filePath: string) => {
	const extension = path.extname(filePath).toLowerCase();
	switch (extension) {
		case ".apng":
			return "image/apng";
		case ".avif":
			return "image/avif";
		case ".gif":
			return "image/gif";
		case ".jpeg":
			return "image/jpeg";
		case ".jpg":
			return "image/jpeg";
		case ".png":
			return "image/png";
		case ".svg":
			return "image/svg+xml";
		case ".webp":
			return "image/webp";
		default:
			return undefined;
	}
};

const validatePromptForBackend = (
	prompt: ContentBlock[],
	supportsPromptImages: boolean,
) => {
	const imageBlocks = getPromptImageBlocks(prompt);
	if (imageBlocks.length === 0) {
		return;
	}
	if (!supportsPromptImages) {
		throw new Error("Selected backend does not support image prompts");
	}
	const validation = validatePromptImageBlocks(imageBlocks);
	if (!validation.ok) {
		throw new Error(validation.message);
	}
};

const readDirectoryEntries = async (dirPath: string): Promise<FsEntry[]> => {
	const entries = await fs.readdir(dirPath, { withFileTypes: true });
	const resolvedEntries = await Promise.all(
		entries.map(async (entry) => {
			const entryPath = path.join(dirPath, entry.name);
			let isDirectory = entry.isDirectory();
			if (!isDirectory && entry.isSymbolicLink()) {
				try {
					const stats = await fs.stat(entryPath);
					isDirectory = stats.isDirectory();
				} catch {
					// ignore broken symlink
				}
			}
			const entryType: FsEntry["type"] = isDirectory ? "directory" : "file";
			return {
				name: entry.name,
				path: entryPath,
				type: entryType,
				hidden: entry.name.startsWith("."),
			};
		}),
	);
	return resolvedEntries.sort((left, right) => {
		if (left.type !== right.type) {
			return left.type === "directory" ? -1 : 1;
		}
		return left.name.localeCompare(right.name);
	});
};

const filterVisibleEntries = (entries: FsEntry[]) =>
	entries.filter((entry) => !entry.hidden);

/** Minimum interval between automatic discover calls (ms) */
const DISCOVER_THROTTLE_MS = 60_000;
const WAL_REPLAY_BATCH_SIZE = 100;

export class SocketClient extends EventEmitter {
	private socket: Socket<GatewayToCliEvents, CliToGatewayEvents>;
	private connected = false;
	private hasConnectedOnce = false;
	private reconnectAttempts = 0;
	private heartbeatInterval?: NodeJS.Timeout;
	private lastDiscoverAt = 0;
	private walReplayGeneration = 0;
	private readonly agentTeamStore: AgentTeamStore;
	private readonly messageSendsInFlight = new Map<
		string,
		Promise<SendMessageResult>
	>();
	private readonly sessionOperationTails = new Map<string, Promise<void>>();

	constructor(private readonly options: SocketClientOptions) {
		super();
		const { cryptoService } = options;
		this.agentTeamStore =
			options.agentTeamStore ?? new AgentTeamStore(options.config.walDbPath);
		this.socket = io(`${options.config.gatewayUrl}/cli`, {
			path: "/socket.io",
			reconnection: true,
			reconnectionAttempts: Number.POSITIVE_INFINITY,
			reconnectionDelay: 1000,
			reconnectionDelayMax: 30000,
			transports: ["websocket"],
			autoConnect: false,
			auth: (cb) => cb(createSignedToken(cryptoService.authKeyPair)),
		});
		this.setupEventHandlers();
		this.setupRpcHandlers();
		this.setupSessionManagerListeners();
	}

	private setupEventHandlers() {
		this.socket.on("connect", () => {
			void this.handleConnect();
		});

		this.socket.on("disconnect", (reason) => {
			logger.warn({ reason }, "gateway_disconnected");
			this.connected = false;
			this.walReplayGeneration += 1;
			this.stopHeartbeat();
			this.emit("disconnected", reason);
		});

		this.socket.on("connect_error", (error) => {
			this.reconnectAttempts++;

			// Handle affinity redirect — Fly.io routes to the correct instance
			if (error.message.startsWith("WRONG_INSTANCE:")) {
				const targetId = error.message.split(":")[1];
				logger.info({ targetInstance: targetId }, "gateway_affinity_redirect");
				this.socket.io.opts.extraHeaders = {
					...this.socket.io.opts.extraHeaders,
					"fly-force-instance-id": targetId,
				};
				// Socket.io auto-reconnect will carry the new header
				return;
			}

			if (this.reconnectAttempts <= 3 || this.reconnectAttempts % 10 === 0) {
				logger.error(
					{ attempt: this.reconnectAttempts, err: error },
					"gateway_connect_error",
				);
			}
		});

		this.socket.on("cli:registered", async (info) => {
			logger.info({ machineId: info.machineId }, "gateway_registered");
			const replayGeneration = ++this.walReplayGeneration;
			await this.replayUnackedEvents(replayGeneration);
			if (replayGeneration !== this.walReplayGeneration || !this.connected) {
				return;
			}

			// Throttle automatic discover on reconnect
			const now = Date.now();
			if (now - this.lastDiscoverAt < DISCOVER_THROTTLE_MS) {
				logger.info("discover_throttled_skip");
				return;
			}
			this.lastDiscoverAt = now;

			// Auto-discover historical sessions from all backends
			for (const backend of this.options.config.acpBackends) {
				try {
					let cursor: string | undefined;
					let page = 0;
					do {
						const { sessions, capabilities, nextCursor } =
							await this.options.sessionManager.discoverSessions({
								backendId: backend.id,
								cursor,
							});
						cursor = nextCursor;
						if (sessions.length > 0) {
							this.socket.emit("sessions:discovered", {
								sessions,
								capabilities,
								nextCursor,
								backendId: backend.id,
								backendLabel: backend.label,
							});
							logger.info(
								{
									count: sessions.length,
									capabilities,
									page,
									backendId: backend.id,
								},
								"historical_sessions_discovered",
							);
						}
						page += 1;
					} while (cursor);
				} catch (error) {
					logger.warn(
						{ err: error, backendId: backend.id },
						"session_discovery_failed",
					);
				}
			}
		});

		// Handle authentication errors
		this.socket.on("cli:error", (error) => {
			logger.error({ err: error }, "gateway_auth_error");
			this.emit("auth_error", error);
		});

		// Handle event acknowledgments from gateway
		this.socket.on("events:ack", (payload: EventsAckPayload) => {
			logger.debug(
				{
					sessionId: payload.sessionId,
					revision: payload.revision,
					upToSeq: payload.upToSeq,
				},
				"events_acked",
			);
			this.options.sessionManager.ackEvents(
				payload.sessionId,
				payload.revision,
				payload.upToSeq,
			);
		});
	}

	private setupRpcHandlers() {
		const { sessionManager } = this.options;
		const { agentTeamStore } = this;

		// Session create
		this.socket.on("rpc:session:create", async (request) => {
			try {
				logger.info({ requestId: request.requestId }, "rpc_session_create");
				const session = await sessionManager.createSession(request.params);
				this.sendRpcResponse(request.requestId, session);
			} catch (error) {
				logger.error(
					{ err: error, requestId: request.requestId },
					"rpc_session_create_error",
				);
				this.sendRpcError(request.requestId, error);
			}
		});

		this.socket.on("rpc:agent-team:create", async (request) => {
			try {
				logger.info(
					{
						requestId: request.requestId,
						machineId: request.params.machineId,
					},
					"rpc_agent_team_create",
				);
				const result = agentTeamStore.createAgentTeam(request.params);
				this.sendRpcResponse(request.requestId, result);
				this.socket.emit("agent-teams:changed", {
					added: [result.team],
					updated: [],
					removed: [],
					machineId: result.team.machineId,
				});
			} catch (error) {
				logger.error(
					{
						err: error,
						requestId: request.requestId,
						machineId: request.params.machineId,
					},
					"rpc_agent_team_create_error",
				);
				this.sendRpcError(request.requestId, error);
			}
		});

		this.socket.on("rpc:agent-teams:list", async (request) => {
			try {
				logger.info(
					{
						requestId: request.requestId,
						machineId: request.params.machineId,
					},
					"rpc_agent_teams_list",
				);
				const result = agentTeamStore.listAgentTeams(request.params);
				logger.info(
					{
						requestId: request.requestId,
						machineId: request.params.machineId,
						count: result.teams.length,
					},
					"rpc_agent_teams_list_complete",
				);
				this.sendRpcResponse(request.requestId, result);
			} catch (error) {
				logger.error(
					{
						err: error,
						requestId: request.requestId,
						machineId: request.params.machineId,
					},
					"rpc_agent_teams_list_error",
				);
				this.sendRpcError(request.requestId, error);
			}
		});

		this.socket.on("rpc:agent-team:get", async (request) => {
			try {
				logger.info(
					{
						requestId: request.requestId,
						agentTeamId: request.params.agentTeamId,
						machineId: request.params.machineId,
					},
					"rpc_agent_team_get",
				);
				const result = agentTeamStore.getAgentTeam(request.params);
				this.sendRpcResponse(request.requestId, result);
			} catch (error) {
				logger.error(
					{
						err: error,
						requestId: request.requestId,
						agentTeamId: request.params.agentTeamId,
						machineId: request.params.machineId,
					},
					"rpc_agent_team_get_error",
				);
				this.sendRpcError(request.requestId, error);
			}
		});

		// Session cancel
		this.socket.on("rpc:session:cancel", async (request) => {
			try {
				logger.info(
					{ requestId: request.requestId, sessionId: request.params.sessionId },
					"rpc_session_cancel",
				);
				await sessionManager.cancelSession(request.params.sessionId);
				this.sendRpcResponse(request.requestId, { ok: true });
			} catch (error) {
				logger.error(
					{
						err: error,
						requestId: request.requestId,
						sessionId: request.params.sessionId,
					},
					"rpc_session_cancel_error",
				);
				this.sendRpcError(request.requestId, error);
			}
		});

		// Session mode
		this.socket.on("rpc:session:mode", async (request) => {
			try {
				logger.info(
					{
						requestId: request.requestId,
						sessionId: request.params.sessionId,
						modeId: request.params.modeId,
					},
					"rpc_session_mode",
				);
				const session = await sessionManager.setSessionMode(
					request.params.sessionId,
					request.params.modeId,
				);
				this.sendRpcResponse(request.requestId, session);
			} catch (error) {
				logger.error(
					{
						err: error,
						requestId: request.requestId,
						sessionId: request.params.sessionId,
						modeId: request.params.modeId,
					},
					"rpc_session_mode_error",
				);
				this.sendRpcError(request.requestId, error);
			}
		});

		// Session model
		this.socket.on("rpc:session:model", async (request) => {
			try {
				logger.info(
					{
						requestId: request.requestId,
						sessionId: request.params.sessionId,
						modelId: request.params.modelId,
					},
					"rpc_session_model",
				);
				const session = await sessionManager.setSessionModel(
					request.params.sessionId,
					request.params.modelId,
				);
				this.sendRpcResponse(request.requestId, session);
			} catch (error) {
				logger.error(
					{
						err: error,
						requestId: request.requestId,
						sessionId: request.params.sessionId,
						modelId: request.params.modelId,
					},
					"rpc_session_model_error",
				);
				this.sendRpcError(request.requestId, error);
			}
		});

		// Send message
		this.socket.on("rpc:message:send", async (request) => {
			const requestStart = process.hrtime.bigint();
			try {
				const { sessionId, messageId } = request.params;
				logger.info(
					{
						requestId: request.requestId,
						sessionId,
						messageId,
					},
					"rpc_message_send",
				);
				logger.debug(
					{
						requestId: request.requestId,
						sessionId,
						messageId,
					},
					"rpc_message_send_start",
				);
				const result = await this.getOrCreateMessageSend(request.params);
				this.sendRpcResponse<SendMessageResult>(request.requestId, result);
				const durationMs =
					Number(process.hrtime.bigint() - requestStart) / 1_000_000;
				logger.info(
					{
						requestId: request.requestId,
						sessionId,
						messageId,
						stopReason: result.stopReason,
						durationMs,
					},
					"rpc_message_send_complete",
				);
				logger.debug(
					{
						requestId: request.requestId,
						sessionId,
						messageId,
						durationMs,
					},
					"rpc_message_send_finish",
				);
			} catch (error) {
				const durationMs =
					Number(process.hrtime.bigint() - requestStart) / 1_000_000;
				logger.error(
					{
						err: error,
						requestId: request.requestId,
						sessionId: request.params.sessionId,
						promptBlocks: Array.isArray(request.params.prompt)
							? request.params.prompt.length
							: 1,
						durationMs,
					},
					"rpc_message_send_error",
				);
				this.sendRpcError(request.requestId, error);
			}
		});

		// Permission decision
		this.socket.on("rpc:permission:decision", async (request) => {
			try {
				const { sessionId, requestId, outcome } = request.params;
				logger.info(
					{ requestId: request.requestId, sessionId, outcome },
					"rpc_permission_decision",
				);
				sessionManager.resolvePermissionRequest(sessionId, requestId, outcome);
				this.sendRpcResponse(request.requestId, { ok: true });
			} catch (error) {
				logger.error(
					{
						err: error,
						requestId: request.requestId,
						sessionId: request.params.sessionId,
						permissionRequestId: request.params.requestId,
						outcome: request.params.outcome,
					},
					"rpc_permission_decision_error",
				);
				this.sendRpcError(request.requestId, error);
			}
		});

		// File system handlers
		this.socket.on("rpc:fs:roots", async (request) => {
			try {
				logger.debug(
					{ requestId: request.requestId, sessionId: request.params.sessionId },
					"rpc_fs_roots",
				);
				const record = sessionManager.getSession(request.params.sessionId);
				if (!record || !record.cwd) {
					throw new Error("Session not found or no working directory");
				}
				const root: FsRoot = {
					name: SESSION_ROOT_NAME,
					path: record.cwd,
				};
				this.sendRpcResponse(request.requestId, { root });
			} catch (error) {
				logger.error(
					{
						err: error,
						requestId: request.requestId,
						sessionId: request.params.sessionId,
					},
					"rpc_fs_roots_error",
				);
				this.sendRpcError(request.requestId, error);
			}
		});

		this.socket.on("rpc:hostfs:roots", async (request) => {
			try {
				logger.debug(
					{
						requestId: request.requestId,
						machineId: request.params.machineId,
					},
					"rpc_hostfs_roots",
				);
				const result = await buildHostFsRoots();
				this.sendRpcResponse(request.requestId, result);
			} catch (error) {
				logger.error(
					{
						err: error,
						requestId: request.requestId,
						machineId: request.params.machineId,
					},
					"rpc_hostfs_roots_error",
				);
				this.sendRpcError(request.requestId, error);
			}
		});

		this.socket.on("rpc:hostfs:entries", async (request) => {
			try {
				const { path: requestPath, machineId } = request.params;
				logger.debug(
					{ requestId: request.requestId, machineId, path: requestPath },
					"rpc_hostfs_entries",
				);
				const result = await buildHostFsEntries(requestPath, async (dirPath) =>
					filterVisibleEntries(await readDirectoryEntries(dirPath)),
				);
				this.sendRpcResponse(request.requestId, result);
			} catch (error) {
				logger.error(
					{
						err: error,
						requestId: request.requestId,
						machineId: request.params.machineId,
					},
					"rpc_hostfs_entries_error",
				);
				this.sendRpcError(request.requestId, error);
			}
		});

		this.socket.on("rpc:fs:entries", async (request) => {
			try {
				const { sessionId, path: requestPath } = request.params;
				logger.debug(
					{ requestId: request.requestId, sessionId, path: requestPath },
					"rpc_fs_entries",
				);
				const record = sessionManager.getSession(sessionId);
				if (!record || !record.cwd) {
					throw new Error("Session not found or no working directory");
				}
				const resolved = requestPath
					? resolveWithinCwd(record.cwd, requestPath)
					: record.cwd;
				const entries = await readDirectoryEntries(resolved);
				this.sendRpcResponse(request.requestId, { path: resolved, entries });
			} catch (error) {
				logger.error(
					{
						err: error,
						requestId: request.requestId,
						sessionId: request.params.sessionId,
					},
					"rpc_fs_entries_error",
				);
				this.sendRpcError(request.requestId, error);
			}
		});

		this.socket.on("rpc:fs:file", async (request) => {
			try {
				const { sessionId, path: requestPath } = request.params;
				logger.debug(
					{ requestId: request.requestId, sessionId, path: requestPath },
					"rpc_fs_file",
				);
				const record = sessionManager.getSession(sessionId);
				if (!record || !record.cwd) {
					throw new Error("Session not found or no working directory");
				}
				const resolved = resolveWithinCwd(record.cwd, requestPath);
				const mimeType = resolveImageMimeType(resolved);
				if (mimeType) {
					const buffer = await fs.readFile(resolved);
					const preview: SessionFsFilePreview = {
						path: resolved,
						previewType: "image",
						content: `data:${mimeType};base64,${buffer.toString("base64")}`,
						mimeType,
					};
					this.sendRpcResponse(request.requestId, preview);
					return;
				}
				const content = await fs.readFile(resolved, "utf8");
				const preview: SessionFsFilePreview = {
					path: resolved,
					previewType: "code",
					content,
				};
				this.sendRpcResponse(request.requestId, preview);
			} catch (error) {
				logger.error(
					{
						err: error,
						requestId: request.requestId,
						sessionId: request.params.sessionId,
					},
					"rpc_fs_file_error",
				);
				this.sendRpcError(request.requestId, error);
			}
		});

		this.socket.on("rpc:fs:resources", async (request) => {
			try {
				const { sessionId } = request.params;
				logger.debug(
					{ requestId: request.requestId, sessionId },
					"rpc_fs_resources",
				);
				const record = sessionManager.getSession(sessionId);
				if (!record || !record.cwd) {
					throw new Error("Session not found or no working directory");
				}
				const entries = await this.listSessionResources(record.cwd);
				this.sendRpcResponse(request.requestId, {
					rootPath: record.cwd,
					entries,
				});
			} catch (error) {
				logger.error(
					{
						err: error,
						requestId: request.requestId,
						sessionId: request.params.sessionId,
					},
					"rpc_fs_resources_error",
				);
				this.sendRpcError(request.requestId, error);
			}
		});

		// Session discovery - list sessions from ACP agent
		this.socket.on("rpc:sessions:discover", async (request) => {
			try {
				const { cwd, backendId, cursor } = request.params;
				logger.info(
					{ requestId: request.requestId, cwd, backendId, cursor },
					"rpc_sessions_discover",
				);
				const result = await sessionManager.discoverSessions({
					cwd,
					backendId,
					cursor,
				});
				this.sendRpcResponse(request.requestId, result);
			} catch (error) {
				logger.error(
					{
						err: error,
						requestId: request.requestId,
					},
					"rpc_sessions_discover_error",
				);
				this.sendRpcError(request.requestId, error);
			}
		});

		// Load historical session from ACP agent
		this.socket.on("rpc:session:load", async (request) => {
			try {
				const { sessionId, cwd, backendId } = request.params;
				logger.info(
					{ requestId: request.requestId, sessionId, cwd, backendId },
					"rpc_session_load",
				);
				const session = await this.enqueueSessionOperation(sessionId, () =>
					sessionManager.loadSession(sessionId, cwd, backendId),
				);
				this.sendRpcResponse(request.requestId, session);
			} catch (error) {
				logger.error(
					{
						err: error,
						requestId: request.requestId,
						sessionId: request.params.sessionId,
					},
					"rpc_session_load_error",
				);
				this.sendRpcError(request.requestId, error);
			}
		});

		// Reload historical session from ACP agent
		this.socket.on("rpc:session:reload", async (request) => {
			try {
				const { sessionId, cwd, backendId } = request.params;
				logger.info(
					{ requestId: request.requestId, sessionId, cwd, backendId },
					"rpc_session_reload",
				);
				const session = await this.enqueueSessionOperation(sessionId, () =>
					sessionManager.reloadSession(sessionId, cwd, backendId),
				);
				this.sendRpcResponse(request.requestId, session);
			} catch (error) {
				logger.error(
					{
						err: error,
						requestId: request.requestId,
						sessionId: request.params.sessionId,
					},
					"rpc_session_reload_error",
				);
				this.sendRpcError(request.requestId, error);
			}
		});

		// Git status handler
		this.socket.on("rpc:git:status", async (request) => {
			try {
				const { sessionId } = request.params;
				logger.debug(
					{ requestId: request.requestId, sessionId },
					"rpc_git_status",
				);
				const record = sessionManager.getSession(sessionId);
				if (!record || !record.cwd) {
					throw new Error("Session not found or no working directory");
				}

				const isRepo = await isGitRepo(record.cwd);
				if (!isRepo) {
					this.sendRpcResponse(request.requestId, {
						isGitRepo: false,
						files: [],
						dirStatus: {},
					});
					return;
				}

				const [branch, files] = await Promise.all([
					getGitBranch(record.cwd),
					getGitStatus(record.cwd),
				]);
				const dirStatus = aggregateDirStatus(files);

				this.sendRpcResponse(request.requestId, {
					isGitRepo: true,
					branch,
					files,
					dirStatus,
				});
			} catch (error) {
				logger.error(
					{
						err: error,
						requestId: request.requestId,
						sessionId: request.params.sessionId,
					},
					"rpc_git_status_error",
				);
				this.sendRpcError(request.requestId, error);
			}
		});

		// Git file diff handler
		this.socket.on("rpc:git:fileDiff", async (request) => {
			try {
				const { sessionId, path: filePath } = request.params;
				logger.debug(
					{ requestId: request.requestId, sessionId, path: filePath },
					"rpc_git_file_diff",
				);
				const record = sessionManager.getSession(sessionId);
				if (!record || !record.cwd) {
					throw new Error("Session not found or no working directory");
				}

				// Validate filePath stays within cwd
				resolveWithinCwd(record.cwd, filePath);

				const isRepo = await isGitRepo(record.cwd);
				if (!isRepo) {
					this.sendRpcResponse(request.requestId, {
						isGitRepo: false,
						path: filePath,
						addedLines: [],
						modifiedLines: [],
					});
					return;
				}

				const { addedLines, modifiedLines, rawDiff } = await getFileDiff(
					record.cwd,
					filePath,
				);

				this.sendRpcResponse(request.requestId, {
					isGitRepo: true,
					path: filePath,
					addedLines,
					modifiedLines,
					rawDiff,
				});
			} catch (error) {
				logger.error(
					{
						err: error,
						requestId: request.requestId,
						sessionId: request.params.sessionId,
					},
					"rpc_git_file_diff_error",
				);
				this.sendRpcError(request.requestId, error);
			}
		});

		// Git log handler
		this.socket.on("rpc:git:log", async (request) => {
			try {
				const {
					sessionId,
					maxCount,
					skip,
					path: filePath,
					author,
					search,
				} = request.params;
				logger.debug(
					{ requestId: request.requestId, sessionId },
					"rpc_git_log",
				);
				const record = sessionManager.getSession(sessionId);
				if (!record || !record.cwd) {
					throw new Error("Session not found or no working directory");
				}
				const result = await getGitLog(record.cwd, {
					maxCount,
					skip,
					path: filePath,
					author,
					search,
				});
				this.sendRpcResponse(request.requestId, result);
			} catch (error) {
				logger.error(
					{
						err: error,
						requestId: request.requestId,
						sessionId: request.params.sessionId,
					},
					"rpc_git_log_error",
				);
				this.sendRpcError(request.requestId, error);
			}
		});

		// Git show handler
		this.socket.on("rpc:git:show", async (request) => {
			try {
				const { sessionId, hash } = request.params;
				logger.debug(
					{ requestId: request.requestId, sessionId, hash },
					"rpc_git_show",
				);
				const record = sessionManager.getSession(sessionId);
				if (!record || !record.cwd) {
					throw new Error("Session not found or no working directory");
				}
				const result = await getGitShow(record.cwd, hash);
				if (!result) {
					throw new Error(`Commit ${hash} not found`);
				}
				this.sendRpcResponse(request.requestId, result);
			} catch (error) {
				logger.error(
					{
						err: error,
						requestId: request.requestId,
						sessionId: request.params.sessionId,
					},
					"rpc_git_show_error",
				);
				this.sendRpcError(request.requestId, error);
			}
		});

		// Git blame handler
		this.socket.on("rpc:git:blame", async (request) => {
			try {
				const {
					sessionId,
					path: filePath,
					startLine,
					endLine,
				} = request.params;
				logger.debug(
					{ requestId: request.requestId, sessionId, path: filePath },
					"rpc_git_blame",
				);
				const record = sessionManager.getSession(sessionId);
				if (!record || !record.cwd) {
					throw new Error("Session not found or no working directory");
				}
				resolveWithinCwd(record.cwd, filePath);
				const lines = await getGitBlame(
					record.cwd,
					filePath,
					startLine,
					endLine,
				);
				this.sendRpcResponse(request.requestId, { lines });
			} catch (error) {
				logger.error(
					{
						err: error,
						requestId: request.requestId,
						sessionId: request.params.sessionId,
					},
					"rpc_git_blame_error",
				);
				this.sendRpcError(request.requestId, error);
			}
		});

		// Git branches handler
		this.socket.on("rpc:git:branches", async (request) => {
			try {
				const { sessionId } = request.params;
				logger.debug(
					{ requestId: request.requestId, sessionId },
					"rpc_git_branches",
				);
				const record = sessionManager.getSession(sessionId);
				if (!record || !record.cwd) {
					throw new Error("Session not found or no working directory");
				}
				const branches = await getGitBranches(record.cwd);
				this.sendRpcResponse(request.requestId, { branches });
			} catch (error) {
				logger.error(
					{
						err: error,
						requestId: request.requestId,
						sessionId: request.params.sessionId,
					},
					"rpc_git_branches_error",
				);
				this.sendRpcError(request.requestId, error);
			}
		});

		// Git stash list handler
		this.socket.on("rpc:git:stashList", async (request) => {
			try {
				const { sessionId } = request.params;
				logger.debug(
					{ requestId: request.requestId, sessionId },
					"rpc_git_stash_list",
				);
				const record = sessionManager.getSession(sessionId);
				if (!record || !record.cwd) {
					throw new Error("Session not found or no working directory");
				}
				const entries = await getGitStashList(record.cwd);
				this.sendRpcResponse(request.requestId, { entries });
			} catch (error) {
				logger.error(
					{
						err: error,
						requestId: request.requestId,
						sessionId: request.params.sessionId,
					},
					"rpc_git_stash_list_error",
				);
				this.sendRpcError(request.requestId, error);
			}
		});

		// Git status extended handler
		this.socket.on("rpc:git:statusExtended", async (request) => {
			try {
				const { sessionId } = request.params;
				logger.debug(
					{ requestId: request.requestId, sessionId },
					"rpc_git_status_extended",
				);
				const record = sessionManager.getSession(sessionId);
				if (!record || !record.cwd) {
					throw new Error("Session not found or no working directory");
				}
				const isRepo = await isGitRepo(record.cwd);
				if (!isRepo) {
					this.sendRpcResponse(request.requestId, {
						isGitRepo: false,
						staged: [],
						unstaged: [],
						untracked: [],
						dirStatus: {},
					});
					return;
				}
				const result = await getGitStatusExtended(record.cwd);
				this.sendRpcResponse(request.requestId, { isGitRepo: true, ...result });
			} catch (error) {
				logger.error(
					{
						err: error,
						requestId: request.requestId,
						sessionId: request.params.sessionId,
					},
					"rpc_git_status_extended_error",
				);
				this.sendRpcError(request.requestId, error);
			}
		});

		// Git search log handler
		this.socket.on("rpc:git:searchLog", async (request) => {
			try {
				const { sessionId, query, type, maxCount } = request.params;
				logger.debug(
					{ requestId: request.requestId, sessionId, query, type },
					"rpc_git_search_log",
				);
				const record = sessionManager.getSession(sessionId);
				if (!record || !record.cwd) {
					throw new Error("Session not found or no working directory");
				}
				const entries = await searchGitLog(record.cwd, query, type, maxCount);
				this.sendRpcResponse(request.requestId, { entries });
			} catch (error) {
				logger.error(
					{
						err: error,
						requestId: request.requestId,
						sessionId: request.params.sessionId,
					},
					"rpc_git_search_log_error",
				);
				this.sendRpcError(request.requestId, error);
			}
		});

		// Git file history handler
		this.socket.on("rpc:git:fileHistory", async (request) => {
			try {
				const { sessionId, path: filePath, maxCount } = request.params;
				logger.debug(
					{ requestId: request.requestId, sessionId, path: filePath },
					"rpc_git_file_history",
				);
				const record = sessionManager.getSession(sessionId);
				if (!record || !record.cwd) {
					throw new Error("Session not found or no working directory");
				}
				resolveWithinCwd(record.cwd, filePath);
				const entries = await getGitFileHistory(record.cwd, filePath, maxCount);
				this.sendRpcResponse(request.requestId, { entries });
			} catch (error) {
				logger.error(
					{
						err: error,
						requestId: request.requestId,
						sessionId: request.params.sessionId,
					},
					"rpc_git_file_history_error",
				);
				this.sendRpcError(request.requestId, error);
			}
		});

		// Git grep handler
		this.socket.on("rpc:git:grep", async (request) => {
			try {
				const { sessionId, query, caseSensitive, regex, glob } = request.params;
				logger.debug(
					{ requestId: request.requestId, sessionId, query },
					"rpc_git_grep",
				);
				const record = sessionManager.getSession(sessionId);
				if (!record || !record.cwd) {
					throw new Error("Session not found or no working directory");
				}
				const result = await searchFileContents(record.cwd, query, {
					caseSensitive,
					regex,
					glob,
				});
				this.sendRpcResponse(request.requestId, result);
			} catch (error) {
				logger.error(
					{
						err: error,
						requestId: request.requestId,
						sessionId: request.params.sessionId,
					},
					"rpc_git_grep_error",
				);
				this.sendRpcError(request.requestId, error);
			}
		});

		// Git branches for cwd (no session required — used before session creation)
		this.socket.on("rpc:git:branchesForCwd", async (request) => {
			try {
				const { cwd } = request.params;
				logger.debug(
					{ requestId: request.requestId, cwd },
					"rpc_git_branches_for_cwd",
				);
				const projectContext = await resolveGitProjectContext(cwd);
				if (!projectContext.isGitRepo) {
					const result: GitBranchesForCwdResponse = {
						isGitRepo: false,
						branches: [],
					};
					this.sendRpcResponse(request.requestId, result);
					return;
				}
				const branches = await getGitBranches(cwd);
				const result: GitBranchesForCwdResponse = {
					isGitRepo: true,
					branches,
					worktreeBaseDir: this.options.config.worktreeBaseDir,
					repoRoot: projectContext.repoRoot,
					repoName: projectContext.repoName,
					relativeCwd: projectContext.relativeCwd,
					isRepoRoot: projectContext.isRepoRoot,
				};
				this.sendRpcResponse(request.requestId, result);
			} catch (error) {
				logger.error(
					{ err: error, requestId: request.requestId },
					"rpc_git_branches_for_cwd_error",
				);
				this.sendRpcError(request.requestId, error);
			}
		});

		// Session rename
		this.socket.on("rpc:session:rename", async (request) => {
			try {
				const { sessionId, title } = request.params;
				logger.info(
					{ requestId: request.requestId, sessionId, title },
					"rpc_session_rename",
				);
				const summary = sessionManager.updateTitle(sessionId, title);
				this.sendRpcResponse(request.requestId, summary);
			} catch (error) {
				logger.error(
					{
						err: error,
						requestId: request.requestId,
						sessionId: request.params.sessionId,
					},
					"rpc_session_rename_error",
				);
				this.sendRpcError(request.requestId, error);
			}
		});

		// Archive session
		this.socket.on("rpc:session:archive", async (request) => {
			try {
				const { sessionId } = request.params;
				logger.info(
					{ requestId: request.requestId, sessionId },
					"rpc_session_archive",
				);
				await this.enqueueSessionOperation(sessionId, () =>
					sessionManager.archiveSession(sessionId),
				);
				this.sendRpcResponse(request.requestId, { ok: true });
			} catch (error) {
				logger.error(
					{
						err: error,
						requestId: request.requestId,
						sessionId: request.params.sessionId,
					},
					"rpc_session_archive_error",
				);
				this.sendRpcError(request.requestId, error);
			}
		});

		// Bulk archive sessions
		this.socket.on("rpc:session:archive-all", async (request) => {
			try {
				const { sessionIds } = request.params;
				logger.info(
					{
						requestId: request.requestId,
						count: sessionIds.length,
					},
					"rpc_session_archive_all",
				);
				const result = await this.enqueueSessionOperations(sessionIds, () =>
					sessionManager.bulkArchiveSessions(sessionIds),
				);
				this.sendRpcResponse(request.requestId, result);
			} catch (error) {
				logger.error(
					{
						err: error,
						requestId: request.requestId,
					},
					"rpc_session_archive_all_error",
				);
				this.sendRpcError(request.requestId, error);
			}
		});

		// Session events RPC handler (for backfill)
		this.socket.on("rpc:session:events", (request) => {
			try {
				const { sessionId, revision, afterSeq, limit } = request.params;
				logger.debug(
					{
						requestId: request.requestId,
						sessionId,
						revision,
						afterSeq,
						limit,
					},
					"rpc_session_events",
				);

				const result = sessionManager.getSessionEvents({
					sessionId,
					revision,
					afterSeq,
					limit,
				});

				// Encrypt event payloads before sending
				result.events = result.events.map((e) =>
					this.options.cryptoService.encryptEvent(e),
				);

				this.sendRpcResponse<SessionEventsResponse>(request.requestId, result);
			} catch (error) {
				logger.error(
					{
						err: error,
						requestId: request.requestId,
						sessionId: request.params.sessionId,
					},
					"rpc_session_events_error",
				);
				this.sendRpcError(request.requestId, error);
			}
		});
	}

	private getOrCreateMessageSend(
		params: SendMessageParams,
	): Promise<SendMessageResult> {
		const messageId = params.messageId.trim();
		if (!messageId) {
			return Promise.reject(new Error("messageId is required"));
		}
		const key = `${params.sessionId}\u0000${messageId}`;
		const inFlight = this.messageSendsInFlight.get(key);
		if (inFlight) {
			return inFlight;
		}

		const operation = this.enqueueSessionOperation(params.sessionId, () =>
			this.executeMessageSend({ ...params, messageId }),
		);
		this.messageSendsInFlight.set(key, operation);
		const clearInFlight = () => {
			if (this.messageSendsInFlight.get(key) === operation) {
				this.messageSendsInFlight.delete(key);
			}
		};
		// Handle both outcomes without creating an unobserved rejected promise.
		void operation.then(clearInFlight, clearInFlight);
		return operation;
	}

	private enqueueSessionOperation<T>(
		sessionId: string,
		operation: () => Promise<T>,
	): Promise<T> {
		return this.enqueueSessionOperations([sessionId], operation);
	}

	private enqueueSessionOperations<T>(
		sessionIds: readonly string[],
		operation: () => Promise<T>,
	): Promise<T> {
		const uniqueSessionIds = [...new Set(sessionIds)].sort();
		const previousTails = uniqueSessionIds
			.map((sessionId) => this.sessionOperationTails.get(sessionId))
			.filter((tail): tail is Promise<void> => tail !== undefined);
		const previous =
			previousTails.length === 0
				? Promise.resolve()
				: Promise.all(previousTails).then(() => {});
		const result = previous.then(operation);
		const tail = result.then(
			() => {},
			() => {},
		);
		for (const sessionId of uniqueSessionIds) {
			this.sessionOperationTails.set(sessionId, tail);
		}
		const clearTail = () => {
			for (const sessionId of uniqueSessionIds) {
				if (this.sessionOperationTails.get(sessionId) === tail) {
					this.sessionOperationTails.delete(sessionId);
				}
			}
		};
		void result.then(clearTail, clearTail);
		return result;
	}

	private async executeMessageSend(
		params: SendMessageParams,
	): Promise<SendMessageResult> {
		const { sessionManager, cryptoService } = this.options;
		const completed = sessionManager.getMessageSendResult(
			params.sessionId,
			params.messageId,
		);
		if (completed) {
			return completed;
		}

		const prompt = cryptoService.decryptRpcPayload<ContentBlock[]>(
			params.sessionId,
			params.prompt,
		);
		const record = sessionManager.getSession(params.sessionId);
		if (!record) {
			throw new Error("Session not found");
		}
		validatePromptForBackend(
			prompt,
			record.connection.getSessionCapabilities().prompt?.image === true,
		);
		sessionManager.touchSession(params.sessionId);
		const claim = sessionManager.claimMessageSend(
			params.sessionId,
			params.messageId,
		);
		if (claim.status === "completed") {
			return claim.result;
		}
		if (claim.status === "in_progress") {
			throw createMessageOutcomeUnknownError();
		}

		let promptResult: Awaited<ReturnType<typeof record.connection.prompt>>;
		try {
			promptResult = await record.connection.prompt(params.sessionId, prompt);
		} catch (error) {
			throw createMessageOutcomeUnknownError(
				error instanceof Error ? error.message : undefined,
			);
		}
		const result = { stopReason: promptResult.stopReason as StopReason };
		sessionManager.completeMessageSend(
			params.sessionId,
			params.messageId,
			claim.claimId,
			result.stopReason,
		);
		sessionManager.touchSession(params.sessionId);
		sessionManager.recordTurnEnd(params.sessionId, result.stopReason);
		return result;
	}

	private setupSessionManagerListeners() {
		const { sessionManager } = this.options;

		// Note: session:update, session:error, and terminal:output are no longer
		// emitted separately - they're unified through session:event (WAL-persisted)

		sessionManager.onPermissionRequest((payload) => {
			if (this.connected) {
				this.socket.emit("permission:request", payload);
			}
		});

		sessionManager.onPermissionResult((payload) => {
			if (this.connected) {
				this.socket.emit("permission:result", payload);
			}
		});

		sessionManager.onSessionsChanged((payload) => {
			if (this.connected) {
				logger.info(
					{
						added: payload.added.length,
						updated: payload.updated.length,
						removed: payload.removed.length,
					},
					"sessions_changed_emit",
				);
				this.socket.emit("sessions:changed", payload);
			}
		});

		sessionManager.onSessionAttached((payload) => {
			if (this.connected) {
				this.socket.emit("session:attached", payload);
			}
		});

		sessionManager.onSessionDetached((payload) => {
			if (this.connected) {
				this.socket.emit("session:detached", payload);
			}
		});

		// Unified event channel - all content updates (messages, tool calls,
		// terminal output, errors) are WAL-persisted and emitted via session:event
		sessionManager.onSessionEvent((event) => {
			logger.info(
				{
					sessionId: event.sessionId,
					revision: event.revision,
					seq: event.seq,
					kind: event.kind,
					connected: this.connected,
				},
				"session_event_received_from_manager",
			);
			if (this.connected) {
				// Encrypt payload before sending to gateway
				const encrypted = this.options.cryptoService.encryptEvent(event);
				logger.debug(
					{
						sessionId: event.sessionId,
						revision: event.revision,
						seq: event.seq,
						kind: event.kind,
					},
					"session_event_emitting_to_gateway",
				);
				this.socket.emit("session:event", encrypted);
				logger.debug(
					{
						sessionId: event.sessionId,
						seq: event.seq,
					},
					"session_event_emitted_to_gateway",
				);
			} else {
				logger.warn(
					{
						sessionId: event.sessionId,
						seq: event.seq,
						kind: event.kind,
					},
					"session_event_dropped_not_connected",
				);
			}
		});
	}

	private async listSessionResources(
		rootPath: string,
	): Promise<SessionFsResourceEntry[]> {
		const ig = await loadGitignore(rootPath);
		const allFiles = await this.listAllFiles(rootPath, ig, rootPath, []);
		return allFiles.map((filePath) => ({
			name: path.basename(filePath),
			relativePath: path.relative(rootPath, filePath),
			path: filePath,
		}));
	}

	private async listAllFiles(
		rootPath: string,
		ig: Ignore,
		baseDir: string,
		collected: string[] = [],
	): Promise<string[]> {
		if (collected.length >= MAX_RESOURCE_FILES) {
			return collected;
		}
		const entries = await fs.readdir(rootPath, { withFileTypes: true });
		for (const entry of entries) {
			if (collected.length >= MAX_RESOURCE_FILES) {
				break;
			}
			const entryPath = path.join(rootPath, entry.name);
			const relativePath = path.relative(baseDir, entryPath);

			// Check gitignore (add trailing slash for directories)
			const checkPath = entry.isDirectory() ? `${relativePath}/` : relativePath;
			if (ig.ignores(checkPath)) {
				continue;
			}

			if (entry.isDirectory()) {
				await this.listAllFiles(entryPath, ig, baseDir, collected);
			} else if (entry.isFile()) {
				collected.push(entryPath);
			}
		}
		return collected;
	}

	private sendRpcResponse<T>(requestId: string, result: T) {
		const response: RpcResponse<T> = { requestId, result };
		this.socket.emit("rpc:response", response);
		logger.debug({ requestId }, "rpc_response_sent");
	}

	private sendRpcError(requestId: string, error: unknown) {
		const message = error instanceof Error ? error.message : "Unknown error";
		const detail =
			process.env.NODE_ENV === "development"
				? error instanceof Error
					? error.stack
					: undefined
				: undefined;
		logger.error(
			{
				requestId,
				err: error,
				message,
				detail,
			},
			"rpc_response_error_sent",
		);
		const errorPayload =
			error instanceof AppError
				? error.detail
				: {
						code: "INTERNAL_ERROR" as const,
						message,
						retryable: true,
						scope: "request" as const,
						detail,
					};
		const response: RpcResponse<unknown> = {
			requestId,
			error: errorPayload,
		};
		this.socket.emit("rpc:response", response);
	}

	private register() {
		const { config } = this.options;
		logger.info({ machineId: config.machineId }, "cli_register_emit");
		this.socket.emit("cli:register", {
			machineId: config.machineId,
			hostname: config.hostname,
			version: config.clientVersion,
			backends: config.acpBackends.map((backend) => ({
				backendId: backend.id,
				backendLabel: backend.label,
				icon: backend.icon,
				description: backend.description,
			})),
		});
	}

	private async handleConnect() {
		const { config, sessionManager } = this.options;
		// A successful Socket.IO transport recovery does not necessarily emit a
		// connect_error first. Track completed transport connections directly so
		// WAL replay is not skipped after a clean reconnect.
		const wasReconnect = this.hasConnectedOnce || this.reconnectAttempts > 0;
		this.hasConnectedOnce = true;
		logger.info(
			{
				gatewayUrl: config.gatewayUrl,
				wasReconnect,
			},
			"gateway_connected",
		);
		this.connected = true;
		this.reconnectAttempts = 0;
		logger.info("gateway_register_start");
		this.register();
		try {
			await sessionManager.backfillDiscoveredWorkspaceRoots();
		} catch (error) {
			logger.error({ err: error }, "cli_register_backfill_failed");
		}
		logger.info({ machineId: config.machineId }, "cli_register_sessions_list");
		this.socket.emit("sessions:list", sessionManager.listAllSessions());
		this.startHeartbeat();

		this.emit("connected");
	}

	private startHeartbeat() {
		this.stopHeartbeat();
		this.heartbeatInterval = setInterval(() => {
			if (this.connected) {
				this.socket.emit("cli:heartbeat");
				this.socket.emit(
					"sessions:list",
					this.options.sessionManager.listAllSessions(),
				);
			}
		}, 30000);
	}

	private stopHeartbeat() {
		if (this.heartbeatInterval) {
			clearInterval(this.heartbeatInterval);
			this.heartbeatInterval = undefined;
		}
	}

	/**
	 * Replay unacked events for every durable current session revision.
	 */
	private async replayUnackedEvents(generation: number): Promise<void> {
		const { sessionManager } = this.options;
		const revisions = sessionManager.listUnackedSessionRevisions();
		let batchSize = 0;

		for (const { sessionId, revision } of revisions) {
			const unackedEvents = sessionManager.getUnackedEvents(
				sessionId,
				revision,
			);

			if (unackedEvents.length > 0) {
				logger.info(
					{
						sessionId,
						revision,
						count: unackedEvents.length,
					},
					"replaying_unacked_events",
				);

				for (const event of unackedEvents) {
					if (!this.connected || generation !== this.walReplayGeneration) {
						return;
					}
					const encrypted = this.options.cryptoService.encryptEvent(event);
					this.socket.emit("session:event", encrypted);
					batchSize += 1;
					if (batchSize >= WAL_REPLAY_BATCH_SIZE) {
						batchSize = 0;
						await new Promise<void>((resolve) => setTimeout(resolve, 0));
					}
				}
			}
		}
	}

	connect() {
		this.socket.connect();
	}

	disconnect() {
		this.stopHeartbeat();
		this.connected = false;
		this.walReplayGeneration += 1;
		this.agentTeamStore.close();
		this.socket.disconnect();
	}

	isConnected() {
		return this.connected;
	}
}
