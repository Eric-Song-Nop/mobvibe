import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex, crossDomain } from "@convex-dev/better-auth/plugins";
import { betterAuth } from "better-auth";
import { components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { query } from "./_generated/server";
import authConfig from "./auth.config";

/**
 * Better Auth component client.
 * Provides adapter methods and helper functions for Convex integration.
 */
export const authComponent = createClient<DataModel>(components.betterAuth);

/**
 * Create a Better Auth instance for the given Convex context.
 *
 * @param ctx - Convex context (query, mutation, or action)
 * @param options - Optional configuration
 * @returns Configured Better Auth instance
 */
export const createAuth = (
	ctx: GenericCtx<DataModel>,
	{ optionsOnly } = { optionsOnly: false },
) => {
	return betterAuth({
		// Disable logging when called just to generate options
		logger: {
			disabled: optionsOnly,
		},
		// Trust origins for OAuth callbacks and CORS
		trustedOrigins: [
			// Development
			"http://localhost:5173",
			"http://localhost:3005",
			// Allow private network IPs for local network access
			/^http:\/\/192\.168\.\d+\.\d+:\d+$/,
			/^http:\/\/10\.\d+\.\d+\.\d+:\d+$/,
			/^http:\/\/172\.(1[6-9]|2[0-9]|3[0-1])\.\d+\.\d+:\d+$/,
		],
		// Convex database adapter
		database: authComponent.adapter(ctx),
		// Email/password authentication
		emailAndPassword: {
			enabled: true,
			requireEmailVerification: false, // Start simple, can enable later
		},
		// Required plugins
		plugins: [
			// Cross domain plugin required for client-side frameworks (SPA)
			crossDomain({
				trustedOrigins: [
					// Development
					"http://localhost:5173",
					"http://localhost:3005",
					// Allow private network IPs for local network access
					/^http:\/\/192\.168\.\d+\.\d+:\d+$/,
					/^http:\/\/10\.\d+\.\d+\.\d+:\d+$/,
					/^http:\/\/172\.(1[6-9]|2[0-9]|3[0-1])\.\d+\.\d+:\d+$/,
				],
			}),
			// Convex integration plugin with auth config
			convex({ authConfig }),
		],
	});
};

/**
 * Get the currently authenticated user from the session.
 * Returns null if not authenticated.
 */
export const getCurrentUser = query({
	args: {},
	handler: async (ctx) => {
		return authComponent.getAuthUser(ctx);
	},
});

/**
 * Get the current session.
 * Returns null if not authenticated.
 */
export const getSession = query({
	args: {},
	handler: async (ctx) => {
		return authComponent.getAuthSession(ctx);
	},
});
