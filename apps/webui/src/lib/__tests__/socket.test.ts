import { beforeEach, describe, expect, it, vi } from "vitest";
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
		gatewaySocket.disconnect();
		gatewaySocket.connect();
		const handler = vi.fn();
		const unsubscribe = gatewaySocket.onSessionAttached(handler);

		expect(socketMock.on).toHaveBeenCalledWith("session:attached", handler);

		unsubscribe();
		expect(socketMock.off).toHaveBeenCalledWith("session:attached", handler);
	});

	it("registers and unregisters session detached handler", () => {
		gatewaySocket.disconnect();
		gatewaySocket.connect();
		const handler = vi.fn();
		const unsubscribe = gatewaySocket.onSessionDetached(handler);

		expect(socketMock.on).toHaveBeenCalledWith("session:detached", handler);

		unsubscribe();
		expect(socketMock.off).toHaveBeenCalledWith("session:detached", handler);
	});

	it("registers and unregisters disconnect handler", () => {
		gatewaySocket.disconnect();
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
