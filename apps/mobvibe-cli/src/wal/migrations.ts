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
	{
		version: 5,
		up: `
      -- Track whether a session title was manually set (pinned) by the user
      ALTER TABLE sessions ADD COLUMN is_title_pinned INTEGER DEFAULT 0;
    `,
	},
	{
		version: 6,
		up: `
      ALTER TABLE discovered_sessions ADD COLUMN workspace_root_cwd TEXT;

      UPDATE discovered_sessions
      SET workspace_root_cwd = cwd
      WHERE workspace_root_cwd IS NULL;
    `,
	},
	{
		version: 7,
		up: `
      CREATE TABLE IF NOT EXISTS agent_teams (
        agent_team_id TEXT PRIMARY KEY,
        machine_id TEXT NOT NULL,
        workspace_root_cwd TEXT NOT NULL,
        title TEXT NOT NULL,
        lifecycle TEXT NOT NULL,
        leader_member_id TEXT NOT NULL,
        workspace_mode TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived_at TEXT
      );

      CREATE TABLE IF NOT EXISTS agent_team_members (
        member_id TEXT PRIMARY KEY,
        agent_team_id TEXT NOT NULL,
        role TEXT NOT NULL,
        name TEXT NOT NULL,
        backend_id TEXT NOT NULL,
        session_id TEXT,
        lifecycle TEXT NOT NULL,
        health TEXT NOT NULL,
        worktree_source_cwd TEXT,
        worktree_branch TEXT,
        error_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (agent_team_id) REFERENCES agent_teams(agent_team_id)
      );

      CREATE TABLE IF NOT EXISTS agent_team_mcp_status (
        agent_team_id TEXT NOT NULL,
        member_id TEXT NOT NULL,
        transport TEXT NOT NULL,
        server_id TEXT,
        phase TEXT NOT NULL,
        last_error_json TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (agent_team_id, member_id),
        FOREIGN KEY (agent_team_id) REFERENCES agent_teams(agent_team_id),
        FOREIGN KEY (member_id) REFERENCES agent_team_members(member_id)
      );

      CREATE TABLE IF NOT EXISTS agent_team_mailbox_messages (
        message_id TEXT PRIMARY KEY,
        agent_team_id TEXT NOT NULL,
        from_member_id TEXT NOT NULL,
        to_member_id TEXT,
        body_local_json TEXT NOT NULL,
        source_refs_json TEXT,
        read_at TEXT,
        wake_status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (agent_team_id) REFERENCES agent_teams(agent_team_id)
      );

      CREATE TABLE IF NOT EXISTS agent_team_tasks (
        task_id TEXT PRIMARY KEY,
        agent_team_id TEXT NOT NULL,
        owner_member_id TEXT,
        status TEXT NOT NULL,
        body_local_json TEXT NOT NULL,
        blocked_by_json TEXT,
        blocks_json TEXT,
        source_refs_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (agent_team_id) REFERENCES agent_teams(agent_team_id)
      );

      CREATE TABLE IF NOT EXISTS agent_team_summary_refs (
        summary_ref_id TEXT PRIMARY KEY,
        agent_team_id TEXT NOT NULL,
        source_refs_json TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (agent_team_id) REFERENCES agent_teams(agent_team_id)
      );

      CREATE INDEX IF NOT EXISTS idx_agent_teams_machine_lifecycle
        ON agent_teams (machine_id, lifecycle);
      CREATE INDEX IF NOT EXISTS idx_agent_team_members_team
        ON agent_team_members (agent_team_id);
      CREATE INDEX IF NOT EXISTS idx_agent_team_mailbox_team
        ON agent_team_mailbox_messages (agent_team_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_agent_team_tasks_team
        ON agent_team_tasks (agent_team_id, updated_at);
		`,
	},
	{
		version: 8,
		up: `
      CREATE TABLE IF NOT EXISTS agent_team_tool_intents (
        intent_id TEXT PRIMARY KEY,
        agent_team_id TEXT NOT NULL,
        requested_by_member_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        payload_local_json TEXT NOT NULL,
        status TEXT NOT NULL,
        source_refs_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (agent_team_id) REFERENCES agent_teams(agent_team_id),
        FOREIGN KEY (requested_by_member_id) REFERENCES agent_team_members(member_id)
      );

      CREATE INDEX IF NOT EXISTS idx_agent_team_tool_intents_team
        ON agent_team_tool_intents (agent_team_id, created_at);
    `,
	},
	{
		version: 9,
		up: `
      ALTER TABLE agent_team_mailbox_messages ADD COLUMN wake_error_json TEXT;

      CREATE INDEX IF NOT EXISTS idx_agent_team_mailbox_unread
        ON agent_team_mailbox_messages (agent_team_id, to_member_id, read_at, created_at);
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
