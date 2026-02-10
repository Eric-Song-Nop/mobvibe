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
	{
		version: 2,
		up: `
      -- Discovered sessions table for persisting sessions found via discoverSessions()
      CREATE TABLE IF NOT EXISTS discovered_sessions (
        session_id TEXT PRIMARY KEY,
        backend_id TEXT NOT NULL,
        cwd TEXT,
        title TEXT,
        agent_updated_at TEXT,      -- agent-reported update time
        discovered_at TEXT NOT NULL,
        last_verified_at TEXT,      -- last time cwd was verified to exist
        is_stale INTEGER DEFAULT 0  -- marked stale when cwd no longer exists
      );

      CREATE INDEX IF NOT EXISTS idx_discovered_sessions_backend
        ON discovered_sessions (backend_id);

      -- Add agent_updated_at to sessions table
      ALTER TABLE sessions ADD COLUMN agent_updated_at TEXT;
    `,
	},
	{
		version: 3,
		up: `
      -- Compaction support
      ALTER TABLE session_events ADD COLUMN compacted_at TEXT;

      -- Index for finding acked events eligible for cleanup
      CREATE INDEX IF NOT EXISTS idx_session_events_acked_at
        ON session_events (session_id, revision, acked_at)
        WHERE acked_at IS NOT NULL;

      -- Index for finding events by kind (for chunk consolidation)
      CREATE INDEX IF NOT EXISTS idx_session_events_kind
        ON session_events (session_id, revision, kind);

      -- Compaction operation log
      CREATE TABLE IF NOT EXISTS compaction_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        revision INTEGER,
        operation TEXT NOT NULL,
        events_affected INTEGER NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT
      );
    `,
	},
	{
		version: 4,
		up: `
      -- Archived sessions table (local archive state)
      CREATE TABLE IF NOT EXISTS archived_session_ids (
        session_id TEXT PRIMARY KEY,
        archived_at TEXT NOT NULL
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
