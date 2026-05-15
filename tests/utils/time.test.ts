import { describe, expect, it } from 'bun:test';
import { isoCutoff, isoNow } from '@/utils/time.ts';

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

    it('isoCutoff with 0 returns now', () => {
        const cutoff = isoCutoff(0);
        const diff = Math.abs(Date.now() - new Date(cutoff).getTime());
        expect(diff).toBeLessThan(50);
    });
});
