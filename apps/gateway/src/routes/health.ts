import type { Router } from "express";
import type { GatewayConfig } from "../config.js";

export function setupHealthRoutes(router: Router, config: GatewayConfig) {
	router.get("/health", (_request, response) => {
		response.json({
			ok: true,
			instanceId: config.instanceId,
			uptime: process.uptime(),
		});
	});

	return router;
}
