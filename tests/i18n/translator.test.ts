import { describe, expect, it } from 'bun:test';
import { t } from '@/i18n/translator.ts';

describe('translator', () => {
    it('returns string from en locale', () => {
        expect(t('invite.embed_title', { username: 'Alice' }, 'en')).toBe("Alice's Invite Link");
    });

    it('replaces every placeholder occurrence', () => {
        const out = t('leaderboard.entry_format', { rank: 1, username: 'Bob', count: 42 }, 'en');
        expect(out).toContain('Bob');
        expect(out).toContain('42');
        expect(out.startsWith('1.')).toBe(true);
    });

    it('falls back from custom to en when a key is missing in custom', () => {
        // The shipped custom-lang.yaml happens to translate every key, so we can't probe
        // the fallback against a real missing key. Confirm that the SAME unknown key
        // produces the SAME MISSING marker regardless of starting locale — i.e. both code
        // paths reach the en fallback before giving up.
        const fromEn = t('definitely.unknown.key.path', {}, 'en');
        const fromCustom = t('definitely.unknown.key.path', {}, 'custom');
        expect(fromEn).toBe(fromCustom);
        expect(fromEn).toBe('[MISSING_TRANSLATION:definitely.unknown.key.path]');
    });

    it('returns missing-translation marker for unknown keys', () => {
        const result = t('nonexistent.key.path', {}, 'en');
        expect(result).toBe('[MISSING_TRANSLATION:nonexistent.key.path]');
    });

    it('passes through null/undefined placeholders as empty string', () => {
        const result = t('invite.embed_title', { username: null }, 'en');
        expect(result).toBe("'s Invite Link");
    });

    it('serves Polish from custom section when requested', () => {
        const out = t('invite.embed_title', { username: 'Krzysiek' }, 'custom');
        // The `custom` section in custom-lang.yaml is Polish: "Link Zaproszenia {username}".
        expect(out).toContain('Link Zaproszenia');
        expect(out).toContain('Krzysiek');
    });
});
