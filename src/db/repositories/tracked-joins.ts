import type { Database } from 'bun:sqlite';
import type { JoinStatus, LeaderboardEntryRow, LeaderboardPeriod, TrackedJoinRow } from '@/types/db.ts';

export interface BulkValidationUpdate {
    id: number;
    status: Extract<JoinStatus, 'validated' | 'left_early'>;
    validationTime: string | null;
    leaveTime: string | null;
}

const PERIOD_TO_DAYS: Record<Exclude<LeaderboardPeriod, 'all'>, number> = {
    week: 7,
    month: 30,
};

export class TrackedJoinsRepository {
    private readonly stmtGetPending;
    private readonly stmtUpsert;
    private readonly stmtMarkLeftEarly;
    private readonly stmtFindCandidates;
    private readonly stmtFindCandidatesForGuild;
    private readonly stmtBulkUpdate;
    private readonly stmtCountByStatus;
    private readonly stmtLeaderboardAll;
    private readonly stmtLeaderboardSince;
    private readonly stmtLeaderboardAllPage;
    private readonly stmtLeaderboardSincePage;
    private readonly stmtDeleteAllInGuild;

    constructor(private readonly db: Database) {
        this.stmtGetPending = db.query<TrackedJoinRow, [string, string]>(
            "SELECT * FROM TrackedJoins WHERE guildId = ? AND inviteeId = ? AND status = 'pending'",
        );
        this.stmtUpsert = db.prepare<unknown, [string, string, string, string, JoinStatus]>(
            `INSERT INTO TrackedJoins (guildId, inviteeId, inviterId, inviteCodeUsed, status, joinTimestamp)
             VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
             ON CONFLICT(guildId, inviteeId) DO UPDATE SET
                 inviterId            = excluded.inviterId,
                 inviteCodeUsed       = excluded.inviteCodeUsed,
                 joinTimestamp        = excluded.joinTimestamp,
                 status               = excluded.status,
                 validationTimestamp  = NULL,
                 leaveTimestamp       = NULL,
                 updatedAt            = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
        );
        this.stmtMarkLeftEarly = db.prepare<unknown, [string, string]>(
            `UPDATE TrackedJoins
             SET status = 'left_early', leaveTimestamp = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE guildId = ? AND inviteeId = ? AND status = 'pending'`,
        );
        this.stmtFindCandidates = db.query<TrackedJoinRow, [string]>(
            "SELECT * FROM TrackedJoins WHERE status = 'pending' AND joinTimestamp <= ?",
        );
        this.stmtFindCandidatesForGuild = db.query<TrackedJoinRow, [string, string]>(
            "SELECT * FROM TrackedJoins WHERE guildId = ? AND status = 'pending' AND joinTimestamp <= ?",
        );
        this.stmtBulkUpdate = db.prepare<
            unknown,
            [Extract<JoinStatus, 'validated' | 'left_early'>, string | null, string | null, number]
        >(
            `UPDATE TrackedJoins
             SET status = ?, validationTimestamp = ?, leaveTimestamp = ?, updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ? AND status = 'pending'`,
        );
        this.stmtCountByStatus = db.query<{ count: number }, [string, string, JoinStatus]>(
            'SELECT COUNT(*) as count FROM TrackedJoins WHERE guildId = ? AND inviterId = ? AND status = ?',
        );
        this.stmtLeaderboardAll = db.query<LeaderboardEntryRow, [string, number]>(
            `SELECT inviterId, COUNT(*) as count
             FROM TrackedJoins
             WHERE guildId = ? AND status = 'validated'
             GROUP BY inviterId
             ORDER BY count DESC, inviterId ASC
             LIMIT ?`,
        );
        this.stmtLeaderboardSince = db.query<LeaderboardEntryRow, [string, string, number]>(
            `SELECT inviterId, COUNT(*) as count
             FROM TrackedJoins
             WHERE guildId = ? AND status = 'validated' AND joinTimestamp >= ?
             GROUP BY inviterId
             ORDER BY count DESC, inviterId ASC
             LIMIT ?`,
        );
        this.stmtLeaderboardAllPage = db.query<LeaderboardEntryRow, [string, number, number]>(
            `SELECT inviterId, COUNT(*) as count
             FROM TrackedJoins
             WHERE guildId = ? AND status = 'validated'
             GROUP BY inviterId
             ORDER BY count DESC, inviterId ASC
             LIMIT ? OFFSET ?`,
        );
        this.stmtLeaderboardSincePage = db.query<LeaderboardEntryRow, [string, string, number, number]>(
            `SELECT inviterId, COUNT(*) as count
             FROM TrackedJoins
             WHERE guildId = ? AND status = 'validated' AND joinTimestamp >= ?
             GROUP BY inviterId
             ORDER BY count DESC, inviterId ASC
             LIMIT ? OFFSET ?`,
        );
        this.stmtDeleteAllInGuild = db.prepare<unknown, [string]>('DELETE FROM TrackedJoins WHERE guildId = ?');
    }

    getPending(guildId: string, inviteeId: string): TrackedJoinRow | null {
        return this.stmtGetPending.get(guildId, inviteeId) ?? null;
    }

    upsertPending(guildId: string, inviteeId: string, inviterId: string, inviteCode: string): void {
        this.stmtUpsert.run(guildId, inviteeId, inviterId, inviteCode, 'pending');
    }

    upsertWithStatus(
        guildId: string,
        inviteeId: string,
        inviterId: string,
        inviteCode: string,
        status: JoinStatus,
    ): void {
        this.stmtUpsert.run(guildId, inviteeId, inviterId, inviteCode, status);
    }

    markLeftEarly(guildId: string, inviteeId: string): number {
        const result = this.stmtMarkLeftEarly.run(guildId, inviteeId);
        return Number(result.changes);
    }

    findCandidatesForValidation(cutoffIso: string): TrackedJoinRow[] {
        return this.stmtFindCandidates.all(cutoffIso);
    }

    /** Per-guild scan — cleaner when callers want to apply per-guild validation_period_days. */
    findCandidatesForGuild(guildId: string, cutoffIso: string): TrackedJoinRow[] {
        return this.stmtFindCandidatesForGuild.all(guildId, cutoffIso);
    }

    bulkUpdateStatus(updates: readonly BulkValidationUpdate[]): void {
        if (updates.length === 0) return;
        const stmt = this.stmtBulkUpdate;
        const txn = this.db.transaction((ops: readonly BulkValidationUpdate[]) => {
            for (const op of ops) {
                stmt.run(op.status, op.validationTime, op.leaveTime, op.id);
            }
        });
        txn(updates);
    }

    countByStatus(guildId: string, inviterId: string, status: JoinStatus): number {
        const row = this.stmtCountByStatus.get(guildId, inviterId, status);
        return row?.count ?? 0;
    }

    /**
     * Top-N inviters in a guild, restricted to a time window.
     * `all` ignores joinTimestamp; `week`/`month` use a rolling window from now().
     */
    getLeaderboard(guildId: string, limit: number, period: LeaderboardPeriod): LeaderboardEntryRow[] {
        if (period === 'all') {
            return this.stmtLeaderboardAll.all(guildId, limit);
        }
        const days = PERIOD_TO_DAYS[period];
        const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
        return this.stmtLeaderboardSince.all(guildId, cutoff, limit);
    }

    /** Paginated leaderboard. Callers pass `limit+1` to peek for hasMore without a separate count query. */
    getLeaderboardPage(
        guildId: string,
        limit: number,
        offset: number,
        period: LeaderboardPeriod,
    ): LeaderboardEntryRow[] {
        if (period === 'all') {
            return this.stmtLeaderboardAllPage.all(guildId, limit, offset);
        }
        const days = PERIOD_TO_DAYS[period];
        const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
        return this.stmtLeaderboardSincePage.all(guildId, cutoff, limit, offset);
    }

    deleteAllInGuild(guildId: string): number {
        const result = this.stmtDeleteAllInGuild.run(guildId);
        return Number(result.changes);
    }
}
