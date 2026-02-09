import type { Router } from "express";
import {
	type AuthenticatedRequest,
	getUserId,
	requireAuth,
} from "../middleware/auth.js";
import type { CliRegistry } from "../services/cli-registry.js";

export function setupHealthRoutes(router: Router, cliRegistry: CliRegistry) {
	router.get("/health", (_request, response) => {
		response.json({ ok: true });
	});

	router.get(
		"/status",
		requireAuth,
		(request: AuthenticatedRequest, response) => {
			// userId is guaranteed by requireAuth middleware
			const userId = getUserId(request) as string;
			const clis = cliRegistry.getClisForUser(userId);
			response.json({
				clis: clis.map((cli) => ({
					machineId: cli.machineId,
					hostname: cli.hostname,
					version: cli.version,
					connectedAt: cli.connectedAt.toISOString(),
					sessionCount: cli.sessions.length,
				})),
				sessions: cliRegistry.getSessionsForUser(userId),
			});
		},
	);

	return router;
}
