import type { SodiumLib } from "./types.js";

let _sodium: SodiumLib | null = null;

export async function initCrypto(): Promise<void> {
	if (_sodium) return;
	const mod = await import("libsodium-wrappers");
	const sodium = ("default" in mod ? mod.default : mod) as SodiumLib;
	await sodium.ready;
	_sodium = sodium;
}

export function getSodium(): SodiumLib {
	if (!_sodium) {
		throw new Error("Crypto not initialized. Call initCrypto() first.");
	}
	return _sodium;
}
