import { describe, expect, it, vi } from "vitest";
import {
	createRegisteredAffinityServices,
	shutdownAffinityServices,
} from "../affinity-initialization.js";
import type { Redis } from "../redis.js";

describe("affinity initialization", () => {
	it("does not publish affinity services when instance registration fails", async () => {
		const registrationError = new Error("registration failed");
		const redis = {
			set: vi.fn(async () => {
				throw registrationError;
			}),
		};
		let published = false;

		await expect(
			createRegisteredAffinityServices(
				redis as unknown as Redis,
				"instance-a",
				"region-a",
			).then(() => {
				published = true;
			}),
		).rejects.toBe(registrationError);

		expect(published).toBe(false);
	});

	it("releases owned user affinities before deregistering the instance", async () => {
		const order: string[] = [];
		const instanceRegistry = {
			stopHeartbeatLoop: vi.fn(() => order.push("stop-heartbeat")),
			deregister: vi.fn(async () => {
				order.push("deregister-instance");
			}),
		};
		const userAffinity = {
			shutdownAndReleaseAllOwnedUsers: vi.fn(async () => {
				order.push("release-users");
			}),
		};

		await shutdownAffinityServices({ instanceRegistry, userAffinity });

		expect(order).toEqual([
			"stop-heartbeat",
			"release-users",
			"deregister-instance",
		]);
	});
});
