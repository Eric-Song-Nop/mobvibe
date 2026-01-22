/**
 * Authentication middleware for Express routes.
 * Validates session tokens using Better Auth.
 */

import { fromNodeHeaders } from "better-auth/node";
import type { NextFunction, Request, Response } from "express";
import { getAuth, isAuthEnabled } from "../lib/auth.js";

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
 * Returns 503 if auth is not configured (DATABASE_URL not set).
 */
export function requireAuth(
	req: AuthenticatedRequest,
	res: Response,
	next: NextFunction,
): void {
	// Check if auth is enabled
	if (!isAuthEnabled()) {
		// Auth disabled - allow all requests without user context
		// This maintains backwards compatibility during development
		next();
		return;
	}

	const auth = getAuth();
	if (!auth) {
		res.status(503).json({
			error: "Authentication service unavailable",
			code: "AUTH_UNAVAILABLE",
		});
		return;
	}

	// Validate session asynchronously using Better Auth
	auth.api
		.getSession({
			headers: fromNodeHeaders(req.headers),
		})
		.then((session) => {
			if (!session?.user) {
				res.status(401).json({
					error: "Authentication required",
					code: "AUTH_REQUIRED",
				});
				return;
			}

			// Attach user info to request
			req.userId = session.user.id;
			req.userEmail = session.user.email;
			next();
		})
		.catch((error) => {
			console.error("[auth] Session validation error:", error);
			res.status(500).json({
				error: "Authentication service error",
				code: "AUTH_SERVICE_ERROR",
			});
		});
}

/**
 * Middleware that optionally authenticates.
 * If a session exists, validates it and attaches user info.
 * If no session, continues without user context.
 */
export function optionalAuth(
	req: AuthenticatedRequest,
	res: Response,
	next: NextFunction,
): void {
	// Check if auth is enabled
	if (!isAuthEnabled()) {
		next();
		return;
	}

	const auth = getAuth();
	if (!auth) {
		// Auth not available - continue without auth
		next();
		return;
	}

	// Validate session asynchronously using Better Auth
	auth.api
		.getSession({
			headers: fromNodeHeaders(req.headers),
		})
		.then((session) => {
			if (session?.user) {
				req.userId = session.user.id;
				req.userEmail = session.user.email;
			}
			next();
		})
		.catch((error) => {
			console.error("[auth] Session validation error:", error);
			// Continue without auth on error
			next();
		});
}

/**
 * Helper to get user ID from request, with fallback for backwards compatibility.
 * Returns undefined if auth is disabled.
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

// Re-export isAuthEnabled for convenience
export { isAuthEnabled };
