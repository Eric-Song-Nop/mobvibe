import { isInTauri } from "./auth";

/**
 * Platform-aware fetch: Tauri HTTP plugin in native env, browser fetch otherwise.
 * Tauri HTTP plugin routes requests through Rust, bypassing WebView CORS.
 */
export async function platformFetch(
	input: RequestInfo | URL,
	init?: RequestInit,
): Promise<Response> {
	if (isInTauri()) {
		const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
		return tauriFetch(input, init);
	}
	return fetch(input, init);
}
