import { beforeEach, describe, expect, it } from 'bun:test';
import { UserInvitesRepository } from '@/db/repositories/user-invites.ts';
import { createTestDb } from '../helpers/in-memory-db.ts';

describe('UserInvitesRepository', () => {
    let repo: UserInvitesRepository;

    beforeEach(() => {
        repo = new UserInvitesRepository(createTestDb());
    });

    it('upsert + get round-trips', () => {
        repo.upsert('user1', 'guild1', 'CODE_A');
        const row = repo.get('user1', 'guild1');
        expect(row?.inviteCode).toBe('CODE_A');
    });

    it('upsert overwrites inviteCode on conflict (PK userId+guildId)', () => {
        repo.upsert('user1', 'guild1', 'CODE_A');
        repo.upsert('user1', 'guild1', 'CODE_B');
        expect(repo.get('user1', 'guild1')?.inviteCode).toBe('CODE_B');
    });

    it('getByCode finds by code+guildId', () => {
        repo.upsert('user1', 'guild1', 'CODE_A');
        expect(repo.getByCode('CODE_A', 'guild1')?.userId).toBe('user1');
        expect(repo.getByCode('CODE_A', 'guild2')).toBeNull();
        expect(repo.getByCode('CODE_B', 'guild1')).toBeNull();
    });

    it('getAllInGuild returns only the requested guild', () => {
        repo.upsert('user1', 'guild1', 'A');
        repo.upsert('user2', 'guild1', 'B');
        repo.upsert('user3', 'guild2', 'C');
        const rows = repo.getAllInGuild('guild1');
        expect(rows.map((r) => r.userId).sort()).toEqual(['user1', 'user2']);
    });

    it('deleteManyByCode removes the listed codes in one transaction', () => {
        repo.upsert('u1', 'g1', 'A');
        repo.upsert('u2', 'g1', 'B');
        repo.upsert('u3', 'g1', 'C');
        repo.deleteManyByCode(['A', 'C'], 'g1');
        const remaining = repo.getAllInGuild('g1').map((r) => r.inviteCode);
        expect(remaining).toEqual(['B']);
    });

    it('deleteAllInGuild scopes by guild', () => {
        repo.upsert('u1', 'g1', 'A');
        repo.upsert('u2', 'g2', 'B');
        repo.deleteAllInGuild('g1');
        expect(repo.getAllInGuild('g1')).toEqual([]);
        expect(repo.getAllInGuild('g2').length).toBe(1);
    });
});
