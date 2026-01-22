/**
 * @remote-claude/convex
 *
 * Convex backend for Remote-Claude multi-tenant SaaS.
 * Provides types and client utilities for use by gateway, webui, and cli.
 */

// Re-export client utilities
export { createConvexClient, ConvexHttpClient } from "./client.js";

// Session states (defined here to avoid importing from convex/ which has generated code)
export const SESSION_STATES = {
	IDLE: "idle",
	CONNECTING: "connecting",
	READY: "ready",
	ERROR: "error",
	STOPPED: "stopped",
} as const;

export type SessionState = (typeof SESSION_STATES)[keyof typeof SESSION_STATES];

// Export types for machines and sessions
export interface Machine {
	_id: string;
	_creationTime: number;
	userId: string;
	name: string;
	hostname: string;
	platform: string;
	isOnline: boolean;
	lastSeenAt?: number;
	createdAt: number;
}

export interface MachineWithToken extends Machine {
	machineToken: string;
}

export interface AcpSession {
	_id: string;
	_creationTime: number;
	userId: string;
	machineId: string;
	sessionId: string;
	title: string;
	backendId: string;
	cwd?: string;
	state: string;
	createdAt: number;
	updatedAt: number;
}

// Export auth-related types
export interface AuthUser {
	id: string;
	email: string;
	name?: string;
	image?: string;
	emailVerified?: boolean;
}

export interface AuthSession {
	id: string;
	userId: string;
	token: string;
	expiresAt: number;
}

// Validation result from machine token check
export interface MachineTokenValidation {
	machineId: string;
	userId: string;
	name: string;
	hostname: string;
	platform: string;
}

// Session ownership check result
export interface SessionOwnershipCheck {
	exists: boolean;
	isOwner: boolean;
}
