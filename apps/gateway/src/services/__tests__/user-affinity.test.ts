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

	it("releases tracked leases without deleting users claimed by another instance", async () => {
		const instanceA = JSON.stringify({
			instanceId: "instance-a",
			region: undefined,
		});
		const instanceB = JSON.stringify({
			instanceId: "instance-b",
			region: undefined,
		});
		const stored = new Map<string, string>();
		const releaseCommands: Array<() => [null, number]> = [];
		const pipeline = {
			eval: vi.fn(
				(_script: string, _keyCount: number, key: string, expected: string) => {
					releaseCommands.push(() => {
						if (stored.get(key) !== expected) return [null, 0];
						stored.delete(key);
						return [null, 1];
					});
					return pipeline;
				},
			),
			exec: vi.fn(async () => releaseCommands.map((execute) => execute())),
		};
		const redis = {
			eval: vi.fn(
				async (
					_script: string,
					_keyCount: number,
					key: string,
					value: string,
				) => {
					if (stored.has(key) && stored.get(key) !== value) return 0;
					stored.set(key, value);
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

		expect(await manager.claimUser("owned-user")).toBe(true);
		expect(await manager.claimUser("moved-user")).toBe(true);
		expect(stored.get("gw:user:owned-user")).toBe(instanceA);
		stored.set("gw:user:moved-user", instanceB);
		stored.set("gw:user:untracked-user", instanceB);

		await manager.releaseAllOwnedUsers();

		expect(stored.get("gw:user:owned-user")).toBeUndefined();
		expect(stored.get("gw:user:moved-user")).toBe(instanceB);
		expect(stored.get("gw:user:untracked-user")).toBe(instanceB);
		expect(pipeline.eval).toHaveBeenCalledTimes(2);
	});

	it("drains an in-flight claim before releasing leases during shutdown", async () => {
		const owner = JSON.stringify({
			instanceId: "instance-a",
			region: undefined,
		});
		const stored = new Map<string, string>();
		let resolveClaim: ((result: number) => void) | undefined;
		const releaseCommands: Array<() => [null, number]> = [];
		const pipeline = {
			eval: vi.fn(
				(_script: string, _keyCount: number, key: string, expected: string) => {
					releaseCommands.push(() => {
						if (stored.get(key) !== expected) return [null, 0];
						stored.delete(key);
						return [null, 1];
					});
					return pipeline;
				},
			),
			exec: vi.fn(async () => releaseCommands.map((execute) => execute())),
		};
		const redis = {
			eval: vi.fn(
				async (
					_script: string,
					_keyCount: number,
					key: string,
					value: string,
				) => {
					const result = await new Promise<number>((resolve) => {
						resolveClaim = resolve;
					});
					if (result === 1) stored.set(key, value);
					return result;
				},
			),
			pipeline: vi.fn(() => pipeline),
		};
		const manager = new UserAffinityManager(
			redis as unknown as Redis,
			"instance-a",
			undefined,
		);

		const claim = manager.claimUser("racing-user");
		const shutdown = manager.shutdownAndReleaseAllOwnedUsers();
		resolveClaim?.(1);

		await expect(claim).resolves.toBe(true);
		await shutdown;

		expect(stored.get("gw:user:racing-user")).toBeUndefined();
		expect(pipeline.eval).toHaveBeenCalledWith(
			expect.any(String),
			1,
			"gw:user:racing-user",
			owner,
		);
		await expect(manager.claimUser("late-user")).resolves.toBe(false);
		expect(redis.eval).toHaveBeenCalledTimes(1);
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

	it("retains an inactive lease for shutdown and resets its deadline on reclaim", async () => {
		vi.useFakeTimers();
		const stored = new Map<string, string>();
		const queued: Array<() => [null, number]> = [];
		const executeScript = (
			script: string,
			key: string,
			owner: string,
		): number => {
			if (script.includes('redis.call("del"')) {
				if (stored.get(key) !== owner) return 0;
				stored.delete(key);
				return 1;
			}
			if (stored.has(key) && stored.get(key) !== owner) return 0;
			stored.set(key, owner);
			return 1;
		};
		const pipeline = {
			eval: vi.fn(
				(script: string, _keyCount: number, key: string, owner: string) => {
					queued.push(() => [null, executeScript(script, key, owner)]);
					return pipeline;
				},
			),
			exec: vi.fn(async () => queued.splice(0).map((execute) => execute())),
		};
		const redis = {
			eval: vi.fn(
				async (script: string, _keyCount: number, key: string, owner: string) =>
					executeScript(script, key, owner),
			),
			pipeline: vi.fn(() => pipeline),
		};
		const firstManager = new UserAffinityManager(
			redis as unknown as Redis,
			"instance-a",
			undefined,
		);
		const secondManager = new UserAffinityManager(
			redis as unknown as Redis,
			"instance-b",
			undefined,
		);

		try {
			expect(await firstManager.claimUser("inactive-user")).toBe(true);
			await firstManager.renewAll([]);
			expect(
				JSON.parse(stored.get("gw:user:inactive-user") ?? "{}"),
			).toMatchObject({ instanceId: "instance-a" });

			await vi.advanceTimersByTimeAsync(200_000);
			expect(await firstManager.claimUser("inactive-user")).toBe(true);
			await firstManager.renewAll([]);

			// The reclaim starts a fresh inactivity window. Crossing the original
			// deadline must not drop shutdown tracking for the refreshed lease.
			await vi.advanceTimersByTimeAsync(101_000);
			await firstManager.renewAll([]);
			await firstManager.shutdownAndReleaseAllOwnedUsers();
			expect(stored.get("gw:user:inactive-user")).toBeUndefined();

			expect(await secondManager.claimUser("inactive-user")).toBe(true);
			expect(
				JSON.parse(stored.get("gw:user:inactive-user") ?? "{}"),
			).toMatchObject({ instanceId: "instance-b" });
		} finally {
			vi.useRealTimers();
		}
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
