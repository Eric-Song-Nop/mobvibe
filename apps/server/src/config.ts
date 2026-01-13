export type ServerConfig = {
	port: number;
	opencodeCommand: string;
	opencodeArgs: string[];
	clientName: string;
	clientVersion: string;
	corsOrigins: string[];
};

const parsePort = (value: string) => {
	const port = Number.parseInt(value, 10);
	if (!Number.isFinite(port)) {
		throw new Error(`Invalid port: ${value}`);
	}
	return port;
};

const parseArgs = (value: string) => {
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed.split(/\s+/) : [];
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

	return {
		port: parsePort(env.MOBVIBE_SERVER_PORT ?? "3757"),
		opencodeCommand: env.MOBVIBE_OPENCODE_COMMAND ?? "opencode",
		opencodeArgs: parseArgs(env.MOBVIBE_OPENCODE_ARGS ?? "acp"),
		clientName: env.MOBVIBE_ACP_CLIENT_NAME ?? "mobvibe-backend",
		clientVersion: env.MOBVIBE_ACP_CLIENT_VERSION ?? "0.0.0",
		corsOrigins: parseOrigins(env.MOBVIBE_CORS_ORIGINS),
	};
};
