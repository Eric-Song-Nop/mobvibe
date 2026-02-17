import type { CliRegistrationInfo, SessionSummary } from "@mobvibe/shared";
import type { Server } from "socket.io";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CliRegistry } from "../../services/cli-registry.js";
import { setupCliHandlers } from "../cli-handlers.js";

vi.mock("@mobvibe/shared", () => ({
	initCrypto: vi.fn().mockResolvedValue(undefined),
	verifySignedToken: vi.fn(),
}));

vi.mock("../../services/db-service.js", () => ({
	upsertMachine: vi.fn(),
	findDeviceByPublicKey: vi.fn(),
}));

vi.mock("../../lib/logger.js", () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}));

const createMockSessionSummary = (
	overrides: Partial<SessionSummary> = {},
): SessionSummary => ({
	sessionId: `session-${Math.random().toString(36).slice(2, 8)}`,
	title: "Test Session",
	backendId: "backend-1",
	backendLabel: "Claude Code",
	createdAt: new Date().toISOString(),
	updatedAt: new Date().toISOString(),
	...overrides,
});

const createMockRegistrationInfo = (
	overrides: Partial<CliRegistrationInfo> = {},
): CliRegistrationInfo => ({
	machineId: `machine-${Math.random().toString(36).slice(2, 8)}`,
	hostname: "test-host",
	version: "1.0.0",
	backends: [{ backendId: "backend-1", backendLabel: "Claude Code" }],
	...overrides,
});

describe("setupCliHandlers", () => {
	let registry: CliRegistry;
	let emitToWebui: ReturnType<typeof vi.fn>;
	let connectionHandler: ((socket: any) => void) | undefined;
	let socketHandlers: Record<string, (payload?: any) => void>;
	let socket: any;

	beforeEach(() => {
		registry = new CliRegistry();
		emitToWebui = vi.fn();
		socketHandlers = {};
		socket = {
			id: "socket-1",
			handshake: { headers: {} },
			data: { userId: "user-1", deviceId: "device-123" },
			on: vi.fn((event: string, handler: (payload?: any) => void) => {
				socketHandlers[event] = handler;
			}),
			emit: vi.fn(),
			disconnect: vi.fn(),
		};

		const namespace = {
			use: vi.fn(),
			on: vi.fn((event: string, handler: (socket: any) => void) => {
				if (event === "connection") {
					connectionHandler = handler;
				}
			}),
		};

		const io = {
			of: vi.fn(() => namespace),
		} as unknown as Server;

		setupCliHandlers(
			io,
			registry,
			{ handleRpcResponse: vi.fn() } as any,
			emitToWebui,
		);

		connectionHandler?.(socket);
	});

	it("forwards session:attached events to webui", () => {
		// Register the socket first so the guard passes
		const info = createMockRegistrationInfo({ machineId: "machine-1" });
		registry.register(socket, info, {
			userId: "user-1",
			deviceId: "device-123",
		});

		socketHandlers["session:attached"]?.({
			sessionId: "session-1",
			machineId: "machine-1",
			attachedAt: "2024-01-01T00:00:00Z",
		});

		expect(emitToWebui).toHaveBeenCalledWith(
			"session:attached",
			{
				sessionId: "session-1",
				machineId: "machine-1",
				attachedAt: "2024-01-01T00:00:00Z",
			},
			"user-1",
		);
	});

	it("forwards session:detached events to webui", () => {
		// Register the socket first so the guard passes
		const info = createMockRegistrationInfo({ machineId: "machine-1" });
		registry.register(socket, info, {
			userId: "user-1",
			deviceId: "device-123",
		});

		socketHandlers["session:detached"]?.({
			sessionId: "session-1",
			machineId: "machine-1",
			detachedAt: "2024-01-01T00:00:00Z",
			reason: "agent_exit",
		});

		expect(emitToWebui).toHaveBeenCalledWith(
			"session:detached",
			{
				sessionId: "session-1",
				machineId: "machine-1",
				detachedAt: "2024-01-01T00:00:00Z",
				reason: "agent_exit",
			},
			"user-1",
		);
	});

	it("emits detached events for active sessions on disconnect", async () => {
		const info = createMockRegistrationInfo({ machineId: "machine-1" });
		registry.register(socket, info, {
			userId: "user-1",
			deviceId: "device-123",
		});
		registry.updateSessions("socket-1", [
			createMockSessionSummary({ sessionId: "session-1" }),
			createMockSessionSummary({ sessionId: "session-2" }),
		]);

		await socketHandlers.disconnect?.("transport close");

		expect(emitToWebui).toHaveBeenCalledWith(
			"session:detached",
			expect.objectContaining({
				sessionId: "session-1",
				machineId: "machine-1",
				reason: "cli_disconnect",
				detachedAt: expect.any(String),
			}),
			"user-1",
		);
		expect(emitToWebui).toHaveBeenCalledWith(
			"session:detached",
			expect.objectContaining({
				sessionId: "session-2",
				machineId: "machine-1",
				reason: "cli_disconnect",
				detachedAt: expect.any(String),
			}),
			"user-1",
		);
	});
});
