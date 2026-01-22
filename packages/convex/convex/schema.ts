import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Convex schema for Remote-Claude multi-tenant SaaS.
 *
 * Better Auth tables (user, session, account, verification) are managed
 * by the convex-better-auth component and don't need to be defined here.
 *
 * Application tables defined below extend the base auth schema.
 */
export default defineSchema({
	/**
	 * Machines - CLI instances registered by users.
	 * Each user can have multiple machines (desktop, laptop, server, etc.)
	 */
	machines: defineTable({
		/** Owner of this machine */
		userId: v.string(),
		/** User-friendly name (e.g., "Work Laptop", "Home Desktop") */
		name: v.string(),
		/** Secret token for CLI authentication - generated on registration */
		machineToken: v.string(),
		/** Hostname from the CLI machine */
		hostname: v.string(),
		/** Operating system platform (linux, darwin, win32) */
		platform: v.string(),
		/** Whether the machine is currently connected to gateway */
		isOnline: v.boolean(),
		/** Last time the machine was seen online (Unix timestamp ms) */
		lastSeenAt: v.optional(v.number()),
		/** When the machine was registered (Unix timestamp ms) */
		createdAt: v.number(),
	})
		.index("by_user", ["userId"])
		.index("by_token", ["machineToken"]),

	/**
	 * ACP Sessions - Metadata about active/historical ACP sessions.
	 * Actual message content stays in-memory during active sessions;
	 * this table stores metadata for session listing and routing.
	 */
	acpSessions: defineTable({
		/** Owner of this session */
		userId: v.string(),
		/** Machine running this session */
		machineId: v.id("machines"),
		/** ACP session UUID from the CLI */
		sessionId: v.string(),
		/** Session title/description */
		title: v.string(),
		/** Backend identifier (e.g., "claude-code", "gemini-cli") */
		backendId: v.string(),
		/** Current working directory */
		cwd: v.optional(v.string()),
		/** Session state: idle | connecting | ready | error | stopped */
		state: v.string(),
		/** When the session was created (Unix timestamp ms) */
		createdAt: v.number(),
		/** When the session was last updated (Unix timestamp ms) */
		updatedAt: v.number(),
	})
		.index("by_user", ["userId"])
		.index("by_machine", ["machineId"])
		.index("by_session_id", ["sessionId"]),
});
