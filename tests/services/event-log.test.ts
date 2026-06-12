import { describe, expect, it } from 'bun:test';
import { renderJoinLogLine, renderLeaveLogLine } from '@/services/event-log.ts';

describe('renderJoinLogLine', () => {
    it('attributed line includes user, inviter, code and total', () => {
        const line = renderJoinLogLine(
            'attributed',
            { userId: 'u1', inviterId: 'inv1', inviteCode: 'abc123', inviterTotal: 7 },
            'en',
        );
        expect(line).toContain('<@u1>');
        expect(line).toContain('<@inv1>');
        expect(line).toContain('`abc123`');
        expect(line).toContain('`7`');
    });

    it('unattributed line includes only the user', () => {
        const line = renderJoinLogLine('unattributed', { userId: 'u1' }, 'en');
        expect(line).toContain('<@u1>');
        expect(line).not.toContain('undefined');
    });

    it('flagged_fake and flagged_rejoin lines name the inviter', () => {
        for (const kind of ['flagged_fake', 'flagged_rejoin'] as const) {
            const line = renderJoinLogLine(kind, { userId: 'u1', inviterId: 'inv1' }, 'en');
            expect(line).toContain('🚩');
            expect(line).toContain('<@inv1>');
        }
    });

    it('custom locale renders the Polish strings', () => {
        const line = renderJoinLogLine('unattributed', { userId: 'u1' }, 'custom');
        expect(line).toContain('dołączył');
    });
});

describe('renderLeaveLogLine', () => {
    it('with inviter', () => {
        const line = renderLeaveLogLine('u1', 'inv1', 'en');
        expect(line).toContain('<@u1>');
        expect(line).toContain('<@inv1>');
    });

    it('without inviter', () => {
        const line = renderLeaveLogLine('u1', null, 'en');
        expect(line).toContain('<@u1>');
        expect(line).toContain('left');
    });
});
