import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { SessionManager } from "../acp/session-manager.js";
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

		try {
			process.kill(pid, "SIGTERM");
			console.log(`Sent SIGTERM to daemon (PID ${pid})`);

			// Wait for process to exit
			let attempts = 0;
			while (attempts < 30) {
				try {
					process.kill(pid, 0);
					await new Promise((resolve) => setTimeout(resolve, 100));
					attempts++;
				} catch {
					// Process exited
					console.log("Daemon stopped");
					await this.removePidFile();
					return;
				}
			}

			// Force kill if still running
			try {
				process.kill(pid, "SIGKILL");
				console.log("Daemon force killed");
			} catch {
				// Already dead
			}
			await this.removePidFile();
		} catch (error) {
			console.error("Failed to stop daemon:", error);
			await this.removePidFile();
		}
	}

	private async spawnBackground(): Promise<void> {
		const logFile = path.join(
			this.config.logPath,
			`${new Date().toISOString().replace(/[:.]/g, "-")}-daemon.log`,
		);

		const child = spawn(
			process.argv[0],
			[...process.argv.slice(1), "--foreground"],
			{
				detached: true,
				stdio: ["ignore", "pipe", "pipe"],
				env: {
					...process.env,
					MOBVIBE_GATEWAY_URL: this.config.gatewayUrl,
				},
			},
		);

		if (!child.pid) {
			throw new Error("Failed to spawn daemon process");
		}

		// Write PID file immediately
		await this.writePidFile(child.pid);

		// Create log file stream
		const logStream = await fs.open(logFile, "a");
		const fileHandle = logStream;

		child.stdout?.on("data", async (data) => {
			await fileHandle.write(`[stdout] ${data}`);
		});

		child.stderr?.on("data", async (data) => {
			await fileHandle.write(`[stderr] ${data}`);
		});

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

		const sessionManager = new SessionManager(this.config);
		const socketClient = new SocketClient({
			config: this.config,
			sessionManager,
		});

		const shutdown = async (signal: string) => {
			console.log(`\n[mobvibe-cli] Received ${signal}, shutting down...`);
			socketClient.disconnect();
			await sessionManager.closeAll();
			await this.removePidFile();
			process.exit(0);
		};

		process.on("SIGINT", () => void shutdown("SIGINT"));
		process.on("SIGTERM", () => void shutdown("SIGTERM"));

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
