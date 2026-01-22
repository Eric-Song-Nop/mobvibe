import { Command } from "commander";
import { getCliConfig } from "./config.js";
import { DaemonManager } from "./daemon/daemon.js";

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
		const config = getCliConfig();
		const daemon = new DaemonManager(config);
		await daemon.start({ foreground: options.foreground });
	});

program
	.command("stop")
	.description("Stop the mobvibe daemon")
	.action(async () => {
		const config = getCliConfig();
		const daemon = new DaemonManager(config);
		await daemon.stop();
	});

program
	.command("status")
	.description("Show daemon status")
	.action(async () => {
		const config = getCliConfig();
		const daemon = new DaemonManager(config);
		const status = await daemon.status();
		if (status.running) {
			console.log(`Daemon is running (PID ${status.pid})`);
			if (status.connected !== undefined) {
				console.log(`Connected to gateway: ${status.connected ? "yes" : "no"}`);
			}
			if (status.sessionCount !== undefined) {
				console.log(`Active sessions: ${status.sessionCount}`);
			}
		} else {
			console.log("Daemon is not running");
		}
	});

program
	.command("logs")
	.description("Show daemon logs")
	.option("-f, --follow", "Follow log output")
	.option("-n, --lines <number>", "Number of lines to show", "50")
	.action(async (options) => {
		const config = getCliConfig();
		const daemon = new DaemonManager(config);
		await daemon.logs({
			follow: options.follow,
			lines: Number.parseInt(options.lines, 10),
		});
	});

export async function run() {
	await program.parseAsync(process.argv);
}

run().catch((error) => {
	console.error("Error:", error.message);
	process.exit(1);
});
