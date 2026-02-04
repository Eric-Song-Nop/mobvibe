import type { Database } from "bun:sqlite";
import type { CompactionConfig } from "../config.js";
import { logger } from "../lib/logger.js";
import type { WalStore } from "./wal-store.js";

export type CompactionStats = {
	sessionId: string;
	ackedEventsDeleted: number;
	oldRevisionsDeleted: number;
	durationMs: number;
};

export type CompactionResult = {
	stats: CompactionStats[];
	totalDurationMs: number;
	skipped: string[];
};

/**
 * WAL Compactor - handles cleanup and optimization of the WAL database.
 *
 * Operations:
 * 1. Delete acked events older than retention period
 * 2. Delete events from old revisions (keeps latest N revisions)
 * 3. Run SQLite VACUUM to reclaim space
 */
export class WalCompactor {
	private db: Database;
	private activeSessionIds = new Set<string>();

	// Prepared statements
	private stmtGetAllSessions: ReturnType<Database["query"]>;
	private stmtGetSessionRevisions: ReturnType<Database["query"]>;
	private stmtDeleteAckedEvents: ReturnType<Database["query"]>;
	private stmtDeleteOldRevisionEvents: ReturnType<Database["query"]>;
	private stmtCountEvents: ReturnType<Database["query"]>;
	private stmtLogCompaction: ReturnType<Database["query"]>;

	constructor(
		_walStore: WalStore,
		private readonly config: CompactionConfig,
		db: Database,
	) {
		this.db = db;

		this.stmtGetAllSessions = this.db.query(`
			SELECT DISTINCT session_id FROM sessions
		`);

		this.stmtGetSessionRevisions = this.db.query(`
			SELECT DISTINCT revision FROM session_events
			WHERE session_id = $sessionId
			ORDER BY revision DESC
		`);

		this.stmtDeleteAckedEvents = this.db.query(`
			DELETE FROM session_events
			WHERE session_id = $sessionId
			  AND revision = $revision
			  AND acked_at IS NOT NULL
			  AND acked_at < $olderThan
			  AND id NOT IN (
			    SELECT id FROM session_events
			    WHERE session_id = $sessionId AND revision = $revision
			    ORDER BY seq DESC
			    LIMIT $minKeep
			  )
		`);

		this.stmtDeleteOldRevisionEvents = this.db.query(`
			DELETE FROM session_events
			WHERE session_id = $sessionId
			  AND revision = $revision
		`);

		this.stmtCountEvents = this.db.query(`
			SELECT COUNT(*) as count FROM session_events
			WHERE session_id = $sessionId AND revision = $revision
		`);

		this.stmtLogCompaction = this.db.query(`
			INSERT INTO compaction_log (session_id, revision, operation, events_affected, started_at, completed_at)
			VALUES ($sessionId, $revision, $operation, $eventsAffected, $startedAt, $completedAt)
		`);
	}

	/**
	 * Mark a session as actively streaming (will be skipped during compaction).
	 */
	markSessionActive(sessionId: string): void {
		this.activeSessionIds.add(sessionId);
	}

	/**
	 * Mark a session as inactive (eligible for compaction).
	 */
	markSessionInactive(sessionId: string): void {
		this.activeSessionIds.delete(sessionId);
	}

	/**
	 * Check if a session should be skipped during compaction.
	 */
	private shouldSkipSession(sessionId: string): boolean {
		return this.activeSessionIds.has(sessionId);
	}

	/**
	 * Compact all sessions.
	 */
	async compactAll(options?: { dryRun?: boolean }): Promise<CompactionResult> {
		const startTime = performance.now();
		const stats: CompactionStats[] = [];
		const skipped: string[] = [];

		const sessions = this.stmtGetAllSessions.all() as Array<{
			session_id: string;
		}>;

		for (const { session_id: sessionId } of sessions) {
			if (this.shouldSkipSession(sessionId)) {
				skipped.push(sessionId);
				continue;
			}

			try {
				const sessionStats = await this.compactSession(sessionId, options);
				stats.push(sessionStats);
			} catch (error) {
				logger.error({ err: error, sessionId }, "compaction_session_error");
			}
		}

		const totalDurationMs = performance.now() - startTime;

		// Run VACUUM if not dry run and we deleted anything
		const totalDeleted = stats.reduce(
			(sum, s) => sum + s.ackedEventsDeleted + s.oldRevisionsDeleted,
			0,
		);
		if (!options?.dryRun && totalDeleted > 0) {
			try {
				this.db.exec("VACUUM");
				logger.info({ totalDeleted }, "compaction_vacuum_complete");
			} catch (error) {
				logger.error({ err: error }, "compaction_vacuum_error");
			}
		}

		logger.info(
			{
				sessionsCompacted: stats.length,
				sessionsSkipped: skipped.length,
				totalDeleted,
				totalDurationMs,
			},
			"compaction_complete",
		);

		return { stats, totalDurationMs, skipped };
	}

	/**
	 * Compact a single session.
	 */
	async compactSession(
		sessionId: string,
		options?: { dryRun?: boolean },
	): Promise<CompactionStats> {
		const startTime = performance.now();
		let ackedEventsDeleted = 0;
		let oldRevisionsDeleted = 0;

		// Get all revisions for this session
		const revisions = this.stmtGetSessionRevisions.all({
			$sessionId: sessionId,
		}) as Array<{ revision: number }>;

		if (revisions.length === 0) {
			return {
				sessionId,
				ackedEventsDeleted: 0,
				oldRevisionsDeleted: 0,
				durationMs: performance.now() - startTime,
			};
		}

		const revisionsToKeep = revisions
			.slice(0, this.config.keepLatestRevisionsCount)
			.map((r) => r.revision);

		// Calculate cutoff dates
		const ackedCutoff = new Date();
		ackedCutoff.setDate(
			ackedCutoff.getDate() - this.config.ackedEventRetentionDays,
		);

		const revisionCutoff = new Date();
		revisionCutoff.setDate(
			revisionCutoff.getDate() - this.config.keepOldRevisionsDays,
		);

		// Process each revision
		for (const { revision } of revisions) {
			// Check if this is an old revision that can be deleted entirely
			if (!revisionsToKeep.includes(revision)) {
				// Delete all events for old revisions
				const countResult = this.stmtCountEvents.get({
					$sessionId: sessionId,
					$revision: revision,
				}) as { count: number };

				if (!options?.dryRun) {
					const result = this.stmtDeleteOldRevisionEvents.run({
						$sessionId: sessionId,
						$revision: revision,
					});
					oldRevisionsDeleted += result.changes;

					this.logCompaction(
						sessionId,
						revision,
						"delete_old_revision",
						result.changes,
					);
				} else {
					oldRevisionsDeleted += countResult.count;
				}

				logger.debug(
					{ sessionId, revision, count: countResult.count },
					"compaction_delete_old_revision",
				);
				continue;
			}

			// For kept revisions, delete old acked events
			if (!options?.dryRun) {
				const result = this.stmtDeleteAckedEvents.run({
					$sessionId: sessionId,
					$revision: revision,
					$olderThan: ackedCutoff.toISOString(),
					$minKeep: this.config.minEventsToKeep,
				});
				ackedEventsDeleted += result.changes;

				if (result.changes > 0) {
					this.logCompaction(
						sessionId,
						revision,
						"delete_acked_events",
						result.changes,
					);
					logger.debug(
						{ sessionId, revision, deleted: result.changes },
						"compaction_delete_acked",
					);
				}
			}
		}

		const durationMs = performance.now() - startTime;

		if (ackedEventsDeleted > 0 || oldRevisionsDeleted > 0) {
			logger.info(
				{ sessionId, ackedEventsDeleted, oldRevisionsDeleted, durationMs },
				"compaction_session_complete",
			);
		}

		return {
			sessionId,
			ackedEventsDeleted,
			oldRevisionsDeleted,
			durationMs,
		};
	}

	private logCompaction(
		sessionId: string,
		revision: number | null,
		operation: string,
		eventsAffected: number,
	): void {
		const now = new Date().toISOString();
		this.stmtLogCompaction.run({
			$sessionId: sessionId,
			$revision: revision,
			$operation: operation,
			$eventsAffected: eventsAffected,
			$startedAt: now,
			$completedAt: now,
		});
	}
}
