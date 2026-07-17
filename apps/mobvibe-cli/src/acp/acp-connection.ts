import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { constants as fsConstants } from "node:fs";
import {
	chmod,
	lstat,
	open,
	realpath,
	rename,
	unlink,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import { TextDecoder } from "node:util";
import {
	type AgentCapabilities,
	type ClientConnection,
	type CloseSessionResponse,
	type ContentBlock,
	type CreateTerminalRequest,
	type CreateTerminalResponse,
	client,
	type DeleteSessionResponse,
	type Implementation,
	type InitializeRequest,
	type JsonRpcId,
	type KillTerminalRequest,
	type KillTerminalResponse,
	type ListSessionsResponse,
	type LoadSessionResponse,
	methods,
	type NewSessionResponse,
	ndJsonStream,
	PROTOCOL_VERSION,
	type PromptResponse,
	type ReadTextFileRequest,
	type ReadTextFileResponse,
	type ReleaseTerminalRequest,
	type ReleaseTerminalResponse,
	RequestError,
	type RequestPermissionRequest,
	type RequestPermissionResponse,
	type ResumeSessionResponse,
	type SessionInfo,
	type SessionNotification,
	type SetSessionConfigOptionResponse,
	type TerminalExitStatus,
	type TerminalOutputRequest,
	type TerminalOutputResponse,
	type WaitForTerminalExitRequest,
	type WaitForTerminalExitResponse,
	type WriteTextFileRequest,
	type WriteTextFileResponse,
} from "@agentclientprotocol/sdk";
import {
	type AcpConnectionState,
	type AgentSessionCapabilities,
	createErrorDetail,
	type ErrorDetail,
	isProtocolMismatch,
	sanitizeAcpMessageMeta,
	sanitizeAcpMeta,
	type TerminalOutputEvent,
} from "@mobvibe/shared";
import type { AcpBackendConfig } from "../config.js";
import {
	type ChildProcessWithoutNullStreams,
	spawn,
} from "../lib/child-process.js";
import { logger } from "../lib/logger.js";
import { buildShellCommand, resolveShell } from "../lib/shell.js";

type ClientInfo = {
	name: string;
	version: string;
};

const MAX_STDERR_LINES = 20;
const MAX_META_SANITIZATION_WARNINGS = 3;
export const MAX_ACP_FILE_BYTES = 1024 * 1024;
export const MAX_ACP_FILE_LINES = 10_000;

export const ACP_FILE_SYSTEM_CAPABILITIES = {
	readTextFile: true,
	writeTextFile: true,
} as const;

const UTF8_DECODER = new TextDecoder("utf-8", {
	fatal: true,
	ignoreBOM: true,
});

type ActiveFileSystemSession = {
	sessionId: string;
	roots: string[];
	canonicalRoots?: Promise<string[]>;
};

const isErrnoException = (error: unknown): error is NodeJS.ErrnoException =>
	error instanceof Error && "code" in error;

const isPathWithinRoot = (target: string, root: string) => {
	const relative = path.relative(root, target);
	return (
		relative === "" ||
		(relative !== ".." &&
			!relative.startsWith(`..${path.sep}`) &&
			!path.isAbsolute(relative))
	);
};

const throwIfCancelled = (signal?: AbortSignal) => {
	if (signal?.aborted) {
		throw RequestError.requestCancelled(
			undefined,
			"File system request was cancelled",
		);
	}
};

const validateNativeAbsolutePath = (filePath: string) => {
	if (!path.isAbsolute(filePath)) {
		throw RequestError.invalidParams(
			{ path: filePath },
			"File system paths must be absolute",
		);
	}
};

const decodeUtf8 = (content: Uint8Array, filePath: string) => {
	try {
		return UTF8_DECODER.decode(content);
	} catch {
		throw RequestError.invalidParams(
			{ path: filePath },
			"File content must be valid UTF-8",
		);
	}
};

const encodeUtf8 = (content: string) => {
	const encoded = Buffer.from(content, "utf8");
	if (UTF8_DECODER.decode(encoded) !== content) {
		throw RequestError.invalidParams(
			undefined,
			"File content must be valid Unicode text",
		);
	}
	return encoded;
};

const sliceTextLines = (
	content: string,
	line?: number | null,
	limit?: number | null,
) => {
	if (
		line !== undefined &&
		line !== null &&
		(!Number.isInteger(line) || line < 1)
	) {
		throw RequestError.invalidParams(
			{ line },
			"Read line must be a 1-based positive integer",
		);
	}
	if (
		limit !== undefined &&
		limit !== null &&
		(!Number.isInteger(limit) || limit < 0 || limit > MAX_ACP_FILE_LINES)
	) {
		throw RequestError.invalidParams(
			{ limit, max: MAX_ACP_FILE_LINES },
			`Read limit must be between 0 and ${MAX_ACP_FILE_LINES} lines`,
		);
	}

	const lines = content.split(/\r\n|\n|\r/);
	const start = (line ?? 1) - 1;
	const requestedLineCount = limit ?? Math.max(0, lines.length - start);
	if (requestedLineCount > MAX_ACP_FILE_LINES) {
		throw RequestError.invalidParams(
			{ line: line ?? 1, max: MAX_ACP_FILE_LINES },
			`Read requests are limited to ${MAX_ACP_FILE_LINES} lines`,
		);
	}
	if (line == null && limit == null) {
		return content;
	}
	return lines.slice(start, start + requestedLineCount).join("\n");
};

const isAbsolutePathInput = (value: string) =>
	path.posix.isAbsolute(value) || path.win32.isAbsolute(value);

/**
 * Validate and normalize ACP additional directories without changing their
 * spelling or order. Exact duplicates and the primary cwd are omitted.
 */
export const normalizeAdditionalDirectories = (
	cwd: string,
	additionalDirectories?: readonly string[],
): string[] => {
	if (additionalDirectories === undefined) {
		return [];
	}
	if (!Array.isArray(additionalDirectories)) {
		throw new Error("additionalDirectories must be an array");
	}
	const seen = new Set<string>();
	const normalized: string[] = [];
	for (const directory of additionalDirectories) {
		if (typeof directory !== "string" || directory.length === 0) {
			throw new Error("additionalDirectories must contain non-empty strings");
		}
		if (!isAbsolutePathInput(directory)) {
			throw new Error("additionalDirectories must contain absolute paths");
		}
		if (directory === cwd || seen.has(directory)) {
			continue;
		}
		seen.add(directory);
		normalized.push(directory);
	}
	return normalized;
};

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

const withCancellationSignal = <T>(
	promise: Promise<T>,
	signal?: AbortSignal,
): Promise<T> => {
	if (!signal) {
		return promise;
	}
	if (signal.aborted) {
		return Promise.reject(
			signal.reason ?? new Error("ACP request was cancelled"),
		);
	}
	return new Promise<T>((resolve, reject) => {
		const cleanup = () => signal.removeEventListener("abort", onAbort);
		const onAbort = () => {
			cleanup();
			reject(signal.reason ?? new Error("ACP request was cancelled"));
		};
		signal.addEventListener("abort", onAbort, { once: true });
		promise.then(
			(value) => {
				cleanup();
				resolve(value);
			},
			(error: unknown) => {
				cleanup();
				reject(error);
			},
		);
	});
};

export class AcpConnection {
	private connection?: ClientConnection;
	private process?: ChildProcessWithoutNullStreams;
	private closedPromise?: Promise<void>;
	private state: AcpConnectionState = "idle";
	private connectedAt?: Date;
	private error?: ErrorDetail;
	private sessionId?: string;
	private activeFileSystemSession?: ActiveFileSystemSession;
	private agentInfo?: Implementation;
	private agentCapabilities?: AgentCapabilities;
	private readonly sessionUpdateEmitter = new EventEmitter();
	private readonly statusEmitter = new EventEmitter();
	private readonly terminalOutputEmitter = new EventEmitter();
	private permissionHandler?: (
		params: RequestPermissionRequest,
		requestId: JsonRpcId,
		signal: AbortSignal,
	) => Promise<RequestPermissionResponse>;
	private promptControllers = new Map<string, Set<AbortController>>();
	private terminals = new Map<string, TerminalRecord>();
	private recentStderr: string[] = [];
	private metaSanitizationWarnings = 0;

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
			resume: this.agentCapabilities?.sessionCapabilities?.resume != null,
			close: this.agentCapabilities?.sessionCapabilities?.close != null,
			delete: this.agentCapabilities?.sessionCapabilities?.delete != null,
			additionalDirectories:
				this.agentCapabilities?.sessionCapabilities?.additionalDirectories !=
				null,
			prompt: {
				image: this.agentCapabilities?.promptCapabilities?.image === true,
				audio: this.agentCapabilities?.promptCapabilities?.audio === true,
				embeddedContext:
					this.agentCapabilities?.promptCapabilities?.embeddedContext === true,
			},
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
	 * Check if the agent supports session/resume.
	 */
	supportsSessionResume(): boolean {
		return this.agentCapabilities?.sessionCapabilities?.resume != null;
	}

	/** Check if the agent supports session/close. */
	supportsSessionClose(): boolean {
		return this.agentCapabilities?.sessionCapabilities?.close != null;
	}

	/** Check if the agent supports session/delete. */
	supportsSessionDelete(): boolean {
		return this.agentCapabilities?.sessionCapabilities?.delete != null;
	}

	supportsAdditionalDirectories(): boolean {
		return (
			this.agentCapabilities?.sessionCapabilities?.additionalDirectories != null
		);
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
		const response = this.sanitizeAgentPayload<ListSessionsResponse>(
			await connection.agent.request(methods.agent.session.list, {
				cursor: params?.cursor ?? undefined,
				cwd: params?.cwd ?? undefined,
			}),
			"session/list",
		);
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
		additionalDirectories?: readonly string[],
	): Promise<LoadSessionResponse> {
		if (!this.supportsSessionLoad()) {
			throw new Error("Agent does not support session/load capability");
		}
		const normalizedAdditionalDirectories = normalizeAdditionalDirectories(
			cwd,
			additionalDirectories,
		);
		if (
			normalizedAdditionalDirectories.length > 0 &&
			!this.supportsAdditionalDirectories()
		) {
			throw new Error(
				"Agent does not support session additionalDirectories capability",
			);
		}
		const connection = await this.ensureReady();
		const response = this.sanitizeAgentPayload<LoadSessionResponse>(
			await connection.agent.request(methods.agent.session.load, {
				sessionId,
				cwd,
				mcpServers: [],
				additionalDirectories:
					normalizedAdditionalDirectories.length > 0
						? normalizedAdditionalDirectories
						: undefined,
			}),
			"session/load",
		);
		this.bindActiveSession(sessionId, cwd, normalizedAdditionalDirectories);
		return response;
	}

	/** Resume a historical session without replaying its message history. */
	async resumeSession(
		sessionId: string,
		cwd: string,
		additionalDirectories?: readonly string[],
	): Promise<ResumeSessionResponse> {
		if (!this.supportsSessionResume()) {
			throw new Error("Agent does not support session/resume capability");
		}
		const normalizedAdditionalDirectories = normalizeAdditionalDirectories(
			cwd,
			additionalDirectories,
		);
		if (
			normalizedAdditionalDirectories.length > 0 &&
			!this.supportsAdditionalDirectories()
		) {
			throw new Error(
				"Agent does not support session additionalDirectories capability",
			);
		}
		const connection = await this.ensureReady();
		const response = this.sanitizeAgentPayload<ResumeSessionResponse>(
			await connection.agent.request(methods.agent.session.resume, {
				sessionId,
				cwd,
				mcpServers: [],
				additionalDirectories:
					normalizedAdditionalDirectories.length > 0
						? normalizedAdditionalDirectories
						: undefined,
			}),
			"session/resume",
		);
		this.bindActiveSession(sessionId, cwd, normalizedAdditionalDirectories);
		return response;
	}

	/** Close an active session and release its client-owned resources. */
	async closeSession(sessionId: string): Promise<CloseSessionResponse> {
		if (!this.supportsSessionClose()) {
			throw new Error("Agent does not support session/close capability");
		}
		const connection = await this.ensureReady();
		const response = this.sanitizeAgentPayload<CloseSessionResponse>(
			await connection.agent.request(methods.agent.session.close, {
				sessionId,
			}),
			"session/close",
		);
		this.cleanupSessionResources(
			sessionId,
			new Error("ACP session was closed"),
		);
		this.clearActiveSession(sessionId);
		return response;
	}

	/** Delete a session from the agent's session/list storage. */
	async deleteSession(sessionId: string): Promise<DeleteSessionResponse> {
		if (!this.supportsSessionDelete()) {
			throw new Error("Agent does not support session/delete capability");
		}
		const connection = await this.ensureReady();
		return this.sanitizeAgentPayload<DeleteSessionResponse>(
			await connection.agent.request(methods.agent.session.delete, {
				sessionId,
			}),
			"session/delete",
		);
	}

	setPermissionHandler(
		handler?: (
			params: RequestPermissionRequest,
			requestId: JsonRpcId,
			signal: AbortSignal,
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
		let attemptConnection: ClientConnection | undefined;
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
			this.clearActiveSession();
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
				if (this.process !== child) {
					return;
				}
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
			const connection = client({ name: this.options.client.name })
				.onRequest(
					methods.client.session.requestPermission,
					({ params, requestId, signal }) =>
						this.handlePermissionRequest(params, requestId, signal),
				)
				.onRequest(methods.client.fs.readTextFile, ({ params, signal }) =>
					this.readTextFile(params, signal),
				)
				.onRequest(methods.client.fs.writeTextFile, ({ params, signal }) =>
					this.writeTextFile(params, signal),
				)
				.onNotification(methods.client.session.update, ({ params }) =>
					this.emitSessionUpdate(params),
				)
				.onRequest(methods.client.terminal.create, ({ params }) =>
					this.createTerminal(params),
				)
				.onRequest(methods.client.terminal.output, ({ params }) =>
					this.getTerminalOutput(params),
				)
				.onRequest(methods.client.terminal.waitForExit, ({ params, signal }) =>
					this.waitForTerminalExit(params, signal),
				)
				.onRequest(methods.client.terminal.kill, ({ params }) =>
					this.killTerminal(params),
				)
				.onRequest(methods.client.terminal.release, ({ params }) =>
					this.releaseTerminal(params),
				)
				.connect(stream);
			attemptConnection = connection;
			this.connection = connection;

			child.once("error", (error) => {
				if (
					this.process !== child ||
					this.state === "stopped" ||
					this.state === "error"
				) {
					return;
				}
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
				this.updateStatus("error", buildConnectError(error, stderrTail));
			});

			child.once("exit", (code, signal) => {
				if (
					this.process !== child ||
					this.state === "stopped" ||
					this.state === "error"
				) {
					return;
				}
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

			this.closedPromise = connection.closed.then(() => {
				if (
					this.connection !== connection ||
					this.state === "stopped" ||
					this.state === "error"
				) {
					return;
				}
				const reason = connection.signal.reason;
				const stderrTail = this.getStderrTail();
				logger.warn(
					{
						backendId: this.options.backend.id,
						pid: child.pid,
						err: reason,
						stderrTail,
					},
					"acp_backend_connection_closed",
				);
				this.updateStatus(
					"error",
					buildConnectionClosedError(
						reason === undefined
							? "ACP transport closed unexpectedly"
							: getErrorMessage(reason),
						stderrTail,
					),
				);
			});

			logger.info(
				{ backendId: this.options.backend.id, pid: child.pid },
				"acp_backend_initialize_start",
			);
			const initializeRequest: InitializeRequest = {
				protocolVersion: PROTOCOL_VERSION,
				clientInfo: {
					name: this.options.client.name,
					version: this.options.client.version,
				},
				clientCapabilities: {
					fs: ACP_FILE_SYSTEM_CAPABILITIES,
					terminal: true,
					session: {
						configOptions: {
							boolean: {},
						},
					},
				},
			};
			const initializeResponse = this.sanitizeAgentPayload(
				await connection.agent.request(
					methods.agent.initialize,
					initializeRequest,
				),
				"initialize",
			);

			this.agentInfo = initializeResponse.agentInfo ?? undefined;
			this.agentCapabilities =
				initializeResponse.agentCapabilities ?? undefined;
			this.connectedAt = new Date();
			this.updateStatus("ready");
			logger.info(
				{
					backendId: this.options.backend.id,
					pid: child.pid,
					agentName: this.agentInfo?.name,
					agentTitle: this.agentInfo?.title,
					agentVersion: this.agentInfo?.version,
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
			if (attemptConnection && this.connection === attemptConnection) {
				this.connection = undefined;
				attemptConnection.close(error);
			}
			await this.stopProcess();
			this.updateStatus("error", buildConnectError(error, stderrTail));
			throw error;
		}
	}

	async createSession(options?: {
		cwd?: string;
		additionalDirectories?: readonly string[];
	}): Promise<NewSessionResponse> {
		const connection = await this.ensureReady();
		const cwd = options?.cwd ?? process.cwd();
		const additionalDirectories = normalizeAdditionalDirectories(
			cwd,
			options?.additionalDirectories,
		);
		if (
			additionalDirectories.length > 0 &&
			!this.supportsAdditionalDirectories()
		) {
			throw new Error(
				"Agent does not support session additionalDirectories capability",
			);
		}
		const response = await this.createSessionInternal(
			connection,
			cwd,
			additionalDirectories,
		);
		this.bindActiveSession(response.sessionId, cwd, additionalDirectories);
		return response;
	}

	async prompt(
		sessionId: string,
		prompt: ContentBlock[],
	): Promise<PromptResponse> {
		const connection = await this.ensureReady();
		const sanitizedPrompt = sanitizeAcpMessageMeta(prompt);
		if (!sanitizedPrompt.complete || sanitizedPrompt.rejectedEnvelopes > 0) {
			throw RequestError.invalidParams(
				{
					complete: sanitizedPrompt.complete,
					reasons: sanitizedPrompt.rejections.map(({ reason }) => reason),
				},
				"Invalid ACP prompt metadata",
			);
		}
		const controller = new AbortController();
		const controllers = this.promptControllers.get(sessionId) ?? new Set();
		controllers.add(controller);
		this.promptControllers.set(sessionId, controllers);
		try {
			return this.sanitizeAgentPayload<PromptResponse>(
				await connection.agent.request(
					methods.agent.session.prompt,
					{ sessionId, prompt: sanitizedPrompt.value },
					{ cancellationSignal: controller.signal },
				),
				"session/prompt",
			);
		} finally {
			controllers.delete(controller);
			if (controllers.size === 0) {
				this.promptControllers.delete(sessionId);
			}
		}
	}

	async cancel(sessionId: string): Promise<void> {
		const connection = await this.ensureReady();
		for (const controller of this.promptControllers.get(sessionId) ?? []) {
			controller.abort(new Error("Prompt cancelled by Mobvibe client"));
		}
		await connection.agent.notify(methods.agent.session.cancel, { sessionId });
	}

	async setSessionMode(sessionId: string, modeId: string): Promise<void> {
		const connection = await this.ensureReady();
		await connection.agent.request(methods.agent.session.setMode, {
			sessionId,
			modeId,
		});
	}

	async setSessionConfigOption(
		sessionId: string,
		configId: string,
		value: string | boolean,
		_meta?: Record<string, unknown> | null,
	): Promise<SetSessionConfigOptionResponse> {
		const connection = await this.ensureReady();
		const sanitizedMeta =
			_meta === undefined ? undefined : sanitizeAcpMeta(_meta);
		if (sanitizedMeta && !sanitizedMeta.ok) {
			throw RequestError.invalidParams(
				{ reason: sanitizedMeta.reason },
				"Invalid ACP session configuration metadata",
			);
		}
		const metadata = sanitizedMeta ? { _meta: sanitizedMeta.value } : {};
		return this.sanitizeAgentPayload<SetSessionConfigOptionResponse>(
			await connection.agent.request(
				methods.agent.session.setConfigOption,
				typeof value === "boolean"
					? { sessionId, configId, type: "boolean", value, ...metadata }
					: { sessionId, configId, value, ...metadata },
			),
			"session/set_config_option",
		);
	}

	async setSessionModel(
		sessionId: string,
		configId: string,
		modelId: string,
		_meta?: Record<string, unknown> | null,
	): Promise<SetSessionConfigOptionResponse> {
		return this.setSessionConfigOption(sessionId, configId, modelId, _meta);
	}

	async readTextFile(
		params: ReadTextFileRequest,
		signal?: AbortSignal,
	): Promise<ReadTextFileResponse> {
		throwIfCancelled(signal);
		const session = this.requireActiveFileSystemSession(params.sessionId);
		validateNativeAbsolutePath(params.path);
		const roots = await this.resolveCanonicalRoots(session, signal);
		this.assertActiveFileSystemSession(session);
		const target = await this.resolveExistingPath(params.path);
		this.assertActiveFileSystemSession(session);
		this.assertPathAllowed(target, roots, params.path);
		throwIfCancelled(signal);

		const noFollow = fsConstants.O_NOFOLLOW ?? 0;
		const handle = await open(target, fsConstants.O_RDONLY | noFollow);
		try {
			this.assertActiveFileSystemSession(session);
			const fileInfo = await handle.stat();
			if (!fileInfo.isFile()) {
				throw RequestError.invalidParams(
					{ path: params.path },
					"Read target must be a regular file",
				);
			}
			if (fileInfo.size > MAX_ACP_FILE_BYTES) {
				throw RequestError.invalidParams(
					{ path: params.path, maxBytes: MAX_ACP_FILE_BYTES },
					`Read files are limited to ${MAX_ACP_FILE_BYTES} bytes`,
				);
			}
			this.assertActiveFileSystemSession(session);
			const content = await handle.readFile({ signal });
			this.assertActiveFileSystemSession(session);
			throwIfCancelled(signal);
			if (content.byteLength > MAX_ACP_FILE_BYTES) {
				throw RequestError.invalidParams(
					{ path: params.path, maxBytes: MAX_ACP_FILE_BYTES },
					`Read files are limited to ${MAX_ACP_FILE_BYTES} bytes`,
				);
			}
			return {
				content: sliceTextLines(
					decodeUtf8(content, params.path),
					params.line,
					params.limit,
				),
			};
		} finally {
			await handle.close();
		}
	}

	async writeTextFile(
		params: WriteTextFileRequest,
		signal?: AbortSignal,
	): Promise<WriteTextFileResponse> {
		throwIfCancelled(signal);
		const session = this.requireActiveFileSystemSession(params.sessionId);
		validateNativeAbsolutePath(params.path);
		const encoded = encodeUtf8(params.content);
		if (encoded.byteLength > MAX_ACP_FILE_BYTES) {
			throw RequestError.invalidParams(
				{ path: params.path, maxBytes: MAX_ACP_FILE_BYTES },
				`Write content is limited to ${MAX_ACP_FILE_BYTES} bytes`,
			);
		}

		const roots = await this.resolveCanonicalRoots(session, signal);
		this.assertActiveFileSystemSession(session);
		const parent = await this.resolveExistingPath(path.dirname(params.path));
		this.assertActiveFileSystemSession(session);
		this.assertPathAllowed(parent, roots, params.path);
		const parentInfo = await lstat(parent);
		if (!parentInfo.isDirectory()) {
			throw RequestError.invalidParams(
				{ path: params.path },
				"Write target parent must be a directory",
			);
		}

		const target = path.join(parent, path.basename(params.path));
		let existingMode: number | undefined;
		try {
			const targetInfo = await lstat(target);
			if (targetInfo.isSymbolicLink()) {
				throw RequestError.invalidParams(
					{ path: params.path },
					"Writing through symbolic links is not allowed",
				);
			}
			if (!targetInfo.isFile()) {
				throw RequestError.invalidParams(
					{ path: params.path },
					"Write target must be a regular file",
				);
			}
			existingMode = targetInfo.mode & 0o777;
		} catch (error) {
			if (!isErrnoException(error) || error.code !== "ENOENT") {
				throw error;
			}
		}

		this.assertActiveFileSystemSession(session);
		throwIfCancelled(signal);
		const temporaryPath = path.join(
			parent,
			`.${path.basename(params.path)}.${randomUUID()}.mobvibe-tmp`,
		);
		let renamed = false;
		try {
			await writeFile(temporaryPath, encoded, {
				flag: "wx",
				...(existingMode !== undefined ? { mode: existingMode } : {}),
				signal,
			});
			if (existingMode !== undefined) {
				await chmod(temporaryPath, existingMode);
			}
			const temporaryHandle = await open(temporaryPath, "r");
			try {
				await temporaryHandle.sync();
			} finally {
				await temporaryHandle.close();
			}
			this.assertActiveFileSystemSession(session);
			throwIfCancelled(signal);
			await rename(temporaryPath, target);
			renamed = true;
			return {};
		} finally {
			if (!renamed) {
				await unlink(temporaryPath).catch((error: unknown) => {
					if (!isErrnoException(error) || error.code !== "ENOENT") {
						logger.warn(
							{ err: error, path: temporaryPath },
							"acp_file_system_temp_cleanup_failed",
						);
					}
				});
			}
		}
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
		signal?: AbortSignal,
	): Promise<WaitForTerminalExitResponse> {
		const record = this.terminals.get(params.terminalId);
		if (!record || record.sessionId !== params.sessionId) {
			return Promise.resolve({ exitCode: null, signal: null });
		}
		return withCancellationSignal(
			record.onExit ?? Promise.resolve({ exitCode: null, signal: null }),
			signal,
		);
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

		this.updateStatus("stopped");
		this.clearActiveSession();
		this.agentInfo = undefined;
		for (const sessionId of new Set([
			...this.promptControllers.keys(),
			...Array.from(this.terminals.values(), (record) => record.sessionId),
		])) {
			this.cleanupSessionResources(
				sessionId,
				new Error("ACP connection stopped"),
			);
		}
		this.promptControllers.clear();
		this.connection?.close();
		await this.stopProcess();
		await this.closedPromise;
		this.connection = undefined;
	}

	private async ensureReady(): Promise<ClientConnection> {
		if (this.state !== "ready" || !this.connection) {
			await this.connect();
		}

		if (!this.connection || this.state !== "ready") {
			throw new Error("ACP connection not available");
		}

		return this.connection;
	}

	private bindActiveSession(
		sessionId: string,
		cwd: string,
		additionalDirectories: readonly string[],
	): void {
		this.sessionId = sessionId;
		this.activeFileSystemSession = {
			sessionId,
			roots: [cwd, ...additionalDirectories],
		};
	}

	private clearActiveSession(sessionId?: string): void {
		if (sessionId !== undefined && this.sessionId !== sessionId) {
			return;
		}
		this.sessionId = undefined;
		this.activeFileSystemSession = undefined;
	}

	private requireActiveFileSystemSession(
		sessionId: string,
	): ActiveFileSystemSession {
		const session = this.activeFileSystemSession;
		if (
			!session ||
			session.sessionId !== sessionId ||
			this.sessionId !== sessionId
		) {
			throw RequestError.invalidParams(
				{ sessionId },
				"File system request does not match the active session",
			);
		}
		return session;
	}

	private assertActiveFileSystemSession(
		session: ActiveFileSystemSession,
	): void {
		if (
			this.activeFileSystemSession !== session ||
			this.sessionId !== session.sessionId
		) {
			throw RequestError.invalidParams(
				{ sessionId: session.sessionId },
				"File system request no longer belongs to the active session",
			);
		}
	}

	private async resolveCanonicalRoots(
		session: ActiveFileSystemSession,
		signal?: AbortSignal,
	): Promise<string[]> {
		session.canonicalRoots ??= Promise.all(
			session.roots.map(async (root) => {
				throwIfCancelled(signal);
				const canonicalRoot = await this.resolveExistingPath(root);
				const rootInfo = await lstat(canonicalRoot);
				if (!rootInfo.isDirectory()) {
					throw RequestError.invalidParams(
						{ root },
						"Session file system roots must be directories",
					);
				}
				return canonicalRoot;
			}),
		).then((roots) => [...new Set(roots)]);
		try {
			const roots = await session.canonicalRoots;
			throwIfCancelled(signal);
			return roots;
		} catch (error) {
			session.canonicalRoots = undefined;
			throw error;
		}
	}

	private async resolveExistingPath(inputPath: string): Promise<string> {
		try {
			return await realpath(inputPath);
		} catch (error) {
			if (isErrnoException(error) && error.code === "ENOENT") {
				throw RequestError.resourceNotFound(inputPath);
			}
			throw error;
		}
	}

	private assertPathAllowed(
		canonicalPath: string,
		roots: readonly string[],
		requestedPath: string,
	): void {
		if (!roots.some((root) => isPathWithinRoot(canonicalPath, root))) {
			throw RequestError.invalidParams(
				{ path: requestedPath },
				"File system path is outside the active session roots",
			);
		}
	}

	private async createSessionInternal(
		connection: ClientConnection,
		cwd: string,
		additionalDirectories: readonly string[],
	): Promise<NewSessionResponse> {
		const session = this.sanitizeAgentPayload<NewSessionResponse>(
			await connection.agent.request(methods.agent.session.new, {
				cwd,
				mcpServers: [],
				additionalDirectories:
					additionalDirectories.length > 0
						? [...additionalDirectories]
						: undefined,
			}),
			"session/new",
		);
		return session;
	}

	private emitSessionUpdate(notification: SessionNotification) {
		let sanitized: SessionNotification;
		try {
			sanitized = this.sanitizeAgentPayload(notification, "session/update");
		} catch {
			// A malformed non-JSON notification is isolated to this update. The
			// sanitizer has already emitted a bounded, value-free warning.
			return;
		}
		this.sessionUpdateEmitter.emit("update", sanitized);
	}

	/** Strip invalid opaque ACP metadata while retaining the protocol payload. */
	private sanitizeAgentPayload<T>(payload: T, method: string): T {
		const result = sanitizeAcpMessageMeta(payload);
		if (
			(!result.complete || result.rejectedEnvelopes > 0) &&
			this.metaSanitizationWarnings < MAX_META_SANITIZATION_WARNINGS
		) {
			this.metaSanitizationWarnings += 1;
			logger.warn(
				{
					backendId: this.options.backend.id,
					method,
					complete: result.complete,
					rejectedEnvelopes: result.rejectedEnvelopes,
					reasons: result.rejections.map(({ reason }) => reason),
					rejectionsTruncated: result.rejectionsTruncated,
				},
				"acp_metadata_rejected",
			);
		}
		if (!result.complete) {
			throw new Error("ACP agent returned a malformed non-JSON payload");
		}
		return result.value;
	}

	private cleanupSessionResources(sessionId: string, reason: Error): void {
		for (const controller of this.promptControllers.get(sessionId) ?? []) {
			controller.abort(reason);
		}
		this.promptControllers.delete(sessionId);
		for (const [terminalId, record] of this.terminals) {
			if (record.sessionId !== sessionId) {
				continue;
			}
			if (record.process?.exitCode === null) {
				record.process.kill("SIGTERM");
			}
			record.resolveExit?.({ exitCode: null, signal: null });
			this.terminals.delete(terminalId);
		}
	}

	private async handlePermissionRequest(
		params: RequestPermissionRequest,
		requestId: JsonRpcId,
		signal: AbortSignal,
	): Promise<RequestPermissionResponse> {
		const sanitizedParams = this.sanitizeAgentPayload(
			params,
			"session/request_permission",
		);
		if (this.permissionHandler) {
			return this.permissionHandler(sanitizedParams, requestId, signal);
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
