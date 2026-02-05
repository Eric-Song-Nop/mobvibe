import { Database } from "bun:sqlite";
import fs from "node:fs";
import path from "node:path";
import type { SessionEventKind } from "@mobvibe/shared";
import { logger } from "../lib/logger.js";
import { runMigrations } from "./migrations.js";
import { SeqGenerator } from "./seq-generator.js";

export type WalSession = {
	sessionId: string;
	machineId: string;
	backendId: string;
	currentRevision: number;
	cwd?: string;
	title?: string;
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

export type AppendEventParams = {
	sessionId: string;
	revision: number;
	kind: SessionEventKind;
	payload: unknown;
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
	title?: string;
};

export type DiscoveredSession = {
	sessionId: string;
	backendId: string;
	cwd?: string;
	title?: string;
	agentUpdatedAt?: string;
	discoveredAt: string;
	lastVerifiedAt?: string;
	isStale: boolean;
};

const DEFAULT_QUERY_LIMIT = 100;

export class WalStore {
	private db: Database;
	private seqGenerator = new SeqGenerator();

	// Prepared statements for performance
	private stmtGetSession: ReturnType<Database["query"]>;
	private stmtInsertSession: ReturnType<Database["query"]>;
	private stmtUpdateSession: ReturnType<Database["query"]>;
	private stmtInsertEvent: ReturnType<Database["query"]>;
	private stmtQueryEvents: ReturnType<Database["query"]>;
	private stmtQueryUnackedEvents: ReturnType<Database["query"]>;
	private stmtAckEvents: ReturnType<Database["query"]>;
	private stmtIncrementRevision: ReturnType<Database["query"]>;
	private stmtGetMaxSeq: ReturnType<Database["query"]>;

	// Discovered sessions statements
	private stmtUpsertDiscoveredSession: ReturnType<Database["query"]>;
	private stmtGetDiscoveredSessions: ReturnType<Database["query"]>;
	private stmtGetDiscoveredSessionsByBackend: ReturnType<Database["query"]>;
	private stmtMarkDiscoveredSessionStale: ReturnType<Database["query"]>;
	private stmtDeleteStaleDiscoveredSessions: ReturnType<Database["query"]>;

	constructor(dbPath: string) {
		// Ensure directory exists
		const dir = path.dirname(dbPath);
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}

		this.db = new Database(dbPath);
		runMigrations(this.db);

		// Prepare statements
		this.stmtGetSession = this.db.query(`
      SELECT session_id, machine_id, backend_id, current_revision, cwd, title, created_at, updated_at
      FROM sessions
      WHERE session_id = $sessionId
    `);

		this.stmtInsertSession = this.db.query(`
      INSERT INTO sessions (session_id, machine_id, backend_id, current_revision, cwd, title, created_at, updated_at)
      VALUES ($sessionId, $machineId, $backendId, 1, $cwd, $title, $createdAt, $updatedAt)
    `);

		this.stmtUpdateSession = this.db.query(`
      UPDATE sessions
      SET cwd = COALESCE($cwd, cwd),
          title = COALESCE($title, title),
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

		this.stmtGetMaxSeq = this.db.query(`
      SELECT MAX(seq) as max_seq
      FROM session_events
      WHERE session_id = $sessionId AND revision = $revision
    `);

		// Discovered sessions statements
		this.stmtUpsertDiscoveredSession = this.db.query(`
      INSERT INTO discovered_sessions (
        session_id, backend_id, cwd, title, agent_updated_at,
        discovered_at, last_verified_at, is_stale
      ) VALUES (
        $sessionId, $backendId, $cwd, $title, $agentUpdatedAt,
        $discoveredAt, $lastVerifiedAt, 0
      )
      ON CONFLICT (session_id) DO UPDATE SET
        backend_id = $backendId,
        cwd = COALESCE($cwd, discovered_sessions.cwd),
        title = COALESCE($title, discovered_sessions.title),
        agent_updated_at = COALESCE($agentUpdatedAt, discovered_sessions.agent_updated_at),
        last_verified_at = $lastVerifiedAt,
        is_stale = 0
    `);

		this.stmtGetDiscoveredSessions = this.db.query(`
      SELECT session_id, backend_id, cwd, title, agent_updated_at,
             discovered_at, last_verified_at, is_stale
      FROM discovered_sessions
      WHERE is_stale = 0
      ORDER BY discovered_at DESC
    `);

		this.stmtGetDiscoveredSessionsByBackend = this.db.query(`
      SELECT session_id, backend_id, cwd, title, agent_updated_at,
             discovered_at, last_verified_at, is_stale
      FROM discovered_sessions
      WHERE backend_id = $backendId AND is_stale = 0
      ORDER BY discovered_at DESC
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
				$title: params.title ?? null,
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
			$title: params.title ?? null,
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
	 * Append an event to the WAL.
	 */
	appendEvent(params: AppendEventParams): WalEvent {
		const seq = this.seqGenerator.next(params.sessionId, params.revision);
		const now = new Date().toISOString();

		logger.debug(
			{
				sessionId: params.sessionId,
				revision: params.revision,
				seq,
				kind: params.kind,
			},
			"wal_append_event",
		);

		this.stmtInsertEvent.run({
			$sessionId: params.sessionId,
			$revision: params.revision,
			$seq: seq,
			$kind: params.kind,
			$payload: JSON.stringify(params.payload),
			$createdAt: now,
		});

		// Get the inserted row ID
		const lastId = this.db.query("SELECT last_insert_rowid() as id").get() as {
			id: number;
		};

		logger.info(
			{
				sessionId: params.sessionId,
				revision: params.revision,
				seq,
				kind: params.kind,
				eventId: lastId.id,
			},
			"wal_event_appended",
		);

		return {
			id: lastId.id,
			sessionId: params.sessionId,
			revision: params.revision,
			seq,
			kind: params.kind,
			payload: params.payload,
			createdAt: now,
		};
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

	// ========== Discovered Sessions Methods ==========

	/**
	 * Save discovered sessions (upsert).
	 * Marks sessions as non-stale and updates verification time.
	 */
	saveDiscoveredSessions(sessions: DiscoveredSession[]): void {
		const now = new Date().toISOString();
		for (const session of sessions) {
			this.stmtUpsertDiscoveredSession.run({
				$sessionId: session.sessionId,
				$backendId: session.backendId,
				$cwd: session.cwd ?? null,
				$title: session.title ?? null,
				$agentUpdatedAt: session.agentUpdatedAt ?? null,
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

	/**
	 * Close the database connection.
	 */
	close(): void {
		this.db.close();
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
			title: row.title ?? undefined,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		};
	}

	private rowToEvent(row: WalEventRow): WalEvent {
		return {
			id: row.id,
			sessionId: row.session_id,
			revision: row.revision,
			seq: row.seq,
			kind: row.kind as SessionEventKind,
			payload: JSON.parse(row.payload),
			createdAt: row.created_at,
			ackedAt: row.acked_at ?? undefined,
		};
	}

	private rowToDiscoveredSession(row: DiscoveredSessionRow): DiscoveredSession {
		return {
			sessionId: row.session_id,
			backendId: row.backend_id,
			cwd: row.cwd ?? undefined,
			title: row.title ?? undefined,
			agentUpdatedAt: row.agent_updated_at ?? undefined,
			discoveredAt: row.discovered_at,
			lastVerifiedAt: row.last_verified_at ?? undefined,
			isStale: row.is_stale === 1,
		};
	}
}

// Internal row types for SQLite results
type WalSessionRow = {
	session_id: string;
	machine_id: string;
	backend_id: string;
	current_revision: number;
	cwd: string | null;
	title: string | null;
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
	title: string | null;
	agent_updated_at: string | null;
	discovered_at: string;
	last_verified_at: string | null;
	is_stale: number;
};
