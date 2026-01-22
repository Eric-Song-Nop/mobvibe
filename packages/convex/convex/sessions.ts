import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";

/**
 * Session states - mirrors the ACP session lifecycle.
 */
export const SESSION_STATES = {
	IDLE: "idle",
	CONNECTING: "connecting",
	READY: "ready",
	ERROR: "error",
	STOPPED: "stopped",
} as const;

export type SessionState = (typeof SESSION_STATES)[keyof typeof SESSION_STATES];

/**
 * Create a new ACP session record.
 * Called by the gateway when a session is created.
 */
export const createSession = mutation({
	args: {
		machineToken: v.string(),
		sessionId: v.string(),
		title: v.string(),
		backendId: v.string(),
		cwd: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		// Validate machine token and get user info
		const machine = await ctx.db
			.query("machines")
			.withIndex("by_token", (q) => q.eq("machineToken", args.machineToken))
			.first();

		if (!machine) {
			throw new Error("Invalid machine token");
		}

		const now = Date.now();

		const sessionDbId = await ctx.db.insert("acpSessions", {
			userId: machine.userId,
			machineId: machine._id,
			sessionId: args.sessionId,
			title: args.title,
			backendId: args.backendId,
			cwd: args.cwd,
			state: SESSION_STATES.CONNECTING,
			createdAt: now,
			updatedAt: now,
		});

		return {
			_id: sessionDbId,
			userId: machine.userId,
			machineId: machine._id,
		};
	},
});

/**
 * Update an ACP session's state.
 * Called by the gateway on session state changes.
 */
export const updateSessionState = mutation({
	args: {
		sessionId: v.string(),
		state: v.string(),
		title: v.optional(v.string()),
		cwd: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const session = await ctx.db
			.query("acpSessions")
			.withIndex("by_session_id", (q) => q.eq("sessionId", args.sessionId))
			.first();

		if (!session) {
			throw new Error("Session not found");
		}

		const updates: {
			state: string;
			updatedAt: number;
			title?: string;
			cwd?: string;
		} = {
			state: args.state,
			updatedAt: Date.now(),
		};

		if (args.title !== undefined) {
			updates.title = args.title;
		}

		if (args.cwd !== undefined) {
			updates.cwd = args.cwd;
		}

		await ctx.db.patch(session._id, updates);

		return { success: true };
	},
});

/**
 * Close/delete an ACP session record.
 * Called by the gateway when a session is closed.
 */
export const closeSession = mutation({
	args: { sessionId: v.string() },
	handler: async (ctx, args) => {
		const session = await ctx.db
			.query("acpSessions")
			.withIndex("by_session_id", (q) => q.eq("sessionId", args.sessionId))
			.first();

		if (!session) {
			// Session may not exist if it was never persisted
			return { success: true };
		}

		// Mark as stopped rather than deleting, for history
		await ctx.db.patch(session._id, {
			state: SESSION_STATES.STOPPED,
			updatedAt: Date.now(),
		});

		return { success: true };
	},
});

/**
 * Permanently delete a session record.
 * For cleanup of old sessions.
 */
export const deleteSession = mutation({
	args: { sessionId: v.string() },
	handler: async (ctx, args) => {
		const user = await authComponent.getAuthUser(ctx);
		if (!user) {
			throw new Error("Authentication required");
		}

		const session = await ctx.db
			.query("acpSessions")
			.withIndex("by_session_id", (q) => q.eq("sessionId", args.sessionId))
			.first();

		if (!session) {
			return { success: true };
		}

		// Verify ownership
		if (session.userId !== user.id) {
			throw new Error("Not authorized to delete this session");
		}

		await ctx.db.delete(session._id);

		return { success: true };
	},
});

/**
 * List all sessions for the authenticated user.
 */
export const listSessions = query({
	args: {},
	handler: async (ctx) => {
		const user = await authComponent.getAuthUser(ctx);
		if (!user) {
			return [];
		}

		const sessions = await ctx.db
			.query("acpSessions")
			.withIndex("by_user", (q) => q.eq("userId", user.id))
			.collect();

		return sessions;
	},
});

/**
 * List sessions for a specific machine.
 */
export const listSessionsByMachine = query({
	args: { machineId: v.id("machines") },
	handler: async (ctx, args) => {
		const user = await authComponent.getAuthUser(ctx);
		if (!user) {
			return [];
		}

		// Verify machine ownership
		const machine = await ctx.db.get(args.machineId);
		if (!machine || machine.userId !== user.id) {
			return [];
		}

		const sessions = await ctx.db
			.query("acpSessions")
			.withIndex("by_machine", (q) => q.eq("machineId", args.machineId))
			.collect();

		return sessions;
	},
});

/**
 * Get a single session by ID.
 */
export const getSession = query({
	args: { sessionId: v.string() },
	handler: async (ctx, args) => {
		const user = await authComponent.getAuthUser(ctx);
		if (!user) {
			return null;
		}

		const session = await ctx.db
			.query("acpSessions")
			.withIndex("by_session_id", (q) => q.eq("sessionId", args.sessionId))
			.first();

		if (!session || session.userId !== user.id) {
			return null;
		}

		return session;
	},
});

/**
 * Check if a user owns a session.
 * Used by gateway for authorization.
 */
export const checkSessionOwnership = query({
	args: {
		sessionId: v.string(),
		userId: v.string(),
	},
	handler: async (ctx, args) => {
		const session = await ctx.db
			.query("acpSessions")
			.withIndex("by_session_id", (q) => q.eq("sessionId", args.sessionId))
			.first();

		if (!session) {
			return { exists: false, isOwner: false };
		}

		return {
			exists: true,
			isOwner: session.userId === args.userId,
		};
	},
});

/**
 * Close all sessions for a machine.
 * Called when a CLI disconnects.
 */
export const closeSessionsForMachine = mutation({
	args: { machineToken: v.string() },
	handler: async (ctx, args) => {
		const machine = await ctx.db
			.query("machines")
			.withIndex("by_token", (q) => q.eq("machineToken", args.machineToken))
			.first();

		if (!machine) {
			return { closed: 0 };
		}

		const sessions = await ctx.db
			.query("acpSessions")
			.withIndex("by_machine", (q) => q.eq("machineId", machine._id))
			.filter((q) =>
				q.and(
					q.neq(q.field("state"), SESSION_STATES.STOPPED),
					q.neq(q.field("state"), SESSION_STATES.ERROR),
				),
			)
			.collect();

		const now = Date.now();
		for (const session of sessions) {
			await ctx.db.patch(session._id, {
				state: SESSION_STATES.STOPPED,
				updatedAt: now,
			});
		}

		return { closed: sessions.length };
	},
});
