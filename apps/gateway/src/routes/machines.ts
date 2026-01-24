import { randomUUID } from "node:crypto";
import { fromNodeHeaders } from "better-auth/node";
import { eq } from "drizzle-orm";
import type { Router } from "express";
import { db } from "../db/index.js";
import { machines } from "../db/schema.js";
import { auth } from "../lib/auth.js";
import { completeRegistration } from "../socket/cli-handlers.js";

/**
 * Generate a secure machine token.
 */
function generateMachineToken(): string {
	return `mt_${randomUUID().replace(/-/g, "")}`;
}

export function setupMachineRoutes(router: Router): void {
	/**
	 * POST /api/machines/register
	 * Register a new machine for the authenticated user.
	 */
	router.post("/api/machines/register", async (req, res) => {
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

			const { name, hostname, platform, registrationCode } = req.body as {
				name?: string;
				hostname?: string;
				platform?: string;
				registrationCode?: string;
			};

			if (!name || !hostname) {
				res.status(400).json({
					error: "Missing required fields: name, hostname",
					code: "INVALID_REQUEST",
				});
				return;
			}

			// Generate machine token
			const machineToken = generateMachineToken();
			const machineId = randomUUID();

			// Create machine record
			await db.insert(machines).values({
				id: machineId,
				userId: session.user.id,
				name,
				hostname,
				platform: platform ?? null,
				machineToken,
				isOnline: false,
			});

			// If registrationCode provided, push credentials to CLI via Socket.io
			if (registrationCode) {
				const pushed = completeRegistration(registrationCode, {
					machineToken,
					machineId,
					userId: session.user.id,
					email: session.user.email ?? undefined,
				});
				if (!pushed) {
					console.log(
						`[machines] No pending registration for code ${registrationCode.slice(0, 8)}...`,
					);
				}
			}

			res.json({
				machineId,
				machineToken,
				userId: session.user.id,
				email: session.user.email,
			});
		} catch (error) {
			console.error("[machines] Registration error:", error);
			res.status(500).json({
				error: "Failed to register machine",
				code: "REGISTRATION_ERROR",
			});
		}
	});

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
}
