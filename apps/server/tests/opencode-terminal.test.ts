import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

class MockChildProcess extends EventEmitter {
	stdout = new PassThrough();
	stderr = new PassThrough();
	stdin = new PassThrough();
	exitCode: number | null = null;
	killed = false;
	kill = vi.fn((signal?: NodeJS.Signals) => {
		this.killed = true;
		this.exitCode = null;
		this.emit("exit", null, signal ?? null);
	});
}

let lastChild: MockChildProcess | undefined;
const spawnMock = vi.fn(() => {
	lastChild = new MockChildProcess();
	return lastChild as unknown as ReturnType<typeof spawnMock>;
});

vi.mock("node:child_process", () => ({
	spawn: spawnMock,
}));

const { AcpConnection } = await import("../src/acp/acp-connection.js");

const buildConnection = () =>
	new AcpConnection({
		backend: { id: "opencode", label: "opencode" },
		command: "opencode",
		args: ["acp"],
		client: { name: "mobvibe", version: "0.0.0" },
	});

describe("AcpConnection terminal output", () => {
	beforeEach(() => {
		lastChild = undefined;
		spawnMock.mockClear();
	});

	it("truncates output and reports exit status", async () => {
		const connection = buildConnection();
		const outputs: Array<{
			terminalId: string;
			truncated: boolean;
			output?: string;
			exitStatus?: { exitCode?: number | null; signal?: string | null } | null;
		}> = [];
		const unsubscribe = connection.onTerminalOutput((payload) => {
			outputs.push(payload);
		});

		const response = await connection.createTerminal({
			sessionId: "session-1",
			command: "echo",
			args: ["hello"],
			outputByteLimit: 8,
		});

		const child = lastChild;
		expect(child).toBeDefined();
		if (!child) {
			return;
		}

		const exitPromise = connection.waitForTerminalExit({
			sessionId: "session-1",
			terminalId: response.terminalId,
		});

		child.stdout.write("123456789");
		child.emit("exit", 0, null);

		await expect(exitPromise).resolves.toEqual({
			exitCode: 0,
			signal: null,
		});

		expect(outputs[0]).toMatchObject({
			terminalId: response.terminalId,
			truncated: true,
			output: "23456789",
		});
		const lastOutput = outputs[outputs.length - 1];
		expect(lastOutput).toMatchObject({
			exitStatus: { exitCode: 0, signal: null },
			output: "23456789",
		});

		const snapshot = await connection.getTerminalOutput({
			sessionId: "session-1",
			terminalId: response.terminalId,
		});
		expect(snapshot).toEqual({
			output: "23456789",
			truncated: true,
			exitStatus: { exitCode: 0, signal: null },
		});

		unsubscribe();
	});
});
