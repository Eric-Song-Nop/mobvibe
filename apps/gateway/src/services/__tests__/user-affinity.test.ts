import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Redis } from "../redis.js";
import { UserAffinityManager } from "../user-affinity.js";

const { mockLoggerWarn } = vi.hoisted(() => ({
	mockLoggerWarn: vi.fn(),
}));

vi.mock("../../lib/logger.js", () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: mockLoggerWarn,
	},
}));

describe("UserAffinityManager ownership safety", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("does not report a claim after ownership changes during refresh", async () => {
		const instanceA = JSON.stringify({ instanceId: "instance-a" });
		const instanceB = JSON.stringify({ instanceId: "instance-b" });
		let stored: string | null = instanceA;
		const redis = {
			set: vi.fn(async () => null),
			get: vi.fn(async () => {
				const observed = stored;
				// Model expiry and a competing claim before the refresh.
				stored = instanceB;
				return observed;
			}),
			expire: vi.fn(async () => 1),
			eval: vi.fn(
				async (
					_script: string,
					_keyCount: number,
					_key: string,
					expected: string,
				) => {
					// A competing claim may happen before the atomic script starts.
					stored = instanceB;
					return stored === expected ? 1 : 0;
				},
			),
		};
		const manager = new UserAffinityManager(
			redis as unknown as Redis,
			"instance-a",
			undefined,
		);

		const claimed = await manager.claimUser("user-1");

		expect(claimed).toBe(false);
		expect(stored).toBe(instanceB);
	});

	it("does not delete affinity claimed by another instance during release", async () => {
		const instanceA = JSON.stringify({ instanceId: "instance-a" });
		const instanceB = JSON.stringify({ instanceId: "instance-b" });
		let stored: string | null = instanceA;
		const redis = {
			get: vi.fn(async () => {
				const observed = stored;
				// Model expiry and a competing claim between GET and DEL.
				stored = instanceB;
				return observed;
			}),
			del: vi.fn(async () => {
				stored = null;
				return 1;
			}),
			eval: vi.fn(
				async (
					_script: string,
					_keyCount: number,
					_key: string,
					expected: string,
				) => {
					// A competing claim may happen before the atomic script starts.
					stored = instanceB;
					if (stored !== expected) return 0;
					stored = null;
					return 1;
				},
			),
		};
		const manager = new UserAffinityManager(
			redis as unknown as Redis,
			"instance-a",
			undefined,
		);

		await manager.releaseUser("user-1");

		expect(stored).toBe(instanceB);
	});

	it("restores a missing affinity key while renewing an active owner", async () => {
		const instanceA = JSON.stringify({ instanceId: "instance-a" });
		let stored: string | null = null;
		const queued: Array<() => [null, number]> = [];
		const pipeline = {
			eval: vi.fn(
				(script: string, _keyCount: number, _key: string, expected: string) => {
					queued.push(() => {
						if (stored === null) {
							if (script.includes("if not existing")) {
								stored = expected;
								return [null, 1];
							}
							return [null, 0];
						}
						return [null, stored === expected ? 2 : 0];
					});
					return pipeline;
				},
			),
			exec: vi.fn(async () => queued.map((execute) => execute())),
		};
		const redis = {
			eval: vi.fn(
				async (
					_script: string,
					_keyCount: number,
					_key: string,
					expected: string,
				) => {
					stored = expected;
					return 1;
				},
			),
			pipeline: vi.fn(() => pipeline),
		};
		const manager = new UserAffinityManager(
			redis as unknown as Redis,
			"instance-a",
			undefined,
		);

		expect(await manager.claimUser("user-1")).toBe(true);
		expect(stored).toBe(instanceA);
		stored = null;

		const conflicts = await manager.renewAll(["user-1"]);

		expect(stored).toBe(instanceA);
		expect(conflicts).toEqual([]);
	});

	it("renews TTL only while this instance still owns the affinity", async () => {
		const instanceB = JSON.stringify({ instanceId: "instance-b" });
		let renewed = false;
		let result = 0;
		const pipeline = {
			expire: vi.fn(() => {
				renewed = true;
				return pipeline;
			}),
			eval: vi.fn(
				(
					_script: string,
					_keyCount: number,
					_key: string,
					expected: string,
				) => {
					if (instanceB === expected) {
						renewed = true;
						result = 2;
					}
					return pipeline;
				},
			),
			exec: vi.fn(async () => [[null, result]]),
		};
		const redis = {
			pipeline: vi.fn(() => pipeline),
		};
		const manager = new UserAffinityManager(
			redis as unknown as Redis,
			"instance-a",
			undefined,
		);

		const conflicts = await manager.renewAll(["user-1"]);

		expect(renewed).toBe(false);
		expect(conflicts).toEqual(["user-1"]);
		expect(mockLoggerWarn).toHaveBeenCalledWith(
			{ userId: "user-1", instanceId: "instance-a" },
			"affinity_renew_conflict",
		);
	});

	it("does not classify Redis command errors as ownership conflicts", async () => {
		const commandError = new Error("redis command failed");
		const pipeline = {
			eval: vi.fn(() => pipeline),
			exec: vi.fn(async () => [[commandError, null]]),
		};
		const redis = {
			pipeline: vi.fn(() => pipeline),
		};
		const manager = new UserAffinityManager(
			redis as unknown as Redis,
			"instance-a",
			undefined,
		);

		const conflicts = await manager.renewAll(["user-1"]);

		expect(conflicts).toEqual([]);
		expect(mockLoggerWarn).toHaveBeenCalledWith(
			{
				err: commandError,
				userId: "user-1",
				instanceId: "instance-a",
			},
			"affinity_renew_command_failed",
		);
	});
});
