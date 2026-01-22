import { EventEmitter } from "node:events";
import type {
	CliRegistrationInfo,
	CliStatusPayload,
	SessionSummary,
} from "@remote-claude/shared";
import type { Socket } from "socket.io";

type CliRecord = {
	machineId: string;
	hostname: string;
	version?: string;
	socket: Socket;
	connectedAt: Date;
	sessions: SessionSummary[];
};

export class CliRegistry extends EventEmitter {
	private cliByMachineId = new Map<string, CliRecord>();
	private cliBySocketId = new Map<string, CliRecord>();

	register(socket: Socket, info: CliRegistrationInfo): CliRecord {
		// Remove any existing connection for this machine
		const existing = this.cliByMachineId.get(info.machineId);
		if (existing) {
			this.cliBySocketId.delete(existing.socket.id);
		}

		const record: CliRecord = {
			machineId: info.machineId,
			hostname: info.hostname,
			version: info.version,
			socket,
			connectedAt: new Date(),
			sessions: [],
		};

		this.cliByMachineId.set(info.machineId, record);
		this.cliBySocketId.set(socket.id, record);

		this.emitCliStatus({
			machineId: info.machineId,
			connected: true,
			hostname: info.hostname,
			sessionCount: 0,
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

		this.emitCliStatus({
			machineId: record.machineId,
			connected: false,
			hostname: record.hostname,
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
			sessions.push(...record.sessions);
		}
		return sessions;
	}

	getFirstCli(): CliRecord | undefined {
		const clis = this.getAllClis();
		return clis[0];
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
