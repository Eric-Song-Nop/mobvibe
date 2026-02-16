/**
 * Authentication middleware for Express routes.
 * Validates session tokens using Better Auth.
 */

import { verifySignedToken } from "@mobvibe/shared";
import { fromNodeHeaders } from "better-auth/node";
import type { NextFunction, Request, Response } from "express";
import { auth } from "../lib/auth.js";
import { logger } from "../lib/logger.js";
import { findDeviceByPublicKey } from "../services/db-service.js";

export interface AuthenticatedRequest extends Request {
	userId?: string;
	userEmail?: string;
	requestId?: string;
	deviceId?: string;
}

export async function requireAuth(
	req: AuthenticatedRequest,
	res: Response,
	next: NextFunction,
): Promise<void> {
	try {
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

		req.userId = session.user.id;
		req.userEmail = session.user.email;
		next();
	} catch (error) {
		logger.error({ err: error }, "auth_session_validation_error");
		res.status(500).json({
			error: "Authentication service error",
			code: "AUTH_SERVICE_ERROR",
		});
	}
}

export async function optionalAuth(
	req: AuthenticatedRequest,
	res: Response,
	next: NextFunction,
): Promise<void> {
	try {
		const session = await auth.api.getSession({
			headers: fromNodeHeaders(req.headers),
		});

		if (session?.user) {
			req.userId = session.user.id;
			req.userEmail = session.user.email;
		}
		next();
	} catch (error) {
		logger.error({ err: error }, "auth_optional_session_validation_error");
		next();
	}
}

export async function requireDeviceOrSessionAuth(
	req: AuthenticatedRequest,
	res: Response,
	next: NextFunction,
): Promise<void> {
	const authHeader = req.headers.authorization;
	if (authHeader?.startsWith("Bearer ")) {
		try {
			const tokenStr = authHeader.slice(7);
			const token = JSON.parse(tokenStr);
			const verified = verifySignedToken(token);
			if (!verified) {
				res.status(401).json({
					error: "Invalid device token",
					code: "INVALID_DEVICE_TOKEN",
				});
				return;
			}

			const device = await findDeviceByPublicKey(verified.publicKey);
			if (!device) {
				res.status(401).json({
					error: "Device not registered",
					code: "DEVICE_NOT_REGISTERED",
				});
				return;
			}

			req.userId = device.userId;
			req.deviceId = device.id;
			next();
			return;
		} catch (error) {
			logger.error({ err: error }, "device_auth_error");
		}
	}

	await requireAuth(req, res, next);
}

export function getUserId(req: AuthenticatedRequest): string | undefined {
	return req.userId;
}

export function isAuthenticated(req: AuthenticatedRequest): boolean {
	return req.userId !== undefined;
}
