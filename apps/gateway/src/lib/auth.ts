import { tauri } from "@daveyplate/better-auth-tauri/plugin";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { apiKey, openAPI } from "better-auth/plugins";
import { getGatewayConfig } from "../config.js";
import { db } from "../db/index.js";
import * as schema from "../db/schema.js";
import { logger } from "./logger.js";

const config = getGatewayConfig();

const trustedOrigins = [
	config.siteUrl,
	...config.corsOrigins,
	"http://localhost:5173",
	"http://127.0.0.1:5173",
].filter(Boolean) as string[];

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
	trustedOrigins,
	database: drizzleAdapter(db, {
		provider: "pg",
		schema,
	}),
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
		useSecureCookies: process.env.NODE_ENV !== "development",
		defaultCookieAttributes: {
			secure: process.env.NODE_ENV !== "development",
			sameSite: "none",
			partitioned: true,
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
