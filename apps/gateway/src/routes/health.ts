import type { Router } from "express";
import type { GatewayConfig } from "../config.js";
import type { UserAffinityManager } from "../services/user-affinity.js";

type HealthDeps = {
	getUserAffinity: () => UserAffinityManager | null;
};

export function setupHealthRoutes(
	router: Router,
	config: GatewayConfig,
	deps?: HealthDeps,
) {
	router.get("/health", (_request, response) => {
		response.json({
			ok: true,
			instanceId: config.instanceId,
			region: config.flyRegion,
			affinityEnabled: deps?.getUserAffinity() != null,
			uptime: process.uptime(),
		});
	});

	return router;
}
