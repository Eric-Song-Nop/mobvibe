import { Database } from "bun:sqlite";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { SessionManager } from "../acp/session-manager.js";
import { getApiKey } from "../auth/credentials.js";
import type { CliConfig } from "../config.js";
import { logger } from "../lib/logger.js";
import { WalCompactor, WalStore } from "../wal/index.js";
import { SocketClient } from "./socket-client.js";

type DaemonStatus = {
	running: boolean;
	pid?: number;
	connected?: boolean;
	sessionCount?: number;
};

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

	async start(options?: { foreground?: boolean }): Promise<void> {
		const existingPid = await this.getPid();
		if (existingPid) {
			logger.info({ pid: existingPid }, "daemon_already_running");
			return;
		}

		await this.ensureHomeDirectory();

		if (options?.foreground) {
			await this.runForeground();
		} else {
			await this.spawnBackground();
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

	private async spawnBackground(): Promise<void> {
		const logFile = path.join(
			this.config.logPath,
			`${new Date().toISOString().replace(/[:.]/g, "-")}-daemon.log`,
		);

		// Filter out --foreground if already present, then add it
		const args = process.argv
			.slice(1)
			.filter((arg) => arg !== "--foreground" && arg !== "-f");
		args.push("--foreground");

		const child = spawn(process.argv[0], args, {
			detached: true,
			stdio: ["ignore", "pipe", "pipe"],
			env: {
				...process.env,
				MOBVIBE_GATEWAY_URL: this.config.gatewayUrl,
			},
		});

		if (!child.pid) {
			logger.error("daemon_spawn_failed");
			throw new Error("Failed to spawn daemon process");
		}

		// Create log file stream before writing PID
		const logStream = await fs.open(logFile, "a");
		const fileHandle = logStream;

		child.stdout?.on("data", (data: Buffer) => {
			fileHandle.write(`[stdout] ${data.toString()}`).catch(() => {});
		});

		child.stderr?.on("data", (data: Buffer) => {
			fileHandle.write(`[stderr] ${data.toString()}`).catch(() => {});
		});

		// Handle child exit to clean up
		child.on("exit", (code, signal) => {
			fileHandle
				.write(`[exit] Process exited with code ${code}, signal ${signal}\n`)
				.catch(() => {});
			fileHandle.close().catch(() => {});
		});

		// Detach from parent
		// Note: The child process writes its own PID file in runForeground()
		child.unref();

		logger.info({ pid: child.pid }, "daemon_started");
		console.log(`Logs: ${logFile}`);
		logger.info({ logFile }, "daemon_log_path");
	}

	async runForeground(): Promise<void> {
		const pid = process.pid;
		await this.writePidFile(pid);

		logger.info({ pid }, "daemon_starting");
		logger.info({ gatewayUrl: this.config.gatewayUrl }, "daemon_gateway_url");
		logger.info({ machineId: this.config.machineId }, "daemon_machine_id");

		// Load API key for authentication
		const apiKey = await getApiKey();
		if (!apiKey) {
			logger.error("daemon_api_key_missing");
			console.error(
				`[mobvibe-cli] No API key found. Run 'mobvibe login' to authenticate.`,
			);
			logger.warn("daemon_exit_missing_api_key");
			process.exit(1);
		}
		logger.info("daemon_api_key_loaded");

		const sessionManager = new SessionManager(this.config);
		const socketClient = new SocketClient({
			config: this.config,
			sessionManager,
			apiKey,
		});

		// Initialize compactor if enabled
		let compactor: WalCompactor | undefined;
		let compactionInterval: NodeJS.Timeout | undefined;
		// P1-2: Track compactor resources for cleanup on shutdown
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

			// Run compaction on startup
			if (this.config.compaction.runOnStartup) {
				logger.info("compaction_startup_start");
				compactor.compactAll().catch((error) => {
					logger.error({ err: error }, "compaction_startup_error");
				});
			}

			// Schedule periodic compaction
			const intervalMs =
				this.config.compaction.runIntervalHours * 60 * 60 * 1000;
			compactionInterval = setInterval(() => {
				logger.info("compaction_scheduled_start");
				compactor?.compactAll().catch((error) => {
					logger.error({ err: error }, "compaction_scheduled_error");
				});
			}, intervalMs);

			logger.info(
				{ intervalHours: this.config.compaction.runIntervalHours },
				"compaction_scheduled",
			);
		}

		let shuttingDown = false;

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

				// P1-2: Close compactor resources to prevent connection leak
				if (compactorWalStore) {
					compactorWalStore.close();
				}
				if (compactorDb) {
					compactorDb.close();
				}

				socketClient.disconnect();
				await sessionManager.shutdown();
				await this.removePidFile();
				logger.info({ signal }, "daemon_shutdown_complete");
			} catch (error) {
				logger.error({ err: error, signal }, "daemon_shutdown_error");
			}
		};

		process.on("SIGINT", () => {
			shutdown("SIGINT").catch((error) => {
				logger.error({ err: error }, "daemon_shutdown_sigint_error");
			});
		});
		process.on("SIGTERM", () => {
			shutdown("SIGTERM").catch((error) => {
				logger.error({ err: error }, "daemon_shutdown_sigterm_error");
			});
		});

		socketClient.connect();

		// Keep process alive
		await new Promise(() => {});
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
