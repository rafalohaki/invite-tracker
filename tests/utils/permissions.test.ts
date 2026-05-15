import { describe, expect, it } from 'bun:test';
import { type Guild, PermissionFlagsBits, type Role } from 'discord.js';
import { canAssignRole } from '@/utils/permissions.ts';

// Minimal stub builders. We deliberately avoid discord.js' real constructors —
// they require a Client instance — and only provide the fields canAssignRole reads.

function makeGuildStub(opts: {
    hasMe: boolean;
    manageRoles: boolean;
    botHighestPos: number;
    everyoneId: string;
}): Guild {
    const me = opts.hasMe
        ? {
              permissions: {
                  has(flag: bigint) {
                      return opts.manageRoles && flag === PermissionFlagsBits.ManageRoles;
                  },
              },
              roles: {
                  highest: { position: opts.botHighestPos },
              },
          }
        : null;
    const everyone = { id: opts.everyoneId };
    return {
        members: { me },
        roles: { everyone },
    } as unknown as Guild;
}

function makeRoleStub(opts: { id: string; position: number; managed?: boolean }): Role {
    return {
        id: opts.id,
        position: opts.position,
        managed: opts.managed ?? false,
    } as unknown as Role;
}

describe('canAssignRole', () => {
    it('fails when bot member is not cached', () => {
        const guild = makeGuildStub({ hasMe: false, manageRoles: false, botHighestPos: 0, everyoneId: 'everyone' });
        const role = makeRoleStub({ id: 'r1', position: 1 });
        const result = canAssignRole(guild, role);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toBe('bot-not-cached');
    });

    it('fails when bot lacks ManageRoles', () => {
        const guild = makeGuildStub({ hasMe: true, manageRoles: false, botHighestPos: 10, everyoneId: 'everyone' });
        const role = makeRoleStub({ id: 'r1', position: 1 });
        const result = canAssignRole(guild, role);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toBe('no-manage-roles');
    });

    it('fails for managed (integration-owned) roles', () => {
        const guild = makeGuildStub({ hasMe: true, manageRoles: true, botHighestPos: 10, everyoneId: 'everyone' });
        const role = makeRoleStub({ id: 'r1', position: 1, managed: true });
        const result = canAssignRole(guild, role);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toBe('role-managed');
    });

    it('fails for @everyone', () => {
        const guild = makeGuildStub({ hasMe: true, manageRoles: true, botHighestPos: 10, everyoneId: 'everyone' });
        const role = makeRoleStub({ id: 'everyone', position: 0 });
        const result = canAssignRole(guild, role);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toBe('role-everyone');
    });

    it('fails when role position is >= bot highest', () => {
        const guild = makeGuildStub({ hasMe: true, manageRoles: true, botHighestPos: 5, everyoneId: 'everyone' });
        const role = makeRoleStub({ id: 'r1', position: 5 });
        const result = canAssignRole(guild, role);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toBe('role-above-bot');
    });

    it('passes when role is below bot and not managed/everyone', () => {
        const guild = makeGuildStub({ hasMe: true, manageRoles: true, botHighestPos: 10, everyoneId: 'everyone' });
        const role = makeRoleStub({ id: 'r1', position: 5 });
        const result = canAssignRole(guild, role);
        expect(result.ok).toBe(true);
    });
});
