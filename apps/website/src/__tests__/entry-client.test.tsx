import { beforeEach, describe, expect, it, vi } from "vitest";

const render = vi.fn();
const createRoot = vi.fn(() => ({ render }));
const hydrateRoot = vi.fn();

vi.mock("react-dom/client", () => ({ createRoot, hydrateRoot }));

describe("website client entry", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
	});

	it("uses a client render for Vite's empty development root", async () => {
		document.body.innerHTML = '<div id="root"></div>';

		await import("@/entry-client");

		expect(createRoot).toHaveBeenCalledOnce();
		expect(render).toHaveBeenCalledOnce();
		expect(hydrateRoot).not.toHaveBeenCalled();
	});

	it("hydrates the prerendered production root", async () => {
		document.body.innerHTML = '<div id="root"><main>Prerendered</main></div>';

		await import("@/entry-client");

		expect(hydrateRoot).toHaveBeenCalledOnce();
		expect(createRoot).not.toHaveBeenCalled();
	});
});
