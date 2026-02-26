import { io, type Socket } from "socket.io-client";
import type {
	CliStatusPayload,
	GatewayToWebuiEvents,
	PermissionDecisionPayload,
	PermissionRequestPayload,
	SessionAttachedPayload,
	SessionDetachedPayload,
	SessionEvent,
	SessionsChangedPayload,
	WebuiToGatewayEvents,
} from "./acp";
import { isInTauri } from "./auth";
import { getAuthToken } from "./auth-token";
import { getDefaultGatewayUrl } from "./gateway-config";

type TypedSocket = Socket<GatewayToWebuiEvents, WebuiToGatewayEvents>;

let GATEWAY_URL = getDefaultGatewayUrl();

class GatewaySocket {
	private socket: TypedSocket | null = null;
	private subscribedSessions = new Set<string>();
	private onConnectCallbacks = new Set<() => void>();
	private isConnecting = false;

	connect(): TypedSocket {
		// Return existing socket if it exists (even if still connecting)
		if (this.socket) {
			return this.socket;
		}

		this.isConnecting = true;
		const tauriEnv = isInTauri();
		this.socket = io(`${GATEWAY_URL}/webui`, {
			path: "/socket.io",
			reconnection: true,
			reconnectionAttempts: Number.POSITIVE_INFINITY,
			reconnectionDelay: 1000,
			reconnectionDelayMax: 10000,
			autoConnect: true,
			...(tauriEnv
				? { auth: { token: getAuthToken() }, transports: ["websocket"] }
				: { withCredentials: true }),
		});

		this.socket.on("connect", () => {
			this.isConnecting = false;
			console.log("[webui] Connected to gateway");
			// Re-subscribe all sessions after reconnect
			for (const sessionId of this.subscribedSessions) {
				this.socket?.emit("subscribe:session", { sessionId });
			}
			// Notify listeners that connection is ready
			this.onConnectCallbacks.forEach((cb) => cb());
		});

		this.socket.on("disconnect", (reason) => {
			console.log(`[webui] Disconnected from gateway: ${reason}`);
		});

		this.socket.on("connect_error", (error) => {
			this.isConnecting = false;
			console.error("[webui] Connection error:", error.message);
		});

		// Handle case where socket connected before handlers were attached
		if (this.socket.connected) {
			this.onConnectCallbacks.forEach((cb) => cb());
		}

		return this.socket;
	}

	disconnect() {
		// Don't disconnect while connecting (protects against React StrictMode race condition)
		if (this.isConnecting) {
			return;
		}
		this.socket?.disconnect();
		this.socket = null;
	}

	/**
	 * Full reset: clear all subscriptions and disconnect.
	 * Use this when the component is unmounting or the connection is being fully torn down.
	 */
	destroy() {
		this.subscribedSessions.clear();
		this.onConnectCallbacks.clear();
		this.isConnecting = false;
		this.socket?.disconnect();
		this.socket = null;
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

	getSubscribedSessions() {
		return Array.from(this.subscribedSessions);
	}

	/** Register a handler for a typed socket event, returning an unsubscribe function. */
	private registerHandler<E extends keyof GatewayToWebuiEvents>(
		event: E,
		handler: GatewayToWebuiEvents[E],
	): () => void {
		this.socket?.on(event, handler as never);
		return () => {
			this.socket?.off(event, handler as never);
		};
	}

	onSessionAttached(handler: (payload: SessionAttachedPayload) => void) {
		return this.registerHandler("session:attached", handler);
	}

	onSessionDetached(handler: (payload: SessionDetachedPayload) => void) {
		return this.registerHandler("session:detached", handler);
	}

	onPermissionRequest(handler: (payload: PermissionRequestPayload) => void) {
		return this.registerHandler("permission:request", handler);
	}

	onPermissionResult(handler: (payload: PermissionDecisionPayload) => void) {
		return this.registerHandler("permission:result", handler);
	}

	onCliStatus(handler: (payload: CliStatusPayload) => void) {
		return this.registerHandler("cli:status", handler);
	}

	onSessionsChanged(handler: (payload: SessionsChangedPayload) => void) {
		return this.registerHandler("sessions:changed", handler);
	}

	onSessionEvent(handler: (event: SessionEvent) => void) {
		return this.registerHandler("session:event", handler);
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

	onDisconnect(callback: (reason: string) => void) {
		const handler = (reason: string) => callback(reason);
		this.socket?.on("disconnect", handler);
		return () => {
			this.socket?.off("disconnect", handler);
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
