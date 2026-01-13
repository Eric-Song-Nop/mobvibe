import { Client } from "@agent-client-protocol/sdk/client/index.js";
import { StdioClientTransport } from "@agent-client-protocol/sdk/client/stdio.js";

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
};

const getErrorMessage = (error: unknown) => {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
};

const closeClientIfSupported = async (client: Client | undefined) => {
	if (!client) {
		return;
	}

	const closable = client as {
		close?: () => Promise<void>;
		disconnect?: () => Promise<void>;
	};

	if (typeof closable.close === "function") {
		await closable.close();
		return;
	}

	if (typeof closable.disconnect === "function") {
		await closable.disconnect();
	}
};

export class OpencodeConnection {
	private client?: Client;
	private transport?: StdioClientTransport;
	private state: OpencodeConnectionState = "idle";
	private connectedAt?: Date;
	private lastError?: string;

	constructor(
		private readonly options: {
			command: string;
			args: string[];
			client: ClientInfo;
		}
	) {}

	getStatus(): OpencodeStatus {
		return {
			state: this.state,
			command: this.options.command,
			args: [...this.options.args],
			connectedAt: this.connectedAt?.toISOString(),
			lastError: this.lastError
		};
	}

	async connect(): Promise<void> {
		if (this.state === "connecting" || this.state === "ready") {
			return;
		}

		this.state = "connecting";
		this.lastError = undefined;

		try {
			this.transport = new StdioClientTransport({
				command: this.options.command,
				args: this.options.args
			});

			this.client = new Client(
				{
					name: this.options.client.name,
					version: this.options.client.version
				},
				{
					capabilities: {}
				}
			);

			await this.client.connect(this.transport);
			this.connectedAt = new Date();
			this.state = "ready";
		} catch (error) {
			this.state = "error";
			this.lastError = getErrorMessage(error);
			throw error;
		}
	}

	async disconnect(): Promise<void> {
		if (this.state === "stopped") {
			return;
		}

		await closeClientIfSupported(this.client);
		this.client = undefined;
		this.transport = undefined;
		this.state = "stopped";
	}
}
