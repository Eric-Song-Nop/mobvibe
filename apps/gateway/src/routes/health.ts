import type { Router } from "express";
import type { CliRegistry } from "../services/cli-registry.js";

export function setupHealthRoutes(router: Router, cliRegistry: CliRegistry) {
	router.get("/health", (_request, response) => {
		const clis = cliRegistry.getAllClis();
		response.json({
			ok: true,
			connectedClis: clis.length,
			totalSessions: cliRegistry.getAllSessions().length,
		});
	});

	router.get("/status", (_request, response) => {
		const clis = cliRegistry.getAllClis();
		response.json({
			clis: clis.map((cli) => ({
				machineId: cli.machineId,
				hostname: cli.hostname,
				version: cli.version,
				connectedAt: cli.connectedAt.toISOString(),
				sessionCount: cli.sessions.length,
			})),
			sessions: cliRegistry.getAllSessions(),
		});
	});

	return router;
}
