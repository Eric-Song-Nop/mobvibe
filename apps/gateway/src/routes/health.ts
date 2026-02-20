import type { Router } from "express";

export function setupHealthRoutes(router: Router) {
	router.get("/health", (_request, response) => {
		response.json({ ok: true });
	});

	return router;
}
