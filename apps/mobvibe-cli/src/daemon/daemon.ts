import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { SessionManager } from "../acp/session-manager.js";
import { getApiKey } from "../auth/credentials.js";
import type { CliConfig } from "../config.js";
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
			console.log(`Daemon already running with PID ${existingPid}`);
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
			console.log("Daemon is not running");
			return;
		}

		// Check if process actually exists
		try {
			process.kill(pid, 0);
		} catch {
			console.log("Daemon process not found, cleaning up PID file");
			await this.removePidFile();
			return;
		}

		try {
			console.log(`Sending SIGTERM to daemon (PID ${pid})...`);
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
					console.log("Daemon stopped gracefully");
					await this.removePidFile();
					return;
				}
			}

			// Process didn't exit gracefully, force kill
			console.log("Daemon did not stop gracefully, sending SIGKILL...");
			try {
				process.kill(pid, "SIGKILL");
				// Wait a bit for SIGKILL to take effect
				await new Promise((resolve) => setTimeout(resolve, 500));
				console.log("Daemon force killed");
			} catch {
				// Already dead
				console.log("Daemon already stopped");
			}
			await this.removePidFile();
		} catch (error) {
			if (error instanceof Error && "code" in error && error.code === "ESRCH") {
				console.log("Daemon process not found, cleaning up PID file");
			} else {
				console.error("Failed to stop daemon:", error);
			}
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

		// Write PID file after setup
		await this.writePidFile(child.pid);

		// Detach from parent
		child.unref();

		console.log(`Daemon started with PID ${child.pid}`);
		console.log(`Logs: ${logFile}`);
	}

	async runForeground(): Promise<void> {
		const pid = process.pid;
		await this.writePidFile(pid);

		console.log(`[mobvibe-cli] Daemon starting (PID ${pid})`);
		console.log(`[mobvibe-cli] Gateway URL: ${this.config.gatewayUrl}`);
		console.log(`[mobvibe-cli] Machine ID: ${this.config.machineId}`);

		// Load API key for authentication
		const apiKey = await getApiKey();
		if (!apiKey) {
			console.error(
				`[mobvibe-cli] No API key found. Run 'mobvibe login' to authenticate.`,
			);
			process.exit(1);
		}
		console.log(`[mobvibe-cli] Authenticated with API key`);

		const sessionManager = new SessionManager(this.config);
		const socketClient = new SocketClient({
			config: this.config,
			sessionManager,
			apiKey,
		});

		let shuttingDown = false;

		const shutdown = async (signal: string) => {
			if (shuttingDown) {
				console.log(`[mobvibe-cli] Already shutting down, ignoring ${signal}`);
				return;
			}
			shuttingDown = true;

			console.log(`\n[mobvibe-cli] Received ${signal}, shutting down...`);

			try {
				socketClient.disconnect();
				await sessionManager.closeAll();
				await this.removePidFile();
				console.log("[mobvibe-cli] Shutdown complete");
			} catch (error) {
				console.error("[mobvibe-cli] Error during shutdown:", error);
			}

			process.exit(0);
		};

		// Use synchronous-style handlers to ensure cleanup completes
		process.on("SIGINT", () => {
			shutdown("SIGINT").catch(console.error);
		});
		process.on("SIGTERM", () => {
			shutdown("SIGTERM").catch(console.error);
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
			console.log("No log files found");
			return;
		}

		const latestLog = path.join(this.config.logPath, logFiles[0]);
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
