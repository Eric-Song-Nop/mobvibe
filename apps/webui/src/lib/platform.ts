import { isInTauri } from "@/lib/auth";

/**
 * Returns true when running as a Tauri mobile app (Android or iOS).
 * Returns false in browsers or desktop Tauri builds.
 */
export async function isMobilePlatform(): Promise<boolean> {
	if (!isInTauri()) return false;
	try {
		const { platform } = await import("@tauri-apps/plugin-os");
		const os = await platform();
		return os === "android" || os === "ios";
	} catch {
		return false;
	}
}
