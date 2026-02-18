import sodiumModule from "libsodium-wrappers";
import type { SodiumLib } from "./types.js";

let _sodium: SodiumLib | null = null;

export async function initCrypto(): Promise<void> {
	if (_sodium) return;
	const sodium = (
		"default" in sodiumModule ? sodiumModule.default : sodiumModule
	) as SodiumLib;
	await sodium.ready;
	_sodium = sodium;
}

export function getSodium(): SodiumLib {
	if (!_sodium) {
		throw new Error("Crypto not initialized. Call initCrypto() first.");
	}
	return _sodium;
}
