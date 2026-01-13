import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Readable, Writable } from "node:stream";
import {
	ClientSideConnection,
	PROTOCOL_VERSION,
	ndJsonStream,
	type Client,
} from "@agentclientprotocol/sdk";

type ClientInfo = {
	name: string;
	version: string;
};

export type OpencodeConnectionState =
	| "idle"
	| "connecting"
	| "ready"
	| "error"
	| "stopped";

export type OpencodeStatus = {
	state: OpencodeConnectionState;
	command: string;
	args: string[];
	connectedAt?: string;
	lastError?: string;
	sessionId?: string;
	pid?: number;
};

const getErrorMessage = (error: unknown) => {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
};

const buildClient = (): Client => ({
	async requestPermission() {
		return { outcome: { outcome: "cancelled" } };
	},
	async sessionUpdate() {},
});

const formatExitMessage = (
	code: number | null,
	signal: NodeJS.Signals | null,
) => {
	if (signal) {
		return `opencode exited with signal ${signal}`;
	}
	if (code !== null) {
		return `opencode exited with code ${code}`;
	}
	return "opencode exited";
};

export class OpencodeConnection {
	private connection?: ClientSideConnection;
	private process?: ChildProcessWithoutNullStreams;
	private closedPromise?: Promise<void>;
	private state: OpencodeConnectionState = "idle";
	private connectedAt?: Date;
	private lastError?: string;
	private sessionId?: string;

	constructor(
		private readonly options: {
			command: string;
			args: string[];
			client: ClientInfo;
		},
	) {}

	getStatus(): OpencodeStatus {
		return {
			state: this.state,
			command: this.options.command,
			args: [...this.options.args],
			connectedAt: this.connectedAt?.toISOString(),
			lastError: this.lastError,
			sessionId: this.sessionId,
			pid: this.process?.pid,
		};
	}

	async connect(): Promise<void> {
		if (this.state === "connecting" || this.state === "ready") {
			return;
		}

		this.state = "connecting";
		this.lastError = undefined;

		try {
			const child = spawn(this.options.command, this.options.args, {
				stdio: ["pipe", "pipe", "inherit"],
			});
			this.process = child;

			const input = Writable.toWeb(child.stdin);
			const output = Readable.toWeb(child.stdout);
			const stream = ndJsonStream(input, output);
			const connection = new ClientSideConnection(buildClient, stream);
			this.connection = connection;

			child.once("error", (error) => {
				if (this.state === "stopped") {
					return;
				}
				this.state = "error";
				this.lastError = getErrorMessage(error);
			});

			child.once("exit", (code, signal) => {
				if (this.state === "stopped") {
					return;
				}
				this.state = "error";
				this.lastError = formatExitMessage(code, signal);
			});

			this.closedPromise = connection.closed.catch((error) => {
				this.state = "error";
				this.lastError = getErrorMessage(error);
			});

			await connection.initialize({
				protocolVersion: PROTOCOL_VERSION,
				clientInfo: {
					name: this.options.client.name,
					version: this.options.client.version,
				},
				clientCapabilities: {},
			});

			const session = await connection.newSession({
				cwd: process.cwd(),
				mcpServers: [],
			});

			this.sessionId = session.sessionId;
			this.connectedAt = new Date();
			this.state = "ready";
		} catch (error) {
			this.state = "error";
			this.lastError = getErrorMessage(error);
			await this.stopProcess();
			throw error;
		}
	}

	async disconnect(): Promise<void> {
		if (this.state === "stopped") {
			return;
		}

		this.state = "stopped";
		this.sessionId = undefined;
		await this.stopProcess();
		await this.closedPromise;
		this.connection = undefined;
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
