/**
 * Database service for Gateway server.
 * Provides methods to validate tokens and manage machine/session data.
 * This replaces the previous Convex-based implementation.
 */

import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb, isDbEnabled } from "../db/index.js";
import { acpSessions, machines, users } from "../db/schema.js";

export type MachineTokenValidation = {
	machineId: string;
	userId: string;
	name: string;
	hostname: string;
};

export type SessionOwnershipCheck = {
	exists: boolean;
	isOwner: boolean;
};

/**
 * Check if authentication is enabled (database is configured).
 */
export function isAuthEnabled(): boolean {
	return isDbEnabled();
}

/**
 * Validate a machine token and get machine/user info.
 * Returns null if token is invalid or database is not configured.
 */
export async function validateMachineToken(
	machineToken: string,
): Promise<MachineTokenValidation | null> {
	const db = getDb();
	if (!db) {
		return null;
	}

	try {
		const result = await db
			.select({
				id: machines.id,
				userId: machines.userId,
				name: machines.name,
				hostname: machines.hostname,
			})
			.from(machines)
			.where(eq(machines.machineToken, machineToken))
			.limit(1);

		if (result.length === 0) {
			return null;
		}

		const machine = result[0];
		return {
			machineId: machine.id,
			userId: machine.userId,
			name: machine.name,
			hostname: machine.hostname,
		};
	} catch (error) {
		console.error("[db-service] validateMachineToken error:", error);
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
	const db = getDb();
	if (!db) {
		return null;
	}

	try {
		const result = await db
			.update(machines)
			.set({
				isOnline,
				lastSeenAt: new Date(),
				updatedAt: new Date(),
			})
			.where(eq(machines.machineToken, machineToken))
			.returning({ id: machines.id, userId: machines.userId });

		if (result.length === 0) {
			return null;
		}

		return { machineId: result[0].id, userId: result[0].userId };
	} catch (error) {
		console.error("[db-service] updateMachineStatus error:", error);
		return null;
	}
}

/**
 * Create a session record in the database.
 */
export async function createAcpSession(params: {
	machineToken: string;
	sessionId: string;
	title: string;
	backendId: string;
	cwd?: string;
}): Promise<{ _id: string; userId: string; machineId: string } | null> {
	const db = getDb();
	if (!db) {
		return null;
	}

	try {
		// First, get the machine info from the token
		const machineResult = await db
			.select({ id: machines.id, userId: machines.userId })
			.from(machines)
			.where(eq(machines.machineToken, params.machineToken))
			.limit(1);

		if (machineResult.length === 0) {
			console.error("[db-service] createAcpSession: machine not found");
			return null;
		}

		const machine = machineResult[0];
		const id = randomUUID();

		await db.insert(acpSessions).values({
			id,
			sessionId: params.sessionId,
			userId: machine.userId,
			machineId: machine.id,
			title: params.title,
			backendId: params.backendId,
			cwd: params.cwd ?? null,
			state: "active",
		});

		return {
			_id: id,
			userId: machine.userId,
			machineId: machine.id,
		};
	} catch (error) {
		console.error("[db-service] createAcpSession error:", error);
		return null;
	}
}

/**
 * Update a session's state in the database.
 */
export async function updateAcpSessionState(params: {
	sessionId: string;
	state: string;
	title?: string;
	cwd?: string;
}): Promise<boolean> {
	const db = getDb();
	if (!db) {
		return true; // No-op if db not configured
	}

	try {
		const updateData: Record<string, unknown> = {
			state: params.state,
			updatedAt: new Date(),
		};

		if (params.title !== undefined) {
			updateData.title = params.title;
		}
		if (params.cwd !== undefined) {
			updateData.cwd = params.cwd;
		}

		await db
			.update(acpSessions)
			.set(updateData)
			.where(eq(acpSessions.sessionId, params.sessionId));

		return true;
	} catch (error) {
		console.error("[db-service] updateAcpSessionState error:", error);
		return false;
	}
}

/**
 * Close a session in the database.
 */
export async function closeAcpSession(sessionId: string): Promise<boolean> {
	const db = getDb();
	if (!db) {
		return true; // No-op if db not configured
	}

	try {
		await db
			.update(acpSessions)
			.set({
				state: "closed",
				closedAt: new Date(),
				updatedAt: new Date(),
			})
			.where(eq(acpSessions.sessionId, sessionId));

		return true;
	} catch (error) {
		console.error("[db-service] closeAcpSession error:", error);
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
	const db = getDb();
	if (!db) {
		// Auth disabled - allow all
		return { exists: true, isOwner: true };
	}

	try {
		const result = await db
			.select({ userId: acpSessions.userId })
			.from(acpSessions)
			.where(eq(acpSessions.sessionId, sessionId))
			.limit(1);

		if (result.length === 0) {
			return { exists: false, isOwner: false };
		}

		return {
			exists: true,
			isOwner: result[0].userId === userId,
		};
	} catch (error) {
		console.error("[db-service] checkSessionOwnership error:", error);
		return { exists: false, isOwner: false };
	}
}

/**
 * Close all sessions for a machine (on disconnect).
 */
export async function closeSessionsForMachine(
	machineToken: string,
): Promise<number> {
	const db = getDb();
	if (!db) {
		return 0;
	}

	try {
		// First get the machine ID from the token
		const machineResult = await db
			.select({ id: machines.id })
			.from(machines)
			.where(eq(machines.machineToken, machineToken))
			.limit(1);

		if (machineResult.length === 0) {
			return 0;
		}

		const machineId = machineResult[0].id;

		// Close all active sessions for this machine
		const result = await db
			.update(acpSessions)
			.set({
				state: "closed",
				closedAt: new Date(),
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(acpSessions.machineId, machineId),
					eq(acpSessions.state, "active"),
				),
			)
			.returning({ id: acpSessions.id });

		return result.length;
	} catch (error) {
		console.error("[db-service] closeSessionsForMachine error:", error);
		return 0;
	}
}

/**
 * Validate a Better Auth session token.
 * This is handled directly by Better Auth now, but we keep this for compatibility.
 * Returns user ID if valid, null otherwise.
 */
export async function validateSessionToken(
	_token: string,
): Promise<{ userId: string; email: string } | null> {
	// This function is now deprecated - session validation is handled
	// directly by Better Auth in the auth middleware.
	// Keeping the signature for API compatibility during migration.
	console.warn(
		"[db-service] validateSessionToken is deprecated, use Better Auth directly",
	);
	return null;
}
