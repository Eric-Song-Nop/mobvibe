/**
 * Convex client for Gateway server.
 * Provides methods to validate tokens and sync data with Convex backend.
 */

import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import type {
	MachineTokenValidation,
	SessionOwnershipCheck,
} from "@remote-claude/convex";
import { getGatewayConfig } from "../config.js";

// Use anyApi for untyped access to Convex functions
// This works without generated types and will be replaced with proper types
// once the Convex project is deployed and types are generated
const api = anyApi;

let convexClient: ConvexHttpClient | null = null;

/**
 * Get the Convex HTTP client instance.
 * Returns null if CONVEX_URL is not configured (auth disabled mode).
 */
export function getConvexClient(): ConvexHttpClient | null {
	const config = getGatewayConfig();

	if (!config.convexUrl) {
		return null;
	}

	if (!convexClient) {
		convexClient = new ConvexHttpClient(config.convexUrl);
	}

	return convexClient;
}

/**
 * Check if authentication is enabled (Convex is configured).
 */
export function isAuthEnabled(): boolean {
	return getConvexClient() !== null;
}

/**
 * Validate a machine token and get machine/user info.
 * Returns null if token is invalid or auth is disabled.
 */
export async function validateMachineToken(
	machineToken: string,
): Promise<MachineTokenValidation | null> {
	const client = getConvexClient();
	if (!client) {
		// Auth disabled - return mock data for backwards compatibility
		return null;
	}

	try {
		const result = await client.query(api.machines.validateMachineToken, {
			machineToken,
		});
		return result as MachineTokenValidation | null;
	} catch (error) {
		console.error("[convex] validateMachineToken error:", error);
		return null;
	}
}

/**
 * Update machine online status.
 */
export async function updateMachineStatus(
	machineToken: string,
	isOnline: boolean,
): Promise<{ machineId: string; userId: string } | null> {
	const client = getConvexClient();
	if (!client) {
		return null;
	}

	try {
		const result = await client.mutation(api.machines.updateMachineStatus, {
			machineToken,
			isOnline,
		});
		return result as { machineId: string; userId: string };
	} catch (error) {
		console.error("[convex] updateMachineStatus error:", error);
		return null;
	}
}

/**
 * Create a session record in Convex.
 */
export async function createConvexSession(params: {
	machineToken: string;
	sessionId: string;
	title: string;
	backendId: string;
	cwd?: string;
}): Promise<{ _id: string; userId: string; machineId: string } | null> {
	const client = getConvexClient();
	if (!client) {
		return null;
	}

	try {
		const result = await client.mutation(api.sessions.createSession, params);
		return result as { _id: string; userId: string; machineId: string };
	} catch (error) {
		console.error("[convex] createSession error:", error);
		return null;
	}
}

/**
 * Update a session's state in Convex.
 */
export async function updateConvexSessionState(params: {
	sessionId: string;
	state: string;
	title?: string;
	cwd?: string;
}): Promise<boolean> {
	const client = getConvexClient();
	if (!client) {
		return true; // No-op if auth disabled
	}

	try {
		await client.mutation(api.sessions.updateSessionState, params);
		return true;
	} catch (error) {
		console.error("[convex] updateSessionState error:", error);
		return false;
	}
}

/**
 * Close a session in Convex.
 */
export async function closeConvexSession(sessionId: string): Promise<boolean> {
	const client = getConvexClient();
	if (!client) {
		return true; // No-op if auth disabled
	}

	try {
		await client.mutation(api.sessions.closeSession, { sessionId });
		return true;
	} catch (error) {
		console.error("[convex] closeSession error:", error);
		return false;
	}
}

/**
 * Check if a user owns a session.
 */
export async function checkSessionOwnership(
	sessionId: string,
	userId: string,
): Promise<SessionOwnershipCheck> {
	const client = getConvexClient();
	if (!client) {
		// Auth disabled - allow all
		return { exists: true, isOwner: true };
	}

	try {
		const result = await client.query(api.sessions.checkSessionOwnership, {
			sessionId,
			userId,
		});
		return result as SessionOwnershipCheck;
	} catch (error) {
		console.error("[convex] checkSessionOwnership error:", error);
		return { exists: false, isOwner: false };
	}
}

/**
 * Close all sessions for a machine (on disconnect).
 */
export async function closeSessionsForMachine(
	machineToken: string,
): Promise<number> {
	const client = getConvexClient();
	if (!client) {
		return 0;
	}

	try {
		const result = await client.mutation(
			api.sessions.closeSessionsForMachine,
			{ machineToken },
		);
		return (result as { closed: number }).closed;
	} catch (error) {
		console.error("[convex] closeSessionsForMachine error:", error);
		return 0;
	}
}

/**
 * Validate a Better Auth session token.
 * Returns user ID if valid, null otherwise.
 */
export async function validateSessionToken(
	token: string,
): Promise<{ userId: string; email: string } | null> {
	const client = getConvexClient();
	if (!client) {
		return null;
	}

	try {
		// Better Auth stores session token in cookie/header
		// We need to call Convex with the token to validate
		// This would typically be done through Better Auth's session validation
		// For now, we'll implement a simple query approach

		// Note: The actual implementation depends on how Better Auth handles
		// session tokens in Convex. This may need adjustment based on the
		// @convex-dev/better-auth API.
		const result = await client.query(api.auth.getSession, {});
		if (result) {
			return result as { userId: string; email: string };
		}
		return null;
	} catch (error) {
		console.error("[convex] validateSessionToken error:", error);
		return null;
	}
}
