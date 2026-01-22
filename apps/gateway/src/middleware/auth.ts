/**
 * Authentication middleware for Express routes.
 * Validates Bearer tokens from the Authorization header.
 */

import type { NextFunction, Request, Response } from "express";
import { isAuthEnabled, validateSessionToken } from "../lib/convex.js";

/**
 * Extended request type with user information.
 */
export interface AuthenticatedRequest extends Request {
	userId?: string;
	userEmail?: string;
}

/**
 * Middleware that requires authentication.
 * Extracts Bearer token from Authorization header and validates it.
 * Returns 401 if no token or invalid token.
 * Returns 503 if auth is not configured (Convex URL not set).
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

	const authHeader = req.headers.authorization;

	if (!authHeader) {
		res.status(401).json({
			error: "Authentication required",
			code: "AUTH_REQUIRED",
		});
		return;
	}

	const parts = authHeader.split(" ");
	if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") {
		res.status(401).json({
			error: "Invalid authorization header format. Expected: Bearer <token>",
			code: "INVALID_AUTH_FORMAT",
		});
		return;
	}

	const token = parts[1];

	// Validate token asynchronously
	validateSessionToken(token)
		.then((user) => {
			if (!user) {
				res.status(401).json({
					error: "Invalid or expired token",
					code: "INVALID_TOKEN",
				});
				return;
			}

			// Attach user info to request
			req.userId = user.userId;
			req.userEmail = user.email;
			next();
		})
		.catch((error) => {
			console.error("[auth] Token validation error:", error);
			res.status(500).json({
				error: "Authentication service error",
				code: "AUTH_SERVICE_ERROR",
			});
		});
}

/**
 * Middleware that optionally authenticates.
 * If a token is provided, validates it and attaches user info.
 * If no token, continues without user context.
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

	const authHeader = req.headers.authorization;

	if (!authHeader) {
		// No token provided - continue without auth
		next();
		return;
	}

	const parts = authHeader.split(" ");
	if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") {
		// Invalid format - continue without auth
		next();
		return;
	}

	const token = parts[1];

	// Validate token asynchronously
	validateSessionToken(token)
		.then((user) => {
			if (user) {
				req.userId = user.userId;
				req.userEmail = user.email;
			}
			next();
		})
		.catch((error) => {
			console.error("[auth] Token validation error:", error);
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
