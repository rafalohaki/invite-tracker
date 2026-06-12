import { describe, expect, it } from 'bun:test';
import { normalizeInviteCode } from '@/commands/invite-labels.ts';

describe('normalizeInviteCode', () => {
    it('passes a bare code through', () => {
        expect(normalizeInviteCode('aBc123')).toBe('aBc123');
    });

    it('strips known invite URL prefixes', () => {
        expect(normalizeInviteCode('https://discord.gg/aBc123')).toBe('aBc123');
        expect(normalizeInviteCode('http://www.discord.gg/aBc123')).toBe('aBc123');
        expect(normalizeInviteCode('https://discord.com/invite/aBc123')).toBe('aBc123');
        expect(normalizeInviteCode('https://discordapp.com/invite/aBc123')).toBe('aBc123');
    });

    it('strips protocol-less URL prefixes too', () => {
        expect(normalizeInviteCode('discord.gg/aBc123')).toBe('aBc123');
        expect(normalizeInviteCode('www.discord.gg/aBc123')).toBe('aBc123');
    });

    it('trims whitespace and trailing slashes', () => {
        expect(normalizeInviteCode('  discord.gg/abc/  ')).toBe('abc');
        expect(normalizeInviteCode('abc//')).toBe('abc');
    });
});
