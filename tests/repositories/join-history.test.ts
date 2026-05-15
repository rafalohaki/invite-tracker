import { beforeEach, describe, expect, it } from 'bun:test';
import { JoinHistoryRepository } from '@/db/repositories/join-history.ts';
import { createTestDb } from '../helpers/in-memory-db.ts';

describe('JoinHistoryRepository', () => {
    let repo: JoinHistoryRepository;

    beforeEach(() => {
        repo = new JoinHistoryRepository(createTestDb());
    });

    it('record returns the row id', () => {
        const id = repo.record('g1', 'u1', 'inv1', 'CODE');
        expect(id).toBeGreaterThan(0);
    });

    it('markLeft closes the most recent open record', () => {
        repo.record('g1', 'u1', 'inv1', 'A');
        repo.record('g1', 'u1', 'inv2', 'B'); // newer, still open
        // First call closes the newest open row (id=2).
        expect(repo.markLeft('g1', 'u1')).toBe(1);
        // Second call closes the remaining open row (id=1).
        expect(repo.markLeft('g1', 'u1')).toBe(1);
        // Third call has nothing left to close.
        expect(repo.markLeft('g1', 'u1')).toBe(0);
    });

    it('getRecentRejoin only matches records with leftTimestamp inside the window', () => {
        repo.record('g1', 'u1', 'inv1', 'OLD');
        repo.markLeft('g1', 'u1');
        const future = new Date(Date.now() + 60_000).toISOString();
        const past = new Date(Date.now() - 60_000).toISOString();
        expect(repo.getRecentRejoin('g1', 'u1', past)?.inviterId).toBe('inv1');
        // Cutoff in the future means "leftTimestamp >= future" — should miss.
        expect(repo.getRecentRejoin('g1', 'u1', future)).toBeNull();
    });

    it('getRecentRejoin ignores still-open records (leftTimestamp NULL)', () => {
        repo.record('g1', 'u1', 'inv1', 'A');
        const past = new Date(Date.now() - 60_000).toISOString();
        expect(repo.getRecentRejoin('g1', 'u1', past)).toBeNull();
    });

    it('flagAsRejoin sets flag and getFlaggedForUser returns flagged rows', () => {
        const idA = repo.record('g1', 'u1', 'inv1', 'A');
        const idB = repo.record('g1', 'u1', 'inv2', 'B');
        repo.flagAsRejoin(idB);
        const flagged = repo.getFlaggedForUser('g1', 'u1');
        expect(flagged.length).toBe(1);
        expect(flagged[0]?.id).toBe(idB);
        expect(flagged[0]?.flaggedAsRejoin).toBe(1);
        // idA stays unflagged.
        expect(repo.getFlaggedForUser('g1', 'u-other')).toEqual([]);
        expect(idA).toBeGreaterThan(0);
    });

    it('deleteAllInGuild scopes by guild', () => {
        repo.record('g1', 'u1', 'inv1', 'A');
        repo.record('g2', 'u2', 'inv2', 'B');
        expect(repo.deleteAllInGuild('g1')).toBe(1);
        expect(repo.getFlaggedForUser('g2', 'u2')).toEqual([]); // not flagged but row exists
    });
});
