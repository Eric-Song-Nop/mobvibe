import { tauri } from "@daveyplate/better-auth-tauri/plugin";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getGatewayConfig } from "../config.js";
import { getDb, isDbEnabled } from "../db/index.js";

let authInstance: ReturnType<typeof betterAuth> | null = null;

/**
 * Check if authentication is enabled (database is configured).
 */
export function isAuthEnabled(): boolean {
	return isDbEnabled();
}

/**
 * Get the Better Auth instance.
 * Creates the instance lazily on first access.
 * Returns null if database is not configured.
 */
export function getAuth(): ReturnType<typeof betterAuth> | null {
	if (!isDbEnabled()) {
		return null;
	}

	if (!authInstance) {
		const config = getGatewayConfig();
		const db = getDb();

		if (!db) {
			return null;
		}

		const trustedOrigins: string[] = [];

		// Add SITE_URL if configured
		if (config.siteUrl) {
			trustedOrigins.push(config.siteUrl);
		}

		// Add CORS origins as trusted
		trustedOrigins.push(...config.corsOrigins);

		// Always trust localhost for development
		trustedOrigins.push("http://localhost:5173");
		trustedOrigins.push("http://127.0.0.1:5173");

		authInstance = betterAuth({
			trustedOrigins,
			database: drizzleAdapter(db, { provider: "pg" }),
			emailAndPassword: {
				enabled: true,
				requireEmailVerification: false,
			},
			session: {
				// Session cookie settings
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
			],
		});
	}

	return authInstance;
}

/**
 * Get the auth instance, throwing if not configured.
 */
export function requireAuth(): ReturnType<typeof betterAuth> {
	const auth = getAuth();
	if (!auth) {
		throw new Error(
			"Auth not configured. Set DATABASE_URL environment variable.",
		);
	}
	return auth;
}
