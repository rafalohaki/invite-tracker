import { describe, expect, it } from 'bun:test';
import { isAccountTooYoung } from '@/services/anti-fake.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('isAccountTooYoung', () => {
    const now = Date.parse('2026-06-12T12:00:00.000Z');

    it('returns false when the feature is disabled (minAgeDays <= 0)', () => {
        expect(isAccountTooYoung(now, 0, now)).toBe(false);
        expect(isAccountTooYoung(now, -1, now)).toBe(false);
    });

    it('flags an account created moments ago', () => {
        expect(isAccountTooYoung(now - 60_000, 7, now)).toBe(true);
    });

    it('flags an account one millisecond short of the threshold', () => {
        expect(isAccountTooYoung(now - 7 * DAY_MS + 1, 7, now)).toBe(true);
    });

    it('passes an account exactly at the threshold', () => {
        expect(isAccountTooYoung(now - 7 * DAY_MS, 7, now)).toBe(false);
    });

    it('passes an old account', () => {
        expect(isAccountTooYoung(now - 365 * DAY_MS, 7, now)).toBe(false);
    });
});
