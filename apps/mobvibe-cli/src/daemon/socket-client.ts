import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import type {
	CliToGatewayEvents,
	ContentBlock,
	FsEntry,
	FsRoot,
	GatewayToCliEvents,
	RpcRequest,
	RpcResponse,
	SessionFsFilePreview,
	SessionFsResourceEntry,
	SessionSummary,
	StopReason,
} from "@mobvibe/shared";
import { io, type Socket } from "socket.io-client";
import type { SessionManager } from "../acp/session-manager.js";
import type { CliConfig } from "../config.js";

type SocketClientOptions = {
	config: CliConfig;
	sessionManager: SessionManager;
	/** API key for authentication (loaded from credentials) */
	apiKey: string;
};

const SESSION_ROOT_NAME = "Working Directory";

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

export class SocketClient extends EventEmitter {
	private socket: Socket<GatewayToCliEvents, CliToGatewayEvents>;
	private connected = false;
	private reconnectAttempts = 0;
	private heartbeatInterval?: NodeJS.Timeout;

	constructor(private readonly options: SocketClientOptions) {
		super();
		this.socket = io(`${options.config.gatewayUrl}/cli`, {
			path: "/socket.io",
			reconnection: true,
			reconnectionAttempts: Number.POSITIVE_INFINITY,
			reconnectionDelay: 1000,
			reconnectionDelayMax: 30000,
			transports: ["websocket"],
			autoConnect: false,
			extraHeaders: {
				"x-api-key": options.apiKey,
			},
		});
		this.setupEventHandlers();
		this.setupRpcHandlers();
		this.setupSessionManagerListeners();
	}

	private setupEventHandlers() {
		this.socket.on("connect", () => {
			console.log("[mobvibe-cli] Connected to gateway");
			this.connected = true;
			this.reconnectAttempts = 0;
      console.log(`[mobvibe-cli] Registering to gateway`);
			this.register();
			this.startHeartbeat();
			this.emit("connected");
		});

		this.socket.on("disconnect", (reason) => {
			console.log(`[mobvibe-cli] Disconnected from gateway: ${reason}`);
			this.connected = false;
			this.stopHeartbeat();
			this.emit("disconnected", reason);
		});

		this.socket.on("connect_error", (error) => {
			this.reconnectAttempts++;
			if (this.reconnectAttempts <= 3 || this.reconnectAttempts % 10 === 0) {
				console.error(
					`[mobvibe-cli] Connection error (attempt ${this.reconnectAttempts}):`,
					error.message,
				);
			}
		});

		this.socket.on("cli:registered", (info) => {
			console.log(`[mobvibe-cli] Registered with gateway: ${info.machineId}`);
		});

		// Handle authentication errors
		this.socket.on("cli:error", (error) => {
			console.error(`[mobvibe-cli] Authentication error: ${error.message}`);
			this.emit("auth_error", error);
		});
	}

	private setupRpcHandlers() {
		const { sessionManager } = this.options;

		// Session create
		this.socket.on("rpc:session:create", async (request) => {
			try {
				const session = await sessionManager.createSession(request.params);
				this.sendRpcResponse(request.requestId, session);
			} catch (error) {
				this.sendRpcError(request.requestId, error);
			}
		});

		// Session close
		this.socket.on("rpc:session:close", async (request) => {
			try {
				await sessionManager.closeSession(request.params.sessionId);
				this.sendRpcResponse(request.requestId, { ok: true });
			} catch (error) {
				this.sendRpcError(request.requestId, error);
			}
		});

		// Session cancel
		this.socket.on("rpc:session:cancel", async (request) => {
			try {
				await sessionManager.cancelSession(request.params.sessionId);
				this.sendRpcResponse(request.requestId, { ok: true });
			} catch (error) {
				this.sendRpcError(request.requestId, error);
			}
		});

		// Session mode
		this.socket.on("rpc:session:mode", async (request) => {
			try {
				const session = await sessionManager.setSessionMode(
					request.params.sessionId,
					request.params.modeId,
				);
				this.sendRpcResponse(request.requestId, session);
			} catch (error) {
				this.sendRpcError(request.requestId, error);
			}
		});

		// Session model
		this.socket.on("rpc:session:model", async (request) => {
			try {
				const session = await sessionManager.setSessionModel(
					request.params.sessionId,
					request.params.modelId,
				);
				this.sendRpcResponse(request.requestId, session);
			} catch (error) {
				this.sendRpcError(request.requestId, error);
			}
		});

		// Send message
		this.socket.on("rpc:message:send", async (request) => {
			try {
				const { sessionId, prompt } = request.params;
				const record = sessionManager.getSession(sessionId);
				if (!record) {
					throw new Error("Session not found");
				}
				sessionManager.touchSession(sessionId);
				// Cast through unknown since SDK and shared ContentBlock types are structurally compatible
				const result = await record.connection.prompt(
					sessionId,
					prompt as unknown as import("@agentclientprotocol/sdk").ContentBlock[],
				);
				sessionManager.touchSession(sessionId);
				this.sendRpcResponse<{ stopReason: StopReason }>(request.requestId, {
					stopReason: result.stopReason as StopReason,
				});
			} catch (error) {
				this.sendRpcError(request.requestId, error);
			}
		});

		// Permission decision
		this.socket.on("rpc:permission:decision", async (request) => {
			try {
				const { sessionId, requestId, outcome } = request.params;
				sessionManager.resolvePermissionRequest(sessionId, requestId, outcome);
				this.sendRpcResponse(request.requestId, { ok: true });
			} catch (error) {
				this.sendRpcError(request.requestId, error);
			}
		});

		// File system handlers
		this.socket.on("rpc:fs:roots", async (request) => {
			try {
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
				this.sendRpcError(request.requestId, error);
			}
		});

		this.socket.on("rpc:fs:entries", async (request) => {
			try {
				const { sessionId, path: requestPath } = request.params;
				const record = sessionManager.getSession(sessionId);
				if (!record || !record.cwd) {
					throw new Error("Session not found or no working directory");
				}
				const resolved = requestPath
					? path.isAbsolute(requestPath)
						? requestPath
						: path.join(record.cwd, requestPath)
					: record.cwd;
				const entries = await readDirectoryEntries(resolved);
				this.sendRpcResponse(request.requestId, { path: resolved, entries });
			} catch (error) {
				this.sendRpcError(request.requestId, error);
			}
		});

		this.socket.on("rpc:fs:file", async (request) => {
			try {
				const { sessionId, path: requestPath } = request.params;
				const record = sessionManager.getSession(sessionId);
				if (!record || !record.cwd) {
					throw new Error("Session not found or no working directory");
				}
				const resolved = path.isAbsolute(requestPath)
					? requestPath
					: path.join(record.cwd, requestPath);
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
				this.sendRpcError(request.requestId, error);
			}
		});

		this.socket.on("rpc:fs:resources", async (request) => {
			try {
				const { sessionId } = request.params;
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
				this.sendRpcError(request.requestId, error);
			}
		});
	}

	private setupSessionManagerListeners() {
		const { sessionManager } = this.options;

		sessionManager.onSessionUpdate((notification) => {
			if (this.connected) {
				// Cast through unknown since SDK and shared SessionNotification types are structurally compatible
				this.socket.emit(
					"session:update",
					notification as unknown as import("@mobvibe/shared").SessionNotification,
				);
			}
		});

		sessionManager.onSessionError((payload) => {
			if (this.connected) {
				this.socket.emit("session:error", payload);
			}
		});

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

		sessionManager.onTerminalOutput((event) => {
			if (this.connected) {
				this.socket.emit("terminal:output", event);
			}
		});
	}

	private async listSessionResources(
		rootPath: string,
	): Promise<SessionFsResourceEntry[]> {
		const allFiles = await this.listAllFiles(rootPath);
		return allFiles.map((filePath) => ({
			name: path.basename(filePath),
			relativePath: path.relative(rootPath, filePath),
			path: filePath,
		}));
	}

	private async listAllFiles(rootPath: string): Promise<string[]> {
		const files: string[] = [];
		const entries = await fs.readdir(rootPath, { withFileTypes: true });
		await Promise.all(
			entries.map(async (entry) => {
				const entryPath = path.join(rootPath, entry.name);
				if (entry.isDirectory()) {
					files.push(...(await this.listAllFiles(entryPath)));
					return;
				}
				if (entry.isFile()) {
					files.push(entryPath);
				}
			}),
		);
		return files;
	}

	private sendRpcResponse<T>(requestId: string, result: T) {
		const response: RpcResponse<T> = { requestId, result };
		this.socket.emit("rpc:response", response);
	}

	private sendRpcError(requestId: string, error: unknown) {
		const message = error instanceof Error ? error.message : "Unknown error";
		const response: RpcResponse<unknown> = {
			requestId,
			error: {
				code: "INTERNAL_ERROR",
				message,
				retryable: true,
				scope: "request",
			},
		};
		this.socket.emit("rpc:response", response);
	}

	private register() {
		const { config, sessionManager } = this.options;
    console.log(`[cli] Registering CLI for machine ${config.machineId}`);
		this.socket.emit("cli:register", {
			machineId: config.machineId,
			hostname: config.hostname,
			version: config.clientVersion,
			backends: config.acpBackends.map((backend) => ({
				backendId: backend.id,
				backendLabel: backend.label,
			})),
			defaultBackendId: config.defaultAcpBackendId,
		});
    console.log(`[cli] Registered CLI for machine ${config.machineId}, sending sessions list`);
		// Send current sessions list
		this.socket.emit("sessions:list", sessionManager.listSessions());
	}

	private startHeartbeat() {
		this.stopHeartbeat();
		this.heartbeatInterval = setInterval(() => {
			if (this.connected) {
				this.socket.emit("cli:heartbeat");
				this.socket.emit(
					"sessions:list",
					this.options.sessionManager.listSessions(),
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

	connect() {
		this.socket.connect();
	}

	disconnect() {
		this.stopHeartbeat();
		this.socket.disconnect();
	}

	isConnected() {
		return this.connected;
	}
}
