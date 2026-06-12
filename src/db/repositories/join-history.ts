import type { Database } from 'bun:sqlite';
import type { JoinHistoryRow } from '@/types/db.ts';

export class JoinHistoryRepository {
    private readonly stmtRecord;
    private readonly stmtMarkLeft;
    private readonly stmtGetRecentRejoin;
    private readonly stmtFlagAsRejoin;
    private readonly stmtGetFlaggedForUser;
    private readonly stmtGetLatestForUser;
    private readonly stmtGuildStats;
    private readonly stmtDeleteAllInGuild;

    constructor(db: Database) {
        this.stmtRecord = db.prepare<unknown, [string, string, string | null, string | null]>(
            `INSERT INTO JoinHistory (guildId, userId, inviterId, inviteCodeUsed)
             VALUES (?, ?, ?, ?)`,
        );
        // Order by id DESC (not joinTimestamp DESC): SQLite's datetime('now') has second-level
        // resolution, so two rows inserted in the same second tie on joinTimestamp. id is
        // AUTOINCREMENT, so the highest id is always the newest record.
        this.stmtMarkLeft = db.prepare<unknown, [string, string]>(
            `UPDATE JoinHistory
             SET leftTimestamp = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = (
                 SELECT id FROM JoinHistory
                 WHERE guildId = ? AND userId = ? AND leftTimestamp IS NULL
                 ORDER BY id DESC
                 LIMIT 1
             )`,
        );
        // Most recent record where the user already left, inside the window.
        // Same id-vs-timestamp reasoning: order by id DESC to break ties on equal leftTimestamp.
        this.stmtGetRecentRejoin = db.query<JoinHistoryRow, [string, string, string]>(
            `SELECT * FROM JoinHistory
             WHERE guildId = ? AND userId = ? AND leftTimestamp IS NOT NULL AND leftTimestamp >= ?
             ORDER BY id DESC
             LIMIT 1`,
        );
        this.stmtFlagAsRejoin = db.prepare<unknown, [number]>(
            'UPDATE JoinHistory SET flaggedAsRejoin = 1 WHERE id = ?',
        );
        this.stmtGetFlaggedForUser = db.query<JoinHistoryRow, [string, string]>(
            `SELECT * FROM JoinHistory
             WHERE guildId = ? AND userId = ? AND flaggedAsRejoin = 1
             ORDER BY joinTimestamp DESC`,
        );
        this.stmtGetLatestForUser = db.query<JoinHistoryRow, [string, string]>(
            `SELECT * FROM JoinHistory
             WHERE guildId = ? AND userId = ?
             ORDER BY id DESC
             LIMIT 1`,
        );
        this.stmtGuildStats = db.query<{ joins: number; leaves: number; flaggedRejoins: number }, [string]>(
            `SELECT COUNT(*) as joins,
                    COUNT(leftTimestamp) as leaves,
                    SUM(flaggedAsRejoin) as flaggedRejoins
             FROM JoinHistory
             WHERE guildId = ?`,
        );
        this.stmtDeleteAllInGuild = db.prepare<unknown, [string]>('DELETE FROM JoinHistory WHERE guildId = ?');
    }

    /** Returns the auto-increment id of the new row. */
    record(guildId: string, userId: string, inviterId: string | null, inviteCodeUsed: string | null): number {
        const result = this.stmtRecord.run(guildId, userId, inviterId, inviteCodeUsed);
        return Number(result.lastInsertRowid);
    }

    /** Updates the most recent open record. Returns `changes`. */
    markLeft(guildId: string, userId: string): number {
        const result = this.stmtMarkLeft.run(guildId, userId);
        return Number(result.changes);
    }

    /** Latest record where this user already left, with leftTimestamp >= cutoff. */
    getRecentRejoin(guildId: string, userId: string, cutoffIso: string): JoinHistoryRow | null {
        return this.stmtGetRecentRejoin.get(guildId, userId, cutoffIso) ?? null;
    }

    flagAsRejoin(id: number): void {
        this.stmtFlagAsRejoin.run(id);
    }

    getFlaggedForUser(guildId: string, userId: string): JoinHistoryRow[] {
        return this.stmtGetFlaggedForUser.all(guildId, userId);
    }

    /** Newest history record for a user (joined or left), or null if never seen. */
    getLatestForUser(guildId: string, userId: string): JoinHistoryRow | null {
        return this.stmtGetLatestForUser.get(guildId, userId) ?? null;
    }

    /** Lifetime guild totals: recorded joins, completed leaves, flagged rejoins. */
    guildStats(guildId: string): { joins: number; leaves: number; flaggedRejoins: number } {
        const row = this.stmtGuildStats.get(guildId);
        return {
            joins: row?.joins ?? 0,
            leaves: row?.leaves ?? 0,
            flaggedRejoins: row?.flaggedRejoins ?? 0,
        };
    }

    deleteAllInGuild(guildId: string): number {
        const result = this.stmtDeleteAllInGuild.run(guildId);
        return Number(result.changes);
    }
}
