export type GatewayConfig = {
	port: number;
	corsOrigins: string[];
	convexUrl: string | undefined;
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

export const getGatewayConfig = (): GatewayConfig => {
	const env = process.env;
	return {
		port: parsePort(env.PORT ?? env.GATEWAY_PORT ?? "3005"),
		corsOrigins: parseOrigins(env.GATEWAY_CORS_ORIGINS),
		convexUrl: env.CONVEX_URL,
	};
};
