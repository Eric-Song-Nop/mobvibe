type HotkeyHandler = (e: KeyboardEvent) => void;

type HotkeyEntry = {
	key: string;
	mod?: boolean;
	shift?: boolean;
	handler: HotkeyHandler;
};

/**
 * Returns true when keyboard focus is inside an input element
 * (text input, textarea, or contenteditable).
 */
export function isInputFocused(): boolean {
	const el = document.activeElement;
	if (!el) return false;
	const tag = el.tagName;
	if (tag === "INPUT" || tag === "TEXTAREA") return true;
	if ((el as HTMLElement).isContentEditable) return true;
	return false;
}

/**
 * Register global keyboard shortcuts.
 * Automatically normalises `mod` to Meta (macOS) / Ctrl (Windows/Linux).
 * Returns a cleanup function to remove all listeners.
 */
export function registerHotkeys(entries: HotkeyEntry[]): () => void {
	const isMac =
		typeof navigator !== "undefined" &&
		/mac|iphone|ipad|ipod/i.test(navigator.userAgent);

	const handler = (e: KeyboardEvent) => {
		for (const entry of entries) {
			const modMatch = entry.mod
				? isMac
					? e.metaKey
					: e.ctrlKey
				: !(isMac ? e.metaKey : e.ctrlKey);
			const shiftMatch = entry.shift ? e.shiftKey : !e.shiftKey;
			if (
				e.key.toLowerCase() === entry.key.toLowerCase() &&
				modMatch &&
				shiftMatch
			) {
				e.preventDefault();
				entry.handler(e);
				return;
			}
		}
	};

	window.addEventListener("keydown", handler);
	return () => window.removeEventListener("keydown", handler);
}
