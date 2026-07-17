import { EventEmitter } from "node:events";
import { isDeepStrictEqual } from "node:util";
import type {
	AcpBackendSummary,
	AgentSessionCapabilities,
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
	protocolCapabilities?: CliRegistrationInfo["protocolCapabilities"];
	/** User ID from auth */
	userId?: string;
	/** Device key ID used to authenticate this CLI */
	deviceId?: string;
	/** Per-backend capabilities */
	backendCapabilities?: Record<string, AgentSessionCapabilities>;
};

const mergeDiscoveredSession = (
	existing: SessionSummary,
	discovered: SessionSummary,
): SessionSummary => {
	// The attached session is the live authority. Discovery is only allowed to
	// refresh detached snapshots, otherwise a stale list page could overwrite
	// active metadata or a locally pinned title.
	if (existing.isAttached === true) {
		return existing;
	}
	return {
		...existing,
		...discovered,
		title: existing.isTitlePinned ? existing.title : discovered.title,
		...(existing.isTitlePinned !== undefined
			? { isTitlePinned: existing.isTitlePinned }
			: {}),
		...(existing.isAttached !== undefined
			? { isAttached: existing.isAttached }
			: {}),
	};
};

const mergeSessionMetadata = (
	existing: SessionSummary,
	incoming: SessionSummary,
): SessionSummary => {
	if (Object.hasOwn(incoming, "_meta") || !Object.hasOwn(existing, "_meta")) {
		return incoming;
	}
	return { ...incoming, _meta: existing._meta };
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
	 * @param authInfo - Auth info (userId, deviceId) from signed token verification
	 */
	register(
		socket: Socket,
		info: CliRegistrationInfo,
		authInfo?: { userId: string; deviceId: string },
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
			if (existing.socket.id !== socket.id) {
				existing.socket.disconnect(true);
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
			protocolCapabilities: info.protocolCapabilities,
			userId: authInfo?.userId,
			deviceId: authInfo?.deviceId,
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
			backendCapabilities: record.backendCapabilities,
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

		const previousById = new Map(
			record.sessions.map((session) => [session.sessionId, session]),
		);
		const nextById = new Map(
			sessions.map((session) => {
				const previous = previousById.get(session.sessionId);
				return [
					session.sessionId,
					previous ? mergeSessionMetadata(previous, session) : session,
				] as const;
			}),
		);
		const added: SessionSummary[] = [];
		const updated: SessionSummary[] = [];
		for (const session of nextById.values()) {
			const previous = previousById.get(session.sessionId);
			if (!previous) {
				added.push({ ...session, machineId: record.machineId });
			} else if (!isDeepStrictEqual(previous, session)) {
				updated.push({ ...session, machineId: record.machineId });
			}
		}
		const removed = record.sessions
			.filter((session) => !nextById.has(session.sessionId))
			.map((session) => session.sessionId);

		// Replace the entire list — the CLI now sends the complete set
		// (active + discovered), so stale entries are cleaned up naturally.
		record.sessions = Array.from(nextById.values());
		this.emit("sessions:updated", record.machineId, record.sessions);
		if (added.length > 0 || updated.length > 0 || removed.length > 0) {
			this.emit(
				"sessions:changed",
				record.machineId,
				{ added, updated, removed } satisfies SessionsChangedPayload,
				record.userId,
			);
		}
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
		const normalizedPayload: SessionsChangedPayload = {
			...payload,
			updated: payload.updated.map((updated) => {
				const existing = record.sessions.find(
					(session) => session.sessionId === updated.sessionId,
				);
				return existing ? mergeSessionMetadata(existing, updated) : updated;
			}),
		};

		// Remove sessions
		for (const removedId of normalizedPayload.removed) {
			const index = record.sessions.findIndex((s) => s.sessionId === removedId);
			if (index !== -1) {
				record.sessions.splice(index, 1);
			}
		}

		// Update sessions
		for (const updated of normalizedPayload.updated) {
			const index = record.sessions.findIndex(
				(s) => s.sessionId === updated.sessionId,
			);
			if (index !== -1) {
				record.sessions[index] = updated;
			}
		}

		// Add new sessions
		for (const added of normalizedPayload.added) {
			const existing = record.sessions.find(
				(s) => s.sessionId === added.sessionId,
			);
			if (!existing) {
				record.sessions.push(added);
			}
		}

		// Emit the enhanced payload with machineId
		const enhancedPayload: SessionsChangedPayload = {
			added: normalizedPayload.added.map((s) => ({
				...s,
				machineId: record.machineId,
			})),
			updated: normalizedPayload.updated.map((s) => ({
				...s,
				machineId: record.machineId,
			})),
			removed: normalizedPayload.removed,
			backendCapabilities: normalizedPayload.backendCapabilities,
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
	 * Add or refresh discovered historical sessions on a CLI record.
	 * Attached sessions remain authoritative and pinned titles are preserved.
	 */
	addDiscoveredSessions(
		socketId: string,
		sessions: SessionSummary[],
	): Pick<SessionsChangedPayload, "added" | "updated" | "removed"> {
		const record = this.cliBySocketId.get(socketId);
		if (!record) {
			return { added: [], updated: [], removed: [] };
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
			const merged = mergeDiscoveredSession(
				record.sessions[existingIndex],
				session,
			);
			if (!isDeepStrictEqual(record.sessions[existingIndex], merged)) {
				record.sessions[existingIndex] = merged;
				updated.push(merged);
			}
		}
		return { added, updated, removed: [] };
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
			const merged = mergeDiscoveredSession(existing, session);
			if (!isDeepStrictEqual(existing, merged)) {
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

	/**
	 * Merge per-backend capabilities into a CLI record.
	 */
	updateBackendCapabilities(
		socketId: string,
		capabilities: Record<string, AgentSessionCapabilities>,
	): void {
		const record = this.cliBySocketId.get(socketId);
		if (!record) return;
		record.backendCapabilities = {
			...record.backendCapabilities,
			...capabilities,
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

	/** Get all user IDs with active CLI connections. */
	getConnectedUserIds(): string[] {
		return Array.from(this.clisByUserId.keys());
	}
}
