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
import type { UserAffinityProvider } from "../services/user-affinity.js";

export const INSTANCE_ROUTING_REQUEST_HEADER = "fly-force-instance-id";
export const INSTANCE_ROUTING_RESPONSE_HEADER = "x-mobvibe-instance-id";
export const INSTANCE_ROUTING_ALLOWED_HEADERS = Object.freeze([
	"Content-Type",
	"Authorization",
	INSTANCE_ROUTING_REQUEST_HEADER,
]);
export const INSTANCE_ROUTING_EXPOSED_HEADERS = Object.freeze([
	INSTANCE_ROUTING_RESPONSE_HEADER,
]);

export function createFlyReplayMiddleware(
	getUserAffinity: UserAffinityProvider,
	instanceId: string,
) {
	return async (
		req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> => {
		try {
			const userAffinity = getUserAffinity();
			if (!userAffinity) {
				next();
				return;
			}

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
				res.set(INSTANCE_ROUTING_RESPONSE_HEADER, target.instanceId);
				const forcedInstance = req.headers[INSTANCE_ROUTING_REQUEST_HEADER];
				if (typeof forcedInstance === "string" && forcedInstance.length > 0) {
					logger.info(
						{
							userId,
							forcedInstance,
							targetInstance: target.instanceId,
							path: req.path,
						},
						"fly_forced_instance_stale",
					);
					res.status(409).json({
						error: {
							code: "INSTANCE_AFFINITY_CHANGED",
							message: "Request must be retried on the current session owner",
							retryable: true,
							scope: "request",
						},
					});
					return;
				}
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

			if (!target || target.instanceId === instanceId) {
				res.set(INSTANCE_ROUTING_RESPONSE_HEADER, instanceId);
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
