import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Shared mock store used across Tauri tests
const mockStore = {
	get: vi.fn(),
	set: vi.fn(),
	save: vi.fn(),
	delete: vi.fn(),
};

describe("auth-token (non-Tauri)", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.doMock("../auth", () => ({ isInTauri: () => false }));
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("getAuthToken returns null initially", async () => {
		const { getAuthToken } = await import("../auth-token");
		expect(getAuthToken()).toBeNull();
	});

	it("setAuthToken stores token in memory", async () => {
		const { getAuthToken, setAuthToken } = await import("../auth-token");
		setAuthToken("test-token-123");
		expect(getAuthToken()).toBe("test-token-123");
	});

	it("clearAuthToken removes token from memory", async () => {
		const { clearAuthToken, getAuthToken, setAuthToken } = await import(
			"../auth-token"
		);
		setAuthToken("test-token-123");
		await clearAuthToken();
		expect(getAuthToken()).toBeNull();
	});

	it("loadAuthToken is a no-op in non-Tauri environment", async () => {
		vi.doMock("@tauri-apps/plugin-store", () => ({
			load: vi.fn(),
		}));
		const { loadAuthToken } = await import("../auth-token");
		await loadAuthToken();
		// Should not throw and not call store
		const { load } = await import("@tauri-apps/plugin-store");
		expect(load).not.toHaveBeenCalled();
	});
});

describe("auth-token (Tauri)", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.doMock("../auth", () => ({ isInTauri: () => true }));
		vi.doMock("@tauri-apps/plugin-store", () => ({
			load: vi.fn().mockResolvedValue(mockStore),
		}));
		mockStore.get.mockReset();
		mockStore.set.mockReset();
		mockStore.save.mockReset();
		mockStore.delete.mockReset();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("setAuthToken persists token via store", async () => {
		mockStore.set.mockResolvedValue(undefined);
		mockStore.save.mockResolvedValue(undefined);
		const { setAuthToken } = await import("../auth-token");

		setAuthToken("tauri-token");

		// Wait for the async persist to complete
		await vi.waitFor(() => {
			expect(mockStore.set).toHaveBeenCalledWith("bearerToken", "tauri-token");
		});
		expect(mockStore.save).toHaveBeenCalled();
	});

	it("clearAuthToken deletes token from store", async () => {
		mockStore.delete.mockResolvedValue(undefined);
		mockStore.save.mockResolvedValue(undefined);
		const { clearAuthToken } = await import("../auth-token");

		await clearAuthToken();

		expect(mockStore.delete).toHaveBeenCalledWith("bearerToken");
		expect(mockStore.save).toHaveBeenCalled();
	});

	it("loadAuthToken reads token from store into memory", async () => {
		mockStore.get.mockResolvedValue("stored-token");
		const { getAuthToken, loadAuthToken } = await import("../auth-token");

		await loadAuthToken();

		expect(mockStore.get).toHaveBeenCalledWith("bearerToken");
		expect(getAuthToken()).toBe("stored-token");
	});

	it("loadAuthToken does not set cache when store returns null", async () => {
		mockStore.get.mockResolvedValue(null);
		const { getAuthToken, loadAuthToken } = await import("../auth-token");

		await loadAuthToken();

		expect(getAuthToken()).toBeNull();
	});

	it("loadAuthToken silently catches store errors", async () => {
		vi.resetModules();
		vi.doMock("../auth", () => ({ isInTauri: () => true }));
		vi.doMock("@tauri-apps/plugin-store", () => ({
			load: vi.fn().mockRejectedValue(new Error("Store unavailable")),
		}));

		const { getAuthToken, loadAuthToken } = await import("../auth-token");

		// Should not throw
		await loadAuthToken();
		expect(getAuthToken()).toBeNull();
	});
});
