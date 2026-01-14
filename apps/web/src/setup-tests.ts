import "@testing-library/jest-dom/vitest";

const fallbackUuid = "00000000-0000-0000-0000-000000000000";

if (!globalThis.crypto) {
	globalThis.crypto = {
		randomUUID: () => fallbackUuid,
	} as unknown as Crypto;
} else if (!globalThis.crypto.randomUUID) {
	globalThis.crypto.randomUUID = () => fallbackUuid;
}

if (!globalThis.ResizeObserver) {
	globalThis.ResizeObserver = class ResizeObserver {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
}
