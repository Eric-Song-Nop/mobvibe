import type { Database } from "bun:sqlite";

type Migration = {
	version: number;
	up: string | ((db: Database) => void);
};

const MESSAGE_SEND_RESULTS_SCHEMA = `
	-- Completed message sends are durable idempotency records. The prompt
	-- itself remains in the session event WAL; only the terminal result is
	-- stored here so a gateway retry cannot execute the agent twice.
	CREATE TABLE IF NOT EXISTS message_send_results (
		session_id TEXT NOT NULL,
		message_id TEXT NOT NULL,
		stop_reason TEXT NOT NULL,
		completed_at TEXT NOT NULL,
		PRIMARY KEY (session_id, message_id)
	);

	CREATE INDEX IF NOT EXISTS idx_message_send_results_completed_at
		ON message_send_results (completed_at);
`;

const SESSION_REVISION_KEYS_SCHEMA = `
	-- DEKs are never stored in plaintext. wrapped_dek is a sealed box
	-- encrypted to the content keypair derived from the CLI master secret.
	CREATE TABLE IF NOT EXISTS session_revision_keys (
		session_id TEXT NOT NULL,
		revision INTEGER NOT NULL,
		wrapped_dek TEXT NOT NULL,
		created_at TEXT NOT NULL,
		PRIMARY KEY (session_id, revision)
	);

	CREATE INDEX IF NOT EXISTS idx_session_revision_keys_session
		ON session_revision_keys (session_id, revision);
`;

const TEAM_RUNTIME_OUTBOX_SCHEMA = `
	-- A worker-local runtime outbox contains only immutable routing
	-- identifiers and the source WAL position. Team-authored facts stay
	-- exclusively in the leader's AgentTeamStore.
	CREATE TABLE IF NOT EXISTS team_runtime_outbox (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		source_session_id TEXT NOT NULL,
		source_revision INTEGER NOT NULL,
		source_seq INTEGER NOT NULL,
		protocol_version INTEGER NOT NULL,
		event_type TEXT NOT NULL,
		agent_team_id TEXT NOT NULL,
		member_id TEXT NOT NULL,
		target_machine_id TEXT NOT NULL,
		status TEXT NOT NULL,
		attempt_count INTEGER NOT NULL DEFAULT 0,
		next_attempt_at TEXT,
		lease_id TEXT,
		lease_expires_at TEXT,
		last_error_code TEXT,
		last_attempt_at TEXT,
		delivered_at TEXT,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL,
		UNIQUE (source_session_id, source_revision, source_seq),
		CHECK (source_revision > 0),
		CHECK (source_seq > 0),
		CHECK (protocol_version = 1),
		CHECK (event_type = 'turn_completed'),
		CHECK (status IN ('pending', 'in_flight', 'delivered', 'failed')),
		CHECK (attempt_count >= 0),
		CHECK (
			(status = 'pending'
				AND next_attempt_at IS NOT NULL
				AND lease_id IS NULL
				AND lease_expires_at IS NULL
				AND delivered_at IS NULL)
			OR (status = 'in_flight'
				AND next_attempt_at IS NULL
				AND lease_id IS NOT NULL
				AND lease_expires_at IS NOT NULL
				AND delivered_at IS NULL)
			OR (status = 'delivered'
				AND next_attempt_at IS NULL
				AND lease_id IS NULL
				AND lease_expires_at IS NULL
				AND delivered_at IS NOT NULL)
			OR (status = 'failed'
				AND next_attempt_at IS NULL
				AND lease_id IS NULL
				AND lease_expires_at IS NULL
				AND last_error_code IS NOT NULL
				AND delivered_at IS NULL)
		)
	);

	CREATE INDEX IF NOT EXISTS idx_team_runtime_outbox_due
		ON team_runtime_outbox (
			status,
			next_attempt_at,
			lease_expires_at
		);

	CREATE INDEX IF NOT EXISTS idx_team_runtime_outbox_member_order
		ON team_runtime_outbox (
			agent_team_id,
			member_id,
			status,
			id
		);
`;

const TEAM_RUNTIME_OUTBOX_DELIVERED_INDEX_SCHEMA = `
	CREATE INDEX IF NOT EXISTS idx_team_runtime_outbox_delivered
		ON team_runtime_outbox (status, delivered_at, id)
		WHERE status = 'delivered';
`;

const AGENT_TEAM_RUNTIME_INBOX_SCHEMA = `
	-- Runtime events become leader-authored facts only through this local inbox.
	-- The event receipt, member transition, and notification are committed by
	-- AgentTeamStore in one SQLite transaction.
	CREATE TABLE IF NOT EXISTS agent_team_runtime_inbox (
		turn_id TEXT NOT NULL PRIMARY KEY,
		agent_team_id TEXT NOT NULL,
		member_id TEXT NOT NULL,
		leader_member_id TEXT NOT NULL,
		notification_message_id TEXT NOT NULL UNIQUE,
		applied_at TEXT NOT NULL,
		FOREIGN KEY (agent_team_id)
			REFERENCES agent_teams(agent_team_id)
			ON DELETE CASCADE,
		FOREIGN KEY (agent_team_id, member_id)
			REFERENCES agent_team_members(agent_team_id, member_id)
			ON DELETE CASCADE,
		FOREIGN KEY (agent_team_id, leader_member_id)
			REFERENCES agent_team_members(agent_team_id, member_id)
			ON DELETE CASCADE,
		CHECK (member_id <> leader_member_id)
	);

	CREATE INDEX IF NOT EXISTS idx_agent_team_runtime_inbox_team
		ON agent_team_runtime_inbox (agent_team_id, member_id, applied_at);
`;

const TEAM_RUNTIME_OUTBOX_BACKFILL_SCHEMA = `
	-- Reconcile terminal events committed before this migration. A canonical
	-- replay is safe because the leader relay journal is exactly-once by
	-- source machine and operation identity.
	INSERT OR IGNORE INTO team_runtime_outbox (
		source_session_id, source_revision, source_seq,
		protocol_version, event_type, agent_team_id, member_id,
		target_machine_id, status, attempt_count, next_attempt_at,
		created_at, updated_at
	)
	SELECT
		events.session_id,
		events.revision,
		events.seq,
		1,
		'turn_completed',
		bindings.agent_team_id,
		bindings.member_id,
		bindings.leader_machine_id,
		'pending',
		0,
		events.created_at,
		events.created_at,
		events.created_at
	FROM session_events AS events
	INNER JOIN remote_team_session_bindings AS bindings
		ON bindings.session_id = events.session_id
		AND bindings.lifecycle = 'active'
	WHERE events.kind = 'turn_end'
	ORDER BY events.id;
`;

const TEAM_RUNTIME_OUTBOX_TRIGGER_SCHEMA = `
	-- SQLite triggers run in the transaction that inserted the WAL event, so
	-- terminal durability and relay durability cannot split.
	CREATE TRIGGER IF NOT EXISTS enqueue_team_runtime_after_turn_end
	AFTER INSERT ON session_events
	WHEN NEW.kind = 'turn_end'
	BEGIN
		INSERT OR IGNORE INTO team_runtime_outbox (
			source_session_id, source_revision, source_seq,
			protocol_version, event_type, agent_team_id, member_id,
			target_machine_id, status, attempt_count, next_attempt_at,
			created_at, updated_at
		)
		SELECT
			NEW.session_id,
			NEW.revision,
			NEW.seq,
			1,
			'turn_completed',
			bindings.agent_team_id,
			bindings.member_id,
			bindings.leader_machine_id,
			'pending',
			0,
			NEW.created_at,
			NEW.created_at,
			NEW.created_at
		FROM remote_team_session_bindings AS bindings
		WHERE bindings.session_id = NEW.session_id
			AND bindings.lifecycle = 'active';
	END;
`;

function tableExists(db: Database, tableName: string): boolean {
	return (
		db
			.query(
				"SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
			)
			.get(tableName) !== null
	);
}

function triggerExists(db: Database, triggerName: string): boolean {
	return (
		db
			.query(
				"SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = ? LIMIT 1",
			)
			.get(triggerName) !== null
	);
}

function columnExists(
	db: Database,
	tableName: string,
	columnName: string,
): boolean {
	return (
		db
			.query("SELECT 1 FROM pragma_table_info(?) WHERE name = ? LIMIT 1")
			.get(tableName, columnName) !== null
	);
}

function installTeamRuntimeOutboxCapture(
	db: Database,
	backfill: boolean,
): void {
	if (
		tableExists(db, "session_events") &&
		tableExists(db, "remote_team_session_bindings")
	) {
		if (backfill) {
			db.exec(TEAM_RUNTIME_OUTBOX_BACKFILL_SCHEMA);
		}
		db.exec(TEAM_RUNTIME_OUTBOX_TRIGGER_SCHEMA);
	}
}

function reconcileDivergentMigrationHistory(
	db: Database,
	currentVersion: number,
): void {
	if (currentVersion >= 8 && !tableExists(db, "message_send_results")) {
		db.exec(MESSAGE_SEND_RESULTS_SCHEMA);
	}
	if (
		currentVersion >= 14 &&
		!columnExists(db, "message_send_results", "usage_json")
	) {
		db.exec("ALTER TABLE message_send_results ADD COLUMN usage_json TEXT");
	}
	if (currentVersion >= 9 && !tableExists(db, "session_revision_keys")) {
		db.exec(SESSION_REVISION_KEYS_SCHEMA);
	}
	if (currentVersion >= 20) {
		const outboxMissing = !tableExists(db, "team_runtime_outbox");
		const captureTriggerMissing = !triggerExists(
			db,
			"enqueue_team_runtime_after_turn_end",
		);
		db.exec(TEAM_RUNTIME_OUTBOX_SCHEMA);
		installTeamRuntimeOutboxCapture(db, outboxMissing || captureTriggerMissing);
	}
	if (currentVersion >= 21 && tableExists(db, "team_runtime_outbox")) {
		db.exec(TEAM_RUNTIME_OUTBOX_DELIVERED_INDEX_SCHEMA);
	}
	if (currentVersion >= 22) {
		if (
			tableExists(db, "team_relay_operations") &&
			!columnExists(db, "team_relay_operations", "claim_owner_id")
		) {
			db.exec(`
				ALTER TABLE team_relay_operations
					ADD COLUMN claim_owner_id TEXT NOT NULL DEFAULT 'legacy';
			`);
		}
		if (
			tableExists(db, "agent_teams") &&
			tableExists(db, "agent_team_members") &&
			tableExists(db, "agent_team_mailbox_messages")
		) {
			db.exec(AGENT_TEAM_RUNTIME_INBOX_SCHEMA);
		}
	}
}

const MIGRATIONS: readonly Migration[] = [
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
		up: MESSAGE_SEND_RESULTS_SCHEMA,
	},
	{
		version: 9,
		up: SESSION_REVISION_KEYS_SCHEMA,
	},
	{
		version: 10,
		up: `
			-- A durable claim closes the crash window between starting an ACP
			-- prompt and recording its terminal result. A claim left behind by a
			-- terminated daemon is intentionally treated as indeterminate instead
			-- of executing the same external side effects again.
			CREATE TABLE IF NOT EXISTS message_send_claims (
				session_id TEXT NOT NULL,
				message_id TEXT NOT NULL,
				claim_id TEXT NOT NULL,
				claimed_at TEXT NOT NULL,
				PRIMARY KEY (session_id, message_id)
			);

			CREATE INDEX IF NOT EXISTS idx_message_send_claims_claimed_at
				ON message_send_claims (claimed_at);
		`,
	},
	{
		version: 11,
		up: `
			-- Bind a WAL database to the non-secret public identity derived from
			-- the master secret. A daemon using another account/key must fail
			-- closed instead of advertising or replaying the previous user's data.
			CREATE TABLE IF NOT EXISTS wal_encryption_identity (
				id INTEGER PRIMARY KEY CHECK (id = 1),
				key_identity TEXT NOT NULL,
				bound_at TEXT NOT NULL
			);
		`,
	},
	{
		version: 12,
		up: `
			-- ACP additionalDirectories is complete ordered session state. Keep it
			-- with both attached/WAL sessions and agent-discovered sessions.
			ALTER TABLE sessions
				ADD COLUMN additional_directories_json TEXT NOT NULL DEFAULT '[]';
			ALTER TABLE discovered_sessions
				ADD COLUMN additional_directories_json TEXT NOT NULL DEFAULT '[]';
		`,
	},
	{
		version: 13,
		up: `
			-- session/list metadata is a complete opaque snapshot. Persist it so
			-- detached sessions keep the same metadata across daemon restarts.
			ALTER TABLE discovered_sessions
				ADD COLUMN meta_json TEXT;
		`,
	},
	{
		version: 14,
		up: `
			-- Preserve the bounded, agent-reported prompt usage snapshot with the
			-- durable idempotency result. Legacy completed sends remain NULL.
			ALTER TABLE message_send_results
				ADD COLUMN usage_json TEXT;
		`,
	},
	{
		version: 15,
		up: `
			-- Team tool calls are leader-local durable facts. This migration used
			-- to occupy v8 on the Agent Team branch; keep it forward-only now that
			-- the mainline message-delivery migrations own v8-v14.
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
				FOREIGN KEY (requested_by_member_id)
					REFERENCES agent_team_members(member_id)
			);

			CREATE INDEX IF NOT EXISTS idx_agent_team_tool_intents_team
				ON agent_team_tool_intents (agent_team_id, created_at);
		`,
	},
	{
		version: 16,
		up: (db) => {
			// The former Agent Team branch used this column as its v9 migration.
			// Keep the renumbered migration safe when that history already exists.
			if (!columnExists(db, "agent_team_mailbox_messages", "wake_error_json")) {
				db.exec(`
					ALTER TABLE agent_team_mailbox_messages
						ADD COLUMN wake_error_json TEXT;
				`);
			}
			db.exec(`
				CREATE INDEX IF NOT EXISTS idx_agent_team_mailbox_unread
					ON agent_team_mailbox_messages (
						agent_team_id,
						to_member_id,
						read_at,
						created_at
					);
			`);
		},
	},
	{
		version: 17,
		up: `
			-- Team command results and execution failures remain leader-local.
			-- An in-progress row is never reclaimed automatically because the
			-- external side-effect outcome may be unknown after a crash.
			CREATE TABLE IF NOT EXISTS agent_team_command_journal (
				source_scope TEXT NOT NULL,
				operation_id TEXT NOT NULL,
				agent_team_id TEXT NOT NULL,
				caller_member_id TEXT NOT NULL,
				payload_digest TEXT NOT NULL,
				status TEXT NOT NULL,
				claim_id TEXT NOT NULL,
				result_local_json TEXT,
				error_local_json TEXT,
				claimed_at TEXT NOT NULL,
				completed_at TEXT,
				PRIMARY KEY (source_scope, operation_id),
				UNIQUE (agent_team_id, caller_member_id, operation_id),
				FOREIGN KEY (agent_team_id) REFERENCES agent_teams(agent_team_id),
				FOREIGN KEY (caller_member_id)
					REFERENCES agent_team_members(member_id),
				CHECK (status IN ('in_progress', 'completed', 'failed')),
				CHECK (
					(status = 'in_progress'
						AND result_local_json IS NULL
						AND error_local_json IS NULL
						AND completed_at IS NULL)
					OR (status = 'completed'
						AND result_local_json IS NOT NULL
						AND error_local_json IS NULL
						AND completed_at IS NOT NULL)
					OR (status = 'failed'
						AND result_local_json IS NULL
						AND error_local_json IS NOT NULL
						AND completed_at IS NOT NULL)
				)
			);

			CREATE INDEX IF NOT EXISTS idx_agent_team_command_journal_team
				ON agent_team_command_journal (
					agent_team_id,
					caller_member_id,
					claimed_at
			);
		`,
	},
	{
		version: 18,
		up: `
			-- Worker-local relay idempotency is intentionally independent from
			-- leader-authoritative Team facts. In-progress operations are never
			-- reclaimed automatically because a crashed side effect is unknown.
			CREATE TABLE IF NOT EXISTS team_relay_operations (
				source_machine_id TEXT NOT NULL,
				operation_id TEXT NOT NULL,
				request_digest TEXT NOT NULL,
				status TEXT NOT NULL,
				claim_id TEXT NOT NULL,
				result_local_json TEXT,
				error_local_json TEXT,
				claimed_at TEXT NOT NULL,
				completed_at TEXT,
				PRIMARY KEY (source_machine_id, operation_id),
				CHECK (status IN ('in_progress', 'completed', 'failed')),
				CHECK (
					(status = 'in_progress'
						AND result_local_json IS NULL
						AND error_local_json IS NULL
						AND completed_at IS NULL)
					OR (status = 'completed'
						AND result_local_json IS NOT NULL
						AND error_local_json IS NULL
						AND completed_at IS NOT NULL)
					OR (status = 'failed'
						AND result_local_json IS NULL
						AND error_local_json IS NOT NULL
						AND completed_at IS NOT NULL)
				)
			);

			CREATE INDEX IF NOT EXISTS idx_team_relay_operations_status
				ON team_relay_operations (status, claimed_at);

			-- A worker stores only the routing state needed to attach a remote
			-- ACP session. Team roles and all user-authored facts stay solely on
			-- the leader machine.
			CREATE TABLE IF NOT EXISTS remote_team_session_bindings (
				server_id TEXT NOT NULL PRIMARY KEY,
				agent_team_id TEXT NOT NULL,
				member_id TEXT NOT NULL,
				leader_machine_id TEXT NOT NULL,
				backend_id TEXT NOT NULL,
				session_id TEXT UNIQUE,
				lifecycle TEXT NOT NULL,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				UNIQUE (agent_team_id, member_id),
				CHECK (lifecycle IN ('creating', 'active', 'failed', 'closed')),
				CHECK (lifecycle <> 'active' OR session_id IS NOT NULL)
			);

			CREATE INDEX IF NOT EXISTS idx_remote_team_session_bindings_leader
				ON remote_team_session_bindings (
					leader_machine_id,
					updated_at
			);
		`,
	},
	{
		version: 19,
		up: `
			-- Remote member placement is leader-authoritative routing truth.
			-- It is deliberately separate from the gateway-facing Team
			-- projection and contains no user-authored Team content.
			CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_team_members_team_member
				ON agent_team_members (agent_team_id, member_id);

			CREATE TABLE IF NOT EXISTS agent_team_member_executions (
				agent_team_id TEXT NOT NULL,
				member_id TEXT NOT NULL PRIMARY KEY,
				execution_machine_id TEXT NOT NULL,
				worker_relay_key_id TEXT NOT NULL,
				bootstrap_operation_id TEXT NOT NULL UNIQUE,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				FOREIGN KEY (agent_team_id)
					REFERENCES agent_teams(agent_team_id)
					ON DELETE CASCADE,
				FOREIGN KEY (agent_team_id, member_id)
					REFERENCES agent_team_members(agent_team_id, member_id)
					ON DELETE CASCADE
			);

			CREATE INDEX IF NOT EXISTS idx_agent_team_member_executions_team
				ON agent_team_member_executions (agent_team_id, created_at);
		`,
	},
	{
		version: 20,
		up: (db) => {
			db.exec(TEAM_RUNTIME_OUTBOX_SCHEMA);
			installTeamRuntimeOutboxCapture(db, true);
		},
	},
	{
		version: 21,
		up: TEAM_RUNTIME_OUTBOX_DELIVERED_INDEX_SCHEMA,
	},
	{
		version: 22,
		up: (db) => {
			if (!columnExists(db, "team_relay_operations", "claim_owner_id")) {
				db.exec(`
					ALTER TABLE team_relay_operations
						ADD COLUMN claim_owner_id TEXT NOT NULL DEFAULT 'legacy';
				`);
			}
			db.exec(AGENT_TEAM_RUNTIME_INBOX_SCHEMA);
		},
	},
];

export function runMigrations(db: Database): number {
	// Enable WAL mode for better concurrency
	db.exec("PRAGMA journal_mode = WAL");
	db.exec("PRAGMA synchronous = NORMAL");
	// SQLite foreign-key enforcement is connection-local, so every store
	// connection must enable it when initializing the schema.
	db.exec("PRAGMA foreign_keys = ON");

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
	const initialVersion = currentVersion;

	const reconcileHistory = db.transaction(() => {
		reconcileDivergentMigrationHistory(db, currentVersion);
	});
	reconcileHistory();

	// Run pending migrations
	for (const migration of MIGRATIONS) {
		if (migration.version > currentVersion) {
			const applyMigration = db.transaction(() => {
				if (typeof migration.up === "string") {
					db.exec(migration.up);
				} else {
					migration.up(db);
				}
				db.exec(
					`INSERT INTO schema_version (version) VALUES (${migration.version})`,
				);
			});
			applyMigration();
		}
	}
	return initialVersion;
}
