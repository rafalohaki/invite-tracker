import { beforeEach, describe, expect, it } from 'bun:test';
import { BonusInvitesRepository } from '@/db/repositories/bonus-invites.ts';
import { TrackedJoinsRepository } from '@/db/repositories/tracked-joins.ts';
import { createTestDb } from '../helpers/in-memory-db.ts';

describe('BonusInvitesRepository', () => {
    let repo: BonusInvitesRepository;
    let joins: TrackedJoinsRepository;

    beforeEach(() => {
        const db = createTestDb();
        repo = new BonusInvitesRepository(db);
        joins = new TrackedJoinsRepository(db);
    });

    it('get returns 0 for a user with no bonus row', () => {
        expect(repo.get('g1', 'u1')).toBe(0);
    });

    it('adjust creates the row and returns the running total', () => {
        expect(repo.adjust('g1', 'u1', 5)).toBe(5);
        expect(repo.adjust('g1', 'u1', 3)).toBe(8);
        expect(repo.get('g1', 'u1')).toBe(8);
    });

    it('adjust with a negative delta can push the balance below zero', () => {
        repo.adjust('g1', 'u1', 2);
        expect(repo.adjust('g1', 'u1', -5)).toBe(-3);
    });

    it('balances are isolated per guild', () => {
        repo.adjust('g1', 'u1', 5);
        repo.adjust('g2', 'u1', 7);
        expect(repo.get('g1', 'u1')).toBe(5);
        expect(repo.get('g2', 'u1')).toBe(7);
    });

    it('deleteAllInGuild wipes only that guild', () => {
        repo.adjust('g1', 'u1', 5);
        repo.adjust('g2', 'u1', 7);
        expect(repo.deleteAllInGuild('g1')).toBe(1);
        expect(repo.get('g1', 'u1')).toBe(0);
        expect(repo.get('g2', 'u1')).toBe(7);
    });

    describe('leaderboard integration (period=all)', () => {
        function validate(guildId: string, inviteeId: string, inviterId: string) {
            joins.upsertWithStatus(guildId, inviteeId, inviterId, 'CODE', 'validated');
        }

        it('adds bonus on top of validated counts', () => {
            validate('g1', 'i1', 'alice');
            validate('g1', 'i2', 'alice');
            validate('g1', 'i3', 'bob');
            repo.adjust('g1', 'bob', 5);

            const board = joins.getLeaderboard('g1', 10, 'all');
            expect(board).toEqual([
                { inviterId: 'bob', count: 6 },
                { inviterId: 'alice', count: 2 },
            ]);
        });

        it('includes users with bonus only (no validated joins)', () => {
            repo.adjust('g1', 'carol', 4);
            const board = joins.getLeaderboard('g1', 10, 'all');
            expect(board).toEqual([{ inviterId: 'carol', count: 4 }]);
        });

        it('hides users whose net total is zero or negative', () => {
            validate('g1', 'i1', 'alice');
            repo.adjust('g1', 'alice', -1); // 1 validated - 1 bonus = 0
            repo.adjust('g1', 'dave', -3);
            const board = joins.getLeaderboard('g1', 10, 'all');
            expect(board).toEqual([]);
        });

        it('does not affect week/month leaderboards', () => {
            validate('g1', 'i1', 'alice');
            repo.adjust('g1', 'alice', 100);
            const weekly = joins.getLeaderboard('g1', 10, 'week');
            expect(weekly).toEqual([{ inviterId: 'alice', count: 1 }]);
        });

        it('paginated variant matches the non-paginated totals', () => {
            validate('g1', 'i1', 'alice');
            repo.adjust('g1', 'alice', 2);
            const page = joins.getLeaderboardPage('g1', 10, 0, 'all');
            expect(page).toEqual([{ inviterId: 'alice', count: 3 }]);
        });
    });
});
