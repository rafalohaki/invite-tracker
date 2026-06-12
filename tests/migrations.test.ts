import { describe, expect, it } from 'bun:test';
import { runMigrations } from '@/db/migration-runner.ts';
import { createTestDb } from './helpers/in-memory-db.ts';

interface TableRow {
    name: string;
}

interface MigrationRow {
    name: string;
}

describe('migrations', () => {
    it('creates every expected table on a fresh DB', () => {
        const db = createTestDb();
        const tables = (
            db.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as TableRow[]
        ).map((r) => r.name);
        expect(tables).toContain('_migrations');
        expect(tables).toContain('UserInvites');
        expect(tables).toContain('TrackedJoins');
        expect(tables).toContain('GuildConfig');
        expect(tables).toContain('RoleRewards');
        expect(tables).toContain('JoinHistory');
        expect(tables).toContain('BonusInvites');
        expect(tables).toContain('InviteLabels');
    });

    it('records every applied migration in _migrations', () => {
        const db = createTestDb();
        const applied = (db.query('SELECT name FROM _migrations ORDER BY name').all() as MigrationRow[]).map(
            (r) => r.name,
        );
        expect(applied).toEqual([
            '001_initial.sql',
            '002_guild_config.sql',
            '003_role_rewards.sql',
            '004_join_history.sql',
            '005_bonus_invites.sql',
            '006_guild_config_extensions.sql',
            '007_invite_labels.sql',
        ]);
    });

    it('is idempotent — calling runMigrations a second time is a no-op', () => {
        const db = createTestDb();
        const firstCount = (db.query('SELECT COUNT(*) as c FROM _migrations').get() as { c: number }).c;
        runMigrations(db);
        const secondCount = (db.query('SELECT COUNT(*) as c FROM _migrations').get() as { c: number }).c;
        expect(secondCount).toBe(firstCount);
    });

    it("enforces TrackedJoins.status CHECK constraint including 'flagged'", () => {
        const db = createTestDb();
        // Valid statuses must all be accepted.
        for (const status of ['pending', 'validated', 'left_early', 'flagged']) {
            const inviteeId = `invitee-${status}`;
            db.run(
                `INSERT INTO TrackedJoins (guildId, inviteeId, inviterId, inviteCodeUsed, status)
                 VALUES (?, ?, 'inviter1', 'CODE', ?)`,
                ['g1', inviteeId, status],
            );
        }
        expect(() =>
            db.run(
                `INSERT INTO TrackedJoins (guildId, inviteeId, inviterId, inviteCodeUsed, status)
                 VALUES (?, ?, 'inviter1', 'CODE', 'bogus')`,
                ['g1', 'invitee-bogus'],
            ),
        ).toThrow();
    });
});
