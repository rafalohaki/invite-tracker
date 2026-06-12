import type { Database } from 'bun:sqlite';
import type { BonusInviteRow } from '@/types/db.ts';

export class BonusInvitesRepository {
    private readonly stmtGet;
    private readonly stmtAdjust;
    private readonly stmtDeleteAllInGuild;

    constructor(db: Database) {
        this.stmtGet = db.query<BonusInviteRow, [string, string]>(
            'SELECT * FROM BonusInvites WHERE guildId = ? AND userId = ?',
        );
        this.stmtAdjust = db.query<{ amount: number }, [string, string, number]>(
            `INSERT INTO BonusInvites (guildId, userId, amount)
             VALUES (?, ?, ?)
             ON CONFLICT(guildId, userId) DO UPDATE SET
                 amount    = amount + excluded.amount,
                 updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             RETURNING amount`,
        );
        this.stmtDeleteAllInGuild = db.prepare<unknown, [string]>('DELETE FROM BonusInvites WHERE guildId = ?');
    }

    /** Net bonus amount for a user (0 when no row exists). */
    get(guildId: string, userId: string): number {
        return this.stmtGet.get(guildId, userId)?.amount ?? 0;
    }

    /** Adds `delta` (may be negative) to the user's bonus total. Returns the new total. */
    adjust(guildId: string, userId: string, delta: number): number {
        // biome-ignore lint/style/noNonNullAssertion: RETURNING on an upsert always yields a row
        return this.stmtAdjust.get(guildId, userId, delta)!.amount;
    }

    deleteAllInGuild(guildId: string): number {
        const result = this.stmtDeleteAllInGuild.run(guildId);
        return Number(result.changes);
    }
}
