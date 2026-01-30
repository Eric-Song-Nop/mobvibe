import { tauri } from "@daveyplate/better-auth-tauri/plugin";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { apiKey, openAPI } from "better-auth/plugins";
import { getGatewayConfig } from "../config.js";
import { db } from "../db/index.js";
import * as schema from "../db/schema.js";
import { logger } from "./logger.js";

const config = getGatewayConfig();

const tauriOrigins = [
	"tauri://localhost",
	"http://tauri.localhost",
	"https://tauri.localhost",
	"mobvibe://",
];

const trustedOrigins = [
	config.siteUrl,
	...config.corsOrigins,
	"http://localhost:5173",
	"http://127.0.0.1:5173",
	...tauriOrigins,
].filter(Boolean) as string[];

const isDevelopment = process.env.NODE_ENV === "development";

logger.info(
	{
		trustedOrigins,
		siteUrl: config.siteUrl,
		corsOrigins: config.corsOrigins,
	},
	"better_auth_trusted_origins",
);

/**
 * Better Auth instance.
 */
export const auth = betterAuth({
	baseURL: config.siteUrl,
	trustedOrigins,
	database: drizzleAdapter(db, {
		provider: "pg",
		schema,
	}),
	socialProviders: {
		github: {
			clientId: process.env.GITHUB_CLIENT_ID as string,
			clientSecret: process.env.GITHUB_CLIENT_SECRET as string,
		},
	},
	emailAndPassword: {
		enabled: true,
		requireEmailVerification: false,
	},
	session: {
		cookieCache: {
			enabled: true,
			maxAge: 5 * 60, // 5 minutes cache
		},
	},
	advanced: {
		useSecureCookies: !isDevelopment,
		defaultCookieAttributes: {
			secure: !isDevelopment,
			sameSite: isDevelopment ? "lax" : "none",
			partitioned: !isDevelopment,
		},
	},
	plugins: [
		tauri({
			scheme: "mobvibe",
			callbackURL: "/",
		}),
		openAPI(),
		apiKey({
			defaultPrefix: "mbk_",
			apiKeyHeaders: ["x-api-key"],
			enableMetadata: true,
			enableSessionForAPIKeys: true,
			rateLimit: {
				enabled: false,
			},
		}),
	],
});
