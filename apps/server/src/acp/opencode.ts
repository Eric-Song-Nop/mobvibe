import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { Readable, Writable } from "node:stream";
import {
	type Client,
	ClientSideConnection,
	type ContentBlock,
	type Implementation,
	type NewSessionResponse,
	ndJsonStream,
	PROTOCOL_VERSION,
	type PromptResponse,
	type RequestPermissionRequest,
	type RequestPermissionResponse,
	type SessionNotification,
} from "@agentclientprotocol/sdk";
import type { AcpBackendId } from "../config.js";
import {
	createErrorDetail,
	type ErrorDetail,
	isProtocolMismatch,
} from "./errors.js";

type ClientInfo = {
	name: string;
	version: string;
};

export type AcpConnectionState =
	| "idle"
	| "connecting"
	| "ready"
	| "error"
	| "stopped";

export type AcpBackendStatus = {
	backendId: AcpBackendId;
	backendLabel: string;
	state: AcpConnectionState;
	command: string;
	args: string[];
	connectedAt?: string;
	error?: ErrorDetail;
	sessionId?: string;
	pid?: number;
};

const getErrorMessage = (error: unknown) => {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
};

type SessionUpdateListener = (notification: SessionNotification) => void;

type ClientHandlers = {
	onSessionUpdate: (notification: SessionNotification) => void;
	onRequestPermission?: (
		params: RequestPermissionRequest,
	) => Promise<RequestPermissionResponse>;
};

const buildClient = (handlers: ClientHandlers): Client => ({
	async requestPermission(params) {
		if (handlers.onRequestPermission) {
			return handlers.onRequestPermission(params);
		}
		return { outcome: { outcome: "cancelled" } };
	},
	async sessionUpdate(params) {
		handlers.onSessionUpdate(params);
	},
});

const formatExitMessage = (
	code: number | null,
	signal: NodeJS.Signals | null,
) => {
	if (signal) {
		return `ACP 进程收到信号 ${signal}`;
	}
	if (code !== null) {
		return `ACP 进程退出，状态码 ${code}`;
	}
	return "ACP 进程已退出";
};

const buildConnectError = (error: unknown): ErrorDetail => {
	const detail = getErrorMessage(error);
	if (isProtocolMismatch(error)) {
		return createErrorDetail({
			code: "ACP_PROTOCOL_MISMATCH",
			message: "ACP 协议版本不匹配",
			retryable: false,
			scope: "service",
			detail,
		});
	}
	return createErrorDetail({
		code: "ACP_CONNECT_FAILED",
		message: "无法连接到 ACP 后端进程",
		retryable: true,
		scope: "service",
		detail,
	});
};

const buildProcessExitError = (detail: string): ErrorDetail =>
	createErrorDetail({
		code: "ACP_PROCESS_EXITED",
		message: "ACP 后端进程异常退出",
		retryable: true,
		scope: "service",
		detail,
	});

const buildConnectionClosedError = (detail: string): ErrorDetail =>
	createErrorDetail({
		code: "ACP_CONNECTION_CLOSED",
		message: "ACP 连接已断开",
		retryable: true,
		scope: "service",
		detail,
	});

export class AcpConnection {
	private connection?: ClientSideConnection;
	private process?: ChildProcessWithoutNullStreams;
	private closedPromise?: Promise<void>;
	private state: AcpConnectionState = "idle";
	private connectedAt?: Date;
	private error?: ErrorDetail;
	private sessionId?: string;
	private agentInfo?: Implementation;
	private readonly sessionUpdateEmitter = new EventEmitter();
	private readonly statusEmitter = new EventEmitter();
	private permissionHandler?: (
		params: RequestPermissionRequest,
	) => Promise<RequestPermissionResponse>;

	constructor(
		private readonly options: {
			backend: {
				id: AcpBackendId;
				label: string;
			};
			command: string;
			args: string[];
			envOverrides?: Record<string, string>;
			client: ClientInfo;
		},
	) {}

	getStatus(): AcpBackendStatus {
		return {
			backendId: this.options.backend.id,
			backendLabel: this.options.backend.label,
			state: this.state,
			command: this.options.command,
			args: [...this.options.args],
			connectedAt: this.connectedAt?.toISOString(),
			error: this.error,
			sessionId: this.sessionId,
			pid: this.process?.pid,
		};
	}

	getAgentInfo(): Implementation | undefined {
		return this.agentInfo;
	}

	setPermissionHandler(
		handler?: (
			params: RequestPermissionRequest,
		) => Promise<RequestPermissionResponse>,
	) {
		this.permissionHandler = handler;
	}

	onSessionUpdate(listener: SessionUpdateListener) {
		this.sessionUpdateEmitter.on("update", listener);
		return () => {
			this.sessionUpdateEmitter.off("update", listener);
		};
	}

	onStatusChange(listener: (status: AcpBackendStatus) => void) {
		this.statusEmitter.on("status", listener);
		return () => {
			this.statusEmitter.off("status", listener);
		};
	}

	private updateStatus(state: AcpConnectionState, error?: ErrorDetail) {
		this.state = state;
		this.error = error;
		this.statusEmitter.emit("status", this.getStatus());
	}

	async connect(): Promise<void> {
		if (this.state === "connecting" || this.state === "ready") {
			return;
		}

		this.updateStatus("connecting");
		this.agentInfo = undefined;

		try {
			const env = this.options.envOverrides
				? { ...process.env, ...this.options.envOverrides }
				: process.env;
			const child = spawn(this.options.command, this.options.args, {
				stdio: ["pipe", "pipe", "pipe"],
				env,
			});
			this.process = child;
			this.sessionId = undefined;
			child.stderr.pipe(process.stderr);

			const input = Writable.toWeb(child.stdin) as WritableStream<Uint8Array>;
			const output = Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>;
			const stream = ndJsonStream(input, output);
			const connection = new ClientSideConnection(
				() =>
					buildClient({
						onSessionUpdate: (notification) =>
							this.emitSessionUpdate(notification),
						onRequestPermission: (params) =>
							this.handlePermissionRequest(params),
					}),
				stream,
			);
			this.connection = connection;

			child.once("error", (error) => {
				if (this.state === "stopped") {
					return;
				}
				this.updateStatus("error", buildConnectError(error));
			});

			child.once("exit", (code, signal) => {
				if (this.state === "stopped") {
					return;
				}
				this.updateStatus(
					"error",
					buildProcessExitError(formatExitMessage(code, signal)),
				);
			});

			this.closedPromise = connection.closed.catch((error) => {
				this.updateStatus(
					"error",
					buildConnectionClosedError(getErrorMessage(error)),
				);
			});

			const initializeResponse = await connection.initialize({
				protocolVersion: PROTOCOL_VERSION,
				clientInfo: {
					name: this.options.client.name,
					version: this.options.client.version,
				},
				clientCapabilities: {},
			});

			this.agentInfo = initializeResponse.agentInfo ?? undefined;
			this.connectedAt = new Date();
			this.updateStatus("ready");
		} catch (error) {
			this.updateStatus("error", buildConnectError(error));
			await this.stopProcess();
			throw error;
		}
	}

	async createSession(options?: { cwd?: string }): Promise<NewSessionResponse> {
		const connection = await this.ensureReady();
		const response = await this.createSessionInternal(
			connection,
			options?.cwd ?? process.cwd(),
		);
		this.sessionId = response.sessionId;
		return response;
	}

	async prompt(
		sessionId: string,
		prompt: ContentBlock[],
	): Promise<PromptResponse> {
		const connection = await this.ensureReady();
		return connection.prompt({ sessionId, prompt });
	}

	async cancel(sessionId: string): Promise<void> {
		const connection = await this.ensureReady();
		await connection.cancel({ sessionId });
	}

	async disconnect(): Promise<void> {
		if (this.state === "stopped") {
			return;
		}

		this.updateStatus("stopped");
		this.sessionId = undefined;
		this.agentInfo = undefined;
		await this.stopProcess();
		await this.closedPromise;
		this.connection = undefined;
	}

	private async ensureReady(): Promise<ClientSideConnection> {
		if (this.state !== "ready" || !this.connection) {
			await this.connect();
		}

		if (!this.connection || this.state !== "ready") {
			throw new Error("ACP 连接不可用");
		}

		return this.connection;
	}

	private async createSessionInternal(
		connection: ClientSideConnection,
		cwd: string,
	): Promise<NewSessionResponse> {
		const session = await connection.newSession({
			cwd,
			mcpServers: [],
		});
		return session;
	}

	private emitSessionUpdate(notification: SessionNotification) {
		this.sessionUpdateEmitter.emit("update", notification);
	}

	private async handlePermissionRequest(
		params: RequestPermissionRequest,
	): Promise<RequestPermissionResponse> {
		if (this.permissionHandler) {
			return this.permissionHandler(params);
		}
		return { outcome: { outcome: "cancelled" } };
	}

	private async stopProcess(): Promise<void> {
		const child = this.process;
		if (!child) {
			return;
		}

		this.process = undefined;
		if (child.exitCode === null && !child.killed) {
			child.kill("SIGTERM");
		}
	}
}
