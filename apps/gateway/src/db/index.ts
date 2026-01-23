import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";

// Create connection pool if DATABASE_URL is configured
const pool = process.env.DATABASE_URL
	? new Pool({
			connectionString: process.env.DATABASE_URL,
			max: 10,
			idleTimeoutMillis: 30000,
			connectionTimeoutMillis: 2000,
		})
	: null;

// Create Drizzle database instance
export const db = pool ? drizzle(pool, { schema }) : null;

// Re-export schema for Better Auth adapter
export { schema };
