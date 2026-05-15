import type { Database } from 'bun:sqlite';
import type { UserInviteRow } from '@/types/db.ts';

export class UserInvitesRepository {
    private readonly stmtGet;
    private readonly stmtGetByCode;
    private readonly stmtGetAllInGuild;
    private readonly stmtUpsert;
    private readonly stmtDelete;
    private readonly stmtDeleteByCode;
    private readonly stmtDeleteAllInGuild;

    constructor(private readonly db: Database) {
        this.stmtGet = db.query<UserInviteRow, [string, string]>(
            'SELECT * FROM UserInvites WHERE userId = ? AND guildId = ?',
        );
        this.stmtGetByCode = db.query<UserInviteRow, [string, string]>(
            'SELECT * FROM UserInvites WHERE inviteCode = ? AND guildId = ?',
        );
        this.stmtGetAllInGuild = db.query<UserInviteRow, [string]>('SELECT * FROM UserInvites WHERE guildId = ?');
        this.stmtUpsert = db.prepare<unknown, [string, string, string]>(
            `INSERT INTO UserInvites (userId, guildId, inviteCode)
             VALUES (?, ?, ?)
             ON CONFLICT(userId, guildId) DO UPDATE SET
                 inviteCode = excluded.inviteCode,
                 updatedAt  = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
        );
        this.stmtDelete = db.prepare<unknown, [string, string, string]>(
            'DELETE FROM UserInvites WHERE userId = ? AND guildId = ? AND inviteCode = ?',
        );
        this.stmtDeleteByCode = db.prepare<unknown, [string, string]>(
            'DELETE FROM UserInvites WHERE inviteCode = ? AND guildId = ?',
        );
        this.stmtDeleteAllInGuild = db.prepare<unknown, [string]>('DELETE FROM UserInvites WHERE guildId = ?');
    }

    get(userId: string, guildId: string): UserInviteRow | null {
        return this.stmtGet.get(userId, guildId) ?? null;
    }

    getByCode(inviteCode: string, guildId: string): UserInviteRow | null {
        return this.stmtGetByCode.get(inviteCode, guildId) ?? null;
    }

    getAllInGuild(guildId: string): UserInviteRow[] {
        return this.stmtGetAllInGuild.all(guildId);
    }

    upsert(userId: string, guildId: string, inviteCode: string): void {
        this.stmtUpsert.run(userId, guildId, inviteCode);
    }

    delete(userId: string, guildId: string, inviteCode: string): void {
        this.stmtDelete.run(userId, guildId, inviteCode);
    }

    /** Bulk delete by invite codes in a single transaction. */
    deleteManyByCode(inviteCodes: readonly string[], guildId: string): void {
        if (inviteCodes.length === 0) return;
        const stmt = this.stmtDeleteByCode;
        const txn = this.db.transaction((codes: readonly string[]) => {
            for (const code of codes) stmt.run(code, guildId);
        });
        txn(inviteCodes);
    }

    deleteAllInGuild(guildId: string): void {
        this.stmtDeleteAllInGuild.run(guildId);
    }
}
