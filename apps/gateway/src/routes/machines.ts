import { fromNodeHeaders } from "better-auth/node";
import { eq } from "drizzle-orm";
import type { Router } from "express";
import { db } from "../db/index.js";
import { machines } from "../db/schema.js";
import { auth } from "../lib/auth.js";

export function setupMachineRoutes(router: Router): void {
	/**
	 * GET /api/machines
	 * List machines for the authenticated user.
	 */
	router.get("/api/machines", async (req, res) => {
		try {
			// Validate session using Better Auth
			const session = await auth.api.getSession({
				headers: fromNodeHeaders(req.headers),
			});

			if (!session?.user) {
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
				.where(eq(machines.userId, session.user.id));

			res.json({ machines: userMachines });
		} catch (error) {
			console.error("[machines] List error:", error);
			res.status(500).json({
				error: "Failed to list machines",
				code: "LIST_ERROR",
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
			const session = await auth.api.getSession({
				headers: fromNodeHeaders(req.headers),
			});

			if (!session?.user) {
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

			if (existing[0].userId !== session.user.id) {
				res.status(403).json({
					error: "Not authorized to delete this machine",
					code: "FORBIDDEN",
				});
				return;
			}

			await db.delete(machines).where(eq(machines.id, machineId));

			res.json({ success: true });
		} catch (error) {
			console.error("[machines] Delete error:", error);
			res.status(500).json({
				error: "Failed to delete machine",
				code: "DELETE_ERROR",
			});
		}
	});
}
