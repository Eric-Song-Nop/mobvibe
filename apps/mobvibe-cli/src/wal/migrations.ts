import type { Database } from "bun:sqlite";

const MIGRATIONS = [
	{
		version: 1,
		up: `
      -- Sessions table to track session metadata and current revision
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        machine_id TEXT NOT NULL,
        backend_id TEXT NOT NULL,
        current_revision INTEGER NOT NULL DEFAULT 1,
        cwd TEXT,
        title TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      -- Session events WAL table
      CREATE TABLE IF NOT EXISTS session_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        seq INTEGER NOT NULL,
        kind TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        acked_at TEXT,
        UNIQUE (session_id, revision, seq)
      );

      -- Index for querying events by session and revision
      CREATE INDEX IF NOT EXISTS idx_session_events_session_revision
        ON session_events (session_id, revision, seq);

      -- Index for querying unacked events
      CREATE INDEX IF NOT EXISTS idx_session_events_unacked
        ON session_events (session_id, revision, acked_at)
        WHERE acked_at IS NULL;

      -- Schema version tracking
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY
      );
    `,
	},
];

export function runMigrations(db: Database): void {
	// Enable WAL mode for better concurrency
	db.exec("PRAGMA journal_mode = WAL");
	db.exec("PRAGMA synchronous = NORMAL");

	// Get current version
	let currentVersion = 0;
	try {
		const result = db
			.query("SELECT MAX(version) as version FROM schema_version")
			.get() as { version: number | null } | null;
		currentVersion = result?.version ?? 0;
	} catch {
		// Table doesn't exist yet, version is 0
	}

	// Run pending migrations
	for (const migration of MIGRATIONS) {
		if (migration.version > currentVersion) {
			db.exec(migration.up);
			db.exec(
				`INSERT INTO schema_version (version) VALUES (${migration.version})`,
			);
		}
	}
}
