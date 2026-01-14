export type AcpBackendId = "opencode" | "gemini-cli" | "claude-code";

export type AcpBackendConfig = {
	id: AcpBackendId;
	label: string;
	command: string;
	args: string[];
	envOverrides?: Record<string, string>;
};

export type ServerConfig = {
	port: number;
	acpBackends: AcpBackendConfig[];
	defaultAcpBackendId: AcpBackendId;
	clientName: string;
	clientVersion: string;
	corsOrigins: string[];
};

const ACP_BACKENDS: Record<AcpBackendId, Omit<AcpBackendConfig, "id">> = {
	opencode: {
		label: "opencode",
		command: "opencode",
		args: ["acp"],
	},
	"gemini-cli": {
		label: "gemini-cli",
		command: "gemini",
		args: ["--experimental-acp"],
	},
	"claude-code": {
		label: "claude-code",
		command: "claude-code-acp",
		args: [],
	},
};

const parseBackendId = (value: string): AcpBackendId => {
	const normalized = value.trim().toLowerCase();
	if (normalized === "opencode") {
		return "opencode";
	}
	if (normalized === "gemini-cli") {
		return "gemini-cli";
	}
	if (normalized === "claude-code") {
		return "claude-code";
	}
	throw new Error(`Invalid ACP backend: ${value}`);
};

const DEFAULT_BACKEND_IDS = Object.keys(ACP_BACKENDS) as AcpBackendId[];

const buildEnvOverrides = (
	backendId: AcpBackendId,
	env: NodeJS.ProcessEnv,
): Record<string, string> | undefined => {
	if (backendId !== "claude-code") {
		return undefined;
	}
	const overrides: Record<string, string> = {};
	if (env.ANTHROPIC_AUTH_TOKEN && !env.ANTHROPIC_API_KEY) {
		overrides.ANTHROPIC_API_KEY = env.ANTHROPIC_AUTH_TOKEN;
	}
	if (env.ANTHROPIC_BASE_URL) {
		overrides.ANTHROPIC_BASE_URL = env.ANTHROPIC_BASE_URL;
	}
	return Object.keys(overrides).length > 0 ? overrides : undefined;
};

const parseBackendIds = (value: string | undefined): AcpBackendId[] => {
	if (!value) {
		return DEFAULT_BACKEND_IDS;
	}
	const ids = value
		.split(",")
		.map((item) => item.trim())
		.filter((item) => item.length > 0)
		.map(parseBackendId);
	const unique = Array.from(new Set(ids));
	return unique.length > 0 ? unique : DEFAULT_BACKEND_IDS;
};

const parsePort = (value: string) => {
	const port = Number.parseInt(value, 10);
	if (!Number.isFinite(port)) {
		throw new Error(`Invalid port: ${value}`);
	}
	return port;
};

const parseOrigins = (value: string | undefined) => {
	if (!value) {
		return [];
	}
	return value
		.split(",")
		.map((origin) => origin.trim())
		.filter((origin) => origin.length > 0);
};

export const getServerConfig = (): ServerConfig => {
	const env = process.env;
	const backendIds = parseBackendIds(env.MOBVIBE_ACP_BACKENDS);
	const acpBackends = backendIds.map((backendId) => ({
		id: backendId,
		...ACP_BACKENDS[backendId],
		envOverrides: buildEnvOverrides(backendId, env),
	}));

	return {
		port: parsePort(env.MOBVIBE_SERVER_PORT ?? "3757"),
		acpBackends,
		defaultAcpBackendId: backendIds[0],
		clientName: env.MOBVIBE_ACP_CLIENT_NAME ?? "mobvibe-backend",
		clientVersion: env.MOBVIBE_ACP_CLIENT_VERSION ?? "0.0.0",
		corsOrigins: parseOrigins(env.MOBVIBE_CORS_ORIGINS),
	};
};
