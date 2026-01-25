import type { CliStatusPayload } from "@mobvibe/shared";
import { fromNodeHeaders } from "better-auth/node";
import { eq } from "drizzle-orm";
import type { Request as ExpressRequest, Response, Router } from "express";
import { db } from "../db/index.js";
import { machines } from "../db/schema.js";
import { auth } from "../lib/auth.js";
import { logger } from "../lib/logger.js";
import type { CliRegistry } from "../services/cli-registry.js";

const sendSseEvent = (response: Response, payload: unknown) => {
	response.write(`data: ${JSON.stringify(payload)}\n\n`);
};

const keepAlive = (response: Response) => {
	response.write(": ping\n\n");
};

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
					isOnline: machines.isOnline,
					lastSeenAt: machines.lastSeenAt,
					createdAt: machines.createdAt,
				})
				.from(machines)
				.where(eq(machines.userId, userId));

			logger.info(
				{ userId, machineCount: userMachines.length },
				"machines_list_success",
			);

			res.json({ machines: userMachines });
		} catch (error) {
			logger.error({ error }, "machines_list_error");
			res.status(500).json({
				error: "Failed to list machines",
				code: "LIST_ERROR",
			});
		}
	});

	/**
	 * GET /api/machines/stream
	 * Stream machine status updates via SSE.
	 */
	router.get("/api/machines/stream", async (req, res) => {
		try {
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
			const sessionUserId = userId;

			const origin = req.headers.origin;
			if (origin) {
				res.setHeader("Access-Control-Allow-Origin", origin);
				res.setHeader("Access-Control-Allow-Credentials", "true");
				res.setHeader("Vary", "Origin");
			}

			res.writeHead(200, {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				Connection: "keep-alive",
			});
			res.flushHeaders?.();

			const heartbeat = setInterval(() => {
				keepAlive(res);
			}, 25000);

			const unsubscribe = cliRegistry.onCliStatus(
				(payload: CliStatusPayload) => {
					if (
						payload.userId &&
						sessionUserId &&
						payload.userId !== sessionUserId
					) {
						return;
					}
					sendSseEvent(res, {
						machineId: payload.machineId,
						isOnline: payload.connected,
						hostname: payload.hostname ?? null,
						sessionCount: payload.sessionCount ?? null,
					});
				},
			);

			const cleanup = () => {
				clearInterval(heartbeat);
				unsubscribe();
				res.end();
			};

			req.on("close", cleanup);
		} catch (error) {
			logger.error({ error }, "machines_stream_error");
			res.status(500).json({
				error: "Failed to stream machine updates",
				code: "STREAM_ERROR",
			});
		}
	});

	/**
	 * DELETE /api/machines/:id
	 * Delete a machine for the authenticated user.
	 */
	router.delete("/api/machines/:id", async (req, res) => {
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

			const machineId = req.params.id;

			// Verify machine belongs to user before deleting
			const existing = await db
				.select({ userId: machines.userId })
				.from(machines)
				.where(eq(machines.id, machineId))
				.limit(1);

			if (existing.length === 0) {
				res.status(404).json({
					error: "Machine not found",
					code: "NOT_FOUND",
				});
				return;
			}

			if (existing[0].userId !== userId) {
				res.status(403).json({
					error: "Not authorized to delete this machine",
					code: "FORBIDDEN",
				});
				return;
			}

			await db.delete(machines).where(eq(machines.id, machineId));

			res.json({ success: true });
		} catch (error) {
			logger.error(
				{ error, machineId: req.params.id },
				"machines_delete_error",
			);
			res.status(500).json({
				error: "Failed to delete machine",
				code: "DELETE_ERROR",
			});
		}
	});
}
