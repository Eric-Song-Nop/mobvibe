import { beforeEach, describe, expect, it, vi } from "vitest";
import { mountClientRoot } from "@/lib/mount-client-root";

describe("website client entry", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("uses a client render for Vite's empty development root", () => {
		document.body.innerHTML = '<div id="root"></div>';
		const root = document.getElementById("root");
		const render = vi.fn();
		const hydrate = vi.fn();
		if (!root) throw new Error("Root element not found");

		mountClientRoot(root, { render, hydrate });

		expect(render).toHaveBeenCalledOnce();
		expect(hydrate).not.toHaveBeenCalled();
	});

	it("hydrates the prerendered production root", () => {
		document.body.innerHTML = '<div id="root"><main>Prerendered</main></div>';
		const root = document.getElementById("root");
		const render = vi.fn();
		const hydrate = vi.fn();
		if (!root) throw new Error("Root element not found");

		mountClientRoot(root, { render, hydrate });

		expect(hydrate).toHaveBeenCalledOnce();
		expect(render).not.toHaveBeenCalled();
	});
});
