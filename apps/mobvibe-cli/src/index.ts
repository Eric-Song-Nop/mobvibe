import { Database } from "bun:sqlite";
import { loadCredentials } from "./auth/credentials.js";
import { login, loginStatus, logout } from "./auth/login.js";
import { getCliConfig } from "./config.js";
import { saveUserConfig } from "./config-loader.js";
import { DaemonManager } from "./daemon/daemon.js";
import { logger } from "./lib/logger.js";
import { resolveSelectedAgents } from "./registry/agent-detector.js";
import { WalCompactor, WalStore } from "./wal/index.js";

const VERSION = "0.0.0";

const ROOT_HELP = `Mobvibe CLI - Connect local ACP backends to the gateway

Usage:
  mobvibe <command> [options]

Commands:
  start [--gateway <url>] [--foreground] [--no-e2ee]
  stop
  status
  logs [-f|--follow] [-n|--lines <number>]
  login
  logout
  auth-status
  e2ee <show|status>
  compact [--session <id>] [--dry-run] [-v|--verbose]

Global options:
  --help
  --version`;

const START_HELP = `Usage:
  mobvibe start [--gateway <url>] [--foreground] [--no-e2ee]`;

const LOGS_HELP = `Usage:
  mobvibe logs [-f|--follow] [-n|--lines <number>]`;

const E2EE_HELP = `Usage:
  mobvibe e2ee <show|status>`;

const COMPACT_HELP = `Usage:
  mobvibe compact [--session <id>] [--dry-run] [-v|--verbose]`;

const fail = (message: string): never => {
	console.error(message);
	process.exit(1);
};

const showAndExit = (text: string) => {
	console.log(text);
	process.exit(0);
};

const parseFlagValue = (args: string[], index: number, flag: string) => {
	const value = args[index + 1];
	if (!value || value.startsWith("-")) {
		fail(`Missing value for ${flag}`);
	}
	return value;
};

const parseStartArgs = (args: string[]) => {
	let foreground = false;
	let gateway: string | undefined;
	let noE2ee = false;

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		switch (arg) {
			case "--foreground":
				foreground = true;
				break;
			case "--gateway":
				gateway = parseFlagValue(args, index, "--gateway");
				index += 1;
				break;
			case "--no-e2ee":
				noE2ee = true;
				break;
			case "--help":
				showAndExit(START_HELP);
				break;
			default:
				fail(`Unknown option for start: ${arg}`);
		}
	}

	return {
		foreground,
		gateway,
		noE2ee,
	};
};

const parseLogsArgs = (args: string[]) => {
	let follow = false;
	let lines = 50;

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		switch (arg) {
			case "-f":
			case "--follow":
				follow = true;
				break;
			case "-n":
			case "--lines": {
				const raw = parseFlagValue(args, index, arg);
				const parsed = Number.parseInt(raw, 10);
				if (Number.isNaN(parsed) || parsed <= 0) {
					fail(`Invalid line count: ${raw}`);
				}
				lines = parsed;
				index += 1;
				break;
			}
			case "--help":
				showAndExit(LOGS_HELP);
				break;
			default:
				fail(`Unknown option for logs: ${arg}`);
		}
	}

	return {
		follow,
		lines,
	};
};

const parseCompactArgs = (args: string[]) => {
	let dryRun = false;
	let session: string | undefined;
	let verbose = false;

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		switch (arg) {
			case "--session":
				session = parseFlagValue(args, index, "--session");
				index += 1;
				break;
			case "--dry-run":
				dryRun = true;
				break;
			case "-v":
			case "--verbose":
				verbose = true;
				break;
			case "--help":
				showAndExit(COMPACT_HELP);
				break;
			default:
				fail(`Unknown option for compact: ${arg}`);
		}
	}

	return {
		dryRun,
		session,
		verbose,
	};
};

const promptAgentSelection = async (
	config: Awaited<ReturnType<typeof getCliConfig>>,
) => {
	if (config.enabledAgents !== undefined || !process.stdout.isTTY) {
		return config;
	}

	if (config.registryAgents.length === 0) {
		return config;
	}

	console.log("Welcome to Mobvibe!");
	console.log("Select agents to enable on first run:");
	for (const [index, agent] of config.registryAgents.entries()) {
		console.log(
			`  ${index + 1}. ${agent.name} (${agent.id})${agent.description ? ` - ${agent.description}` : ""}`,
		);
	}

	const answer = prompt(
		"Enter agent numbers or ids separated by commas. Leave blank for none.",
	);
	if (answer === null) {
		console.log("Setup cancelled.");
		process.exit(0);
	}

	const tokens = answer
		.split(",")
		.map((token) => token.trim())
		.filter(Boolean);
	const selectedIds = tokens
		.map((token) => {
			const asIndex = Number.parseInt(token, 10);
			if (!Number.isNaN(asIndex) && asIndex >= 1) {
				return config.registryAgents[asIndex - 1]?.id;
			}
			return config.registryAgents.find((agent) => agent.id === token)?.id;
		})
		.filter((value): value is string => Boolean(value));

	const { resolved, failed } = resolveSelectedAgents(
		config.registryAgents,
		selectedIds,
	);

	for (const agent of failed) {
		logger.warn(
			`Agent "${agent.name}" cannot be resolved — binary not in PATH, or npx/uvx unavailable. Skipping.`,
		);
	}

	const enabledIds = resolved.map((backend) => backend.id);
	await saveUserConfig(config.homePath, {
		enabledAgents: enabledIds,
	});

	return {
		...config,
		acpBackends: resolved,
		enabledAgents: enabledIds,
	};
};

const runStart = async (args: string[]) => {
	const options = parseStartArgs(args);
	if (options.gateway) {
		process.env.MOBVIBE_GATEWAY_URL = options.gateway;
	}

	let config = await getCliConfig();
	config = await promptAgentSelection(config);

	const daemon = new DaemonManager(config);
	await daemon.start({
		foreground: options.foreground,
		noE2ee: options.noE2ee,
	});
};

const runStatus = async () => {
	const config = await getCliConfig();
	const daemon = new DaemonManager(config);
	const status = await daemon.status();
	if (!status.running) {
		console.log("Daemon is not running");
		return;
	}

	console.log(`Daemon is running (PID ${status.pid})`);
	if (status.connected !== undefined) {
		console.log(`Connected to gateway: ${status.connected ? "yes" : "no"}`);
	}
	if (status.sessionCount !== undefined) {
		console.log(`Active sessions: ${status.sessionCount}`);
	}
	if (status.startedAt) {
		console.log(`Started at: ${new Date(status.startedAt).toLocaleString()}`);
	}
	if (status.logFile) {
		console.log(`Log file: ${status.logFile}`);
	}
};

const runLogs = async (args: string[]) => {
	const options = parseLogsArgs(args);
	const config = await getCliConfig();
	const daemon = new DaemonManager(config);
	await daemon.logs(options);
};

const runLogin = async () => {
	const result = await login();
	if (!result.success) {
		logger.error({ err: result.error }, "login_failed");
		console.error(`Login failed: ${result.error}`);
		process.exit(1);
	}
};

const runE2ee = async (args: string[]) => {
	const subcommand = args[0];
	if (!subcommand || subcommand === "--help") {
		showAndExit(E2EE_HELP);
	}

	switch (subcommand) {
		case "show": {
			const credentials = await loadCredentials();
			const maybeMasterSecret = credentials?.masterSecret;
			const masterSecret =
				maybeMasterSecret ?? fail("Not logged in. Run 'mobvibe login' first.");

			const base64url = masterSecret
				.replace(/\+/g, "-")
				.replace(/\//g, "_")
				.replace(/=+$/, "");
			const pairingUrl = `mobvibe://pair?secret=${base64url}`;
			const QRCode = await import("qrcode");
			const qrText = await QRCode.toString(pairingUrl, {
				type: "terminal",
				small: true,
			});
			console.log(qrText);
			console.log("Master secret (for pairing WebUI/Tauri devices):");
			console.log(`  ${masterSecret}`);
			console.log(
				"\nScan the QR code with your phone, or paste the secret into WebUI Settings > E2EE > Pair.",
			);
			return;
		}
		case "status": {
			const {
				base64ToUint8,
				deriveAuthKeyPair,
				deriveContentKeyPair,
				initCrypto,
				uint8ToBase64,
			} = await import("@mobvibe/shared");
			const credentials = await loadCredentials();
			if (!credentials) {
				console.log("Status: Not logged in");
				console.log("Run 'mobvibe login' to authenticate.");
				return;
			}
			await initCrypto();
			const masterSecret = base64ToUint8(credentials.masterSecret);
			const authKp = deriveAuthKeyPair(masterSecret);
			const contentKp = deriveContentKeyPair(masterSecret);
			console.log("Status: E2EE enabled");
			console.log(
				`Auth public key:    ${uint8ToBase64(authKp.publicKey).slice(0, 16)}...`,
			);
			console.log(
				`Content public key: ${uint8ToBase64(contentKp.publicKey).slice(0, 16)}...`,
			);
			console.log(`Saved: ${new Date(credentials.createdAt).toLocaleString()}`);
			return;
		}
		default:
			fail(`Unknown e2ee command: ${subcommand}`);
	}
};

const runCompact = async (args: string[]) => {
	const options = parseCompactArgs(args);
	const config = await getCliConfig();

	if (!config.compaction.enabled && !options.dryRun) {
		console.log("Compaction is disabled in configuration.");
		console.log("Set MOBVIBE_COMPACTION_ENABLED=true to enable.");
		return;
	}

	const walStore = new WalStore(config.walDbPath);
	const db = new Database(config.walDbPath);
	const compactor = new WalCompactor(walStore, config.compaction, db);

	console.log(
		options.dryRun
			? "Dry run - no changes will be made"
			: "Starting compaction...",
	);

	try {
		if (options.session) {
			const stats = await compactor.compactSession(options.session, {
				dryRun: options.dryRun,
			});
			console.log(`Session ${options.session}:`);
			console.log(`  Acked events deleted: ${stats.ackedEventsDeleted}`);
			console.log(`  Old revisions deleted: ${stats.oldRevisionsDeleted}`);
			console.log(`  Duration: ${stats.durationMs.toFixed(2)}ms`);
		} else {
			const result = await compactor.compactAll({ dryRun: options.dryRun });
			const totalAcked = result.stats.reduce(
				(sum, stat) => sum + stat.ackedEventsDeleted,
				0,
			);
			const totalRevisions = result.stats.reduce(
				(sum, stat) => sum + stat.oldRevisionsDeleted,
				0,
			);
			console.log(`Sessions processed: ${result.stats.length}`);
			console.log(`Acked events deleted: ${totalAcked}`);
			console.log(`Old revisions deleted: ${totalRevisions}`);
			console.log(`Duration: ${result.totalDurationMs.toFixed(2)}ms`);
			if (options.verbose) {
				for (const session of result.stats) {
					console.log(
						`  ${session.sessionId}: ${session.ackedEventsDeleted} acked, ${session.oldRevisionsDeleted} revisions`,
					);
				}
			}
		}
	} finally {
		walStore.close();
		db.close();
	}
};

const main = async () => {
	const args = Bun.argv.slice(2);
	if (args.length === 0) {
		showAndExit(ROOT_HELP);
	}

	const [command, ...rest] = args;
	if (command === "--help") {
		showAndExit(ROOT_HELP);
	}
	if (command === "--version") {
		showAndExit(VERSION);
	}

	switch (command) {
		case "start":
			await runStart(rest);
			return;
		case "stop": {
			const config = await getCliConfig();
			await new DaemonManager(config).stop();
			return;
		}
		case "status":
			await runStatus();
			return;
		case "logs":
			await runLogs(rest);
			return;
		case "login":
			await runLogin();
			return;
		case "logout":
			await logout();
			return;
		case "auth-status":
			await loginStatus();
			return;
		case "e2ee":
			await runE2ee(rest);
			return;
		case "compact":
			await runCompact(rest);
			return;
		default:
			fail(`Unknown command: ${command}\n\n${ROOT_HELP}`);
	}
};

main().catch((error) => {
	logger.error({ err: error }, "cli_command_failed");
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
