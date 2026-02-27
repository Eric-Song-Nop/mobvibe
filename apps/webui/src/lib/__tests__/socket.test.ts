import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gatewaySocket } from "../socket";

const socketMock = {
	on: vi.fn(),
	off: vi.fn(),
	emit: vi.fn(),
	disconnect: vi.fn(),
	connected: false,
};

vi.mock("socket.io-client", () => ({
	io: vi.fn(() => socketMock),
}));

describe("gatewaySocket", () => {
	beforeEach(() => {
		socketMock.on.mockReset();
		socketMock.off.mockReset();
		socketMock.emit.mockReset();
		socketMock.disconnect.mockReset();
	});

	it("registers and unregisters session attached handler", () => {
		gatewaySocket.destroy();
		gatewaySocket.connect();
		const handler = vi.fn();
		const unsubscribe = gatewaySocket.onSessionAttached(handler);

		expect(socketMock.on).toHaveBeenCalledWith("session:attached", handler);

		unsubscribe();
		expect(socketMock.off).toHaveBeenCalledWith("session:attached", handler);
	});

	it("registers and unregisters session detached handler", () => {
		gatewaySocket.destroy();
		gatewaySocket.connect();
		const handler = vi.fn();
		const unsubscribe = gatewaySocket.onSessionDetached(handler);

		expect(socketMock.on).toHaveBeenCalledWith("session:detached", handler);

		unsubscribe();
		expect(socketMock.off).toHaveBeenCalledWith("session:detached", handler);
	});

	it("registers and unregisters disconnect handler", () => {
		gatewaySocket.destroy();
		gatewaySocket.connect();
		const handler = vi.fn();
		const unsubscribe = gatewaySocket.onDisconnect(handler);

		expect(socketMock.on).toHaveBeenCalledWith(
			"disconnect",
			expect.any(Function),
		);

		unsubscribe();
		expect(socketMock.off).toHaveBeenCalledWith(
			"disconnect",
			expect.any(Function),
		);
	});
});

describe("gatewaySocket connect() auth branches", () => {
	let mockIo: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.resetModules();
		mockIo = vi.fn(() => ({
			on: vi.fn(),
			off: vi.fn(),
			emit: vi.fn(),
			disconnect: vi.fn(),
			connected: false,
		}));
		vi.doMock("socket.io-client", () => ({ io: mockIo }));
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("uses withCredentials in browser environment", async () => {
		vi.doMock("../auth", () => ({ isInTauri: () => false }));
		vi.doMock("../auth-token", () => ({ getAuthToken: () => null }));

		const { gatewaySocket: gs } = await import("../socket");
		gs.connect();

		expect(mockIo).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({
				withCredentials: true,
			}),
		);
		const callOpts = mockIo.mock.calls[0][1];
		expect(callOpts.auth).toBeUndefined();
	});

	it("uses auth token in Tauri environment", async () => {
		vi.doMock("../auth", () => ({ isInTauri: () => true }));
		vi.doMock("../auth-token", () => ({
			getAuthToken: () => "tauri-test-token",
		}));

		const { gatewaySocket: gs } = await import("../socket");
		gs.connect();

		expect(mockIo).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({
				auth: { token: "tauri-test-token" },
			}),
		);
		const callOpts = mockIo.mock.calls[0][1];
		expect(callOpts.withCredentials).toBeUndefined();
	});
});
