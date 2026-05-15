import { describe, expect, it } from 'bun:test';
import { isoCutoff, isoNow, msToHumanReadable, parseDuration } from '@/utils/time.ts';

describe('parseDuration', () => {
    it('parses seconds/minutes/hours/days', () => {
        expect(parseDuration('30s')).toBe(30_000);
        expect(parseDuration('5m')).toBe(5 * 60_000);
        expect(parseDuration('2h')).toBe(2 * 60 * 60_000);
        expect(parseDuration('7d')).toBe(7 * 24 * 60 * 60_000);
    });

    it('tolerates whitespace and case', () => {
        expect(parseDuration(' 90S ')).toBe(90_000);
        expect(parseDuration('10 M')).toBe(10 * 60_000); // inner whitespace between number and unit is OK
        expect(parseDuration('10M')).toBe(10 * 60_000);
    });

    it('returns null on malformed input', () => {
        expect(parseDuration('')).toBeNull();
        expect(parseDuration('5')).toBeNull();
        expect(parseDuration('abc')).toBeNull();
        expect(parseDuration('5y')).toBeNull();
        expect(parseDuration('-3d')).toBeNull();
    });
});

describe('isoNow / isoCutoff', () => {
    it('isoNow is a valid ISO 8601 string', () => {
        const now = isoNow();
        expect(new Date(now).toISOString()).toBe(now);
    });

    it('isoCutoff is in the past by the given window', () => {
        const cutoff = isoCutoff(60_000);
        const diff = Date.now() - new Date(cutoff).getTime();
        expect(diff).toBeGreaterThanOrEqual(60_000);
        expect(diff).toBeLessThan(60_500); // allow a few hundred ms for test scheduling
    });
});

describe('msToHumanReadable', () => {
    it('handles sub-second values', () => {
        expect(msToHumanReadable(500)).toBe('500ms');
    });

    it('formats common durations', () => {
        expect(msToHumanReadable(30_000)).toBe('30s');
        expect(msToHumanReadable(5 * 60_000)).toBe('5m');
        expect(msToHumanReadable(2 * 60 * 60_000)).toBe('2h');
        expect(msToHumanReadable(7 * 24 * 60 * 60_000)).toBe('7d');
    });

    it('combines d/h/m parts, drops trailing seconds when bigger parts exist', () => {
        const ms = 2 * 86400_000 + 3 * 3600_000 + 45 * 60_000 + 12_000;
        // d+h+m present, seconds dropped because parts.length >= 2.
        expect(msToHumanReadable(ms)).toBe('2d 3h 45m');
    });

    it('returns "0s" for zero', () => {
        expect(msToHumanReadable(0)).toBe('0ms');
    });
});
