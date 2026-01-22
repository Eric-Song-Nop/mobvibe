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
import { getCachedToken } from "./auth";
import { getDefaultGatewayUrl } from "./gateway-config";

type TypedSocket = Socket<GatewayToWebuiEvents, WebuiToGatewayEvents>;

let GATEWAY_URL = getDefaultGatewayUrl();

class GatewaySocket {
	private socket: TypedSocket | null = null;
	private subscribedSessions = new Set<string>();
	private onConnectCallbacks = new Set<() => void>();

	connect(): TypedSocket {
		// Return existing socket if it exists (even if still connecting)
		if (this.socket) {
			return this.socket;
		}

		const token = getCachedToken();
		this.socket = io(`${GATEWAY_URL}/webui`, {
			path: "/socket.io",
			reconnection: true,
			reconnectionAttempts: Number.POSITIVE_INFINITY,
			reconnectionDelay: 1000,
			reconnectionDelayMax: 10000,
			transports: ["websocket"],
			autoConnect: true,
			withCredentials: true,
			auth: token ? { token } : undefined,
		});

		this.socket.on("connect", () => {
			console.log("[webui] Connected to gateway");
			// Notify listeners that connection is ready
			this.onConnectCallbacks.forEach((cb) => cb());
		});

		this.socket.on("disconnect", (reason) => {
			console.log(`[webui] Disconnected from gateway: ${reason}`);
		});

		this.socket.on("connect_error", (error) => {
			console.error("[webui] Connection error:", error.message);
		});

		// Handle case where socket connected before handlers were attached
		if (this.socket.connected) {
			this.onConnectCallbacks.forEach((cb) => cb());
		}

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

	/**
	 * Register a callback to be called when the socket connects.
	 * Returns an unsubscribe function.
	 */
	onConnect(callback: () => void) {
		this.onConnectCallbacks.add(callback);
		// If already connected, call immediately
		if (this.socket?.connected) {
			callback();
		}
		return () => {
			this.onConnectCallbacks.delete(callback);
		};
	}

	/**
	 * Update the gateway URL and reconnect.
	 */
	setGatewayUrl(url: string) {
		GATEWAY_URL = url;
		if (this.socket) {
			this.disconnect();
			this.connect();
		}
	}

	/**
	 * Get the current gateway URL.
	 */
	getGatewayUrl(): string {
		return GATEWAY_URL;
	}
}

// Singleton instance
export const gatewaySocket = new GatewaySocket();
