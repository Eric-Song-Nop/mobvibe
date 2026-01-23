import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
	throw new Error("DATABASE_URL environment variable is required");
}

const pool = new Pool({
	connectionString: process.env.DATABASE_URL,
	max: 10,
	idleTimeoutMillis: 30000,
	connectionTimeoutMillis: 2000,
});

/**
 * Database connection.
 */
export const db = drizzle(pool, { schema });

/**
 * Close the database connection pool.
 * Call this during graceful shutdown.
 */
export async function closeDb(): Promise<void> {
	await pool.end();
}

export { schema };
