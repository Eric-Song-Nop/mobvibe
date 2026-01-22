import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex, crossDomain } from "@convex-dev/better-auth/plugins";
import { betterAuth } from "better-auth/minimal";
import { components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { query } from "./_generated/server";
import authConfig from "./auth.config";

const siteUrl = process.env.SITE_URL!;

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
export const createAuth = (ctx: GenericCtx<DataModel>) => {
	return betterAuth({
		trustedOrigins: [siteUrl],
		database: authComponent.adapter(ctx),
		emailAndPassword: {
			enabled: true,
			requireEmailVerification: false,
		},
		plugins: [
			// Cross domain plugin required for client-side frameworks (SPA)
			crossDomain({ siteUrl }),
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
