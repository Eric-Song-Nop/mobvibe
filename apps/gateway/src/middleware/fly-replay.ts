/**
 * Fly.io replay middleware for HTTP REST routes.
 *
 * For routes that depend on in-process state (/acp/*, /fs/*),
 * checks Redis user affinity and returns a fly-replay header
 * to redirect the request to the correct instance.
 */
import { fromNodeHeaders } from "better-auth/node";
import type { NextFunction, Request, Response } from "express";
import { auth } from "../lib/auth.js";
import { logger } from "../lib/logger.js";
import type { UserAffinityManager } from "../services/user-affinity.js";

export function createFlyReplayMiddleware(
	userAffinity: UserAffinityManager,
	instanceId: string,
) {
	return async (
		req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> => {
		try {
			// Extract userId from session (cookie or bearer)
			const session = await auth.api.getSession({
				headers: fromNodeHeaders(req.headers),
			});

			const userId = session?.user?.id;
			if (!userId) {
				// No session — let downstream auth middleware handle it
				next();
				return;
			}

			const target = await userAffinity.getUserInstance(userId);

			if (target && target.instanceId !== instanceId) {
				// User is on another instance — replay
				logger.info(
					{
						userId,
						targetInstance: target.instanceId,
						targetRegion: target.region,
						path: req.path,
					},
					"fly_replay_redirect",
				);
				res.set("fly-replay", `instance=${target.instanceId}`);
				res.status(409).json({
					error: "Request replayed to correct instance",
					code: "FLY_REPLAY",
				});
				return;
			}

			// User is on this instance or new user — proceed
			next();
		} catch (err) {
			// On any error, degrade gracefully — just pass through
			logger.warn({ err }, "fly_replay_middleware_error");
			next();
		}
	};
}
