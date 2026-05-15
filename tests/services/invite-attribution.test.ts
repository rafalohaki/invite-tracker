import { describe, expect, it } from 'bun:test';
import { checkSingleInvite, findUsedInviteAndStale } from '@/services/invite-attribution.ts';
import type { UserInviteRow } from '@/types/db.ts';

function ui(userId: string, code: string): UserInviteRow {
    return {
        userId,
        guildId: 'g1',
        inviteCode: code,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
    };
}

const LOG = '[test]';

describe('checkSingleInvite', () => {
    it('marks invite as stale when not in currentUses', () => {
        const result = checkSingleInvite(ui('userA', 'AAA'), new Map(), new Map([['AAA', 3]]), LOG);
        expect(result.isStale).toBe(true);
        expect(result.usageIncreased).toBe(false);
    });

    it('detects usage increase against cache', () => {
        const result = checkSingleInvite(ui('userA', 'AAA'), new Map([['AAA', 5]]), new Map([['AAA', 3]]), LOG);
        expect(result.isStale).toBe(false);
        expect(result.usageIncreased).toBe(true);
        expect(result.delta).toBe(2);
    });

    it('no usage increase when current equals cache', () => {
        const result = checkSingleInvite(ui('userA', 'AAA'), new Map([['AAA', 3]]), new Map([['AAA', 3]]), LOG);
        expect(result.usageIncreased).toBe(false);
        expect(result.delta).toBe(0);
    });

    it('falls back to current uses when cache is missing the code (best-effort attribution)', () => {
        const result = checkSingleInvite(ui('userA', 'AAA'), new Map([['AAA', 4]]), new Map(), LOG);
        expect(result.usageIncreased).toBe(true);
        expect(result.delta).toBe(4);
    });

    it('does not attribute when cache missing and current=0', () => {
        const result = checkSingleInvite(ui('userA', 'AAA'), new Map([['AAA', 0]]), new Map(), LOG);
        expect(result.usageIncreased).toBe(false);
    });
});

describe('findUsedInviteAndStale', () => {
    it('returns null attribution when currentUses is null', () => {
        const r = findUsedInviteAndStale(null, new Map(), [ui('userA', 'AAA')], LOG);
        expect(r.attribution).toBeNull();
        expect(r.staleInviteCodes).toEqual([]);
    });

    it('returns null attribution when cachedUses is null', () => {
        const r = findUsedInviteAndStale(new Map([['AAA', 1]]), null, [ui('userA', 'AAA')], LOG);
        expect(r.attribution).toBeNull();
    });

    it('clear single attribution when exactly one invite increased', () => {
        const current = new Map([
            ['AAA', 5],
            ['BBB', 2],
        ]);
        const cached = new Map([
            ['AAA', 4],
            ['BBB', 2],
        ]);
        const r = findUsedInviteAndStale(current, cached, [ui('userA', 'AAA'), ui('userB', 'BBB')], LOG);
        expect(r.attribution).toEqual({ inviterId: 'userA', inviteCode: 'AAA', delta: 1 });
        expect(r.ambiguous).toBe(false);
    });

    it('flags ambiguous attribution when two tracked invites increased', () => {
        const current = new Map([
            ['AAA', 5],
            ['BBB', 3],
        ]);
        const cached = new Map([
            ['AAA', 4],
            ['BBB', 2],
        ]);
        const r = findUsedInviteAndStale(current, cached, [ui('userA', 'AAA'), ui('userB', 'BBB')], LOG);
        expect(r.ambiguous).toBe(true);
        // Picks the first one encountered.
        expect(r.attribution?.inviteCode).toBe('AAA');
    });

    it('collects stale codes (no longer present in currentUses)', () => {
        const current = new Map([['AAA', 5]]);
        const cached = new Map([
            ['AAA', 4],
            ['ZZZ', 1],
        ]);
        const r = findUsedInviteAndStale(current, cached, [ui('userA', 'AAA'), ui('userZ', 'ZZZ')], LOG);
        expect(r.attribution?.inviteCode).toBe('AAA');
        expect(r.staleInviteCodes).toEqual(['ZZZ']);
    });

    it('returns null attribution when no tracked invite increased', () => {
        const current = new Map([['AAA', 5]]);
        const cached = new Map([['AAA', 5]]);
        const r = findUsedInviteAndStale(current, cached, [ui('userA', 'AAA')], LOG);
        expect(r.attribution).toBeNull();
        expect(r.staleInviteCodes).toEqual([]);
    });

    it('handles empty tracked-invites list', () => {
        const r = findUsedInviteAndStale(new Map(), new Map(), [], LOG);
        expect(r.attribution).toBeNull();
        expect(r.staleInviteCodes).toEqual([]);
    });

    it('all-stale: every tracked invite gone from Discord', () => {
        const r = findUsedInviteAndStale(
            new Map(),
            new Map([
                ['AAA', 1],
                ['BBB', 2],
            ]),
            [ui('userA', 'AAA'), ui('userB', 'BBB')],
            LOG,
        );
        expect(r.attribution).toBeNull();
        expect(r.staleInviteCodes.sort()).toEqual(['AAA', 'BBB']);
    });
});
