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
	defaultBackendId?: string;
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
			defaultBackendId: info.defaultBackendId,
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
		record.sessions = sessions;
		this.emit("sessions:updated", record.machineId, sessions);
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

	getCliBySocketId(socketId: string): CliRecord | undefined {
		return this.cliBySocketId.get(socketId);
	}

	getCliByMachineId(machineId: string): CliRecord | undefined {
		return this.cliByMachineId.get(machineId);
	}

	getCliForSession(sessionId: string): CliRecord | undefined {
		for (const record of this.cliByMachineId.values()) {
			if (record.sessions.some((s) => s.sessionId === sessionId)) {
				return record;
			}
		}
		return undefined;
	}

	getAllClis(): CliRecord[] {
		return Array.from(this.cliByMachineId.values());
	}

	getAllSessions(): SessionSummary[] {
		const sessions: SessionSummary[] = [];
		for (const record of this.cliByMachineId.values()) {
			for (const session of record.sessions) {
				sessions.push({ ...session, machineId: record.machineId });
			}
		}
		return sessions;
	}

	getFirstCli(): CliRecord | undefined {
		const clis = this.getAllClis();
		return clis[0];
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
	 * Falls back to getFirstCli() if userId is not provided (backwards compatibility).
	 */
	getFirstCliForUser(userId?: string): CliRecord | undefined {
		if (!userId) {
			return this.getFirstCli();
		}
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
		const cli = this.getCliForSession(sessionId);
		if (!cli) {
			return false;
		}
		// If CLI has no userId (auth disabled), allow access
		if (!cli.userId) {
			return true;
		}
		return cli.userId === userId;
	}

	/**
	 * Check if a machine belongs to a specific user.
	 */
	isMachineOwnedByUser(machineId: string, userId: string): boolean {
		const cli = this.getCliByMachineId(machineId);
		if (!cli) {
			return false;
		}
		if (!cli.userId) {
			return true;
		}
		return cli.userId === userId;
	}

	/**
	 * Get backends available to a specific user.
	 */
	getBackendsForUser(userId?: string): {
		backends: AcpBackendSummary[];
		defaultBackendId: string | undefined;
	} {
		const clis = userId ? this.getClisForUser(userId) : this.getAllClis();
		const backendsMap = new Map<string, AcpBackendSummary>();
		let defaultBackendId: string | undefined;

		for (const record of clis) {
			for (const backend of record.backends) {
				if (!backendsMap.has(backend.backendId)) {
					backendsMap.set(backend.backendId, backend);
				}
			}
			if (!defaultBackendId && record.defaultBackendId) {
				defaultBackendId = record.defaultBackendId;
			}
		}

		return {
			backends: Array.from(backendsMap.values()),
			defaultBackendId,
		};
	}

	getAllBackends(): {
		backends: AcpBackendSummary[];
		defaultBackendId: string | undefined;
	} {
		// Aggregate backends from all connected CLIs
		const backendsMap = new Map<string, AcpBackendSummary>();
		let defaultBackendId: string | undefined;

		for (const record of this.cliByMachineId.values()) {
			for (const backend of record.backends) {
				if (!backendsMap.has(backend.backendId)) {
					backendsMap.set(backend.backendId, backend);
				}
			}
			if (!defaultBackendId && record.defaultBackendId) {
				defaultBackendId = record.defaultBackendId;
			}
		}

		return {
			backends: Array.from(backendsMap.values()),
			defaultBackendId,
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
