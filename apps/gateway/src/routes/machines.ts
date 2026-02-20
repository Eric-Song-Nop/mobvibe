import { fromNodeHeaders } from "better-auth/node";
import { eq } from "drizzle-orm";
import type { Request as ExpressRequest, Router } from "express";
import { db } from "../db/index.js";
import { machines } from "../db/schema.js";
import { auth } from "../lib/auth.js";
import { logger } from "../lib/logger.js";
import type { CliRegistry } from "../services/cli-registry.js";

const extractSessionUserId = async (
	request: ExpressRequest,
): Promise<{
	userId?: string;
	errorResponse?: { status: number; body: unknown };
}> => {
	const session = await auth.api.getSession({
		headers: fromNodeHeaders(request.headers),
	});
	if (session?.user?.id) {
		return { userId: session.user.id };
	}

	return {
		errorResponse: {
			status: 401,
			body: { error: "Authentication required", code: "AUTH_REQUIRED" },
		},
	};
};

export function setupMachineRoutes(
	router: Router,
	cliRegistry: CliRegistry,
): void {
	/**
	 * GET /api/machines
	 * List machines for the authenticated user.
	 */
	router.get("/api/machines", async (req, res) => {
		try {
			// Validate session using Better Auth
			const { userId, errorResponse } = await extractSessionUserId(req);
			if (errorResponse) {
				res.status(errorResponse.status).json(errorResponse.body);
				return;
			}
			if (!userId) {
				res.status(401).json({
					error: "Authentication required",
					code: "AUTH_REQUIRED",
				});
				return;
			}

			// Get user's machines
			const userMachines = await db
				.select({
					id: machines.id,
					name: machines.name,
					hostname: machines.hostname,
					platform: machines.platform,
					lastSeenAt: machines.lastSeenAt,
					createdAt: machines.createdAt,
				})
				.from(machines)
				.where(eq(machines.userId, userId));

			// Merge DB metadata with real-time status from CliRegistry
			const machinesWithStatus = userMachines.map((m) => {
				const cliRecord = cliRegistry.getCliByMachineIdForUser(m.id, userId);
				return {
					...m,
					isOnline: cliRecord !== undefined,
				};
			});

			logger.info(
				{ userId, machineCount: machinesWithStatus.length },
				"machines_list_success",
			);

			res.json({ machines: machinesWithStatus });
		} catch (error) {
			logger.error({ err: error }, "machines_list_error");
			res.status(500).json({
				error: "Failed to list machines",
				code: "LIST_ERROR",
			});
		}
	});
}
