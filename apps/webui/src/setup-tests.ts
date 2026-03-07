import "@testing-library/jest-dom/vitest";

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

if (!globalThis.DOMRect) {
	class DOMRectFallback {
		x = 0;
		y = 0;
		width = 0;
		height = 0;
		left = 0;
		top = 0;
		right = 0;
		bottom = 0;
		constructor(x = 0, y = 0, width = 0, height = 0) {
			this.x = x;
			this.y = y;
			this.width = width;
			this.height = height;
			this.left = x;
			this.top = y;
			this.right = x + width;
			this.bottom = y + height;
		}
	}
	globalThis.DOMRect = DOMRectFallback as typeof DOMRect;
}

if (!Element.prototype.scrollIntoView) {
	Element.prototype.scrollIntoView = () => {};
}

const createMemoryStorage = (): Storage => {
	const store = new Map<string, string>();
	return {
		get length() {
			return store.size;
		},
		clear() {
			store.clear();
		},
		getItem(key: string) {
			return store.has(key) ? (store.get(key) ?? null) : null;
		},
		key(index: number) {
			return Array.from(store.keys())[index] ?? null;
		},
		removeItem(key: string) {
			store.delete(key);
		},
		setItem(key: string, value: string) {
			store.set(key, String(value));
		},
	};
};

const ensureStorage = (name: "localStorage" | "sessionStorage") => {
	const current = globalThis[name];
	if (
		current &&
		typeof current.getItem === "function" &&
		typeof current.setItem === "function" &&
		typeof current.removeItem === "function" &&
		typeof current.clear === "function"
	) {
		return;
	}
	const storage = createMemoryStorage();
	Object.defineProperty(globalThis, name, {
		configurable: true,
		value: storage,
	});
	if (typeof window !== "undefined") {
		Object.defineProperty(window, name, {
			configurable: true,
			value: storage,
		});
	}
};

ensureStorage("localStorage");
ensureStorage("sessionStorage");
