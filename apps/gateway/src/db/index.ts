import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

const { Pool } = pg;

let pool: pg.Pool | null = null;
let db: ReturnType<typeof drizzle<typeof schema>> | null = null;

function getDatabaseUrl(): string | undefined {
	return process.env.DATABASE_URL;
}

/**
 * Check if the database is enabled (DATABASE_URL is configured).
 */
export function isDbEnabled(): boolean {
	return !!getDatabaseUrl();
}

/**
 * Get the database connection.
 * Creates a new connection pool if one doesn't exist.
 * Returns null if DATABASE_URL is not configured.
 */
export function getDb(): ReturnType<typeof drizzle<typeof schema>> | null {
	const databaseUrl = getDatabaseUrl();
	if (!databaseUrl) {
		return null;
	}

	if (!db) {
		pool = new Pool({
			connectionString: databaseUrl,
			max: 10,
			idleTimeoutMillis: 30000,
			connectionTimeoutMillis: 2000,
		});

		db = drizzle(pool, { schema });
	}

	return db;
}

/**
 * Get the database connection, throwing if not configured.
 * Use this when database access is required.
 */
export function requireDb(): ReturnType<typeof drizzle<typeof schema>> {
	const database = getDb();
	if (!database) {
		throw new Error("Database not configured. Set DATABASE_URL environment variable.");
	}
	return database;
}

/**
 * Close the database connection pool.
 * Call this during graceful shutdown.
 */
export async function closeDb(): Promise<void> {
	if (pool) {
		await pool.end();
		pool = null;
		db = null;
	}
}

// Re-export schema for convenience
export { schema };
