/**
 * Authentication middleware for Express routes.
 * Validates session tokens using Better Auth.
 */

import { fromNodeHeaders } from "better-auth/node";
import type { NextFunction, Request, Response } from "express";
import { auth } from "../lib/auth.js";
import { logger } from "../lib/logger.js";

/**
 * Extended request type with user information.
 */
export interface AuthenticatedRequest extends Request {
	userId?: string;
	userEmail?: string;
}

/**
 * Middleware that requires authentication.
 * Validates session using Better Auth.
 * Returns 401 if no session or invalid session.
 */
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
		logger.error({ error }, "auth_session_validation_error");
		res.status(500).json({
			error: "Authentication service error",
			code: "AUTH_SERVICE_ERROR",
		});
	}
}

/**
 * Middleware that optionally authenticates.
 * If a session exists, validates it and attaches user info.
 * If no session, continues without user context.
 */
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
		logger.error({ error }, "auth_optional_session_validation_error");
		// Continue without auth on error
		next();
	}
}

/**
 * Helper to get user ID from request.
 */
export function getUserId(req: AuthenticatedRequest): string | undefined {
	return req.userId;
}

/**
 * Check if request is authenticated.
 */
export function isAuthenticated(req: AuthenticatedRequest): boolean {
	return req.userId !== undefined;
}
