import { beforeEach, describe, expect, it } from 'bun:test';
import { createRepositories } from '@/db/repositories/index.ts';
import { detectRejoin } from '@/services/anti-cheat.ts';
import type { AppContext } from '@/types/discord.ts';
import { createTestDb } from '../helpers/in-memory-db.ts';

function makeCtx(): AppContext {
    const db = createTestDb();
    return { db, repos: createRepositories(db) };
}

describe('detectRejoin', () => {
    let ctx: AppContext;

    beforeEach(() => {
        ctx = makeCtx();
    });

    it('not suspicious when user has no prior join history', () => {
        const verdict = detectRejoin(ctx, 'g1', 'u1', 'inviterA', 30);
        expect(verdict.isSuspicious).toBe(false);
    });

    it('not suspicious when previous join is still open (no leftTimestamp)', () => {
        ctx.repos.joinHistory.record('g1', 'u1', 'inviterA', 'A');
        const verdict = detectRejoin(ctx, 'g1', 'u1', 'inviterB', 30);
        expect(verdict.isSuspicious).toBe(false);
    });

    it('not suspicious when same inviter as before — honest rejoin', () => {
        ctx.repos.joinHistory.record('g1', 'u1', 'inviterA', 'A');
        ctx.repos.joinHistory.markLeft('g1', 'u1');
        const verdict = detectRejoin(ctx, 'g1', 'u1', 'inviterA', 30);
        expect(verdict.isSuspicious).toBe(false);
        // verdict narrowed to isSuspicious:false branch, so check optional field
        if (!verdict.isSuspicious) {
            expect(verdict.sameInviter).toBe(true);
        }
    });

    it('SUSPICIOUS when different inviter inside the window', () => {
        ctx.repos.joinHistory.record('g1', 'u1', 'inviterA', 'A');
        ctx.repos.joinHistory.markLeft('g1', 'u1');
        const verdict = detectRejoin(ctx, 'g1', 'u1', 'inviterB', 30);
        expect(verdict.isSuspicious).toBe(true);
        if (verdict.isSuspicious) {
            expect(verdict.previousInviterId).toBe('inviterA');
            expect(verdict.sameInviter).toBe(false);
        }
    });

    it('not suspicious when previous inviter was null (unattributed)', () => {
        ctx.repos.joinHistory.record('g1', 'u1', null, null);
        ctx.repos.joinHistory.markLeft('g1', 'u1');
        const verdict = detectRejoin(ctx, 'g1', 'u1', 'inviterB', 30);
        expect(verdict.isSuspicious).toBe(false);
    });

    it('not suspicious when window is 0 (anti-cheat disabled)', () => {
        ctx.repos.joinHistory.record('g1', 'u1', 'inviterA', 'A');
        ctx.repos.joinHistory.markLeft('g1', 'u1');
        const verdict = detectRejoin(ctx, 'g1', 'u1', 'inviterB', 0);
        expect(verdict.isSuspicious).toBe(false);
    });

    it('not suspicious when previous leave is outside the window', () => {
        ctx.repos.joinHistory.record('g1', 'u1', 'inviterA', 'A');
        ctx.repos.joinHistory.markLeft('g1', 'u1');
        // Backdate leftTimestamp 60 days into the past.
        ctx.db.run(
            "UPDATE JoinHistory SET leftTimestamp = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-60 days') WHERE userId = 'u1'",
        );
        const verdict = detectRejoin(ctx, 'g1', 'u1', 'inviterB', 30);
        expect(verdict.isSuspicious).toBe(false);
    });
});
