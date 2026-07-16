import { InstanceRegistry } from "./instance-registry.js";
import type { Redis } from "./redis.js";
import { UserAffinityManager } from "./user-affinity.js";

export type RegisteredAffinityServices = {
	instanceRegistry: InstanceRegistry;
	userAffinity: UserAffinityManager;
};

type AffinityShutdownServices = {
	instanceRegistry: Pick<InstanceRegistry, "stopHeartbeatLoop" | "deregister">;
	userAffinity: Pick<UserAffinityManager, "shutdownAndReleaseAllOwnedUsers">;
};

export async function createRegisteredAffinityServices(
	redis: Redis,
	instanceId: string,
	region: string | undefined,
): Promise<RegisteredAffinityServices> {
	const instanceRegistry = new InstanceRegistry(redis, instanceId, region);
	const userAffinity = new UserAffinityManager(redis, instanceId, region);

	await instanceRegistry.register();

	return { instanceRegistry, userAffinity };
}

export async function shutdownAffinityServices(
	services: AffinityShutdownServices,
): Promise<void> {
	services.instanceRegistry.stopHeartbeatLoop();
	await services.userAffinity.shutdownAndReleaseAllOwnedUsers();
	await services.instanceRegistry.deregister();
}
