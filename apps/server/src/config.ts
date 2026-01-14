export type AcpBackendId = "opencode" | "gemini-cli";

export type AcpBackendConfig = {
	id: AcpBackendId;
	label: string;
	command: string;
	args: string[];
};

export type ServerConfig = {
	port: number;
	acpBackend: AcpBackendConfig;
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
};

const parseBackendId = (value: string | undefined): AcpBackendId => {
	const normalized = (value ?? "opencode").trim().toLowerCase();
	if (normalized === "opencode") {
		return "opencode";
	}
	if (normalized === "gemini-cli") {
		return "gemini-cli";
	}
	throw new Error(`Invalid ACP backend: ${value}`);
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
	const backendId = parseBackendId(env.MOBVIBE_ACP_BACKEND);
	const backend = ACP_BACKENDS[backendId];

	return {
		port: parsePort(env.MOBVIBE_SERVER_PORT ?? "3757"),
		acpBackend: {
			id: backendId,
			...backend,
		},
		clientName: env.MOBVIBE_ACP_CLIENT_NAME ?? "mobvibe-backend",
		clientVersion: env.MOBVIBE_ACP_CLIENT_VERSION ?? "0.0.0",
		corsOrigins: parseOrigins(env.MOBVIBE_CORS_ORIGINS),
	};
};
