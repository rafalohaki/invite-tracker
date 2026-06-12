import type { Database } from 'bun:sqlite';
import type { InviteLabelRow, LabelSourceStatRow } from '@/types/db.ts';

export class InviteLabelsRepository {
    private readonly stmtGet;
    private readonly stmtList;
    private readonly stmtUpsert;
    private readonly stmtRemove;
    private readonly stmtSourceStats;
    private readonly stmtDeleteAllInGuild;

    constructor(db: Database) {
        this.stmtGet = db.query<InviteLabelRow, [string, string]>(
            'SELECT * FROM InviteLabels WHERE guildId = ? AND inviteCode = ?',
        );
        this.stmtList = db.query<InviteLabelRow, [string]>(
            'SELECT * FROM InviteLabels WHERE guildId = ? ORDER BY label ASC, inviteCode ASC',
        );
        this.stmtUpsert = db.prepare<unknown, [string, string, string, string | null]>(
            `INSERT INTO InviteLabels (guildId, inviteCode, label, autoRoleId)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(guildId, inviteCode) DO UPDATE SET
                 label      = excluded.label,
                 autoRoleId = excluded.autoRoleId,
                 updatedAt  = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
        );
        this.stmtRemove = db.prepare<unknown, [string, string]>(
            'DELETE FROM InviteLabels WHERE guildId = ? AND inviteCode = ?',
        );
        // Joins per label, counted from the JoinHistory audit trail. A label spanning
        // several codes aggregates across all of them.
        this.stmtSourceStats = db.query<LabelSourceStatRow, [string]>(
            `SELECT il.label as label, COUNT(jh.id) as count
             FROM InviteLabels il
             LEFT JOIN JoinHistory jh
               ON jh.guildId = il.guildId AND jh.inviteCodeUsed = il.inviteCode
             WHERE il.guildId = ?
             GROUP BY il.label
             ORDER BY count DESC, label ASC`,
        );
        this.stmtDeleteAllInGuild = db.prepare<unknown, [string]>('DELETE FROM InviteLabels WHERE guildId = ?');
    }

    get(guildId: string, inviteCode: string): InviteLabelRow | null {
        return this.stmtGet.get(guildId, inviteCode) ?? null;
    }

    list(guildId: string): InviteLabelRow[] {
        return this.stmtList.all(guildId);
    }

    upsert(guildId: string, inviteCode: string, label: string, autoRoleId: string | null): void {
        this.stmtUpsert.run(guildId, inviteCode, label, autoRoleId);
    }

    /** Returns `changes` (0 = no label on that code). */
    remove(guildId: string, inviteCode: string): number {
        const result = this.stmtRemove.run(guildId, inviteCode);
        return Number(result.changes);
    }

    /** Join counts per label, descending. Labels with no joins yet appear with count 0. */
    sourceStats(guildId: string): LabelSourceStatRow[] {
        return this.stmtSourceStats.all(guildId);
    }

    deleteAllInGuild(guildId: string): number {
        const result = this.stmtDeleteAllInGuild.run(guildId);
        return Number(result.changes);
    }
}
