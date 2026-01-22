import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";

/**
 * Generate a secure random token for machine authentication.
 */
function generateMachineToken(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

/**
 * Register a new machine for the authenticated user.
 * Returns the machine ID and token for CLI authentication.
 */
export const registerMachine = mutation({
	args: {
		name: v.string(),
		hostname: v.string(),
		platform: v.string(),
	},
	handler: async (ctx, args) => {
		const user = await authComponent.getAuthUser(ctx);
		if (!user) {
			throw new Error("Authentication required");
		}

		const machineToken = generateMachineToken();
		const now = Date.now();

		const machineId = await ctx.db.insert("machines", {
			userId: user.id,
			name: args.name,
			machineToken,
			hostname: args.hostname,
			platform: args.platform,
			isOnline: false,
			lastSeenAt: undefined,
			createdAt: now,
		});

		return {
			machineId,
			machineToken,
		};
	},
});

/**
 * List all machines for the authenticated user.
 */
export const listMachines = query({
	args: {},
	handler: async (ctx) => {
		const user = await authComponent.getAuthUser(ctx);
		if (!user) {
			return [];
		}

		const machines = await ctx.db
			.query("machines")
			.withIndex("by_user", (q) => q.eq("userId", user.id))
			.collect();

		// Don't expose the machine token in list queries
		return machines.map((m) => ({
			_id: m._id,
			_creationTime: m._creationTime,
			userId: m.userId,
			name: m.name,
			hostname: m.hostname,
			platform: m.platform,
			isOnline: m.isOnline,
			lastSeenAt: m.lastSeenAt,
			createdAt: m.createdAt,
		}));
	},
});

/**
 * Get a single machine by ID (for the authenticated user).
 */
export const getMachine = query({
	args: { machineId: v.id("machines") },
	handler: async (ctx, args) => {
		const user = await authComponent.getAuthUser(ctx);
		if (!user) {
			return null;
		}

		const machine = await ctx.db.get(args.machineId);
		if (!machine || machine.userId !== user.id) {
			return null;
		}

		// Don't expose the machine token
		return {
			_id: machine._id,
			_creationTime: machine._creationTime,
			userId: machine.userId,
			name: machine.name,
			hostname: machine.hostname,
			platform: machine.platform,
			isOnline: machine.isOnline,
			lastSeenAt: machine.lastSeenAt,
			createdAt: machine.createdAt,
		};
	},
});

/**
 * Update a machine's name (for the authenticated user).
 */
export const updateMachine = mutation({
	args: {
		machineId: v.id("machines"),
		name: v.string(),
	},
	handler: async (ctx, args) => {
		const user = await authComponent.getAuthUser(ctx);
		if (!user) {
			throw new Error("Authentication required");
		}

		const machine = await ctx.db.get(args.machineId);
		if (!machine || machine.userId !== user.id) {
			throw new Error("Machine not found");
		}

		await ctx.db.patch(args.machineId, {
			name: args.name,
		});

		return { success: true };
	},
});

/**
 * Delete a machine (for the authenticated user).
 * Also deletes all associated sessions.
 */
export const deleteMachine = mutation({
	args: { machineId: v.id("machines") },
	handler: async (ctx, args) => {
		const user = await authComponent.getAuthUser(ctx);
		if (!user) {
			throw new Error("Authentication required");
		}

		const machine = await ctx.db.get(args.machineId);
		if (!machine || machine.userId !== user.id) {
			throw new Error("Machine not found");
		}

		// Delete all sessions for this machine
		const sessions = await ctx.db
			.query("acpSessions")
			.withIndex("by_machine", (q) => q.eq("machineId", args.machineId))
			.collect();

		for (const session of sessions) {
			await ctx.db.delete(session._id);
		}

		// Delete the machine
		await ctx.db.delete(args.machineId);

		return { success: true };
	},
});

/**
 * Regenerate the machine token (for the authenticated user).
 * Returns the new token.
 */
export const regenerateMachineToken = mutation({
	args: { machineId: v.id("machines") },
	handler: async (ctx, args) => {
		const user = await authComponent.getAuthUser(ctx);
		if (!user) {
			throw new Error("Authentication required");
		}

		const machine = await ctx.db.get(args.machineId);
		if (!machine || machine.userId !== user.id) {
			throw new Error("Machine not found");
		}

		const machineToken = generateMachineToken();
		await ctx.db.patch(args.machineId, { machineToken });

		return { machineToken };
	},
});

/**
 * Update machine online status.
 * Called by the gateway when a CLI connects/disconnects.
 * This is an internal mutation - validated via machine token.
 */
export const updateMachineStatus = mutation({
	args: {
		machineToken: v.string(),
		isOnline: v.boolean(),
	},
	handler: async (ctx, args) => {
		const machine = await ctx.db
			.query("machines")
			.withIndex("by_token", (q) => q.eq("machineToken", args.machineToken))
			.first();

		if (!machine) {
			throw new Error("Invalid machine token");
		}

		await ctx.db.patch(machine._id, {
			isOnline: args.isOnline,
			lastSeenAt: Date.now(),
		});

		return {
			machineId: machine._id,
			userId: machine.userId,
		};
	},
});

/**
 * Validate a machine token and return user/machine info.
 * Used by the gateway to authenticate CLI connections.
 */
export const validateMachineToken = query({
	args: { machineToken: v.string() },
	handler: async (ctx, args) => {
		const machine = await ctx.db
			.query("machines")
			.withIndex("by_token", (q) => q.eq("machineToken", args.machineToken))
			.first();

		if (!machine) {
			return null;
		}

		return {
			machineId: machine._id,
			userId: machine.userId,
			name: machine.name,
			hostname: machine.hostname,
			platform: machine.platform,
		};
	},
});

/**
 * Internal mutation for registering a machine from HTTP action.
 * This bypasses the auth component check since auth is validated in the HTTP layer.
 */
export const registerMachineInternal = mutation({
	args: {
		userId: v.string(),
		name: v.string(),
		hostname: v.string(),
		platform: v.string(),
		machineToken: v.string(),
		createdAt: v.number(),
	},
	handler: async (ctx, args) => {
		const machineId = await ctx.db.insert("machines", {
			userId: args.userId,
			name: args.name,
			machineToken: args.machineToken,
			hostname: args.hostname,
			platform: args.platform,
			isOnline: false,
			lastSeenAt: undefined,
			createdAt: args.createdAt,
		});

		return machineId;
	},
});
