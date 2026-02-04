import { beforeEach, describe, expect, it, mock } from "bun:test";

// Mock the SDK
mock.module("@agentclientprotocol/sdk", () => ({
	ClientSideConnection: mock(() => {}),
	ndJsonStream: mock(() => {}),
	PROTOCOL_VERSION: "0.1.0",
}));

// Mock child_process
mock.module("node:child_process", () => ({
	spawn: mock(() => ({
		stdin: { pipe: mock(() => {}) },
		stdout: { pipe: mock(() => {}) },
		stderr: { pipe: mock(() => {}) },
		on: mock(() => {}),
		once: mock(() => {}),
		kill: mock(() => {}),
		exitCode: null,
		killed: false,
		pid: 12345,
	})),
}));

// Mock stream
mock.module("node:stream", () => ({
	Readable: { toWeb: mock(() => ({})) },
	Writable: { toWeb: mock(() => ({})) },
}));

import type { AcpBackendConfig } from "../../config.js";
import { AcpConnection } from "../acp-connection.js";

const createMockBackendConfig = (): AcpBackendConfig => ({
	id: "test-backend",
	label: "Test Backend",
	command: "test-command",
	args: ["--arg1"],
});

describe("AcpConnection", () => {
	let connection: AcpConnection;
	let mockBackend: AcpBackendConfig;

	beforeEach(() => {
		mockBackend = createMockBackendConfig();
		connection = new AcpConnection({
			backend: mockBackend,
			client: { name: "test-client", version: "1.0.0" },
		});
	});

	describe("getSessionCapabilities", () => {
		it("returns all false when agentCapabilities is undefined", () => {
			const capabilities = connection.getSessionCapabilities();

			expect(capabilities.list).toBe(false);
			expect(capabilities.load).toBe(false);
		});

		it("returns correct capabilities when sessionCapabilities.list is defined", () => {
			// Access private property for testing
			// @ts-expect-error - accessing private property for testing
			connection.agentCapabilities = {
				sessionCapabilities: {
					list: {},
				},
			};

			const capabilities = connection.getSessionCapabilities();

			expect(capabilities.list).toBe(true);
			expect(capabilities.load).toBe(false);
		});

		it("returns correct capabilities when loadSession is true", () => {
			// @ts-expect-error - accessing private property for testing
			connection.agentCapabilities = {
				loadSession: true,
			};

			const capabilities = connection.getSessionCapabilities();

			expect(capabilities.list).toBe(false);
			expect(capabilities.load).toBe(true);
		});
	});

	describe("supportsSessionList", () => {
		it("returns false when agentCapabilities is undefined", () => {
			expect(connection.supportsSessionList()).toBe(false);
		});

		it("returns false when sessionCapabilities is undefined", () => {
			// @ts-expect-error - accessing private property for testing
			connection.agentCapabilities = {};

			expect(connection.supportsSessionList()).toBe(false);
		});

		it("returns false when sessionCapabilities.list is null", () => {
			// @ts-expect-error - accessing private property for testing
			connection.agentCapabilities = {
				sessionCapabilities: {
					list: null,
				},
			};

			expect(connection.supportsSessionList()).toBe(false);
		});

		it("returns true when sessionCapabilities.list is defined", () => {
			// @ts-expect-error - accessing private property for testing
			connection.agentCapabilities = {
				sessionCapabilities: {
					list: {},
				},
			};

			expect(connection.supportsSessionList()).toBe(true);
		});
	});

	describe("supportsSessionLoad", () => {
		it("returns false when agentCapabilities is undefined", () => {
			expect(connection.supportsSessionLoad()).toBe(false);
		});

		it("returns false when loadSession is false", () => {
			// @ts-expect-error - accessing private property for testing
			connection.agentCapabilities = {
				loadSession: false,
			};

			expect(connection.supportsSessionLoad()).toBe(false);
		});

		it("returns false when loadSession is undefined", () => {
			// @ts-expect-error - accessing private property for testing
			connection.agentCapabilities = {};

			expect(connection.supportsSessionLoad()).toBe(false);
		});

		it("returns true when loadSession is true", () => {
			// @ts-expect-error - accessing private property for testing
			connection.agentCapabilities = {
				loadSession: true,
			};

			expect(connection.supportsSessionLoad()).toBe(true);
		});
	});

	describe("listSessions", () => {
		it("returns empty array when session list not supported", async () => {
			// agentCapabilities is undefined, so supportsSessionList() returns false
			const result = await connection.listSessions();

			expect(result).toEqual({ sessions: [] });
		});
	});

	describe("loadSession", () => {
		it("throws error when session load not supported", async () => {
			// agentCapabilities is undefined, so supportsSessionLoad() returns false
			await expect(
				connection.loadSession("session-1", "/home/user/project"),
			).rejects.toThrow("Agent does not support session/load capability");
		});
	});

	describe("getStatus", () => {
		it("returns backend info in status", () => {
			const status = connection.getStatus();

			expect(status.backendId).toBe("test-backend");
			expect(status.backendLabel).toBe("Test Backend");
			expect(status.command).toBe("test-command");
			expect(status.args).toEqual(["--arg1"]);
			expect(status.state).toBe("idle");
		});
	});
});
