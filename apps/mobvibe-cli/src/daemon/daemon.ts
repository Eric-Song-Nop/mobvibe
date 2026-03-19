import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { base64ToUint8, initCrypto } from "@mobvibe/shared";
import { SessionManager } from "../acp/session-manager.js";
import { getMasterSecret } from "../auth/credentials.js";
import type { CliConfig } from "../config.js";
import { CliCryptoService } from "../e2ee/crypto-service.js";
import { logger } from "../lib/logger.js";
import { WalCompactor, WalStore } from "../wal/index.js";
import { SocketClient } from "./socket-client.js";
import { buildBackgroundSpawnArgs } from "./spawn-utils.js";

type DaemonControlState = {
	logFile: string;
	pid: number;
	port: number;
	startedAt: string;
	token: string;
};

type DaemonStatus = {
	running: boolean;
	pid?: number;
	connected?: boolean;
	sessionCount?: number;
	startedAt?: string;
	logFile?: string;
};

const CONTROL_HOST = "127.0.0.1";
const CONTROL_STATE_FILE = "daemon-state.json";
const CONTROL_WAIT_TIMEOUT_MS = 5000;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const toBearerToken = (token: string) => `Bearer ${token}`;

const readLogSnapshot = async (logFile: string) => {
	try {
		const text = await fs.readFile(logFile, "utf8");
		return {
			cursor: text.length,
			text,
		};
	} catch {
		return {
			cursor: 0,
			text: "",
		};
	}
};

const tailLogLines = async (logFile: string, lines: number) => {
	const snapshot = await readLogSnapshot(logFile);
	const contentLines = snapshot.text.split("\n");
	return {
		cursor: snapshot.cursor,
		text: contentLines.slice(-lines).join("\n"),
	};
};

export class DaemonManager {
	constructor(private readonly config: CliConfig) {}

	async ensureHomeDirectory(): Promise<void> {
		await fs.mkdir(this.config.homePath, { recursive: true });
		await fs.mkdir(this.config.logPath, { recursive: true });
	}

	private getStateFilePath() {
		return path.join(this.config.homePath, CONTROL_STATE_FILE);
	}

	private async readStateFile(): Promise<DaemonControlState | null> {
		try {
			const content = await fs.readFile(this.getStateFilePath(), "utf8");
			return JSON.parse(content) as DaemonControlState;
		} catch {
			return null;
		}
	}

	private async writeStateFile(state: DaemonControlState) {
		await fs.writeFile(
			this.getStateFilePath(),
			JSON.stringify(state, null, 2),
			"utf8",
		);
	}

	private async removeStateFile() {
		try {
			await fs.unlink(this.getStateFilePath());
		} catch {
			// ignore cleanup errors
		}
	}

	async getPid(): Promise<number | null> {
		try {
			const content = await fs.readFile(this.config.pidFile, "utf8");
			const pid = Number.parseInt(content.trim(), 10);
			if (Number.isNaN(pid)) {
				return null;
			}
			process.kill(pid, 0);
			return pid;
		} catch {
			return null;
		}
	}

	async writePidFile(pid: number): Promise<void> {
		await fs.writeFile(this.config.pidFile, String(pid), "utf8");
	}

	async removePidFile(): Promise<void> {
		try {
			await fs.unlink(this.config.pidFile);
		} catch {
			// ignore cleanup errors
		}
	}

	private async cleanupStaleState() {
		await this.removeStateFile();
		await this.removePidFile();
	}

	private async getRunningState(): Promise<DaemonControlState | null> {
		const state = await this.readStateFile();
		if (!state) {
			return null;
		}

		try {
			process.kill(state.pid, 0);
			return state;
		} catch {
			logger.warn({ pid: state.pid }, "daemon_state_stale_cleanup");
			await this.cleanupStaleState();
			return null;
		}
	}

	private async requestControl(
		pathname: string,
		init?: RequestInit,
	): Promise<{
		response: Response;
		state: DaemonControlState;
	} | null> {
		const state = await this.getRunningState();
		if (!state) {
			return null;
		}

		try {
			const response = await fetch(
				`http://${CONTROL_HOST}:${state.port}${pathname}`,
				{
					...init,
					headers: {
						...(init?.headers ?? {}),
						authorization: toBearerToken(state.token),
					},
				},
			);

			if (!response.ok) {
				throw new Error(`Control request failed with ${response.status}`);
			}

			return { response, state };
		} catch (error) {
			logger.warn({ err: error, pathname }, "daemon_control_request_failed");
			try {
				process.kill(state.pid, 0);
			} catch {
				await this.cleanupStaleState();
			}
			return null;
		}
	}

	private async waitForStateFile(expectedPid: number) {
		const start = Date.now();
		while (Date.now() - start < CONTROL_WAIT_TIMEOUT_MS) {
			const state = await this.readStateFile();
			if (state?.pid === expectedPid) {
				return state;
			}
			await wait(100);
		}
		return null;
	}

	async status(): Promise<DaemonStatus> {
		const control = await this.requestControl("/status");
		if (!control) {
			const pid = await this.getPid();
			return pid ? { running: true, pid } : { running: false };
		}

		return (await control.response.json()) as DaemonStatus;
	}

	async start(options?: {
		foreground?: boolean;
		noE2ee?: boolean;
	}): Promise<void> {
		const status = await this.status();
		if (status.running && status.pid) {
			logger.info({ pid: status.pid }, "daemon_already_running");
			return;
		}

		await this.ensureHomeDirectory();

		if (options?.foreground) {
			await this.runForeground({ noE2ee: options.noE2ee });
			return;
		}

		await this.spawnBackground({ noE2ee: options?.noE2ee });
	}

	async stop(): Promise<void> {
		const control = await this.requestControl("/shutdown", {
			method: "POST",
		});

		if (control) {
			logger.info({ pid: control.state.pid }, "daemon_shutdown_requested");
			const start = Date.now();
			while (Date.now() - start < CONTROL_WAIT_TIMEOUT_MS) {
				try {
					process.kill(control.state.pid, 0);
					await wait(100);
				} catch {
					await this.cleanupStaleState();
					logger.info({ pid: control.state.pid }, "daemon_stopped_gracefully");
					return;
				}
			}
		}

		const pid = await this.getPid();
		if (!pid) {
			logger.info("daemon_not_running");
			await this.cleanupStaleState();
			return;
		}

		try {
			logger.warn({ pid }, "daemon_stop_fallback_sigterm");
			process.kill(pid, "SIGTERM");
			await wait(500);
			await this.cleanupStaleState();
		} catch (error) {
			logger.error({ err: error, pid }, "daemon_stop_error");
			await this.cleanupStaleState();
		}
	}

	protected async spawnBackground(options?: {
		noE2ee?: boolean;
	}): Promise<void> {
		const logFile = path.join(
			this.config.logPath,
			`${new Date().toISOString().replace(/[:.]/g, "-")}-daemon.log`,
		);
		const args = buildBackgroundSpawnArgs(
			Bun.argv.length > 0 ? Bun.argv : process.argv,
			options,
		);
		const child = Bun.spawn([process.execPath, ...args], {
			detached: true,
			env: {
				...process.env,
				MOBVIBE_DAEMON_LOG_FILE: logFile,
				MOBVIBE_GATEWAY_URL: this.config.gatewayUrl,
			},
			stdio: ["ignore", Bun.file(logFile), Bun.file(logFile)],
		});

		if (!child.pid) {
			logger.error("daemon_spawn_failed");
			throw new Error("Failed to spawn daemon process");
		}

		child.unref();

		const state = await this.waitForStateFile(child.pid);
		logger.info({ pid: child.pid }, "daemon_started");
		console.log(`Logs: ${state?.logFile ?? logFile}`);
	}

	async runForeground(options?: { noE2ee?: boolean }): Promise<void> {
		const pid = process.pid;
		const startedAt = new Date().toISOString();
		const logFile =
			process.env.MOBVIBE_DAEMON_LOG_FILE ??
			path.join(
				this.config.logPath,
				`${startedAt.replace(/[:.]/g, "-")}-daemon.log`,
			);

		await this.writePidFile(pid);

		logger.info({ pid }, "daemon_starting");
		logger.info({ gatewayUrl: this.config.gatewayUrl }, "daemon_gateway_url");
		logger.info({ machineId: this.config.machineId }, "daemon_machine_id");
		logger.info({ noE2ee: options?.noE2ee === true }, "daemon_e2ee_mode");

		const cryptoService = await this.createRuntimeCryptoService(options);
		logger.info("daemon_crypto_initialized");

		const sessionManager = this.createSessionManager(cryptoService);
		const socketClient = this.createSocketClient(sessionManager, cryptoService);
		const controlToken = randomUUID();

		let compactor: WalCompactor | undefined;
		let compactionInterval: NodeJS.Timeout | undefined;
		let compactorWalStore: WalStore | undefined;
		let compactorDb: Database | undefined;

		if (this.config.compaction.enabled) {
			compactorWalStore = new WalStore(this.config.walDbPath);
			compactorDb = new Database(this.config.walDbPath);
			compactor = new WalCompactor(
				compactorWalStore,
				this.config.compaction,
				compactorDb,
			);

			if (this.config.compaction.runOnStartup) {
				void compactor.compactAll().catch((error) => {
					logger.error({ err: error }, "compaction_startup_error");
				});
			}

			const intervalMs =
				this.config.compaction.runIntervalHours * 60 * 60 * 1000;
			compactionInterval = setInterval(() => {
				void compactor?.compactAll().catch((error) => {
					logger.error({ err: error }, "compaction_scheduled_error");
				});
			}, intervalMs);
		}

		let shuttingDown = false;
		let controlServer: Bun.Server<undefined> | undefined;

		const shutdown = async (signal: string) => {
			if (shuttingDown) {
				logger.warn({ signal }, "daemon_shutdown_already_running");
				return;
			}
			shuttingDown = true;
			logger.info({ signal }, "daemon_shutdown_start");

			if (compactionInterval) {
				clearInterval(compactionInterval);
			}

			compactorWalStore?.close();
			compactorDb?.close();
			socketClient.disconnect();
			await sessionManager.shutdown();
			await controlServer?.stop(true);
			await this.cleanupStaleState();
			logger.info({ signal }, "daemon_shutdown_complete");
			process.exit(0);
		};

		const createLogStream = (startCursor: number) => {
			const encoder = new TextEncoder();
			let interval: NodeJS.Timeout | undefined;
			return new ReadableStream<Uint8Array>({
				start: (controller) => {
					let cursor = startCursor;
					interval = setInterval(() => {
						void (async () => {
							const snapshot = await readLogSnapshot(logFile);
							if (snapshot.cursor < cursor) {
								cursor = 0;
							}
							if (snapshot.cursor > cursor) {
								controller.enqueue(encoder.encode(snapshot.text.slice(cursor)));
								cursor = snapshot.cursor;
							}
						})().catch((error) => {
							controller.error(error);
						});
					}, 500);

					void (async () => {
						const snapshot = await readLogSnapshot(logFile);
						if (startCursor === 0 && snapshot.text.length > 0) {
							controller.enqueue(encoder.encode(snapshot.text));
							cursor = snapshot.cursor;
						}
					})();
				},
				cancel: () => {
					if (interval) {
						clearInterval(interval);
					}
				},
			});
		};

		controlServer = Bun.serve({
			hostname: CONTROL_HOST,
			port: 0,
			fetch: async (request) => {
				const url = new URL(request.url);
				if (
					request.headers.get("authorization") !== toBearerToken(controlToken)
				) {
					return new Response("Unauthorized", { status: 401 });
				}

				if (request.method === "GET" && url.pathname === "/status") {
					return Response.json({
						running: true,
						pid,
						connected: socketClient.isConnected(),
						sessionCount: sessionManager.listAllSessions().length,
						startedAt,
						logFile,
					} satisfies DaemonStatus);
				}

				if (request.method === "POST" && url.pathname === "/shutdown") {
					queueMicrotask(() => {
						void shutdown("control-plane");
					});
					return Response.json({ ok: true });
				}

				if (request.method === "GET" && url.pathname === "/logs") {
					const lineCount = Number.parseInt(
						url.searchParams.get("lines") ?? "50",
						10,
					);
					const snapshot = await tailLogLines(
						logFile,
						Number.isNaN(lineCount) ? 50 : lineCount,
					);
					return new Response(snapshot.text, {
						headers: {
							"content-type": "text/plain; charset=utf-8",
							"x-mobvibe-log-cursor": String(snapshot.cursor),
						},
					});
				}

				if (request.method === "GET" && url.pathname === "/logs/stream") {
					const startCursor = Number.parseInt(
						url.searchParams.get("cursor") ?? "0",
						10,
					);
					return new Response(
						createLogStream(Number.isNaN(startCursor) ? 0 : startCursor),
						{
							headers: {
								"cache-control": "no-cache",
								"content-type": "text/plain; charset=utf-8",
							},
						},
					);
				}

				return new Response("Not found", { status: 404 });
			},
		});
		const controlPort = controlServer.port;
		if (typeof controlPort !== "number") {
			throw new Error("Control server did not bind a local port");
		}

		await this.writeStateFile({
			logFile,
			pid,
			port: controlPort,
			startedAt,
			token: controlToken,
		});

		process.on("SIGINT", () => {
			void shutdown("SIGINT");
		});
		process.on("SIGTERM", () => {
			void shutdown("SIGTERM");
		});

		socketClient.connect();
		await new Promise(() => {});
	}

	protected async createRuntimeCryptoService(options?: {
		noE2ee?: boolean;
	}): Promise<CliCryptoService> {
		await initCrypto();
		const masterSecretBase64 = await getMasterSecret();
		if (!masterSecretBase64) {
			logger.error("daemon_master_secret_missing");
			console.error(
				`[mobvibe-cli] No credentials found. Run 'mobvibe login' to authenticate.`,
			);
			process.exit(1);
		}
		return new CliCryptoService(base64ToUint8(masterSecretBase64), {
			contentEncryptionEnabled: !options?.noE2ee,
		});
	}

	protected createSessionManager(
		cryptoService: CliCryptoService,
	): SessionManager {
		return new SessionManager(this.config, cryptoService);
	}

	protected createSocketClient(
		sessionManager: SessionManager,
		cryptoService: CliCryptoService,
	): SocketClient {
		return new SocketClient({
			config: this.config,
			sessionManager,
			cryptoService,
		});
	}

	private async readLatestLocalLogFile() {
		const files = await fs.readdir(this.config.logPath).catch(() => []);
		const latestLog = files
			.filter((file) => file.endsWith("-daemon.log"))
			.sort()
			.reverse()[0];
		return latestLog ? path.join(this.config.logPath, latestLog) : null;
	}

	async logs(options?: { follow?: boolean; lines?: number }): Promise<void> {
		const requestedLines = options?.lines ?? 50;
		const control = await this.requestControl(`/logs?lines=${requestedLines}`);
		if (control) {
			const cursor = Number.parseInt(
				control.response.headers.get("x-mobvibe-log-cursor") ?? "0",
				10,
			);
			const content = await control.response.text();
			if (content) {
				process.stdout.write(`${content}${content.endsWith("\n") ? "" : "\n"}`);
			}

			if (!options?.follow) {
				return;
			}

			const streamResponse = await this.requestControl(
				`/logs/stream?cursor=${Number.isNaN(cursor) ? 0 : cursor}`,
			);
			if (!streamResponse?.response.body) {
				return;
			}

			const reader = streamResponse.response.body.getReader();
			const decoder = new TextDecoder();
			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					break;
				}
				process.stdout.write(decoder.decode(value, { stream: true }));
			}
			return;
		}

		const latestLog = await this.readLatestLocalLogFile();
		if (!latestLog) {
			logger.warn("daemon_logs_empty");
			console.log("No log files found");
			return;
		}

		const { text } = await tailLogLines(latestLog, requestedLines);
		console.log(text);
		if (options?.follow) {
			console.log("Daemon is not running; live log streaming is unavailable.");
		}
	}
}
