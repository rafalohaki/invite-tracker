import type { Database } from 'bun:sqlite';
import type { RoleRewardRow } from '@/types/db.ts';

export class RoleRewardsRepository {
    private readonly stmtAdd;
    private readonly stmtRemoveByThreshold;
    private readonly stmtListForGuild;
    private readonly stmtFindEligible;
    private readonly stmtDeleteAllInGuild;

    constructor(db: Database) {
        this.stmtAdd = db.prepare<unknown, [string, number, string]>(
            'INSERT INTO RoleRewards (guildId, threshold, roleId) VALUES (?, ?, ?)',
        );
        this.stmtRemoveByThreshold = db.prepare<unknown, [string, number]>(
            'DELETE FROM RoleRewards WHERE guildId = ? AND threshold = ?',
        );
        this.stmtListForGuild = db.query<RoleRewardRow, [string]>(
            'SELECT * FROM RoleRewards WHERE guildId = ? ORDER BY threshold ASC',
        );
        this.stmtFindEligible = db.query<RoleRewardRow, [string, number]>(
            'SELECT * FROM RoleRewards WHERE guildId = ? AND threshold <= ? ORDER BY threshold ASC',
        );
        this.stmtDeleteAllInGuild = db.prepare<unknown, [string]>('DELETE FROM RoleRewards WHERE guildId = ?');
    }

    /**
     * Adds a reward. Throws on duplicate (guildId, threshold) — UNIQUE constraint.
     * Caller (slash command) should catch and present a friendly error.
     */
    add(guildId: string, threshold: number, roleId: string): void {
        this.stmtAdd.run(guildId, threshold, roleId);
    }

    /** Returns `changes` count (0 = no such threshold for guild). */
    removeByThreshold(guildId: string, threshold: number): number {
        const result = this.stmtRemoveByThreshold.run(guildId, threshold);
        return Number(result.changes);
    }

    listForGuild(guildId: string): RoleRewardRow[] {
        return this.stmtListForGuild.all(guildId);
    }

    /** All rewards whose threshold is ≤ count, ordered by threshold ascending. */
    findEligibleForCount(guildId: string, count: number): RoleRewardRow[] {
        return this.stmtFindEligible.all(guildId, count);
    }

    deleteAllInGuild(guildId: string): number {
        const result = this.stmtDeleteAllInGuild.run(guildId);
        return Number(result.changes);
    }
}
