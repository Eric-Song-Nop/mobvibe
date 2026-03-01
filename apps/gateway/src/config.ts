import { randomUUID } from "node:crypto";

export type GatewayConfig = {
	port: number;
	corsOrigins: string[];
	siteUrl: string | undefined;
	databaseUrl: string | undefined;
	resendApiKey: string | undefined;
	emailFrom: string;
	skipEmailVerification: boolean;
	isPreview: boolean;
	/** Unique identifier for this gateway instance (FLY_ALLOC_ID or random). */
	instanceId: string;
	/** Fly.io region identifier, if running on Fly.io. */
	flyRegion: string | undefined;
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

/** Origins used by Tauri desktop and mobile apps. */
export const tauriOrigins = [
	"tauri://localhost",
	"http://tauri.localhost",
	"https://tauri.localhost",
	"mobvibe://",
];

export const getGatewayConfig = (): GatewayConfig => {
	const env = process.env;
	const isPreview = env.IS_PULL_REQUEST === "true";
	return {
		port: parsePort(env.PORT ?? env.GATEWAY_PORT ?? "3005"),
		corsOrigins: parseOrigins(env.GATEWAY_CORS_ORIGINS),
		siteUrl: isPreview
			? env.RENDER_EXTERNAL_URL
			: (env.SITE_URL ??
				(env.FLY_APP_NAME
					? `https://${env.FLY_APP_NAME}.fly.dev`
					: env.RENDER_EXTERNAL_URL)),
		databaseUrl: env.DATABASE_URL,
		resendApiKey: env.RESEND_API_KEY,
		emailFrom: env.EMAIL_FROM ?? "Mobvibe <noreply@example.com>",
		skipEmailVerification: env.SKIP_EMAIL_VERIFICATION === "true",
		isPreview,
		instanceId: env.FLY_ALLOC_ID ?? randomUUID().slice(0, 8),
		flyRegion: env.FLY_REGION,
	};
};
