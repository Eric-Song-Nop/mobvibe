import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { Readable, Writable } from "node:stream";
import {
	type AgentCapabilities,
	type Client,
	ClientSideConnection,
	type ContentBlock,
	type CreateTerminalRequest,
	type CreateTerminalResponse,
	type Implementation,
	type KillTerminalRequest,
	type KillTerminalResponse,
	type ListSessionsResponse,
	type LoadSessionResponse,
	type NewSessionResponse,
	ndJsonStream,
	PROTOCOL_VERSION,
	type PromptResponse,
	type ReleaseTerminalRequest,
	type ReleaseTerminalResponse,
	RequestError,
	type RequestPermissionRequest,
	type RequestPermissionResponse,
	type SessionInfo,
	type SessionNotification,
	type TerminalExitStatus,
	type TerminalOutputRequest,
	type TerminalOutputResponse,
	type WaitForTerminalExitRequest,
	type WaitForTerminalExitResponse,
} from "@agentclientprotocol/sdk";
import {
	type AcpConnectionState,
	type AgentSessionCapabilities,
	createErrorDetail,
	type ErrorDetail,
	isProtocolMismatch,
	type TeamMcpTransport,
	type TerminalOutputEvent,
} from "@mobvibe/shared";
import type { AcpBackendConfig } from "../config.js";
import {
	type ChildProcessWithoutNullStreams,
	spawn,
} from "../lib/child-process.js";
import { logger } from "../lib/logger.js";
import { buildShellCommand, resolveShell } from "../lib/shell.js";
import type { TeamMcpSessionDeclaration } from "../team/team-capability.js";
import {
	EXPECTED_TEAM_TOOL_NAMES,
	type TeamToolName,
} from "../team/team-tool-handlers.js";

type ClientInfo = {
	name: string;
	version: string;
};

type RfdMcpCapabilities = {
	acp?: boolean;
	stdio?: boolean;
	perSessionBridge?: boolean;
};

const MAX_STDERR_LINES = 20;

export type AcpBackendStatus = {
	backendId: string;
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

export type TeamMcpSessionOptions = {
	teamMcpDeclaration?: TeamMcpSessionDeclaration;
	teamMcpTransport?: TeamMcpTransport;
	teamMcpHandlers?: TeamMcpCallbackHandlers;
};

export type TeamMcpCallbackHandlers = {
	handleConnect(input: {
		serverId: string;
		transport?: TeamMcpTransport;
	}): unknown;
	handleListTools(input: { serverId: string; toolNames: string[] }): unknown;
	handleToolCall(input: {
		serverId: string;
		toolName: TeamToolName;
		args: unknown;
	}): Promise<unknown> | unknown;
	handleDisconnect(input: { serverId: string }): unknown;
};

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
		params: KillTerminalRequest,
	) => Promise<KillTerminalResponse>;
	onReleaseTerminal?: (
		params: ReleaseTerminalRequest,
	) => Promise<ReleaseTerminalResponse>;
	onExtMethod?: (
		method: string,
		params: Record<string, unknown>,
	) => Promise<Record<string, unknown>>;
	onExtNotification?: (
		method: string,
		params: Record<string, unknown>,
	) => Promise<void>;
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
	async killTerminal(params: KillTerminalRequest) {
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
	async extMethod(method: string, params: Record<string, unknown>) {
		if (!handlers.onExtMethod) {
			throw RequestError.methodNotFound(method);
		}
		return handlers.onExtMethod(method, params);
	},
	async extNotification(method: string, params: Record<string, unknown>) {
		if (!handlers.onExtNotification) {
			throw RequestError.methodNotFound(method);
		}
		return handlers.onExtNotification(method, params);
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

const appendStderrDetail = (detail: string, stderrTail?: string) => {
	if (!stderrTail) {
		return detail;
	}
	return `${detail}\nBackend stderr:\n${stderrTail}`;
};

const buildConnectError = (
	error: unknown,
	stderrTail?: string,
): ErrorDetail => {
	const detail = appendStderrDetail(getErrorMessage(error), stderrTail);
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

const buildProcessExitError = (
	detail: string,
	stderrTail?: string,
): ErrorDetail =>
	createErrorDetail({
		code: "ACP_PROCESS_EXITED",
		message: "ACP backend process exited unexpectedly",
		retryable: true,
		scope: "service",
		detail: appendStderrDetail(detail, stderrTail),
	});

const buildConnectionClosedError = (
	detail: string,
	stderrTail?: string,
): ErrorDetail =>
	createErrorDetail({
		code: "ACP_CONNECTION_CLOSED",
		message: "ACP connection closed",
		retryable: true,
		scope: "service",
		detail: appendStderrDetail(detail, stderrTail),
	});

const normalizeOutputText = (value: string) => value.normalize("NFC");

const readBooleanFlag = (value: unknown, key: keyof RfdMcpCapabilities) => {
	if (!value || typeof value !== "object") {
		return false;
	}
	const candidate = value as Record<keyof RfdMcpCapabilities, unknown>;
	return candidate[key] === true;
};

const mapRfdMcpCapabilities = (
	agentCapabilities?: AgentCapabilities,
): RfdMcpCapabilities | undefined => {
	const mcpCapabilities = agentCapabilities?.mcpCapabilities as unknown;
	const mapped = {
		acp: readBooleanFlag(mcpCapabilities, "acp"),
		stdio: readBooleanFlag(mcpCapabilities, "stdio"),
		perSessionBridge: readBooleanFlag(mcpCapabilities, "perSessionBridge"),
	};
	if (!mapped.acp && !mapped.stdio && !mapped.perSessionBridge) {
		return undefined;
	}
	return mapped;
};

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

type ParsedTeamMcpMessage =
	| { kind: "list_tools"; serverId: string; toolNames: string[] }
	| {
			kind: "tool_call";
			serverId: string;
			toolName: TeamToolName;
			args: unknown;
	  };

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const requireRecord = (
	value: unknown,
	message: string,
): Record<string, unknown> => {
	if (!isRecord(value)) {
		throw RequestError.invalidParams(undefined, message);
	}
	return value;
};

const readStringField = (
	record: Record<string, unknown> | undefined,
	key: string,
): string | undefined => {
	const value = record?.[key];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
};

const readRecordField = (
	record: Record<string, unknown> | undefined,
	key: string,
): Record<string, unknown> | undefined => {
	const value = record?.[key];
	return isRecord(value) ? value : undefined;
};

const hasField = (record: Record<string, unknown>, key: string): boolean =>
	Object.hasOwn(record, key);

const readTeamMcpServerId = (params: unknown): string => {
	const record = requireRecord(params, "Team MCP params must be an object");
	const server = readRecordField(record, "server");
	const serverId =
		readStringField(record, "serverId") ??
		readStringField(record, "server_id") ??
		readStringField(server, "id") ??
		readStringField(server, "serverId");
	if (!serverId) {
		throw RequestError.invalidParams(
			undefined,
			"Team MCP serverId is required",
		);
	}
	return serverId;
};

const readToolNames = (value: unknown): string[] | undefined => {
	if (!Array.isArray(value)) {
		return undefined;
	}
	const names = value
		.map((item) => {
			if (typeof item === "string") return item.trim();
			if (isRecord(item)) return readStringField(item, "name") ?? "";
			return "";
		})
		.filter(Boolean);
	return names.length === value.length ? names : undefined;
};

const readToolNamesFromRecords = (
	...records: Array<Record<string, unknown> | undefined>
): string[] | undefined => {
	for (const record of records) {
		const names =
			readToolNames(record?.toolNames) ?? readToolNames(record?.tools);
		if (names) return names;
	}
	return undefined;
};

const readTeamToolName = (
	value: string | undefined,
): TeamToolName | undefined => {
	if (!value) {
		return undefined;
	}
	if (EXPECTED_TEAM_TOOL_NAMES.includes(value as TeamToolName)) {
		return value as TeamToolName;
	}
	throw RequestError.invalidParams(undefined, "Unsupported Team MCP tool name");
};

const readToolCallArgs = (
	...records: Array<Record<string, unknown> | undefined>
): unknown => {
	for (const record of records) {
		if (!record) continue;
		if (hasField(record, "args")) return record.args;
		if (hasField(record, "arguments")) return record.arguments;
	}
	return {};
};

const parseTeamMcpMessage = (params: unknown): ParsedTeamMcpMessage => {
	const record = requireRecord(params, "Team MCP message must be an object");
	const message =
		readRecordField(record, "message") ??
		readRecordField(record, "data") ??
		record;
	const rpcParams = readRecordField(message, "params");
	const result = readRecordField(message, "result");
	const serverId = readTeamMcpServerId(record);
	const toolNames = readToolNamesFromRecords(
		record,
		message,
		rpcParams,
		result,
	);
	if (toolNames) {
		return { kind: "list_tools", serverId, toolNames };
	}

	const toolName = readTeamToolName(
		readStringField(record, "toolName") ??
			readStringField(record, "name") ??
			readStringField(message, "toolName") ??
			readStringField(message, "name") ??
			readStringField(rpcParams, "toolName") ??
			readStringField(rpcParams, "name"),
	);
	if (toolName) {
		return {
			kind: "tool_call",
			serverId,
			toolName,
			args: readToolCallArgs(record, message, rpcParams),
		};
	}

	throw RequestError.invalidParams(
		undefined,
		"Unsupported Team MCP message shape",
	);
};

const toRecordResponse = (value: unknown): Record<string, unknown> => {
	if (isRecord(value)) return value;
	return { value };
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
	private agentCapabilities?: AgentCapabilities;
	private readonly sessionUpdateEmitter = new EventEmitter();
	private readonly statusEmitter = new EventEmitter();
	private readonly terminalOutputEmitter = new EventEmitter();
	private permissionHandler?: (
		params: RequestPermissionRequest,
	) => Promise<RequestPermissionResponse>;
	private teamMcpHandlers?: TeamMcpCallbackHandlers;
	private teamMcpTransport?: TeamMcpTransport;
	private terminals = new Map<string, TerminalRecord>();
	private recentStderr: string[] = [];

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

	/**
	 * Get the agent's session capabilities.
	 */
	getSessionCapabilities(): AgentSessionCapabilities {
		return {
			list: this.agentCapabilities?.sessionCapabilities?.list != null,
			load: this.agentCapabilities?.loadSession === true,
			prompt: {
				image: this.agentCapabilities?.promptCapabilities?.image === true,
				audio: this.agentCapabilities?.promptCapabilities?.audio === true,
				embeddedContext:
					this.agentCapabilities?.promptCapabilities?.embeddedContext === true,
			},
			mcp: mapRfdMcpCapabilities(this.agentCapabilities),
		};
	}

	/**
	 * Check if the agent supports session/list.
	 */
	supportsSessionList(): boolean {
		return this.agentCapabilities?.sessionCapabilities?.list != null;
	}

	/**
	 * Check if the agent supports session/load.
	 */
	supportsSessionLoad(): boolean {
		return this.agentCapabilities?.loadSession === true;
	}

	/**
	 * List sessions from the agent (session/list).
	 * @param params Optional filter parameters
	 * @returns List of session info from the agent
	 */
	async listSessions(params?: {
		cursor?: string;
		cwd?: string;
	}): Promise<{ sessions: SessionInfo[]; nextCursor?: string }> {
		if (!this.supportsSessionList()) {
			return { sessions: [] };
		}
		const connection = await this.ensureReady();
		const response: ListSessionsResponse = await connection.listSessions({
			cursor: params?.cursor ?? undefined,
			cwd: params?.cwd ?? undefined,
		});
		return {
			sessions: response.sessions,
			nextCursor: response.nextCursor ?? undefined,
		};
	}

	/**
	 * Load a historical session with message history replay (session/load).
	 * @param sessionId The session ID to load
	 * @param cwd The working directory
	 * @returns Load session response with modes/models state
	 */
	async loadSession(
		sessionId: string,
		cwd: string,
		options?: TeamMcpSessionOptions,
	): Promise<LoadSessionResponse> {
		if (!this.supportsSessionLoad()) {
			throw new Error("Agent does not support session/load capability");
		}
		const connection = await this.ensureReady();
		this.configureTeamMcp(options);
		const response = await connection.loadSession({
			sessionId,
			cwd,
			mcpServers: this.buildMcpServers(options),
		});
		this.sessionId = sessionId;
		return response;
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

	private recordStderr(text: string) {
		for (const line of text.split(/\r?\n/)) {
			const trimmed = line.trim();
			if (!trimmed) {
				continue;
			}
			this.recentStderr.push(trimmed);
			if (this.recentStderr.length > MAX_STDERR_LINES) {
				this.recentStderr.shift();
			}
		}
	}

	private getStderrTail(): string | undefined {
		return this.recentStderr.length > 0
			? this.recentStderr.join("\n")
			: undefined;
	}

	async connect(): Promise<void> {
		if (this.state === "connecting" || this.state === "ready") {
			return;
		}

		this.updateStatus("connecting");
		this.agentInfo = undefined;
		this.recentStderr = [];
		logger.info(
			{
				backendId: this.options.backend.id,
				command: this.options.backend.command,
				args: this.options.backend.args,
			},
			"acp_backend_connect_start",
		);

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
			logger.info(
				{
					backendId: this.options.backend.id,
					pid: child.pid,
					command: this.options.backend.command,
					args: this.options.backend.args,
				},
				"acp_backend_spawned",
			);
			child.stderr.on("data", (chunk: Buffer) => {
				const text = chunk.toString("utf8").trimEnd();
				if (text) {
					this.recordStderr(text);
					logger.debug(
						{ backendId: this.options.backend.id, stderr: text },
						"acp_backend_stderr",
					);
				}
			});
			child.stdout.once("close", () => {
				logger.info(
					{ backendId: this.options.backend.id, pid: child.pid },
					"acp_backend_stdout_closed",
				);
			});
			child.stdin.once("close", () => {
				logger.info(
					{ backendId: this.options.backend.id, pid: child.pid },
					"acp_backend_stdin_closed",
				);
			});

			const input = Writable.toWeb(child.stdin) as WritableStream<Uint8Array>;
			const output = Readable.toWeb(
				child.stdout,
			) as unknown as ReadableStream<Uint8Array>;
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
						onExtMethod: (method, params) =>
							this.handleTeamMcpExtensionMethod(method, params),
						onExtNotification: async (method, params) => {
							await this.handleTeamMcpExtensionMethod(method, params);
						},
					}),
				stream,
			);
			this.connection = connection;

			child.once("error", (error) => {
				const stderrTail = this.getStderrTail();
				logger.error(
					{
						backendId: this.options.backend.id,
						pid: child.pid,
						err: error,
						stderrTail,
					},
					"acp_backend_process_error",
				);
				if (this.state === "stopped") {
					return;
				}
				this.updateStatus("error", buildConnectError(error, stderrTail));
			});

			child.once("exit", (code, signal) => {
				const detail = formatExitMessage(code, signal);
				const stderrTail = this.getStderrTail();
				logger.warn(
					{
						backendId: this.options.backend.id,
						pid: child.pid,
						code,
						signal,
						stderrTail,
					},
					"acp_backend_process_exit",
				);
				if (this.state === "stopped") {
					return;
				}
				this.updateStatus("error", buildProcessExitError(detail, stderrTail));
			});
			child.once("close", (code, signal) => {
				logger.info(
					{
						backendId: this.options.backend.id,
						pid: child.pid,
						code,
						signal,
					},
					"acp_backend_process_close",
				);
			});

			this.closedPromise = connection.closed.catch((error) => {
				const stderrTail = this.getStderrTail();
				logger.warn(
					{
						backendId: this.options.backend.id,
						pid: child.pid,
						err: error,
						stderrTail,
					},
					"acp_backend_connection_closed",
				);
				this.updateStatus(
					"error",
					buildConnectionClosedError(getErrorMessage(error), stderrTail),
				);
			});

			logger.info(
				{ backendId: this.options.backend.id, pid: child.pid },
				"acp_backend_initialize_start",
			);
			const initializeResponse = await connection.initialize({
				protocolVersion: PROTOCOL_VERSION,
				clientInfo: {
					name: this.options.client.name,
					version: this.options.client.version,
				},
				clientCapabilities: { terminal: true },
			});

			this.agentInfo = initializeResponse.agentInfo ?? undefined;
			this.agentCapabilities =
				initializeResponse.agentCapabilities ?? undefined;
			this.connectedAt = new Date();
			this.updateStatus("ready");
			logger.info(
				{
					backendId: this.options.backend.id,
					pid: child.pid,
					agentInfo: this.agentInfo,
					sessionCapabilities: this.getSessionCapabilities(),
				},
				"acp_backend_initialize_complete",
			);
		} catch (error) {
			const stderrTail = this.getStderrTail();
			logger.error(
				{
					backendId: this.options.backend.id,
					command: this.options.backend.command,
					args: this.options.backend.args,
					err: error,
					stderrTail,
				},
				"acp_backend_connect_failed",
			);
			this.updateStatus("error", buildConnectError(error, stderrTail));
			await this.stopProcess();
			throw error;
		}
	}

	async createSession(
		options?: { cwd?: string } & TeamMcpSessionOptions,
	): Promise<NewSessionResponse> {
		const connection = await this.ensureReady();
		const response = await this.createSessionInternal(
			connection,
			options?.cwd ?? process.cwd(),
			options,
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

		const shell = resolveShell();
		const fullCommand = buildShellCommand(params.command, params.args ?? []);
		const child = spawn(shell, ["-c", fullCommand], {
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
		params: KillTerminalRequest,
	): Promise<KillTerminalResponse> {
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

		this.configureTeamMcp(undefined);
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
		options?: TeamMcpSessionOptions,
	): Promise<NewSessionResponse> {
		this.configureTeamMcp(options);
		const session = await connection.newSession({
			cwd,
			mcpServers: this.buildMcpServers(options),
		});
		return session;
	}

	private configureTeamMcp(options?: TeamMcpSessionOptions): void {
		this.teamMcpHandlers = options?.teamMcpHandlers;
		this.teamMcpTransport = options?.teamMcpTransport;
	}

	private async handleTeamMcpExtensionMethod(
		method: string,
		params: unknown,
	): Promise<Record<string, unknown>> {
		switch (method) {
			case "mcp/connect": {
				const handlers = this.requireTeamMcpHandlers(method);
				handlers.handleConnect({
					serverId: readTeamMcpServerId(params),
					transport: this.teamMcpTransport ?? "acp",
				});
				return { ok: true };
			}
			case "mcp/message": {
				const handlers = this.requireTeamMcpHandlers(method);
				const message = parseTeamMcpMessage(params);
				if (message.kind === "list_tools") {
					handlers.handleListTools({
						serverId: message.serverId,
						toolNames: message.toolNames,
					});
					return { ok: true };
				}
				return toRecordResponse(
					await handlers.handleToolCall({
						serverId: message.serverId,
						toolName: message.toolName,
						args: message.args,
					}),
				);
			}
			case "mcp/disconnect": {
				const handlers = this.requireTeamMcpHandlers(method);
				handlers.handleDisconnect({ serverId: readTeamMcpServerId(params) });
				return { ok: true };
			}
			default:
				throw RequestError.methodNotFound(method);
		}
	}

	private requireTeamMcpHandlers(method: string): TeamMcpCallbackHandlers {
		if (!this.teamMcpHandlers) {
			throw RequestError.methodNotFound(method);
		}
		return this.teamMcpHandlers;
	}

	private buildMcpServers(options?: TeamMcpSessionOptions): unknown[] {
		if (!options?.teamMcpDeclaration) {
			return [];
		}
		return [options.teamMcpDeclaration];
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
