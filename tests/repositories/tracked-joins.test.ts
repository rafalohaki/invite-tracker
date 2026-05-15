import { beforeEach, describe, expect, it } from 'bun:test';
import { TrackedJoinsRepository } from '@/db/repositories/tracked-joins.ts';
import { createTestDb } from '../helpers/in-memory-db.ts';

describe('TrackedJoinsRepository', () => {
    let repo: TrackedJoinsRepository;

    beforeEach(() => {
        repo = new TrackedJoinsRepository(createTestDb());
    });

    it('upsertPending creates a row then a second call resets pending state', () => {
        repo.upsertPending('g1', 'invitee1', 'inviter1', 'CODE');
        let row = repo.getPending('g1', 'invitee1');
        expect(row?.status).toBe('pending');

        // Simulate validation having moved it forward, then a new join resets.
        repo.upsertPending('g1', 'invitee1', 'inviter2', 'CODE2');
        row = repo.getPending('g1', 'invitee1');
        expect(row?.inviterId).toBe('inviter2');
        expect(row?.inviteCodeUsed).toBe('CODE2');
        expect(row?.status).toBe('pending');
    });

    it('markLeftEarly only updates pending rows', () => {
        repo.upsertPending('g1', 'invitee1', 'inviter1', 'CODE');
        const changes = repo.markLeftEarly('g1', 'invitee1');
        expect(changes).toBe(1);
        // Calling again does nothing — status is now 'left_early', not pending.
        expect(repo.markLeftEarly('g1', 'invitee1')).toBe(0);
    });

    it('countByStatus respects guild + inviter + status scope', () => {
        repo.upsertPending('g1', 'i1', 'inviter1', 'A');
        repo.upsertPending('g1', 'i2', 'inviter1', 'B');
        repo.upsertPending('g1', 'i3', 'inviter2', 'C');
        repo.upsertPending('g2', 'i4', 'inviter1', 'D');
        expect(repo.countByStatus('g1', 'inviter1', 'pending')).toBe(2);
        expect(repo.countByStatus('g1', 'inviter2', 'pending')).toBe(1);
        expect(repo.countByStatus('g1', 'inviter1', 'validated')).toBe(0);
        expect(repo.countByStatus('g2', 'inviter1', 'pending')).toBe(1);
    });

    it('bulkUpdateStatus moves pending rows to validated/left_early in a single txn', () => {
        repo.upsertPending('g1', 'i1', 'inv1', 'A');
        repo.upsertPending('g1', 'i2', 'inv1', 'B');
        const candidates = repo.findCandidatesForValidation(new Date().toISOString());
        repo.bulkUpdateStatus(
            candidates.map((c, idx) => ({
                id: c.id,
                status: idx === 0 ? ('validated' as const) : ('left_early' as const),
                validationTime: idx === 0 ? new Date().toISOString() : null,
                leaveTime: idx === 0 ? null : new Date().toISOString(),
            })),
        );
        expect(repo.countByStatus('g1', 'inv1', 'validated')).toBe(1);
        expect(repo.countByStatus('g1', 'inv1', 'left_early')).toBe(1);
    });

    it('getLeaderboard sorts by count desc and respects limit', () => {
        const promote = (inviter: string, n: number) => {
            for (let i = 0; i < n; i++) {
                const invitee = `${inviter}-i${i}`;
                repo.upsertPending('g1', invitee, inviter, `C${i}`);
            }
        };
        promote('top', 5);
        promote('mid', 3);
        promote('low', 1);
        // Promote all pending rows to validated.
        const candidates = repo.findCandidatesForValidation(new Date().toISOString());
        repo.bulkUpdateStatus(
            candidates.map((c) => ({
                id: c.id,
                status: 'validated' as const,
                validationTime: new Date().toISOString(),
                leaveTime: null,
            })),
        );
        const board = repo.getLeaderboard('g1', 10, 'all');
        expect(board.map((r) => r.inviterId)).toEqual(['top', 'mid', 'low']);
        expect(board.map((r) => r.count)).toEqual([5, 3, 1]);
    });

    it('getLeaderboard period:week excludes rows older than 7 days', () => {
        // Backdate by editing joinTimestamp directly — bun:sqlite raw exec is fine in tests.
        repo.upsertPending('g1', 'iOld', 'inviterA', 'OLD');
        repo.upsertPending('g1', 'iNew', 'inviterA', 'NEW');
        const candidates = repo.findCandidatesForValidation(new Date().toISOString());
        repo.bulkUpdateStatus(
            candidates.map((c) => ({
                id: c.id,
                status: 'validated' as const,
                validationTime: new Date().toISOString(),
                leaveTime: null,
            })),
        );
        // Push iOld's joinTimestamp 30 days into the past.
        const db = (repo as unknown as { db: ReturnType<typeof createTestDb> }).db;
        db.run(
            "UPDATE TrackedJoins SET joinTimestamp = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days') WHERE inviteeId = 'iOld'",
        );
        const weekly = repo.getLeaderboard('g1', 10, 'week');
        expect(weekly).toEqual([{ inviterId: 'inviterA', count: 1 }]);
    });
});
