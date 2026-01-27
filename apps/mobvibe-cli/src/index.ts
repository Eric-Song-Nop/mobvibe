import { Command } from "commander";
import { login, loginStatus, logout } from "./auth/login.js";
import { getCliConfig } from "./config.js";
import { DaemonManager } from "./daemon/daemon.js";
import { logger } from "./lib/logger.js";

const program = new Command();

program
	.name("mobvibe")
	.description("Mobvibe CLI - Connect local ACP backends to the gateway")
	.version("0.0.0");

program
	.command("start")
	.description("Start the mobvibe daemon")
	.option("--gateway <url>", "Gateway URL", process.env.MOBVIBE_GATEWAY_URL)
	.option("--foreground", "Run in foreground instead of detaching")
	.action(async (options) => {
		if (options.gateway) {
			process.env.MOBVIBE_GATEWAY_URL = options.gateway;
		}
		const config = await getCliConfig();
		const daemon = new DaemonManager(config);
		await daemon.start({ foreground: options.foreground });
	});

program
	.command("stop")
	.description("Stop the mobvibe daemon")
	.action(async () => {
		const config = await getCliConfig();
		const daemon = new DaemonManager(config);
		await daemon.stop();
	});

program
	.command("status")
	.description("Show daemon status")
	.action(async () => {
		const config = await getCliConfig();
		const daemon = new DaemonManager(config);
		const status = await daemon.status();
		if (status.running) {
			logger.info({ pid: status.pid }, "daemon_status_running");
			console.log(`Daemon is running (PID ${status.pid})`);
			if (status.connected !== undefined) {
				console.log(`Connected to gateway: ${status.connected ? "yes" : "no"}`);
			}
			if (status.sessionCount !== undefined) {
				console.log(`Active sessions: ${status.sessionCount}`);
			}
		} else {
			logger.info("daemon_status_not_running");
			console.log("Daemon is not running");
		}
	});

program
	.command("logs")
	.description("Show daemon logs")
	.option("-f, --follow", "Follow log output")
	.option("-n, --lines <number>", "Number of lines to show", "50")
	.action(async (options) => {
		const config = await getCliConfig();
		const daemon = new DaemonManager(config);
		await daemon.logs({
			follow: options.follow,
			lines: Number.parseInt(options.lines, 10),
		});
	});

program
	.command("login")
	.description("Authenticate with an API key from the WebUI")
	.action(async () => {
		const result = await login();
		if (!result.success) {
			logger.error({ err: result.error }, "login_failed");
			console.error(`Login failed: ${result.error}`);
			process.exit(1);
		}
	});

program
	.command("logout")
	.description("Remove stored credentials")
	.action(async () => {
		await logout();
	});

program
	.command("auth-status")
	.description("Show authentication status")
	.action(async () => {
		await loginStatus();
	});

export async function run() {
	await program.parseAsync(process.argv);
}

run().catch((error) => {
	logger.error({ err: error }, "cli_run_error");
	console.error("Error:", error.message);
	process.exit(1);
});
