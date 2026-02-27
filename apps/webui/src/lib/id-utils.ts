/**
 * Generate a local UUID-like identifier.
 * Prefers crypto.randomUUID, falls back to getRandomValues, then timestamp-based.
 */
export const createLocalId = (): string => {
	const cryptoRef = globalThis.crypto;
	if (cryptoRef?.randomUUID) {
		return cryptoRef.randomUUID();
	}
	if (cryptoRef?.getRandomValues) {
		const bytes = new Uint8Array(16);
		cryptoRef.getRandomValues(bytes);
		bytes[6] = (bytes[6] & 0x0f) | 0x40;
		bytes[8] = (bytes[8] & 0x3f) | 0x80;
		const toHex = (value: number) => value.toString(16).padStart(2, "0");
		const hex = Array.from(bytes, toHex);
		return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
	}
	return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
};
