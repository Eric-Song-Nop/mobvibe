import {
	boolean,
	index,
	pgTable,
	text,
	timestamp,
	varchar,
} from "drizzle-orm/pg-core";

// ============================================
// Better Auth Tables
// ============================================

export const users = pgTable("users", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	email: text("email").notNull().unique(),
	emailVerified: boolean("email_verified").notNull().default(false),
	image: text("image"),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
	id: text("id").primaryKey(),
	expiresAt: timestamp("expires_at").notNull(),
	token: text("token").notNull().unique(),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
	ipAddress: text("ip_address"),
	userAgent: text("user_agent"),
	userId: text("user_id")
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
});

export const accounts = pgTable("accounts", {
	id: text("id").primaryKey(),
	accountId: text("account_id").notNull(),
	providerId: text("provider_id").notNull(),
	userId: text("user_id")
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
	accessToken: text("access_token"),
	refreshToken: text("refresh_token"),
	idToken: text("id_token"),
	accessTokenExpiresAt: timestamp("access_token_expires_at"),
	refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
	scope: text("scope"),
	password: text("password"),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const verifications = pgTable("verifications", {
	id: text("id").primaryKey(),
	identifier: text("identifier").notNull(),
	value: text("value").notNull(),
	expiresAt: timestamp("expires_at").notNull(),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ============================================
// Application Tables
// ============================================

export const machines = pgTable(
	"machines",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		hostname: text("hostname").notNull(),
		platform: varchar("platform", { length: 50 }),
		machineToken: text("machine_token").notNull().unique(),
		isOnline: boolean("is_online").notNull().default(false),
		lastSeenAt: timestamp("last_seen_at"),
		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at").notNull().defaultNow(),
	},
	(table) => [
		index("machines_user_id_idx").on(table.userId),
		index("machines_machine_token_idx").on(table.machineToken),
	],
);

export const acpSessions = pgTable(
	"acp_sessions",
	{
		id: text("id").primaryKey(),
		sessionId: text("session_id").notNull().unique(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		machineId: text("machine_id")
			.notNull()
			.references(() => machines.id, { onDelete: "cascade" }),
		title: text("title"),
		backendId: text("backend_id"),
		cwd: text("cwd"),
		state: varchar("state", { length: 50 }).notNull().default("active"),
		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at").notNull().defaultNow(),
		closedAt: timestamp("closed_at"),
	},
	(table) => [
		index("acp_sessions_user_id_idx").on(table.userId),
		index("acp_sessions_machine_id_idx").on(table.machineId),
		index("acp_sessions_session_id_idx").on(table.sessionId),
	],
);

// Type exports
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type Verification = typeof verifications.$inferSelect;
export type NewVerification = typeof verifications.$inferInsert;
export type Machine = typeof machines.$inferSelect;
export type NewMachine = typeof machines.$inferInsert;
export type AcpSession = typeof acpSessions.$inferSelect;
export type NewAcpSession = typeof acpSessions.$inferInsert;
