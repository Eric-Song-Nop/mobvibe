import { EventEmitter } from "node:events";
import type {
	AcpBackendSummary,
	CliRegistrationInfo,
	CliStatusPayload,
	SessionSummary,
	SessionsChangedPayload,
} from "@mobvibe/shared";
import type { Socket } from "socket.io";

export type CliRecord = {
	machineId: string;
	hostname: string;
	version?: string;
	socket: Socket;
	connectedAt: Date;
	sessions: SessionSummary[];
	backends: AcpBackendSummary[];
	/** User ID from auth */
	userId?: string;
	/** API key used to authenticate this CLI */
	apiKey?: string;
};

export class CliRegistry extends EventEmitter {
	private cliByMachineId = new Map<string, CliRecord>();
	private cliBySocketId = new Map<string, CliRecord>();
	/** Index of machines by user ID for efficient lookup */
	private clisByUserId = new Map<string, Set<string>>();

	/**
	 * Register a CLI connection.
	 * @param socket - The Socket.io socket
	 * @param info - CLI registration info
	 * @param authInfo - Optional auth info (userId, apiKey) from API key validation
	 */
	register(
		socket: Socket,
		info: CliRegistrationInfo,
		authInfo?: { userId: string; apiKey: string },
	): CliRecord {
		// Remove any existing connection for this machine
		const existing = this.cliByMachineId.get(info.machineId);
		if (existing) {
			this.cliBySocketId.delete(existing.socket.id);
			// Remove from user index if it had a userId
			if (existing.userId) {
				const userMachines = this.clisByUserId.get(existing.userId);
				if (userMachines) {
					userMachines.delete(existing.machineId);
					if (userMachines.size === 0) {
						this.clisByUserId.delete(existing.userId);
					}
				}
			}
		}

		const record: CliRecord = {
			machineId: info.machineId,
			hostname: info.hostname,
			version: info.version,
			socket,
			connectedAt: new Date(),
			sessions: [],
			backends: info.backends ?? [],
			userId: authInfo?.userId,
			apiKey: authInfo?.apiKey,
		};

		this.cliByMachineId.set(info.machineId, record);
		this.cliBySocketId.set(socket.id, record);

		// Add to user index if authenticated
		if (authInfo?.userId) {
			let userMachines = this.clisByUserId.get(authInfo.userId);
			if (!userMachines) {
				userMachines = new Set();
				this.clisByUserId.set(authInfo.userId, userMachines);
			}
			userMachines.add(info.machineId);
		}

		this.emitCliStatus({
			machineId: info.machineId,
			connected: true,
			hostname: info.hostname,
			sessionCount: 0,
			userId: authInfo?.userId,
		});

		return record;
	}

	unregister(socketId: string): CliRecord | undefined {
		const record = this.cliBySocketId.get(socketId);
		if (!record) {
			return undefined;
		}

		this.cliBySocketId.delete(socketId);
		this.cliByMachineId.delete(record.machineId);

		// Remove from user index
		if (record.userId) {
			const userMachines = this.clisByUserId.get(record.userId);
			if (userMachines) {
				userMachines.delete(record.machineId);
				if (userMachines.size === 0) {
					this.clisByUserId.delete(record.userId);
				}
			}
		}

		this.emitCliStatus({
			machineId: record.machineId,
			connected: false,
			hostname: record.hostname,
			userId: record.userId,
		});

		return record;
	}

	updateSessions(socketId: string, sessions: SessionSummary[]) {
		const record = this.cliBySocketId.get(socketId);
		if (!record) {
			return;
		}

		const merged = new Map<string, SessionSummary>();
		for (const existing of record.sessions) {
			merged.set(existing.sessionId, existing);
		}
		for (const session of sessions) {
			const current = merged.get(session.sessionId);
			merged.set(
				session.sessionId,
				current ? { ...current, ...session } : session,
			);
		}

		record.sessions = Array.from(merged.values());
		this.emit("sessions:updated", record.machineId, record.sessions);
	}

	/**
	 * Update sessions incrementally based on change payload.
	 * Returns the enhanced payload with machineId added to sessions.
	 */
	updateSessionsIncremental(
		socketId: string,
		payload: SessionsChangedPayload,
	): SessionsChangedPayload | undefined {
		const record = this.cliBySocketId.get(socketId);
		if (!record) {
			return undefined;
		}

		// Remove sessions
		for (const removedId of payload.removed) {
			const index = record.sessions.findIndex((s) => s.sessionId === removedId);
			if (index !== -1) {
				record.sessions.splice(index, 1);
			}
		}

		// Update sessions
		for (const updated of payload.updated) {
			const index = record.sessions.findIndex(
				(s) => s.sessionId === updated.sessionId,
			);
			if (index !== -1) {
				record.sessions[index] = updated;
			}
		}

		// Add new sessions
		for (const added of payload.added) {
			const existing = record.sessions.find(
				(s) => s.sessionId === added.sessionId,
			);
			if (!existing) {
				record.sessions.push(added);
			}
		}

		// Emit the enhanced payload with machineId
		const enhancedPayload: SessionsChangedPayload = {
			added: payload.added.map((s) => ({ ...s, machineId: record.machineId })),
			updated: payload.updated.map((s) => ({
				...s,
				machineId: record.machineId,
			})),
			removed: payload.removed,
		};

		this.emit(
			"sessions:changed",
			record.machineId,
			enhancedPayload,
			record.userId,
		);

		return enhancedPayload;
	}

	/**
	 * Register a listener for sessions:changed events.
	 */
	onSessionsChanged(
		listener: (
			machineId: string,
			payload: SessionsChangedPayload,
			userId?: string,
		) => void,
	) {
		this.on("sessions:changed", listener);
		return () => {
			this.off("sessions:changed", listener);
		};
	}

	/**
	 * Add discovered historical sessions to a CLI record.
	 * Only adds sessions that don't already exist (to avoid overwriting active sessions).
	 */
	addDiscoveredSessions(socketId: string, sessions: SessionSummary[]): void {
		const record = this.cliBySocketId.get(socketId);
		if (!record) {
			return;
		}

		for (const session of sessions) {
			const exists = record.sessions.some(
				(s) => s.sessionId === session.sessionId,
			);
			if (!exists) {
				record.sessions.push(session);
			}
		}
	}

	/**
	 * Add discovered sessions to a CLI record by machineId.
	 * Adds new discovered sessions and merges metadata for existing entries.
	 */
	addDiscoveredSessionsForMachine(
		machineId: string,
		sessions: SessionSummary[],
		userId?: string,
	): void {
		const record = this.cliByMachineId.get(machineId);
		if (!record) {
			return;
		}

		const added: SessionSummary[] = [];
		const updated: SessionSummary[] = [];
		for (const session of sessions) {
			const existingIndex = record.sessions.findIndex(
				(existing) => existing.sessionId === session.sessionId,
			);
			if (existingIndex === -1) {
				record.sessions.push(session);
				added.push(session);
				continue;
			}

			const existing = record.sessions[existingIndex];
			const merged: SessionSummary = { ...existing, ...session };
			const hasChanges = (
				Object.keys(session) as Array<keyof SessionSummary>
			).some((key) => existing[key] !== merged[key]);
			if (hasChanges) {
				record.sessions[existingIndex] = merged;
				updated.push(merged);
			}
		}

		if (added.length > 0 || updated.length > 0) {
			this.emit(
				"sessions:changed",
				record.machineId,
				{
					added,
					updated,
					removed: [],
				} as SessionsChangedPayload,
				userId ?? record.userId,
			);
		}
	}

	getCliBySocketId(socketId: string): CliRecord | undefined {
		return this.cliBySocketId.get(socketId);
	}

	/**
	 * Get CLI by machineId, scoped to a specific user.
	 * Uses the clisByUserId index to verify ownership in a single step,
	 * eliminating the TOCTOU gap of separate lookup + auth check.
	 * Returns undefined for both missing and unauthorized machines
	 * to avoid leaking machine existence to other users.
	 */
	getCliByMachineIdForUser(
		machineId: string,
		userId: string,
	): CliRecord | undefined {
		const machineIds = this.clisByUserId.get(userId);
		if (!machineIds || !machineIds.has(machineId)) {
			return undefined;
		}
		return this.cliByMachineId.get(machineId);
	}

	/**
	 * Get the CLI record that owns a session, scoped to a specific user.
	 * Only searches among the user's machines, preventing cross-user collision.
	 */
	getCliForSessionByUser(
		sessionId: string,
		userId: string,
	): CliRecord | undefined {
		const machineIds = this.clisByUserId.get(userId);
		if (!machineIds) {
			return undefined;
		}
		for (const machineId of machineIds) {
			const record = this.cliByMachineId.get(machineId);
			if (record?.sessions.some((s) => s.sessionId === sessionId)) {
				return record;
			}
		}
		return undefined;
	}

	/**
	 * Get all CLIs belonging to a specific user.
	 */
	getClisForUser(userId: string): CliRecord[] {
		const machineIds = this.clisByUserId.get(userId);
		if (!machineIds) {
			return [];
		}
		const records: CliRecord[] = [];
		for (const machineId of machineIds) {
			const record = this.cliByMachineId.get(machineId);
			if (record) {
				records.push(record);
			}
		}
		return records;
	}

	/**
	 * Get the first available CLI for a user.
	 */
	getFirstCliForUser(userId: string): CliRecord | undefined {
		const clis = this.getClisForUser(userId);
		return clis[0];
	}

	/**
	 * Get all sessions for a specific user.
	 */
	getSessionsForUser(userId: string): SessionSummary[] {
		const sessions: SessionSummary[] = [];
		const clis = this.getClisForUser(userId);
		for (const cli of clis) {
			for (const session of cli.sessions) {
				sessions.push({ ...session, machineId: cli.machineId });
			}
		}
		return sessions;
	}

	/**
	 * Check if a session belongs to a specific user.
	 */
	isSessionOwnedByUser(sessionId: string, userId: string): boolean {
		return this.getCliForSessionByUser(sessionId, userId) !== undefined;
	}

	/**
	 * Get backends available to a specific user.
	 */
	getBackendsForUser(userId: string): {
		backends: AcpBackendSummary[];
	} {
		const clis = this.getClisForUser(userId);
		const backendsMap = new Map<string, AcpBackendSummary>();

		for (const record of clis) {
			for (const backend of record.backends) {
				if (!backendsMap.has(backend.backendId)) {
					backendsMap.set(backend.backendId, backend);
				}
			}
		}

		return {
			backends: Array.from(backendsMap.values()),
		};
	}

	onCliStatus(listener: (payload: CliStatusPayload) => void) {
		this.on("cli:status", listener);
		return () => {
			this.off("cli:status", listener);
		};
	}

	private emitCliStatus(payload: CliStatusPayload) {
		this.emit("cli:status", payload);
	}
}
