import type { Socket } from "socket.io";
import { describe, expect, it, vi } from "vitest";
import { renewActiveUserAffinities } from "../affinity-renewal.js";
import type { CliRegistry } from "../cli-registry.js";
import type { Redis } from "../redis.js";
import { UserAffinityManager } from "../user-affinity.js";

const { mockLoggerWarn } = vi.hoisted(() => ({
	mockLoggerWarn: vi.fn(),
}));

vi.mock("../../lib/logger.js", () => ({
	logger: {
		warn: mockLoggerWarn,
	},
}));

const createSocket = (id: string, userId: string) =>
	({
		id,
		data: { userId },
		disconnect: vi.fn(),
		conn: { close: vi.fn() },
	}) as unknown as Socket;

describe("renewActiveUserAffinities", () => {
	it("disconnects only local sockets whose affinity moved to another owner", async () => {
		const instanceA = JSON.stringify({ instanceId: "instance-a" });
		const instanceB = JSON.stringify({ instanceId: "instance-b" });
		const stored = new Map<string, string>([
			["gw:user:user-1", instanceB],
			["gw:user:user-2", instanceA],
		]);
		const queued: Array<() => [null, number]> = [];
		const pipeline = {
			eval: vi.fn(
				(script: string, _keyCount: number, key: string, expected: string) => {
					queued.push(() => {
						const existing = stored.get(key);
						if (!existing && script.includes("if not existing")) {
							stored.set(key, expected);
							return [null, 1];
						}
						return [null, existing === expected ? 2 : 0];
					});
					return pipeline;
				},
			),
			exec: vi.fn(async () => queued.map((execute) => execute())),
		};
		const userAffinity = new UserAffinityManager(
			{ pipeline: vi.fn(() => pipeline) } as unknown as Redis,
			"instance-a",
			undefined,
		);
		const conflictingCliSocket = createSocket("cli-conflict", "user-1");
		const healthyCliSocket = createSocket("cli-healthy", "user-2");
		const conflictingWebuiSocket = createSocket("webui-conflict", "user-1");
		const healthyWebuiSocket = createSocket("webui-healthy", "user-2");
		const cliRegistry = {
			getConnectedUserIds: vi.fn(() => ["user-1", "user-2"]),
			getClisForUser: vi.fn((userId: string) =>
				userId === "user-1"
					? [{ socket: conflictingCliSocket }]
					: [{ socket: healthyCliSocket }],
			),
		} as unknown as CliRegistry;

		const conflicts = await renewActiveUserAffinities(
			userAffinity,
			cliRegistry,
			[conflictingWebuiSocket, healthyWebuiSocket],
		);

		expect(conflicts).toEqual(["user-1"]);
		expect(stored.get("gw:user:user-1")).toBe(instanceB);
		expect(conflictingCliSocket.conn.close).toHaveBeenCalledOnce();
		expect(conflictingWebuiSocket.conn.close).toHaveBeenCalledOnce();
		expect(conflictingCliSocket.disconnect).not.toHaveBeenCalled();
		expect(conflictingWebuiSocket.disconnect).not.toHaveBeenCalled();
		expect(healthyCliSocket.disconnect).not.toHaveBeenCalled();
		expect(healthyWebuiSocket.disconnect).not.toHaveBeenCalled();
		expect(mockLoggerWarn).toHaveBeenCalledWith(
			{ userId: "user-1", cliCount: 1, webuiCount: 1 },
			"affinity_conflict_connections_disconnected",
		);
	});
});
