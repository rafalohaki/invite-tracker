import { beforeEach, describe, expect, it } from 'bun:test';
import { InviteLabelsRepository } from '@/db/repositories/invite-labels.ts';
import { JoinHistoryRepository } from '@/db/repositories/join-history.ts';
import { createTestDb } from '../helpers/in-memory-db.ts';

describe('InviteLabelsRepository', () => {
    let repo: InviteLabelsRepository;
    let history: JoinHistoryRepository;

    beforeEach(() => {
        const db = createTestDb();
        repo = new InviteLabelsRepository(db);
        history = new JoinHistoryRepository(db);
    });

    it('upsert + get round-trips and overwrites label/role', () => {
        repo.upsert('g1', 'abc', 'YouTube', null);
        expect(repo.get('g1', 'abc')?.label).toBe('YouTube');
        repo.upsert('g1', 'abc', 'Twitter', 'role1');
        const row = repo.get('g1', 'abc');
        expect(row?.label).toBe('Twitter');
        expect(row?.autoRoleId).toBe('role1');
        expect(repo.get('g2', 'abc')).toBeNull();
    });

    it('remove returns changes and list is sorted by label', () => {
        repo.upsert('g1', 'b', 'Zeta', null);
        repo.upsert('g1', 'a', 'Alpha', null);
        expect(repo.list('g1').map((r) => r.label)).toEqual(['Alpha', 'Zeta']);
        expect(repo.remove('g1', 'b')).toBe(1);
        expect(repo.remove('g1', 'b')).toBe(0);
        expect(repo.list('g1').length).toBe(1);
    });

    it('sourceStats counts JoinHistory rows per label, aggregating multi-code labels', () => {
        repo.upsert('g1', 'yt1', 'YouTube', null);
        repo.upsert('g1', 'yt2', 'YouTube', null);
        repo.upsert('g1', 'tw', 'Twitter', null);
        repo.upsert('g1', 'unused', 'Reddit', null);

        history.record('g1', 'u1', 'inv1', 'yt1');
        history.record('g1', 'u2', 'inv1', 'yt2');
        history.record('g1', 'u3', 'inv2', 'tw');
        history.record('g1', 'u4', null, null); // unlabeled join
        history.record('g2', 'u5', null, 'yt1'); // other guild

        expect(repo.sourceStats('g1')).toEqual([
            { label: 'YouTube', count: 2 },
            { label: 'Twitter', count: 1 },
            { label: 'Reddit', count: 0 },
        ]);
    });

    it('deleteAllInGuild scopes by guild', () => {
        repo.upsert('g1', 'a', 'A', null);
        repo.upsert('g2', 'b', 'B', null);
        expect(repo.deleteAllInGuild('g1')).toBe(1);
        expect(repo.list('g2').length).toBe(1);
    });
});
