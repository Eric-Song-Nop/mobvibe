/**
 * Crypto initialization — pure JS implementation using tweetnacl + @noble/hashes.
 * No WASM or asm.js dependency, works in all environments (browsers, Node.js, Bun).
 */

let _ready = false;

export async function initCrypto(): Promise<void> {
	if (_ready) return;
	// Pure JS crypto requires no async initialization.
	// We keep the async signature for API compatibility.
	_ready = true;
}

export function ensureCryptoReady(): void {
	if (!_ready) {
		throw new Error("Crypto not initialized. Call initCrypto() first.");
	}
}
