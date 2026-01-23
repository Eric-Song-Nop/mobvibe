import { tauri } from "@daveyplate/better-auth-tauri/plugin";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { openAPI } from "better-auth/plugins";
import { getGatewayConfig } from "../config.js";
import { db } from "../db/index.js";
import * as schema from "../db/schema.js";

const config = getGatewayConfig();

const trustedOrigins = [
	config.siteUrl,
	...config.corsOrigins,
	"http://localhost:5173",
	"http://127.0.0.1:5173",
].filter(Boolean) as string[];

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
	plugins: [
		tauri({
			scheme: "mobvibe",
			callbackURL: "/",
		}),
		openAPI(),
	],
});
