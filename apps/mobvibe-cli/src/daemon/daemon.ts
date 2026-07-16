import { Database } from "bun:sqlite";
import { spawn } from "node:child_process";
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

type DaemonStatus = {
	running: boolean;
	pid?: number;
	connected?: boolean;
	sessionCount?: number;
};

const COMPACTION_SHUTDOWN_TIMEOUT_MS = 4_000;

export class DaemonManager {
	constructor(private readonly config: CliConfig) {}

	async ensureHomeDirectory(): Promise<void> {
		await fs.mkdir(this.config.homePath, { recursive: true });
		await fs.mkdir(this.config.logPath, { recursive: true });
	}

	async getPid(): Promise<number | null> {
		try {
			const content = await fs.readFile(this.config.pidFile, "utf8");
			const pid = Number.parseInt(content.trim(), 10);
			if (Number.isNaN(pid)) {
				return null;
			}
			// Check if process is running
			try {
				process.kill(pid, 0);
				return pid;
			} catch {
				// Process not running, clean up stale PID file
				await this.removePidFile();
				return null;
			}
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
			// Ignore errors
		}
	}

	async status(): Promise<DaemonStatus> {
		const pid = await this.getPid();
		if (!pid) {
			return { running: false };
		}
		return { running: true, pid };
	}

	async start(options?: {
		foreground?: boolean;
		noE2ee?: boolean;
	}): Promise<void> {
		const existingPid = await this.getPid();
		if (existingPid) {
			logger.info({ pid: existingPid }, "daemon_already_running");
			return;
		}

		await this.ensureHomeDirectory();

		if (options?.foreground) {
			await this.runForeground({ noE2ee: options.noE2ee });
		} else {
			await this.spawnBackground({ noE2ee: options?.noE2ee });
		}
	}

	async stop(): Promise<void> {
		const pid = await this.getPid();
		if (!pid) {
			logger.info("daemon_not_running");
			return;
		}

		// Check if process actually exists
		try {
			process.kill(pid, 0);
		} catch {
			logger.warn("daemon_pid_missing_cleanup");
			await this.removePidFile();
			return;
		}

		try {
			logger.info({ pid }, "daemon_stop_sigterm");
			process.kill(pid, "SIGTERM");

			// Wait for process to exit (up to 5 seconds)
			const startTime = Date.now();
			const timeout = 5000;

			while (Date.now() - startTime < timeout) {
				await new Promise((resolve) => setTimeout(resolve, 100));
				try {
					process.kill(pid, 0);
					// Process still running
				} catch {
					// Process exited
					logger.info({ pid }, "daemon_stopped_gracefully");
					await this.removePidFile();
					return;
				}
			}

			// Process didn't exit gracefully, force kill
			logger.warn({ pid }, "daemon_force_kill_start");
			try {
				process.kill(pid, "SIGKILL");
				// Wait a bit for SIGKILL to take effect
				await new Promise((resolve) => setTimeout(resolve, 500));
				logger.warn({ pid }, "daemon_force_kill_complete");
			} catch {
				// Already dead
				logger.info({ pid }, "daemon_already_stopped");
			}
			await this.removePidFile();
		} catch (error) {
			logger.error({ err: error }, "daemon_stop_error");
			await this.removePidFile();
		}
	}

	protected async spawnBackground(options?: {
		noE2ee?: boolean;
	}): Promise<void> {
		const logFile = path.join(
			this.config.logPath,
			`${new Date().toISOString().replace(/[:.]/g, "-")}-daemon.log`,
		);

		const args = buildBackgroundSpawnArgs(process.argv, options);

		// Open log file for direct stdio redirection (no pipe, parent can exit immediately)
		const logFd = await fs.open(logFile, "a");

		const child = spawn(process.execPath, args, {
			detached: true,
			stdio: ["ignore", logFd.fd, logFd.fd],
			env: {
				...process.env,
				MOBVIBE_GATEWAY_URL: this.config.gatewayUrl,
			},
		});

		if (!child.pid) {
			logger.error("daemon_spawn_failed");
			throw new Error("Failed to spawn daemon process");
		}

		// Close parent's fd reference (child has duplicated it)
		await logFd.close();

		// Detach from parent - no event listeners needed since stdio is directly redirected
		// Note: The child process writes its own PID file in runForeground()
		child.unref();

		logger.info({ pid: child.pid }, "daemon_started");
		console.log(`Logs: ${logFile}`);
		logger.info({ logFile }, "daemon_log_path");
	}

	async runForeground(options?: { noE2ee?: boolean }): Promise<void> {
		const pid = process.pid;
		await this.writePidFile(pid);

		logger.info({ pid }, "daemon_starting");
		logger.info({ gatewayUrl: this.config.gatewayUrl }, "daemon_gateway_url");
		logger.info({ machineId: this.config.machineId }, "daemon_machine_id");
		logger.info({ noE2ee: options?.noE2ee === true }, "daemon_e2ee_mode");

		const cryptoService = await this.createRuntimeCryptoService(options);
		logger.info("daemon_crypto_initialized");

		const sessionManager = this.createSessionManager(cryptoService);
		const socketClient = this.createSocketClient(sessionManager, cryptoService);

		// Initialize compactor if enabled
		let compactor: WalCompactor | undefined;
		let compactionInterval: NodeJS.Timeout | undefined;
		// P1-2: Track compactor resources for cleanup on shutdown
		let compactorWalStore: WalStore | undefined;
		let compactorDb: Database | undefined;
		let compactorResourcesClosed = false;
		const closeCompactorResources = () => {
			if (compactorResourcesClosed) return;
			compactorResourcesClosed = true;
			try {
				compactorWalStore?.close();
			} catch (error) {
				logger.error({ err: error }, "compactor_wal_store_close_error");
			}
			try {
				compactorDb?.close();
			} catch (error) {
				logger.error({ err: error }, "compactor_db_close_error");
			}
		};
		const compactionRuns = new Set<Promise<unknown>>();
		const startCompaction = (source: "startup" | "scheduled") => {
			if (!compactor) return;
			let run: Promise<unknown>;
			try {
				run = compactor.compactAll();
			} catch (error) {
				logger.error({ err: error }, `compaction_${source}_error`);
				return;
			}
			compactionRuns.add(run);
			void run.then(
				() => {
					compactionRuns.delete(run);
				},
				(error) => {
					compactionRuns.delete(run);
					logger.error({ err: error }, `compaction_${source}_error`);
				},
			);
		};

		if (this.config.compaction.enabled) {
			compactorWalStore = new WalStore(this.config.walDbPath);
			compactorDb = new Database(this.config.walDbPath);
			compactor = this.createWalCompactor(
				compactorWalStore,
				this.config.compaction,
				compactorDb,
			);

			// Run compaction on startup
			if (this.config.compaction.runOnStartup) {
				logger.info("compaction_startup_start");
				startCompaction("startup");
			}

			// Schedule periodic compaction
			const intervalMs =
				this.config.compaction.runIntervalHours * 60 * 60 * 1000;
			compactionInterval = setInterval(() => {
				logger.info("compaction_scheduled_start");
				startCompaction("scheduled");
			}, intervalMs);

			logger.info(
				{ intervalHours: this.config.compaction.runIntervalHours },
				"compaction_scheduled",
			);
		}

		let shuttingDown = false;
		let resolveShutdown: () => void = () => {};
		const shutdownComplete = new Promise<void>((resolve) => {
			resolveShutdown = resolve;
		});

		const shutdown = async (signal: string) => {
			if (shuttingDown) {
				logger.warn({ signal }, "daemon_shutdown_already_running");
				return;
			}
			shuttingDown = true;

			logger.info({ signal }, "daemon_shutdown_start");

			try {
				// Stop compaction interval
				if (compactionInterval) {
					clearInterval(compactionInterval);
				}
				const pendingCompactions = Array.from(compactionRuns);
				if (pendingCompactions.length > 0) {
					logger.info(
						{ count: pendingCompactions.length },
						"compaction_shutdown_wait",
					);
					const allCompactionsSettled = Promise.allSettled(pendingCompactions);
					let timeoutId: NodeJS.Timeout | undefined;
					const completedWithinDeadline = await Promise.race([
						allCompactionsSettled.then(() => true),
						new Promise<false>((resolve) => {
							timeoutId = setTimeout(
								() => resolve(false),
								this.getCompactionShutdownTimeoutMs(),
							);
						}),
					]);
					if (timeoutId) clearTimeout(timeoutId);
					if (!completedWithinDeadline) {
						logger.warn(
							{
								count: pendingCompactions.length,
								timeoutMs: this.getCompactionShutdownTimeoutMs(),
							},
							"compaction_shutdown_timeout",
						);
						void allCompactionsSettled.then(closeCompactorResources);
					} else {
						closeCompactorResources();
					}
				} else {
					closeCompactorResources();
				}

				socketClient.disconnect();
				await sessionManager.shutdown();
				await this.removePidFile();
				logger.info({ signal }, "daemon_shutdown_complete");
			} catch (error) {
				logger.error({ err: error, signal }, "daemon_shutdown_error");
			} finally {
				resolveShutdown();
			}
		};

		const handleSigint = () => {
			shutdown("SIGINT").catch((error) => {
				logger.error({ err: error }, "daemon_shutdown_sigint_error");
			});
		};
		const handleSigterm = () => {
			shutdown("SIGTERM").catch((error) => {
				logger.error({ err: error }, "daemon_shutdown_sigterm_error");
			});
		};

		process.on("SIGINT", handleSigint);
		process.on("SIGTERM", handleSigterm);

		try {
			socketClient.connect();
			await shutdownComplete;
		} catch (error) {
			await shutdown("startup_error");
			throw error;
		} finally {
			process.off("SIGINT", handleSigint);
			process.off("SIGTERM", handleSigterm);
		}
	}

	protected getCompactionShutdownTimeoutMs(): number {
		return COMPACTION_SHUTDOWN_TIMEOUT_MS;
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
			logger.warn("daemon_exit_missing_master_secret");
			process.exit(1);
		}
		const masterSecret = base64ToUint8(masterSecretBase64);
		return new CliCryptoService(masterSecret, {
			contentEncryptionEnabled: !options?.noE2ee,
		});
	}

	protected createSessionManager(
		cryptoService: CliCryptoService,
	): SessionManager {
		return new SessionManager(this.config, cryptoService);
	}

	protected createWalCompactor(
		walStore: WalStore,
		config: CliConfig["compaction"],
		db: Database,
	): WalCompactor {
		return new WalCompactor(walStore, config, db);
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

	async logs(options?: { follow?: boolean; lines?: number }): Promise<void> {
		const files = await fs.readdir(this.config.logPath);
		const logFiles = files
			.filter((f) => f.endsWith("-daemon.log"))
			.sort()
			.reverse();

		if (logFiles.length === 0) {
			logger.warn("daemon_logs_empty");
			console.log("No log files found");
			return;
		}

		const latestLog = path.join(this.config.logPath, logFiles[0]);
		logger.info({ logFile: latestLog }, "daemon_logs_latest");
		console.log(`Log file: ${latestLog}\n`);

		if (options?.follow) {
			// Use tail -f
			const tail = spawn("tail", ["-f", latestLog], {
				stdio: "inherit",
			});
			await new Promise<void>((resolve) => {
				tail.on("close", () => resolve());
			});
		} else {
			const content = await fs.readFile(latestLog, "utf8");
			const lines = content.split("\n");
			const count = options?.lines ?? 50;
			console.log(lines.slice(-count).join("\n"));
		}
	}
}
