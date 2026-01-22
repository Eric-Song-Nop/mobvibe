import {
	type ApiClient,
	createApiClient,
	GatewaySocket,
} from "@remote-claude/core";
import * as SecureStore from "expo-secure-store";
import React, {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";

const GATEWAY_URL_KEY = "mobvibe.gateway_url";
const AUTH_TOKEN_KEY = "mobvibe.auth_token";

type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

type GatewayContextValue = {
	gatewayUrl: string;
	setGatewayUrl: (url: string) => Promise<void>;
	authToken: string | null;
	setAuthToken: (token: string | null) => Promise<void>;
	connectionStatus: ConnectionStatus;
	gatewaySocket: GatewaySocket;
	apiClient: ApiClient;
	connect: () => void;
	disconnect: () => void;
};

const GatewayContext = createContext<GatewayContextValue | null>(null);

export const useGateway = () => {
	const context = useContext(GatewayContext);
	if (!context) {
		throw new Error("useGateway must be used within a GatewayProvider");
	}
	return context;
};

export const GatewayProvider: React.FC<{ children: React.ReactNode }> = ({
	children,
}) => {
	const [gatewayUrl, setGatewayUrlState] = useState("http://localhost:3005");
	const [authToken, setAuthTokenState] = useState<string | null>(null);
	const [connectionStatus, setConnectionStatus] =
		useState<ConnectionStatus>("disconnected");
	const [isInitialized, setIsInitialized] = useState(false);

	// Create socket and API client
	const gatewaySocket = useMemo(() => {
		return new GatewaySocket({
			getGatewayUrl: () => gatewayUrl,
			getToken: () => authToken,
		});
	}, [gatewayUrl, authToken]);

	const apiClient = useMemo(() => {
		return createApiClient({
			getBaseUrl: () => gatewayUrl,
			getToken: () => authToken,
		});
	}, [gatewayUrl, authToken]);

	// Load saved values on mount
	useEffect(() => {
		const loadStoredValues = async () => {
			try {
				const storedUrl = await SecureStore.getItemAsync(GATEWAY_URL_KEY);
				const storedToken = await SecureStore.getItemAsync(AUTH_TOKEN_KEY);

				if (storedUrl) {
					setGatewayUrlState(storedUrl);
				}
				if (storedToken) {
					setAuthTokenState(storedToken);
				}
			} catch (error) {
				console.error("Failed to load stored gateway settings:", error);
			} finally {
				setIsInitialized(true);
			}
		};

		loadStoredValues();
	}, []);

	// Set gateway URL and persist
	const setGatewayUrl = useCallback(async (url: string) => {
		setGatewayUrlState(url);
		try {
			await SecureStore.setItemAsync(GATEWAY_URL_KEY, url);
		} catch (error) {
			console.error("Failed to save gateway URL:", error);
		}
	}, []);

	// Set auth token and persist
	const setAuthToken = useCallback(async (token: string | null) => {
		setAuthTokenState(token);
		try {
			if (token) {
				await SecureStore.setItemAsync(AUTH_TOKEN_KEY, token);
			} else {
				await SecureStore.deleteItemAsync(AUTH_TOKEN_KEY);
			}
		} catch (error) {
			console.error("Failed to save auth token:", error);
		}
	}, []);

	// Connect to gateway
	const connect = useCallback(() => {
		if (connectionStatus === "connecting" || connectionStatus === "connected") {
			return;
		}

		setConnectionStatus("connecting");

		try {
			const socket = gatewaySocket.connect();

			socket.on("connect", () => {
				setConnectionStatus("connected");
			});

			socket.on("disconnect", () => {
				setConnectionStatus("disconnected");
			});

			socket.on("connect_error", () => {
				setConnectionStatus("error");
			});
		} catch (error) {
			console.error("Failed to connect:", error);
			setConnectionStatus("error");
		}
	}, [gatewaySocket, connectionStatus]);

	// Disconnect from gateway
	const disconnect = useCallback(() => {
		gatewaySocket.disconnect();
		setConnectionStatus("disconnected");
	}, [gatewaySocket]);

	// Auto-connect when initialized
	useEffect(() => {
		if (isInitialized && gatewayUrl) {
			connect();
		}
	}, [isInitialized, gatewayUrl, connect]);

	const value = useMemo(
		() => ({
			gatewayUrl,
			setGatewayUrl,
			authToken,
			setAuthToken,
			connectionStatus,
			gatewaySocket,
			apiClient,
			connect,
			disconnect,
		}),
		[
			gatewayUrl,
			setGatewayUrl,
			authToken,
			setAuthToken,
			connectionStatus,
			gatewaySocket,
			apiClient,
			connect,
			disconnect,
		],
	);

	return (
		<GatewayContext.Provider value={value}>{children}</GatewayContext.Provider>
	);
};
