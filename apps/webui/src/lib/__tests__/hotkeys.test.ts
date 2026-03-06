import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerHotkeys } from "../hotkeys";

/**
 * Detects if we're on a Mac platform based on userAgent.
 */
function isMacPlatform(): boolean {
	return /mac|iphone|ipad|ipod/i.test(navigator.userAgent);
}

/**
 * Creates a KeyboardEvent with the appropriate modifier key based on platform.
 * Uses metaKey for Mac and ctrlKey for non-Mac.
 */
function createModKeyEvent(key: string): KeyboardEvent {
	const isMac = isMacPlatform();
	return new KeyboardEvent("keydown", {
		key,
		metaKey: isMac,
		ctrlKey: !isMac,
		bubbles: true,
		cancelable: true,
	});
}

describe("registerHotkeys", () => {
	let cleanup: (() => void) | null = null;

	beforeEach(() => {
		cleanup = null;
	});

	afterEach(() => {
		if (cleanup) {
			cleanup();
			cleanup = null;
		}
	});

	describe("Command Palette Hotkeys", () => {
		it("triggers handler on cmd+k (Mac) or ctrl+k (non-Mac)", () => {
			const mockHandler = vi.fn();
			cleanup = registerHotkeys([
				{
					key: "k",
					mod: true,
					handler: mockHandler,
				},
			]);

			const event = createModKeyEvent("k");
			window.dispatchEvent(event);

			expect(mockHandler).toHaveBeenCalledTimes(1);
		});

		it("does NOT trigger on cmd+p or ctrl+p (cmd+p is disabled)", () => {
			const mockCmdKHandler = vi.fn();

			cleanup = registerHotkeys([
				{
					key: "k",
					mod: true,
					handler: mockCmdKHandler,
				},
				// cmd+p is NOT registered - this is the key fix
			]);

			const event = createModKeyEvent("p");
			window.dispatchEvent(event);

			// cmd+p should not trigger anything since it's not registered
			expect(mockCmdKHandler).not.toHaveBeenCalled();
		});

		it("prevents default when matching hotkey is pressed", () => {
			const mockHandler = vi.fn();
			cleanup = registerHotkeys([
				{
					key: "k",
					mod: true,
					handler: mockHandler,
				},
			]);

			const event = createModKeyEvent("k");
			window.dispatchEvent(event);

			expect(event.defaultPrevented).toBe(true);
		});
	});

	describe("Other Hotkeys", () => {
		it("triggers handler on cmd+f or ctrl+f", () => {
			const mockHandler = vi.fn();
			cleanup = registerHotkeys([
				{
					key: "f",
					mod: true,
					handler: mockHandler,
				},
			]);

			const event = createModKeyEvent("f");
			window.dispatchEvent(event);

			expect(mockHandler).toHaveBeenCalledTimes(1);
		});

		it("triggers handler on cmd+b or ctrl+b", () => {
			const mockHandler = vi.fn();
			cleanup = registerHotkeys([
				{
					key: "b",
					mod: true,
					handler: mockHandler,
				},
			]);

			const event = createModKeyEvent("b");
			window.dispatchEvent(event);

			expect(mockHandler).toHaveBeenCalledTimes(1);
		});

		it("triggers handler on cmd+n or ctrl+n", () => {
			const mockHandler = vi.fn();
			cleanup = registerHotkeys([
				{
					key: "n",
					mod: true,
					handler: mockHandler,
				},
			]);

			const event = createModKeyEvent("n");
			window.dispatchEvent(event);

			expect(mockHandler).toHaveBeenCalledTimes(1);
		});
	});

	describe("Hotkey Registration", () => {
		it("returns cleanup function to remove listeners", () => {
			const mockHandler = vi.fn();
			cleanup = registerHotkeys([
				{
					key: "k",
					mod: true,
					handler: mockHandler,
				},
			]);

			expect(typeof cleanup).toBe("function");

			// Call cleanup
			cleanup();

			// After cleanup, hotkey should not trigger
			const event = createModKeyEvent("k");
			window.dispatchEvent(event);

			expect(mockHandler).not.toHaveBeenCalled();
		});
	});
});
