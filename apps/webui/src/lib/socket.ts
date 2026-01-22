import { io, type Socket } from "socket.io-client";
import type {
	CliStatusPayload,
	GatewayToWebuiEvents,
	PermissionDecisionPayload,
	PermissionRequestPayload,
	SessionNotification,
	StreamErrorPayload,
	TerminalOutputEvent,
	WebuiToGatewayEvents,
} from "./acp";
import type { SessionSummary } from "./api";

type TypedSocket = Socket<GatewayToWebuiEvents, WebuiToGatewayEvents>;

const resolveDefaultGatewayUrl = () => {
	if (typeof window === "undefined") {
		return "http://localhost:3005";
	}
	return `${window.location.protocol}//${window.location.hostname}:3005`;
};

const GATEWAY_URL =
	import.meta.env.VITE_GATEWAY_URL ?? resolveDefaultGatewayUrl();

class GatewaySocket {
	private socket: TypedSocket | null = null;
	private subscribedSessions = new Set<string>();

	connect(): TypedSocket {
		if (this.socket?.connected) {
			return this.socket;
		}

		this.socket = io(`${GATEWAY_URL}/webui`, {
			path: "/socket.io",
			reconnection: true,
			reconnectionAttempts: Number.POSITIVE_INFINITY,
			reconnectionDelay: 1000,
			reconnectionDelayMax: 10000,
			transports: ["websocket"],
			autoConnect: true,
		});

		this.socket.on("connect", () => {
			console.log("[webui] Connected to gateway");
			// Re-subscribe to sessions after reconnect
			for (const sessionId of this.subscribedSessions) {
				this.socket?.emit("subscribe:session", { sessionId });
			}
		});

		this.socket.on("disconnect", (reason) => {
			console.log(`[webui] Disconnected from gateway: ${reason}`);
		});

		this.socket.on("connect_error", (error) => {
			console.error("[webui] Connection error:", error.message);
		});

		return this.socket;
	}

	disconnect() {
		this.socket?.disconnect();
		this.socket = null;
		this.subscribedSessions.clear();
	}

	getSocket(): TypedSocket | null {
		return this.socket;
	}

	subscribeToSession(sessionId: string) {
		this.subscribedSessions.add(sessionId);
		this.socket?.emit("subscribe:session", { sessionId });
	}

	unsubscribeFromSession(sessionId: string) {
		this.subscribedSessions.delete(sessionId);
		this.socket?.emit("unsubscribe:session", { sessionId });
	}

	sendPermissionDecision(payload: PermissionDecisionPayload) {
		this.socket?.emit("permission:decision", payload);
	}

	onSessionUpdate(handler: (notification: SessionNotification) => void) {
		this.socket?.on("session:update", handler);
		return () => {
			this.socket?.off("session:update", handler);
		};
	}

	onSessionError(handler: (payload: StreamErrorPayload) => void) {
		this.socket?.on("session:error", handler);
		return () => {
			this.socket?.off("session:error", handler);
		};
	}

	onPermissionRequest(handler: (payload: PermissionRequestPayload) => void) {
		this.socket?.on("permission:request", handler);
		return () => {
			this.socket?.off("permission:request", handler);
		};
	}

	onPermissionResult(handler: (payload: PermissionDecisionPayload) => void) {
		this.socket?.on("permission:result", handler);
		return () => {
			this.socket?.off("permission:result", handler);
		};
	}

	onTerminalOutput(handler: (event: TerminalOutputEvent) => void) {
		this.socket?.on("terminal:output", handler);
		return () => {
			this.socket?.off("terminal:output", handler);
		};
	}

	onCliStatus(handler: (payload: CliStatusPayload) => void) {
		this.socket?.on("cli:status", handler);
		return () => {
			this.socket?.off("cli:status", handler);
		};
	}

	onSessionsList(handler: (sessions: SessionSummary[]) => void) {
		this.socket?.on("sessions:list", handler);
		return () => {
			this.socket?.off("sessions:list", handler);
		};
	}

	isConnected(): boolean {
		return this.socket?.connected ?? false;
	}
}

// Singleton instance
export const gatewaySocket = new GatewaySocket();
