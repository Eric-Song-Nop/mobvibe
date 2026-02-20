import { isInTauri } from "./auth";

/**
 * Get the gateway URL based on the current environment.
 *
 * Priority:
 * 1. VITE_GATEWAY_URL environment variable
 * 2. Stored URL from Tauri Store (for desktop/mobile apps)
 * 3. Default based on current window location (for web)
 */
export const getGatewayUrl = async (): Promise<string> => {
	// Check environment variable first
	const envUrl = import.meta.env.VITE_GATEWAY_URL as string | undefined;
	if (envUrl) {
		return envUrl;
	}

	// In Tauri, check for stored gateway URL
	if (isInTauri()) {
		try {
			const { load } = await import("@tauri-apps/plugin-store");
			const store = await load("gateway.json");
			const storedUrl = await store.get<string>("gatewayUrl");
			if (storedUrl) {
				return storedUrl;
			}
		} catch {
			// Store not available, fall through to default
		}
		return "http://localhost:3005";
	}

	// Default: derive from current window location
	if (typeof window === "undefined") {
		return "http://localhost:3005";
	}
	return `${window.location.protocol}//${window.location.hostname}:3005`;
};

/**
 * Save the gateway URL to Tauri Store (for desktop/mobile apps).
 */
export const setGatewayUrl = async (url: string): Promise<void> => {
	if (!isInTauri()) {
		return;
	}

	try {
		const { load } = await import("@tauri-apps/plugin-store");
		const store = await load("gateway.json");
		await store.set("gatewayUrl", url);
		await store.save();
	} catch {
		// Store not available
	}
};

/**
 * Get the default gateway URL without checking Tauri Store.
 * Useful for synchronous operations where async is not possible.
 */
export const getDefaultGatewayUrl = (): string => {
	const envUrl = import.meta.env.VITE_GATEWAY_URL as string | undefined;
	if (envUrl) {
		return envUrl;
	}

	if (isInTauri()) {
		return "http://localhost:3005";
	}

	if (typeof window === "undefined") {
		return "http://localhost:3005";
	}
	return `${window.location.protocol}//${window.location.hostname}:3005`;
};
