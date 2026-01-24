/**
 * Database service for Gateway server.
 * Provides methods to validate tokens and manage machine/session data.
 */

import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { acpSessions, machines } from "../db/schema.js";

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
 * Validate a machine token and get machine/user info.
 * Returns null if token is invalid.
 */
export async function validateMachineToken(
	machineToken: string,
): Promise<MachineTokenValidation | null> {
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
 * @deprecated Use closeSessionsForMachineById instead
 */
export async function closeSessionsForMachine(
	machineToken: string,
): Promise<number> {
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
 * Close all sessions for a machine by machineId (on disconnect).
 */
export async function closeSessionsForMachineById(
	machineId: string,
): Promise<number> {
	try {
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
		console.error("[db-service] closeSessionsForMachineById error:", error);
		return 0;
	}
}

/**
 * Create or update a machine record.
 * Uses the CLI-provided machineId as the primary key.
 */
export async function upsertMachine(params: {
	machineId: string;
	userId: string;
	name: string;
	hostname: string;
	platform?: string;
	isOnline?: boolean;
}): Promise<{ id: string; userId: string } | null> {
	try {
		// Check if machine exists
		const existing = await db
			.select({ id: machines.id, userId: machines.userId })
			.from(machines)
			.where(eq(machines.id, params.machineId))
			.limit(1);

		if (existing.length > 0) {
			// Machine exists - verify it belongs to the same user
			if (existing[0].userId !== params.userId) {
				console.error(
					"[db-service] upsertMachine: machine belongs to different user",
				);
				return null;
			}

			// Update existing machine
			await db
				.update(machines)
				.set({
					name: params.name,
					hostname: params.hostname,
					platform: params.platform ?? null,
					isOnline: params.isOnline ?? true,
					lastSeenAt: new Date(),
					updatedAt: new Date(),
				})
				.where(eq(machines.id, params.machineId));

			return { id: params.machineId, userId: params.userId };
		}

		// Create new machine
		// Generate a placeholder machineToken for backwards compatibility
		const placeholderToken = `api_${params.machineId.replace(/-/g, "")}`;

		await db.insert(machines).values({
			id: params.machineId,
			userId: params.userId,
			name: params.name,
			hostname: params.hostname,
			platform: params.platform ?? null,
			machineToken: placeholderToken,
			isOnline: params.isOnline ?? true,
			lastSeenAt: new Date(),
		});

		return { id: params.machineId, userId: params.userId };
	} catch (error) {
		console.error("[db-service] upsertMachine error:", error);
		return null;
	}
}

/**
 * Update machine online status by machineId.
 */
export async function updateMachineStatusById(
	machineId: string,
	isOnline: boolean,
): Promise<boolean> {
	try {
		await db
			.update(machines)
			.set({
				isOnline,
				lastSeenAt: new Date(),
				updatedAt: new Date(),
			})
			.where(eq(machines.id, machineId));

		return true;
	} catch (error) {
		console.error("[db-service] updateMachineStatusById error:", error);
		return false;
	}
}

/**
 * Create a session record with explicit userId and machineId.
 */
export async function createAcpSessionDirect(params: {
	userId: string;
	machineId: string;
	sessionId: string;
	title: string;
	backendId: string;
	cwd?: string;
}): Promise<{ _id: string } | null> {
	try {
		const id = randomUUID();

		await db.insert(acpSessions).values({
			id,
			sessionId: params.sessionId,
			userId: params.userId,
			machineId: params.machineId,
			title: params.title,
			backendId: params.backendId,
			cwd: params.cwd ?? null,
			state: "active",
		});

		return { _id: id };
	} catch (error) {
		console.error("[db-service] createAcpSessionDirect error:", error);
		return null;
	}
}
