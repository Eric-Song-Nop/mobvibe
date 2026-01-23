import { tauri } from "@daveyplate/better-auth-tauri/plugin";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { openAPI } from "better-auth/plugins";
import { getGatewayConfig } from "../config.js";
import { db, schema } from "../db/index.js";

// Get gateway configuration
const config = getGatewayConfig();

// Build trusted origins list
const trustedOrigins = [
	...(config.siteUrl ? [config.siteUrl] : []),
	...config.corsOrigins,
	"http://localhost:5173",
	"http://127.0.0.1:5173",
];

// Create Better Auth instance
export const auth = db
	? betterAuth({
			trustedOrigins,
			database: drizzleAdapter(db, {
				provider: "pg",
				schema,
				usePlural: true,
			}),
			emailAndPassword: {
				enabled: true,
				requireEmailVerification: false,
			},
			session: {
				cookieCache: {
					enabled: true,
					maxAge: 5 * 60, // 5 minutes
				},
			},
			plugins: [
				tauri({
					scheme: "mobvibe",
					callbackURL: "/",
				}),
				openAPI(),
			],
		})
	: null;
