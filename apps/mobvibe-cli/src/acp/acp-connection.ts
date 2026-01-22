import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { Readable, Writable } from "node:stream";
import {
	type Client,
	ClientSideConnection,
	type ContentBlock,
	type CreateTerminalRequest,
	type CreateTerminalResponse,
	type Implementation,
	type KillTerminalCommandRequest,
	type KillTerminalCommandResponse,
	type NewSessionResponse,
	ndJsonStream,
	PROTOCOL_VERSION,
	type PromptResponse,
	type ReleaseTerminalRequest,
	type ReleaseTerminalResponse,
	type RequestPermissionRequest,
	type RequestPermissionResponse,
	type SessionNotification,
	type TerminalExitStatus,
	type TerminalOutputRequest,
	type TerminalOutputResponse,
	type WaitForTerminalExitRequest,
	type WaitForTerminalExitResponse,
} from "@agentclientprotocol/sdk";
import {
	type AcpBackendId,
	type AcpConnectionState,
	createErrorDetail,
	type ErrorDetail,
	isProtocolMismatch,
	type TerminalOutputEvent,
} from "@mobvibe/shared";
import type { AcpBackendConfig } from "../config.js";

type ClientInfo = {
	name: string;
	version: string;
};

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

type TerminalOutputSnapshot = {
	output: string;
	truncated: boolean;
	exitStatus?: TerminalExitStatus | null;
};

type TerminalRecord = {
	sessionId: string;
	command: string;
	args: string[];
	outputByteLimit: number;
	output: TerminalOutputSnapshot;
	process?: ChildProcessWithoutNullStreams;
	onExit?: Promise<WaitForTerminalExitResponse>;
	resolveExit?: (response: WaitForTerminalExitResponse) => void;
};

type ClientHandlers = {
	onSessionUpdate: (notification: SessionNotification) => void;
	onRequestPermission?: (
		params: RequestPermissionRequest,
	) => Promise<RequestPermissionResponse>;
	onCreateTerminal?: (
		params: CreateTerminalRequest,
	) => Promise<CreateTerminalResponse>;
	onTerminalOutput?: (
		params: TerminalOutputRequest,
	) => Promise<TerminalOutputResponse>;
	onWaitForTerminalExit?: (
		params: WaitForTerminalExitRequest,
	) => Promise<WaitForTerminalExitResponse>;
	onKillTerminal?: (
		params: KillTerminalCommandRequest,
	) => Promise<KillTerminalCommandResponse>;
	onReleaseTerminal?: (
		params: ReleaseTerminalRequest,
	) => Promise<ReleaseTerminalResponse>;
};

const buildClient = (handlers: ClientHandlers): Client => ({
	async requestPermission(params: RequestPermissionRequest) {
		if (handlers.onRequestPermission) {
			return handlers.onRequestPermission(params);
		}
		return { outcome: { outcome: "cancelled" } };
	},
	async sessionUpdate(params: SessionNotification) {
		handlers.onSessionUpdate(params);
	},
	async createTerminal(params: CreateTerminalRequest) {
		if (!handlers.onCreateTerminal) {
			throw new Error("Terminal create handler not configured");
		}
		return handlers.onCreateTerminal(params);
	},
	async terminalOutput(params: TerminalOutputRequest) {
		if (!handlers.onTerminalOutput) {
			return { output: "", truncated: false };
		}
		return handlers.onTerminalOutput(params);
	},
	async waitForTerminalExit(params: WaitForTerminalExitRequest) {
		if (!handlers.onWaitForTerminalExit) {
			return { exitCode: null, signal: null };
		}
		return handlers.onWaitForTerminalExit(params);
	},
	async killTerminal(params: KillTerminalCommandRequest) {
		if (!handlers.onKillTerminal) {
			return {};
		}
		return handlers.onKillTerminal(params);
	},
	async releaseTerminal(params: ReleaseTerminalRequest) {
		if (!handlers.onReleaseTerminal) {
			return {};
		}
		return handlers.onReleaseTerminal(params);
	},
});

const formatExitMessage = (
	code: number | null,
	signal: NodeJS.Signals | null,
) => {
	if (signal) {
		return `ACP process received signal ${signal}`;
	}
	if (code !== null) {
		return `ACP process exited with code ${code}`;
	}
	return "ACP process exited";
};

const buildConnectError = (error: unknown): ErrorDetail => {
	const detail = getErrorMessage(error);
	if (isProtocolMismatch(error)) {
		return createErrorDetail({
			code: "ACP_PROTOCOL_MISMATCH",
			message: "ACP protocol version mismatch",
			retryable: false,
			scope: "service",
			detail,
		});
	}
	return createErrorDetail({
		code: "ACP_CONNECT_FAILED",
		message: "Failed to connect to ACP backend process",
		retryable: true,
		scope: "service",
		detail,
	});
};

const buildProcessExitError = (detail: string): ErrorDetail =>
	createErrorDetail({
		code: "ACP_PROCESS_EXITED",
		message: "ACP backend process exited unexpectedly",
		retryable: true,
		scope: "service",
		detail,
	});

const buildConnectionClosedError = (detail: string): ErrorDetail =>
	createErrorDetail({
		code: "ACP_CONNECTION_CLOSED",
		message: "ACP connection closed",
		retryable: true,
		scope: "service",
		detail,
	});

const normalizeOutputText = (value: string) => value.normalize("NFC");

const isOutputOverLimit = (value: string, limit: number) =>
	Buffer.byteLength(value, "utf8") > limit;

const sliceOutputToLimit = (value: string, limit: number) => {
	const buffer = Buffer.from(value, "utf8");
	if (buffer.byteLength <= limit) {
		return value;
	}
	const sliced = buffer.subarray(buffer.byteLength - limit);
	let start = 0;
	while (start < sliced.length && (sliced[start] & 0b11000000) === 0b10000000) {
		start += 1;
	}
	return sliced.subarray(start).toString("utf8");
};

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
	private readonly terminalOutputEmitter = new EventEmitter();
	private permissionHandler?: (
		params: RequestPermissionRequest,
	) => Promise<RequestPermissionResponse>;
	private terminals = new Map<string, TerminalRecord>();

	constructor(
		private readonly options: {
			backend: AcpBackendConfig;
			client: ClientInfo;
		},
	) {}

	getStatus(): AcpBackendStatus {
		return {
			backendId: this.options.backend.id,
			backendLabel: this.options.backend.label,
			state: this.state,
			command: this.options.backend.command,
			args: [...this.options.backend.args],
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

	onTerminalOutput(listener: (payload: TerminalOutputEvent) => void) {
		this.terminalOutputEmitter.on("output", listener);
		return () => {
			this.terminalOutputEmitter.off("output", listener);
		};
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
			const env = this.options.backend.envOverrides
				? { ...process.env, ...this.options.backend.envOverrides }
				: process.env;
			const child = spawn(
				this.options.backend.command,
				this.options.backend.args,
				{
					stdio: ["pipe", "pipe", "pipe"],
					env,
				},
			);
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
						onCreateTerminal: (params) => this.createTerminal(params),
						onTerminalOutput: (params) => this.getTerminalOutput(params),
						onWaitForTerminalExit: (params) => this.waitForTerminalExit(params),
						onKillTerminal: (params) => this.killTerminal(params),
						onReleaseTerminal: (params) => this.releaseTerminal(params),
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
				clientCapabilities: { terminal: true },
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

	async setSessionMode(sessionId: string, modeId: string): Promise<void> {
		const connection = await this.ensureReady();
		await connection.setSessionMode({ sessionId, modeId });
	}

	async setSessionModel(sessionId: string, modelId: string): Promise<void> {
		const connection = await this.ensureReady();
		await connection.unstable_setSessionModel({ sessionId, modelId });
	}

	async createTerminal(
		params: CreateTerminalRequest,
	): Promise<CreateTerminalResponse> {
		const outputLimit =
			typeof params.outputByteLimit === "number" && params.outputByteLimit > 0
				? Math.floor(params.outputByteLimit)
				: 1024 * 1024;
		const resolvedEnv = params.env
			? Object.fromEntries(
					params.env.map((envVar) => [envVar.name, envVar.value]),
				)
			: undefined;
		const terminalId = randomUUID();
		const record: TerminalRecord = {
			sessionId: params.sessionId,
			command: params.command,
			args: params.args ?? [],
			outputByteLimit: outputLimit,
			output: {
				output: "",
				truncated: false,
				exitStatus: null,
			},
		};
		this.terminals.set(terminalId, record);

		const child = spawn(params.command, params.args ?? [], {
			cwd: params.cwd ?? undefined,
			env: resolvedEnv ? { ...process.env, ...resolvedEnv } : process.env,
		});
		child.once("error", (error) => {
			record.output.exitStatus = {
				exitCode: null,
				signal: null,
			};
			record.resolveExit?.({ exitCode: null, signal: null });
			this.terminalOutputEmitter.emit("output", {
				sessionId: record.sessionId,
				terminalId,
				delta: `\n[terminal error] ${String(error)}`,
				truncated: record.output.truncated,
				output: record.output.output,
				exitStatus: record.output.exitStatus,
			} satisfies TerminalOutputEvent);
		});
		record.process = child;
		let resolveExit: (response: WaitForTerminalExitResponse) => void = () => {};
		record.onExit = new Promise<WaitForTerminalExitResponse>((resolve) => {
			resolveExit = resolve;
		});
		record.resolveExit = resolveExit;

		const handleChunk = (chunk: Buffer) => {
			const delta = normalizeOutputText(chunk.toString("utf8"));
			if (!delta) {
				return;
			}
			const combinedOutput = record.output.output + delta;
			record.output.truncated = isOutputOverLimit(
				combinedOutput,
				record.outputByteLimit,
			);
			record.output.output = sliceOutputToLimit(
				combinedOutput,
				record.outputByteLimit,
			);

			this.terminalOutputEmitter.emit("output", {
				sessionId: record.sessionId,
				terminalId,
				delta,
				truncated: record.output.truncated,
				output: record.output.truncated ? record.output.output : undefined,
				exitStatus: record.output.exitStatus,
			} satisfies TerminalOutputEvent);
		};

		child.stdout?.on("data", handleChunk);
		child.stderr?.on("data", handleChunk);
		child.on("exit", (code, signal) => {
			record.output.exitStatus = {
				exitCode: code ?? null,
				signal: signal ?? null,
			};
			record.resolveExit?.({
				exitCode: code ?? null,
				signal: signal ?? null,
			});
			this.terminalOutputEmitter.emit("output", {
				sessionId: record.sessionId,
				terminalId,
				delta: "",
				truncated: record.output.truncated,
				output: record.output.output,
				exitStatus: record.output.exitStatus,
			} satisfies TerminalOutputEvent);
		});

		return { terminalId };
	}

	async getTerminalOutput(
		params: TerminalOutputRequest,
	): Promise<TerminalOutputResponse> {
		const record = this.terminals.get(params.terminalId);
		if (!record || record.sessionId !== params.sessionId) {
			return { output: "", truncated: false };
		}
		return record.output;
	}

	async waitForTerminalExit(
		params: WaitForTerminalExitRequest,
	): Promise<WaitForTerminalExitResponse> {
		const record = this.terminals.get(params.terminalId);
		if (!record || record.sessionId !== params.sessionId) {
			return Promise.resolve({ exitCode: null, signal: null });
		}
		return record.onExit ?? Promise.resolve({ exitCode: null, signal: null });
	}

	async killTerminal(
		params: KillTerminalCommandRequest,
	): Promise<KillTerminalCommandResponse> {
		const record = this.terminals.get(params.terminalId);
		if (!record || record.sessionId !== params.sessionId) {
			return {};
		}
		record.process?.kill("SIGTERM");
		return {};
	}

	async releaseTerminal(
		params: ReleaseTerminalRequest,
	): Promise<ReleaseTerminalResponse> {
		const record = this.terminals.get(params.terminalId);
		if (record?.process && record.process.exitCode === null) {
			record.process.kill("SIGTERM");
		}
		this.terminals.delete(params.terminalId);
		return {};
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
			throw new Error("ACP connection not available");
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
