import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
	type AcpMetaValue,
	REPORTED_TOKEN_USAGE_MAX_SERIALIZED_BYTES,
	type ReportedTokenUsage,
	type SendMessageResult,
	type SessionEventKind,
	type StopReason,
	sanitizeAcpMessageMeta,
	sanitizeAcpMeta,
	sanitizeReportedTokenUsage,
} from "@mobvibe/shared";
import { logger } from "../lib/logger.js";
import { runMigrations } from "./migrations.js";
import { SeqGenerator } from "./seq-generator.js";

export type WalSession = {
	sessionId: string;
	machineId: string;
	backendId: string;
	currentRevision: number;
	cwd?: string;
	additionalDirectories: string[];
	title?: string;
	isTitlePinned?: boolean;
	createdAt: string;
	updatedAt: string;
};

export type WalEvent = {
	id: number;
	sessionId: string;
	revision: number;
	seq: number;
	kind: SessionEventKind;
	payload: unknown;
	createdAt: string;
	ackedAt?: string;
};

export type UnackedSessionRevision = {
	sessionId: string;
	revision: number;
};

export type SessionRevisionKey = {
	sessionId: string;
	revision: number;
	wrappedDek: string;
};

export type MessageSendClaim =
	| { status: "claimed"; claimId: string }
	| { status: "completed"; result: SendMessageResult }
	| { status: "in_progress" };

export type AppendEventParams = {
	sessionId: string;
	revision: number;
	kind: SessionEventKind;
	payload: unknown;
};

export type WalEventInput = Pick<AppendEventParams, "kind" | "payload">;

export type CommitReloadRevisionParams = {
	sessionId: string;
	expectedRevision: number;
	additionalDirectories?: readonly string[];
	events: readonly WalEventInput[];
	wrappedDek?: string;
};

type PreparedWalEventInput = WalEventInput & {
	serializedPayload: string;
	createdAt: string;
};

export type QueryEventsParams = {
	sessionId: string;
	revision: number;
	afterSeq?: number;
	limit?: number;
};

export type EnsureSessionParams = {
	sessionId: string;
	machineId: string;
	backendId: string;
	cwd?: string;
	additionalDirectories?: readonly string[];
	title?: string;
	isTitlePinned?: boolean;
};

export type CommitSessionLoadParams = EnsureSessionParams & {
	expectedRevision: number | null;
	events: readonly WalEventInput[];
	wrappedDek?: string;
};

export type CommitSessionResumeParams = EnsureSessionParams & {
	expectedRevision: number | null;
	events: readonly WalEventInput[];
	wrappedDek?: string;
};

export type DiscoveredSession = {
	sessionId: string;
	backendId: string;
	cwd?: string;
	additionalDirectories?: string[];
	workspaceRootCwd?: string;
	title?: string | null;
	agentUpdatedAt?: string | null;
	_meta?: Record<string, unknown> | null;
	discoveredAt: string;
	lastVerifiedAt?: string;
	isStale: boolean;
};

const DEFAULT_QUERY_LIMIT = 100;

const parseAdditionalDirectories = (value: string): string[] => {
	const parsed: unknown = JSON.parse(value);
	if (
		!Array.isArray(parsed) ||
		!parsed.every((directory) => typeof directory === "string")
	) {
		throw new Error("Invalid additional directories in WAL");
	}
	return parsed;
};

const parseMetadata = (value: string): AcpMetaValue | undefined => {
	try {
		const result = sanitizeAcpMeta(JSON.parse(value));
		return result.ok ? result.value : undefined;
	} catch {
		return undefined;
	}
};

const parseReportedTokenUsage = (
	value: string | null,
): ReportedTokenUsage | undefined => {
	if (value === null) return undefined;
	if (
		Buffer.byteLength(value, "utf8") > REPORTED_TOKEN_USAGE_MAX_SERIALIZED_BYTES
	) {
		return undefined;
	}
	try {
		return sanitizeReportedTokenUsage(JSON.parse(value));
	} catch {
		return undefined;
	}
};

/**
 * Tables whose rows are tied to a user's local Mobvibe identity. Schema and
 * migration metadata are deliberately excluded so a genuinely empty database
 * can be claimed on first login.
 */
const DURABLE_DATA_TABLES = [
	"wal_encryption_identity",
	"sessions",
	"session_events",
	"discovered_sessions",
	"archived_session_ids",
	"compaction_log",
	"message_send_results",
	"message_send_claims",
	"session_revision_keys",
	"agent_teams",
	"agent_team_members",
	"agent_team_mcp_status",
	"agent_team_mailbox_messages",
	"agent_team_tasks",
	"agent_team_summary_refs",
] as const;

const databaseHasDurableData = (db: Database): boolean => {
	const existingTables = new Set(
		(
			db
				.query("SELECT name FROM sqlite_master WHERE type = 'table'")
				.all() as Array<{ name: string }>
		).map((row) => row.name),
	);

	for (const table of DURABLE_DATA_TABLES) {
		if (!existingTables.has(table)) continue;
		// `table` comes exclusively from the constant allowlist above.
		if (db.query(`SELECT 1 FROM ${table} LIMIT 1`).get()) {
			return true;
		}
	}
	return false;
};

/** Inspect an existing WAL without creating or migrating it. */
export const hasDurableWalData = (dbPath: string): boolean => {
	if (!fs.existsSync(dbPath)) return false;
	const db = new Database(dbPath, { readonly: true });
	try {
		return databaseHasDurableData(db);
	} finally {
		db.close();
	}
};

export class WalStore {
	private db: Database;
	private readonly initialSchemaVersion: number;
	private seqGenerator = new SeqGenerator();
	private metaReplayWarnings = 0;

	// Prepared statements for performance
	private stmtGetSession: ReturnType<Database["query"]>;
	private stmtGetSessions: ReturnType<Database["query"]>;
	private stmtInsertSession: ReturnType<Database["query"]>;
	private stmtUpdateSession: ReturnType<Database["query"]>;
	private stmtInsertEvent: ReturnType<Database["query"]>;
	private stmtQueryEvents: ReturnType<Database["query"]>;
	private stmtQueryUnackedEvents: ReturnType<Database["query"]>;
	private stmtQueryUnackedEventsPage: ReturnType<Database["query"]>;
	private stmtAckEvents: ReturnType<Database["query"]>;
	private stmtIncrementRevision: ReturnType<Database["query"]>;
	private stmtCommitReloadRevision: ReturnType<Database["query"]>;
	private stmtGetMaxSeq: ReturnType<Database["query"]>;
	private stmtGetMessageSendResult: ReturnType<Database["query"]>;
	private stmtInsertMessageSendResult: ReturnType<Database["query"]>;
	private stmtGetMessageSendClaim: ReturnType<Database["query"]>;
	private stmtInsertMessageSendClaim: ReturnType<Database["query"]>;
	private stmtDeleteMessageSendClaim: ReturnType<Database["query"]>;
	private stmtGetSessionRevisionKey: ReturnType<Database["query"]>;
	private stmtInsertSessionRevisionKey: ReturnType<Database["query"]>;
	private stmtListSessionRevisionKeysPage: ReturnType<Database["query"]>;
	private stmtListUnackedSessionRevisions: ReturnType<Database["query"]>;

	// Discovered sessions statements
	private stmtUpsertDiscoveredSession: ReturnType<Database["query"]>;
	private stmtGetDiscoveredSessions: ReturnType<Database["query"]>;
	private stmtGetDiscoveredSessionsByBackend: ReturnType<Database["query"]>;
	private stmtGetDiscoveredSessionBackend: ReturnType<Database["query"]>;
	private stmtMarkDiscoveredSessionStale: ReturnType<Database["query"]>;
	private stmtDeleteStaleDiscoveredSessions: ReturnType<Database["query"]>;
	private stmtDeleteDiscoveredSession: ReturnType<Database["query"]>;

	// Consolidation statements
	private stmtQueryBySeqRange: ReturnType<Database["query"]>;
	private stmtUpdatePayload: ReturnType<Database["query"]>;

	// Archive statements
	private stmtDeleteSessionEvents: ReturnType<Database["query"]>;
	private stmtDeleteMessageSendResults: ReturnType<Database["query"]>;
	private stmtDeleteMessageSendClaims: ReturnType<Database["query"]>;
	private stmtDeleteSessionRevisionKeys: ReturnType<Database["query"]>;
	private stmtDeleteCompactionLog: ReturnType<Database["query"]>;
	private stmtClearAgentTeamMemberSession: ReturnType<Database["query"]>;
	private stmtDeleteSession: ReturnType<Database["query"]>;
	private stmtInsertArchivedSession: ReturnType<Database["query"]>;
	private stmtDeleteArchivedSession: ReturnType<Database["query"]>;
	private stmtIsArchived: ReturnType<Database["query"]>;
	private stmtGetArchivedSessionIds: ReturnType<Database["query"]>;

	constructor(dbPath: string) {
		// Ensure directory exists
		const dir = path.dirname(dbPath);
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}

		this.db = new Database(dbPath);
		this.initialSchemaVersion = runMigrations(this.db);

		// Prepare statements
		this.stmtGetSession = this.db.query(`
      SELECT session_id, machine_id, backend_id, current_revision, cwd, additional_directories_json, title, is_title_pinned, created_at, updated_at
      FROM sessions
      WHERE session_id = $sessionId
    `);

		this.stmtGetSessions = this.db.query(`
			SELECT session_id, machine_id, backend_id, current_revision, cwd, additional_directories_json, title, is_title_pinned, created_at, updated_at
			FROM sessions
			ORDER BY updated_at DESC, session_id ASC
		`);

		this.stmtInsertSession = this.db.query(`
      INSERT INTO sessions (session_id, machine_id, backend_id, current_revision, cwd, additional_directories_json, title, is_title_pinned, created_at, updated_at)
      VALUES ($sessionId, $machineId, $backendId, 1, $cwd, $additionalDirectoriesJson, $title, $isTitlePinned, $createdAt, $updatedAt)
    `);

		this.stmtUpdateSession = this.db.query(`
      UPDATE sessions
      SET cwd = COALESCE($cwd, cwd),
          additional_directories_json = COALESCE($additionalDirectoriesJson, additional_directories_json),
          title = COALESCE($title, title),
          is_title_pinned = COALESCE($isTitlePinned, is_title_pinned),
          updated_at = $updatedAt
      WHERE session_id = $sessionId
    `);

		this.stmtInsertEvent = this.db.query(`
      INSERT INTO session_events (session_id, revision, seq, kind, payload, created_at)
      VALUES ($sessionId, $revision, $seq, $kind, $payload, $createdAt)
    `);

		this.stmtQueryEvents = this.db.query(`
      SELECT id, session_id, revision, seq, kind, payload, created_at, acked_at
      FROM session_events
      WHERE session_id = $sessionId
        AND revision = $revision
        AND seq > $afterSeq
      ORDER BY seq ASC
      LIMIT $limit
    `);

		this.stmtQueryUnackedEvents = this.db.query(`
      SELECT id, session_id, revision, seq, kind, payload, created_at, acked_at
      FROM session_events
      WHERE session_id = $sessionId
        AND revision = $revision
        AND acked_at IS NULL
      ORDER BY seq ASC
    `);

		this.stmtQueryUnackedEventsPage = this.db.query(`
			SELECT id, session_id, revision, seq, kind, payload, created_at, acked_at
			FROM session_events
			WHERE session_id = $sessionId
				AND revision = $revision
				AND seq > $afterSeq
				AND acked_at IS NULL
			ORDER BY seq ASC
			LIMIT $limit
		`);

		this.stmtAckEvents = this.db.query(`
      UPDATE session_events
      SET acked_at = $ackedAt
      WHERE session_id = $sessionId
        AND revision = $revision
        AND seq <= $upToSeq
        AND acked_at IS NULL
    `);

		this.stmtIncrementRevision = this.db.query(`
      UPDATE sessions
      SET current_revision = current_revision + 1,
          updated_at = $updatedAt
      WHERE session_id = $sessionId
      RETURNING current_revision
    `);

		this.stmtCommitReloadRevision = this.db.query(`
			UPDATE sessions
			SET current_revision = current_revision + 1,
				additional_directories_json = COALESCE($additionalDirectoriesJson, additional_directories_json),
				updated_at = $updatedAt
			WHERE session_id = $sessionId
				AND current_revision = $expectedRevision
			RETURNING current_revision
		`);

		this.stmtGetMaxSeq = this.db.query(`
      SELECT MAX(seq) as max_seq
      FROM session_events
      WHERE session_id = $sessionId AND revision = $revision
		`);

		this.stmtGetMessageSendResult = this.db.query(`
			SELECT stop_reason, usage_json
			FROM message_send_results
			WHERE session_id = $sessionId AND message_id = $messageId
		`);

		this.stmtInsertMessageSendResult = this.db.query(`
			INSERT OR IGNORE INTO message_send_results (
				session_id, message_id, stop_reason, usage_json, completed_at
			) VALUES ($sessionId, $messageId, $stopReason, $usageJson, $completedAt)
		`);

		this.stmtGetMessageSendClaim = this.db.query(`
			SELECT claim_id
			FROM message_send_claims
			WHERE session_id = $sessionId AND message_id = $messageId
		`);

		this.stmtInsertMessageSendClaim = this.db.query(`
			INSERT OR IGNORE INTO message_send_claims (
				session_id, message_id, claim_id, claimed_at
			) VALUES ($sessionId, $messageId, $claimId, $claimedAt)
		`);

		this.stmtDeleteMessageSendClaim = this.db.query(`
			DELETE FROM message_send_claims
			WHERE session_id = $sessionId
				AND message_id = $messageId
				AND claim_id = $claimId
		`);

		this.stmtGetSessionRevisionKey = this.db.query(`
			SELECT wrapped_dek
			FROM session_revision_keys
			WHERE session_id = $sessionId AND revision = $revision
		`);

		this.stmtInsertSessionRevisionKey = this.db.query(`
			INSERT OR IGNORE INTO session_revision_keys (
				session_id, revision, wrapped_dek, created_at
			) VALUES ($sessionId, $revision, $wrappedDek, $createdAt)
		`);

		this.stmtListSessionRevisionKeysPage = this.db.query(`
			SELECT session_id, revision, wrapped_dek
			FROM session_revision_keys
			WHERE $afterSessionId IS NULL
				OR session_id > $afterSessionId
				OR (session_id = $afterSessionId AND revision > $afterRevision)
			ORDER BY session_id ASC, revision ASC
			LIMIT $limit
		`);

		this.stmtListUnackedSessionRevisions = this.db.query(`
			SELECT DISTINCT e.session_id, e.revision
			FROM session_events e
			INNER JOIN sessions s
				ON s.session_id = e.session_id
				AND s.current_revision = e.revision
			WHERE e.acked_at IS NULL
			ORDER BY e.session_id ASC, e.revision ASC
		`);

		// Consolidation statements
		this.stmtQueryBySeqRange = this.db.query(`
      SELECT id, session_id, revision, seq, kind, payload, created_at, acked_at
      FROM session_events
      WHERE session_id = $sessionId AND revision = $revision
        AND seq >= $fromSeq AND seq <= $toSeq
      ORDER BY seq ASC
    `);

		this.stmtUpdatePayload = this.db.query(`
      UPDATE session_events SET payload = $payload WHERE id = $id
    `);

		// Discovered sessions statements
		this.stmtUpsertDiscoveredSession = this.db.query(`
      INSERT INTO discovered_sessions (
        session_id, backend_id, cwd, additional_directories_json, workspace_root_cwd, title, agent_updated_at, meta_json,
        discovered_at, last_verified_at, is_stale
      ) VALUES (
        $sessionId, $backendId, $cwd, $additionalDirectoriesJson, $workspaceRootCwd, $title, $agentUpdatedAt, $metaJson,
        $discoveredAt, $lastVerifiedAt, 0
      )
      ON CONFLICT (session_id) DO UPDATE SET
        backend_id = $backendId,
        cwd = COALESCE($cwd, discovered_sessions.cwd),
        additional_directories_json = $additionalDirectoriesJson,
        workspace_root_cwd = COALESCE($workspaceRootCwd, discovered_sessions.workspace_root_cwd),
        title = $title,
        agent_updated_at = $agentUpdatedAt,
        meta_json = CASE WHEN $hasMeta = 1 THEN $metaJson ELSE discovered_sessions.meta_json END,
        last_verified_at = $lastVerifiedAt,
        is_stale = 0
    `);

		this.stmtGetDiscoveredSessions = this.db.query(`
			SELECT d.session_id, d.backend_id, d.cwd, d.additional_directories_json, d.workspace_root_cwd, d.title, d.agent_updated_at, d.meta_json,
             d.discovered_at, d.last_verified_at, d.is_stale
      FROM discovered_sessions d
      LEFT JOIN archived_session_ids a ON d.session_id = a.session_id
      WHERE d.is_stale = 0 AND a.session_id IS NULL
      ORDER BY d.discovered_at DESC
    `);

		this.stmtGetDiscoveredSessionsByBackend = this.db.query(`
			SELECT d.session_id, d.backend_id, d.cwd, d.additional_directories_json, d.workspace_root_cwd, d.title, d.agent_updated_at, d.meta_json,
             d.discovered_at, d.last_verified_at, d.is_stale
      FROM discovered_sessions d
      LEFT JOIN archived_session_ids a ON d.session_id = a.session_id
      WHERE d.backend_id = $backendId AND d.is_stale = 0 AND a.session_id IS NULL
      ORDER BY d.discovered_at DESC
    `);

		this.stmtGetDiscoveredSessionBackend = this.db.query(`
			SELECT backend_id
			FROM discovered_sessions
			WHERE session_id = $sessionId
		`);

		this.stmtMarkDiscoveredSessionStale = this.db.query(`
      UPDATE discovered_sessions
      SET is_stale = 1
      WHERE session_id = $sessionId
    `);

		this.stmtDeleteStaleDiscoveredSessions = this.db.query(`
      DELETE FROM discovered_sessions
      WHERE is_stale = 1 AND discovered_at < $olderThan
    `);

		this.stmtDeleteDiscoveredSession = this.db.query(`
			DELETE FROM discovered_sessions WHERE session_id = $sessionId
		`);

		// Archive statements
		this.stmtDeleteSessionEvents = this.db.query(`
      DELETE FROM session_events WHERE session_id = $sessionId
    `);

		this.stmtDeleteMessageSendResults = this.db.query(`
			DELETE FROM message_send_results WHERE session_id = $sessionId
		`);

		this.stmtDeleteMessageSendClaims = this.db.query(`
			DELETE FROM message_send_claims WHERE session_id = $sessionId
		`);

		this.stmtDeleteSessionRevisionKeys = this.db.query(`
			DELETE FROM session_revision_keys WHERE session_id = $sessionId
		`);

		this.stmtDeleteCompactionLog = this.db.query(`
			DELETE FROM compaction_log WHERE session_id = $sessionId
		`);

		this.stmtClearAgentTeamMemberSession = this.db.query(`
			UPDATE agent_team_members
			SET session_id = NULL, updated_at = $updatedAt
			WHERE session_id = $sessionId
		`);

		this.stmtDeleteSession = this.db.query(`
      DELETE FROM sessions WHERE session_id = $sessionId
    `);

		this.stmtInsertArchivedSession = this.db.query(`
      INSERT OR IGNORE INTO archived_session_ids (session_id, archived_at)
      VALUES ($sessionId, $archivedAt)
    `);

		this.stmtDeleteArchivedSession = this.db.query(`
			DELETE FROM archived_session_ids WHERE session_id = $sessionId
		`);

		this.stmtIsArchived = this.db.query(`
      SELECT 1 FROM archived_session_ids WHERE session_id = $sessionId
    `);

		this.stmtGetArchivedSessionIds = this.db.query(`
      SELECT session_id FROM archived_session_ids
    `);
	}

	/**
	 * Bind this database to one public device-key identity. This value is not a
	 * secret; it prevents a daemon started with another account's credentials
	 * from exposing durable sessions that belong to the previous identity.
	 */
	bindEncryptionIdentity(keyIdentity: string): void {
		const existing = this.getEncryptionIdentity();
		if (existing) {
			if (existing !== keyIdentity) {
				throw new Error(
					"WAL encryption identity mismatch; restore the original master secret or use a separate MOBVIBE_HOME",
				);
			}
			return;
		}
		this.db
			.query(`
				INSERT INTO wal_encryption_identity (id, key_identity, bound_at)
				VALUES (1, $keyIdentity, $boundAt)
			`)
			.run({
				$keyIdentity: keyIdentity,
				$boundAt: new Date().toISOString(),
			});
	}

	getEncryptionIdentity(): string | undefined {
		const row = this.db
			.query("SELECT key_identity FROM wal_encryption_identity WHERE id = 1")
			.get() as { key_identity: string } | null;
		return row?.key_identity;
	}

	/** Schema version observed before this process applied pending migrations. */
	getInitialSchemaVersion(): number {
		return this.initialSchemaVersion;
	}

	/** Return whether this database contains identity-bound user data. */
	hasDurableData(): boolean {
		return databaseHasDurableData(this.db);
	}

	getSessionRevisionKeysPage(
		after: Pick<SessionRevisionKey, "sessionId" | "revision"> | undefined,
		limit: number,
	): SessionRevisionKey[] {
		const rows = this.stmtListSessionRevisionKeysPage.all({
			$afterSessionId: after?.sessionId ?? null,
			$afterRevision: after?.revision ?? 0,
			$limit: Math.max(1, limit),
		}) as Array<{
			session_id: string;
			revision: number;
			wrapped_dek: string;
		}>;
		return rows.map((row) => ({
			sessionId: row.session_id,
			revision: row.revision,
			wrappedDek: row.wrapped_dek,
		}));
	}

	/**
	 * Ensure a session exists in the WAL store.
	 * Creates if not exists, updates metadata if exists.
	 */
	ensureSession(params: EnsureSessionParams): { revision: number } {
		const now = new Date().toISOString();
		const existing = this.stmtGetSession.get({
			$sessionId: params.sessionId,
		}) as WalSessionRow | null;

		logger.debug(
			{ sessionId: params.sessionId, exists: !!existing },
			"wal_ensure_session",
		);

		if (existing) {
			// Update metadata
			this.stmtUpdateSession.run({
				$sessionId: params.sessionId,
				$cwd: params.cwd ?? null,
				$additionalDirectoriesJson:
					params.additionalDirectories === undefined
						? null
						: JSON.stringify(params.additionalDirectories),
				$title: params.title ?? null,
				$isTitlePinned:
					params.isTitlePinned !== undefined
						? params.isTitlePinned
							? 1
							: 0
						: null,
				$updatedAt: now,
			});

			// Initialize sequence generator
			const maxSeq = this.getMaxSeq(
				params.sessionId,
				existing.current_revision,
			);
			this.seqGenerator.initialize(
				params.sessionId,
				existing.current_revision,
				maxSeq,
			);

			logger.debug(
				{
					sessionId: params.sessionId,
					revision: existing.current_revision,
					maxSeq,
				},
				"wal_session_existing",
			);

			return { revision: existing.current_revision };
		}

		// Insert new session
		this.stmtInsertSession.run({
			$sessionId: params.sessionId,
			$machineId: params.machineId,
			$backendId: params.backendId,
			$cwd: params.cwd ?? null,
			$additionalDirectoriesJson: JSON.stringify(
				params.additionalDirectories ?? [],
			),
			$title: params.title ?? null,
			$isTitlePinned: params.isTitlePinned ? 1 : 0,
			$createdAt: now,
			$updatedAt: now,
		});

		// Initialize sequence generator at 0
		this.seqGenerator.initialize(params.sessionId, 1, 0);

		logger.info(
			{ sessionId: params.sessionId, revision: 1 },
			"wal_session_created",
		);

		return { revision: 1 };
	}

	/**
	 * Get a session by ID.
	 */
	getSession(sessionId: string): WalSession | null {
		const row = this.stmtGetSession.get({
			$sessionId: sessionId,
		}) as WalSessionRow | null;
		if (!row) return null;
		return this.rowToSession(row);
	}

	/**
	 * Get all durable WAL sessions, including sessions that are not attached.
	 */
	getSessions(): WalSession[] {
		const rows = this.stmtGetSessions.all() as WalSessionRow[];
		return rows.map((row) => this.rowToSession(row));
	}

	/**
	 * Append an event to the WAL.
	 */
	appendEvent(params: AppendEventParams): WalEvent {
		const event = this.appendEventsAtomically(
			params.sessionId,
			params.revision,
			[{ kind: params.kind, payload: params.payload }],
		)[0];
		if (!event) {
			throw new Error("WAL append produced no event");
		}
		return event;
	}

	/**
	 * Append a same-session, same-revision batch in one transaction. Sequence
	 * state is updated only after the durable commit succeeds.
	 */
	appendEventsAtomically(
		sessionId: string,
		revision: number,
		events: readonly WalEventInput[],
	): WalEvent[] {
		if (events.length === 0) {
			return [];
		}
		const prepared = this.prepareEventInputs(events);
		let inserted: WalEvent[];
		try {
			inserted = this.db
				.transaction(() =>
					this.insertPreparedEvents(sessionId, revision, prepared),
				)
				.immediate();
		} catch (error) {
			this.syncSequenceFromDurableState(sessionId, revision);
			throw error;
		}
		this.syncSequenceAfterCommit(sessionId, revision, inserted);
		this.logAppendedEvents(inserted);
		return inserted;
	}

	/**
	 * Atomically create (or validate an empty existing revision of) a loaded
	 * session and persist its key plus complete replay.
	 */
	commitSessionLoad(params: CommitSessionLoadParams): {
		revision: number;
		events: WalEvent[];
	} {
		const prepared = this.prepareEventInputs(params.events);
		const targetRevision = params.expectedRevision ?? 1;
		let committed: { revision: number; events: WalEvent[] };
		try {
			committed = this.db
				.transaction(() => {
					const existing = this.stmtGetSession.get({
						$sessionId: params.sessionId,
					}) as WalSessionRow | null;
					const now = new Date().toISOString();
					let revision: number;
					if (params.expectedRevision === null) {
						if (existing) {
							throw new Error(
								`Session appeared before load commit: ${params.sessionId}`,
							);
						}
						this.stmtInsertSession.run({
							$sessionId: params.sessionId,
							$machineId: params.machineId,
							$backendId: params.backendId,
							$cwd: params.cwd ?? null,
							$additionalDirectoriesJson: JSON.stringify(
								params.additionalDirectories ?? [],
							),
							$title: params.title ?? null,
							$isTitlePinned: params.isTitlePinned ? 1 : 0,
							$createdAt: now,
							$updatedAt: now,
						});
						revision = 1;
					} else {
						if (
							!existing ||
							existing.current_revision !== params.expectedRevision ||
							this.getMaxSeq(params.sessionId, params.expectedRevision) !== 0
						) {
							throw new Error(
								`Session changed before load commit: ${params.sessionId}`,
							);
						}
						this.stmtUpdateSession.run({
							$sessionId: params.sessionId,
							$cwd: params.cwd ?? null,
							$additionalDirectoriesJson:
								params.additionalDirectories === undefined
									? null
									: JSON.stringify(params.additionalDirectories),
							$title: params.title ?? null,
							$isTitlePinned:
								params.isTitlePinned === undefined
									? null
									: params.isTitlePinned
										? 1
										: 0,
							$updatedAt: now,
						});
						revision = params.expectedRevision;
					}
					if (params.wrappedDek) {
						this.stmtInsertSessionRevisionKey.run({
							$sessionId: params.sessionId,
							$revision: revision,
							$wrappedDek: params.wrappedDek,
							$createdAt: now,
						});
					}
					return {
						revision,
						events: this.insertPreparedEvents(
							params.sessionId,
							revision,
							prepared,
						),
					};
				})
				.immediate();
		} catch (error) {
			this.syncSequenceFromDurableState(params.sessionId, targetRevision);
			throw error;
		}
		this.syncSequenceAfterCommit(
			params.sessionId,
			committed.revision,
			committed.events,
		);
		this.logAppendedEvents(committed.events);
		return committed;
	}

	/**
	 * Atomically attach durable state to a resumed agent session. Unlike a load,
	 * a resume keeps the current revision and appends only updates emitted while
	 * the resume request was in flight.
	 */
	commitSessionResume(params: CommitSessionResumeParams): {
		revision: number;
		events: WalEvent[];
	} {
		const prepared = this.prepareEventInputs(params.events);
		const targetRevision = params.expectedRevision ?? 1;
		let committed: { revision: number; events: WalEvent[] };
		try {
			committed = this.db
				.transaction(() => {
					const existing = this.stmtGetSession.get({
						$sessionId: params.sessionId,
					}) as WalSessionRow | null;
					const now = new Date().toISOString();
					let revision: number;
					if (params.expectedRevision === null) {
						if (existing) {
							throw new Error(
								`Session appeared before resume commit: ${params.sessionId}`,
							);
						}
						this.stmtInsertSession.run({
							$sessionId: params.sessionId,
							$machineId: params.machineId,
							$backendId: params.backendId,
							$cwd: params.cwd ?? null,
							$additionalDirectoriesJson: JSON.stringify(
								params.additionalDirectories ?? [],
							),
							$title: params.title ?? null,
							$isTitlePinned: params.isTitlePinned ? 1 : 0,
							$createdAt: now,
							$updatedAt: now,
						});
						revision = 1;
					} else {
						if (
							!existing ||
							existing.current_revision !== params.expectedRevision
						) {
							throw new Error(
								`Session changed before resume commit: ${params.sessionId}`,
							);
						}
						this.stmtUpdateSession.run({
							$sessionId: params.sessionId,
							$cwd: params.cwd ?? null,
							$additionalDirectoriesJson:
								params.additionalDirectories === undefined
									? null
									: JSON.stringify(params.additionalDirectories),
							$title: params.title ?? null,
							$isTitlePinned:
								params.isTitlePinned === undefined
									? null
									: params.isTitlePinned
										? 1
										: 0,
							$updatedAt: now,
						});
						revision = params.expectedRevision;
					}
					if (params.wrappedDek) {
						this.stmtInsertSessionRevisionKey.run({
							$sessionId: params.sessionId,
							$revision: revision,
							$wrappedDek: params.wrappedDek,
							$createdAt: now,
						});
					}
					return {
						revision,
						events: this.insertPreparedEvents(
							params.sessionId,
							revision,
							prepared,
						),
					};
				})
				.immediate();
		} catch (error) {
			this.syncSequenceFromDurableState(params.sessionId, targetRevision);
			throw error;
		}
		this.syncSequenceAfterCommit(
			params.sessionId,
			committed.revision,
			committed.events,
		);
		this.logAppendedEvents(committed.events);
		return committed;
	}

	/**
	 * Atomically advance an expected revision and persist its complete replay.
	 */
	commitReloadRevision(params: CommitReloadRevisionParams): {
		revision: number;
		events: WalEvent[];
	} {
		const prepared = this.prepareEventInputs(params.events);
		const targetRevision = params.expectedRevision + 1;
		let committed: { revision: number; events: WalEvent[] };
		try {
			committed = this.db
				.transaction(() => {
					const revisionRow = this.stmtCommitReloadRevision.get({
						$sessionId: params.sessionId,
						$expectedRevision: params.expectedRevision,
						$additionalDirectoriesJson:
							params.additionalDirectories === undefined
								? null
								: JSON.stringify(params.additionalDirectories),
						$updatedAt: new Date().toISOString(),
					}) as { current_revision: number } | null;
					if (!revisionRow) {
						throw new Error(
							`Session revision changed before reload commit: ${params.sessionId}`,
						);
					}
					if (params.wrappedDek) {
						this.stmtInsertSessionRevisionKey.run({
							$sessionId: params.sessionId,
							$revision: revisionRow.current_revision,
							$wrappedDek: params.wrappedDek,
							$createdAt: new Date().toISOString(),
						});
					}
					return {
						revision: revisionRow.current_revision,
						events: this.insertPreparedEvents(
							params.sessionId,
							revisionRow.current_revision,
							prepared,
						),
					};
				})
				.immediate();
		} catch (error) {
			this.syncSequenceFromDurableState(params.sessionId, targetRevision);
			throw error;
		}
		this.syncSequenceAfterCommit(
			params.sessionId,
			committed.revision,
			committed.events,
		);
		this.logAppendedEvents(committed.events);
		return committed;
	}

	/**
	 * Query events for a session/revision after a given sequence.
	 */
	queryEvents(params: QueryEventsParams): WalEvent[] {
		logger.debug(
			{
				sessionId: params.sessionId,
				revision: params.revision,
				afterSeq: params.afterSeq ?? 0,
				limit: params.limit ?? DEFAULT_QUERY_LIMIT,
			},
			"wal_query_events",
		);

		const rows = this.stmtQueryEvents.all({
			$sessionId: params.sessionId,
			$revision: params.revision,
			$afterSeq: params.afterSeq ?? 0,
			$limit: params.limit ?? DEFAULT_QUERY_LIMIT,
		}) as WalEventRow[];

		logger.debug(
			{
				sessionId: params.sessionId,
				revision: params.revision,
				count: rows.length,
				seqRange:
					rows.length > 0
						? `${rows[0].seq}-${rows[rows.length - 1].seq}`
						: "empty",
			},
			"wal_query_events_result",
		);

		return rows.map((row) => this.rowToEvent(row));
	}

	/**
	 * Get all unacked events for a session/revision.
	 */
	getUnackedEvents(sessionId: string, revision: number): WalEvent[] {
		const rows = this.stmtQueryUnackedEvents.all({
			$sessionId: sessionId,
			$revision: revision,
		}) as WalEventRow[];

		return rows.map((row) => this.rowToEvent(row));
	}

	/**
	 * Read one bounded page for reconnect replay. Sequence-key pagination stays
	 * stable while acknowledgements are written concurrently.
	 */
	getUnackedEventsPage(
		sessionId: string,
		revision: number,
		afterSeq: number,
		limit: number,
	): WalEvent[] {
		const rows = this.stmtQueryUnackedEventsPage.all({
			$sessionId: sessionId,
			$revision: revision,
			$afterSeq: afterSeq,
			$limit: Math.max(1, limit),
		}) as WalEventRow[];
		return rows.map((row) => this.rowToEvent(row));
	}

	/**
	 * Mark events as acknowledged up to a given sequence.
	 */
	ackEvents(sessionId: string, revision: number, upToSeq: number): void {
		logger.debug({ sessionId, revision, upToSeq }, "wal_ack_events");

		const result = this.stmtAckEvents.run({
			$sessionId: sessionId,
			$revision: revision,
			$upToSeq: upToSeq,
			$ackedAt: new Date().toISOString(),
		});

		logger.debug(
			{ sessionId, revision, upToSeq, changes: result.changes },
			"wal_ack_events_result",
		);
	}

	/**
	 * Return a completed message send result for gateway retry deduplication.
	 */
	getMessageSendResult(
		sessionId: string,
		messageId: string,
	): SendMessageResult | undefined {
		const row = this.stmtGetMessageSendResult.get({
			$sessionId: sessionId,
			$messageId: messageId,
		}) as { stop_reason: StopReason; usage_json: string | null } | null;
		if (!row) return undefined;
		const usage = parseReportedTokenUsage(row.usage_json);
		return {
			stopReason: row.stop_reason,
			...(usage ? { usage } : {}),
		};
	}

	/**
	 * Atomically claim a message before invoking the external ACP prompt.
	 * A pre-existing claim has an unknown outcome and must never be re-executed.
	 */
	claimMessageSend(sessionId: string, messageId: string): MessageSendClaim {
		return this.db.transaction((): MessageSendClaim => {
			const completed = this.getMessageSendResult(sessionId, messageId);
			if (completed) {
				return { status: "completed", result: completed };
			}

			const claimId = randomUUID();
			const inserted = this.stmtInsertMessageSendClaim.run({
				$sessionId: sessionId,
				$messageId: messageId,
				$claimId: claimId,
				$claimedAt: new Date().toISOString(),
			});
			if (inserted.changes === 1) {
				return { status: "claimed", claimId };
			}

			const completedAfterConflict = this.getMessageSendResult(
				sessionId,
				messageId,
			);
			if (completedAfterConflict) {
				return { status: "completed", result: completedAfterConflict };
			}
			return { status: "in_progress" };
		})();
	}

	/**
	 * Atomically persist a completed result and remove its execution claim.
	 */
	completeMessageSend(
		sessionId: string,
		messageId: string,
		claimId: string,
		stopReason: StopReason,
		usage?: ReportedTokenUsage,
	): WalEvent {
		const sanitizedUsage = sanitizeReportedTokenUsage(usage);
		const prepared = this.prepareEventInputs([
			{
				kind: "turn_end",
				payload: {
					stopReason,
					...(sanitizedUsage ? { usage: sanitizedUsage } : {}),
				},
			},
		]);
		let terminalEvent: WalEvent;
		let revision = 0;
		try {
			terminalEvent = this.db
				.transaction(() => {
					const activeClaim = this.stmtGetMessageSendClaim.get({
						$sessionId: sessionId,
						$messageId: messageId,
					}) as { claim_id: string } | null;
					if (!activeClaim || activeClaim.claim_id !== claimId) {
						throw new Error("Message send claim is no longer active");
					}
					const session = this.getSession(sessionId);
					if (!session) {
						throw new Error(`Session not found: ${sessionId}`);
					}
					revision = session.currentRevision;
					const inserted = this.recordMessageSendResult(
						sessionId,
						messageId,
						stopReason,
						sanitizedUsage,
					);
					if (!inserted) {
						throw new Error("Completed message result already exists");
					}
					this.stmtDeleteMessageSendClaim.run({
						$sessionId: sessionId,
						$messageId: messageId,
						$claimId: claimId,
					});
					const [event] = this.insertPreparedEvents(
						sessionId,
						revision,
						prepared,
					);
					if (!event) {
						throw new Error("Terminal event commit produced no event");
					}
					return event;
				})
				.immediate();
		} catch (error) {
			if (revision > 0) {
				this.syncSequenceFromDurableState(sessionId, revision);
			}
			throw error;
		}
		this.syncSequenceAfterCommit(sessionId, revision, [terminalEvent]);
		this.logAppendedEvents([terminalEvent]);
		return terminalEvent;
	}

	/**
	 * Persist the first terminal result. Retries cannot overwrite it.
	 */
	recordMessageSendResult(
		sessionId: string,
		messageId: string,
		stopReason: StopReason,
		usage?: ReportedTokenUsage,
	): boolean {
		const sanitizedUsage = sanitizeReportedTokenUsage(usage);
		const result = this.stmtInsertMessageSendResult.run({
			$sessionId: sessionId,
			$messageId: messageId,
			$stopReason: stopReason,
			$usageJson: sanitizedUsage ? JSON.stringify(sanitizedUsage) : null,
			$completedAt: new Date().toISOString(),
		});
		return result.changes === 1;
	}

	/**
	 * Return the sealed DEK for one durable session revision.
	 */
	getSessionRevisionKey(
		sessionId: string,
		revision: number,
	): string | undefined {
		const row = this.stmtGetSessionRevisionKey.get({
			$sessionId: sessionId,
			$revision: revision,
		}) as { wrapped_dek: string } | null;
		return row?.wrapped_dek;
	}

	/**
	 * Persist the first sealed DEK generated for a revision. A later retry must
	 * not replace it or already-delivered ciphertext would become undecryptable.
	 */
	recordSessionRevisionKey(
		sessionId: string,
		revision: number,
		wrappedDek: string,
	): void {
		this.stmtInsertSessionRevisionKey.run({
			$sessionId: sessionId,
			$revision: revision,
			$wrappedDek: wrappedDek,
			$createdAt: new Date().toISOString(),
		});
	}

	/**
	 * List current revisions with durable, unacknowledged events. Obsolete
	 * revisions are intentionally excluded because clients reset on revision
	 * changes and must not receive stale history after the reset.
	 */
	listUnackedSessionRevisions(): UnackedSessionRevision[] {
		const rows = this.stmtListUnackedSessionRevisions.all() as Array<{
			session_id: string;
			revision: number;
		}>;
		return rows.map((row) => ({
			sessionId: row.session_id,
			revision: row.revision,
		}));
	}

	/**
	 * Increment the revision for a session (used when session is reloaded).
	 */
	incrementRevision(sessionId: string): number {
		logger.info({ sessionId }, "wal_increment_revision");

		const result = this.stmtIncrementRevision.get({
			$sessionId: sessionId,
			$updatedAt: new Date().toISOString(),
		}) as { current_revision: number } | null;

		if (!result) {
			logger.error({ sessionId }, "wal_increment_revision_session_not_found");
			throw new Error(`Session not found: ${sessionId}`);
		}

		// Reset sequence generator for new revision
		this.seqGenerator.reset(sessionId, result.current_revision);

		logger.info(
			{ sessionId, newRevision: result.current_revision },
			"wal_revision_incremented",
		);

		return result.current_revision;
	}

	/**
	 * Get the current sequence number for a session/revision.
	 */
	getCurrentSeq(sessionId: string, revision: number): number {
		return this.seqGenerator.current(sessionId, revision);
	}

	// ========== Consolidation Methods ==========

	/**
	 * Query events by sequence range (inclusive).
	 */
	queryEventsBySeqRange(
		sessionId: string,
		revision: number,
		fromSeq: number,
		toSeq: number,
	): WalEvent[] {
		const rows = this.stmtQueryBySeqRange.all({
			$sessionId: sessionId,
			$revision: revision,
			$fromSeq: fromSeq,
			$toSeq: toSeq,
		}) as WalEventRow[];
		return rows.map((row) => this.rowToEvent(row));
	}

	/**
	 * Update the payload of a single event by ID.
	 */
	updateEventPayload(eventId: number, payload: unknown): void {
		this.stmtUpdatePayload.run({
			$id: eventId,
			$payload: JSON.stringify(payload),
		});
	}

	// ========== Discovered Sessions Methods ==========

	/**
	 * Save discovered sessions (upsert).
	 * Marks sessions as non-stale and updates verification time.
	 */
	saveDiscoveredSessions(sessions: DiscoveredSession[]): void {
		const now = new Date().toISOString();
		for (const session of sessions) {
			const hasMeta = Object.hasOwn(session, "_meta");
			const sanitizedMeta = hasMeta
				? sanitizeAcpMeta(session._meta)
				: undefined;
			this.stmtUpsertDiscoveredSession.run({
				$sessionId: session.sessionId,
				$backendId: session.backendId,
				$cwd: session.cwd ?? null,
				$additionalDirectoriesJson: JSON.stringify(
					session.additionalDirectories ?? [],
				),
				$workspaceRootCwd: session.workspaceRootCwd ?? null,
				$title: session.title ?? null,
				$agentUpdatedAt: session.agentUpdatedAt ?? null,
				$hasMeta: hasMeta && sanitizedMeta?.ok ? 1 : 0,
				$metaJson: sanitizedMeta?.ok
					? JSON.stringify(sanitizedMeta.value)
					: null,
				$discoveredAt: session.discoveredAt,
				$lastVerifiedAt: now,
			});
		}
	}

	/**
	 * Get all non-stale discovered sessions.
	 */
	getDiscoveredSessions(backendId?: string): DiscoveredSession[] {
		let rows: DiscoveredSessionRow[];
		if (backendId) {
			rows = this.stmtGetDiscoveredSessionsByBackend.all({
				$backendId: backendId,
			}) as DiscoveredSessionRow[];
		} else {
			rows = this.stmtGetDiscoveredSessions.all() as DiscoveredSessionRow[];
		}
		return rows.map((row) => this.rowToDiscoveredSession(row));
	}

	/** Resolve durable backend affinity even for a legacy archived snapshot. */
	getDiscoveredSessionBackendId(sessionId: string): string | undefined {
		const row = this.stmtGetDiscoveredSessionBackend.get({
			$sessionId: sessionId,
		}) as { backend_id: string } | null;
		return row?.backend_id;
	}

	/**
	 * Mark a discovered session as stale (cwd no longer exists).
	 */
	markDiscoveredSessionStale(sessionId: string): void {
		this.stmtMarkDiscoveredSessionStale.run({
			$sessionId: sessionId,
		});
	}

	/**
	 * Delete stale discovered sessions older than a given date.
	 */
	deleteStaleDiscoveredSessions(olderThan: Date): number {
		const result = this.stmtDeleteStaleDiscoveredSessions.run({
			$olderThan: olderThan.toISOString(),
		});
		return result.changes;
	}

	// ========== Archive Methods ==========

	/**
	 * Archive a session: delete WAL events, delete session record, mark as archived.
	 */
	archiveSession(sessionId: string): void {
		this.db
			.transaction(() => {
				this.stmtDeleteSessionEvents.run({ $sessionId: sessionId });
				this.stmtDeleteMessageSendResults.run({ $sessionId: sessionId });
				this.stmtDeleteMessageSendClaims.run({ $sessionId: sessionId });
				this.stmtDeleteSessionRevisionKeys.run({ $sessionId: sessionId });
				this.stmtDeleteCompactionLog.run({ $sessionId: sessionId });
				this.stmtDeleteDiscoveredSession.run({ $sessionId: sessionId });
				this.stmtDeleteSession.run({ $sessionId: sessionId });
				this.stmtInsertArchivedSession.run({
					$sessionId: sessionId,
					$archivedAt: new Date().toISOString(),
				});
			})
			.immediate();
		this.seqGenerator.clearSession(sessionId);
	}

	/** Permanently remove every local WAL record associated with a session. */
	deleteSession(sessionId: string): void {
		const deletedAt = new Date().toISOString();
		this.db
			.transaction(() => {
				this.stmtDeleteSessionEvents.run({ $sessionId: sessionId });
				this.stmtDeleteMessageSendResults.run({ $sessionId: sessionId });
				this.stmtDeleteMessageSendClaims.run({ $sessionId: sessionId });
				this.stmtDeleteSessionRevisionKeys.run({ $sessionId: sessionId });
				this.stmtDeleteCompactionLog.run({ $sessionId: sessionId });
				this.stmtDeleteDiscoveredSession.run({ $sessionId: sessionId });
				this.stmtClearAgentTeamMemberSession.run({
					$sessionId: sessionId,
					$updatedAt: deletedAt,
				});
				this.stmtDeleteSession.run({ $sessionId: sessionId });
				this.stmtDeleteArchivedSession.run({ $sessionId: sessionId });
			})
			.immediate();
		this.seqGenerator.clearSession(sessionId);
	}

	/**
	 * Archive multiple sessions. Returns the number archived.
	 */
	bulkArchiveSessions(sessionIds: string[]): number {
		let count = 0;
		for (const sessionId of sessionIds) {
			this.archiveSession(sessionId);
			count++;
		}
		return count;
	}

	/**
	 * Check if a session ID is archived.
	 */
	isArchived(sessionId: string): boolean {
		const row = this.stmtIsArchived.get({ $sessionId: sessionId });
		return row !== null;
	}

	/**
	 * Get all archived session IDs.
	 */
	getArchivedSessionIds(): string[] {
		const rows = this.stmtGetArchivedSessionIds.all() as {
			session_id: string;
		}[];
		return rows.map((r) => r.session_id);
	}

	/**
	 * Close the database connection.
	 */
	close(): void {
		this.db.close();
	}

	private prepareEventInputs(
		events: readonly WalEventInput[],
	): PreparedWalEventInput[] {
		return events.map((event) => {
			const serializedPayload = JSON.stringify(event.payload);
			if (serializedPayload === undefined) {
				throw new Error("WAL event payload must be JSON serializable");
			}
			return {
				...event,
				serializedPayload,
				createdAt: new Date().toISOString(),
			};
		});
	}

	private insertPreparedEvents(
		sessionId: string,
		revision: number,
		events: readonly PreparedWalEventInput[],
	): WalEvent[] {
		let seq = this.getMaxSeq(sessionId, revision);
		return events.map((event) => {
			seq += 1;
			logger.debug(
				{ sessionId, revision, seq, kind: event.kind },
				"wal_append_event",
			);
			this.stmtInsertEvent.run({
				$sessionId: sessionId,
				$revision: revision,
				$seq: seq,
				$kind: event.kind,
				$payload: event.serializedPayload,
				$createdAt: event.createdAt,
			});
			const lastId = this.db
				.query("SELECT last_insert_rowid() as id")
				.get() as { id: number };
			return {
				id: lastId.id,
				sessionId,
				revision,
				seq,
				kind: event.kind,
				payload: event.payload,
				createdAt: event.createdAt,
			};
		});
	}

	private syncSequenceAfterCommit(
		sessionId: string,
		revision: number,
		events: readonly WalEvent[],
	): void {
		const lastSeq = events.at(-1)?.seq ?? this.getMaxSeq(sessionId, revision);
		this.seqGenerator.initialize(sessionId, revision, lastSeq);
	}

	private syncSequenceFromDurableState(
		sessionId: string,
		revision: number,
	): void {
		this.seqGenerator.initialize(
			sessionId,
			revision,
			this.getMaxSeq(sessionId, revision),
		);
	}

	private logAppendedEvents(events: readonly WalEvent[]): void {
		for (const event of events) {
			logger.info(
				{
					sessionId: event.sessionId,
					revision: event.revision,
					seq: event.seq,
					kind: event.kind,
					eventId: event.id,
				},
				"wal_event_appended",
			);
		}
	}

	private getMaxSeq(sessionId: string, revision: number): number {
		const result = this.stmtGetMaxSeq.get({
			$sessionId: sessionId,
			$revision: revision,
		}) as { max_seq: number | null } | null;
		return result?.max_seq ?? 0;
	}

	private rowToSession(row: WalSessionRow): WalSession {
		return {
			sessionId: row.session_id,
			machineId: row.machine_id,
			backendId: row.backend_id,
			currentRevision: row.current_revision,
			cwd: row.cwd ?? undefined,
			additionalDirectories: parseAdditionalDirectories(
				row.additional_directories_json,
			),
			title: row.title ?? undefined,
			isTitlePinned: row.is_title_pinned === 1 ? true : undefined,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		};
	}

	private rowToEvent(row: WalEventRow): WalEvent {
		const payload = this.sanitizeWalPayload(JSON.parse(row.payload), "replay");
		return {
			id: row.id,
			sessionId: row.session_id,
			revision: row.revision,
			seq: row.seq,
			kind: row.kind as SessionEventKind,
			payload,
			createdAt: row.created_at,
			ackedAt: row.acked_at ?? undefined,
		};
	}

	private rowToDiscoveredSession(row: DiscoveredSessionRow): DiscoveredSession {
		const metadata =
			row.meta_json === null ? undefined : parseMetadata(row.meta_json);
		return {
			sessionId: row.session_id,
			backendId: row.backend_id,
			cwd: row.cwd ?? undefined,
			additionalDirectories: parseAdditionalDirectories(
				row.additional_directories_json,
			),
			workspaceRootCwd: row.workspace_root_cwd ?? undefined,
			title: row.title,
			agentUpdatedAt: row.agent_updated_at,
			...(metadata !== undefined ? { _meta: metadata } : {}),
			discoveredAt: row.discovered_at,
			lastVerifiedAt: row.last_verified_at ?? undefined,
			isStale: row.is_stale === 1,
		};
	}

	private sanitizeWalPayload(payload: unknown, operation: string): unknown {
		const result = sanitizeAcpMessageMeta(payload);
		if (!result.complete) {
			throw new Error("WAL event payload must contain plain JSON values");
		}
		if (result.rejectedEnvelopes > 0 && this.metaReplayWarnings < 3) {
			this.metaReplayWarnings += 1;
			logger.warn(
				{
					operation,
					rejectedEnvelopes: result.rejectedEnvelopes,
					reasons: result.rejections.map(({ reason }) => reason),
					rejectionsTruncated: result.rejectionsTruncated,
				},
				"wal_acp_metadata_rejected",
			);
		}
		return result.value;
	}
}

// Internal row types for SQLite results
type WalSessionRow = {
	session_id: string;
	machine_id: string;
	backend_id: string;
	current_revision: number;
	cwd: string | null;
	additional_directories_json: string;
	title: string | null;
	is_title_pinned: number | null;
	created_at: string;
	updated_at: string;
};

type WalEventRow = {
	id: number;
	session_id: string;
	revision: number;
	seq: number;
	kind: string;
	payload: string;
	created_at: string;
	acked_at: string | null;
};

type DiscoveredSessionRow = {
	session_id: string;
	backend_id: string;
	cwd: string | null;
	additional_directories_json: string;
	workspace_root_cwd: string | null;
	title: string | null;
	agent_updated_at: string | null;
	meta_json: string | null;
	discovered_at: string;
	last_verified_at: string | null;
	is_stale: number;
};
