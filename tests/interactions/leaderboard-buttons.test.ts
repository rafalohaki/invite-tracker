import { describe, expect, it } from 'bun:test';
import { buildLeaderboardRow, parseLeaderboardCustomId } from '@/interactions/leaderboard-buttons.ts';

describe('parseLeaderboardCustomId', () => {
    it('parses a valid Next click for week period', () => {
        expect(parseLeaderboardCustomId('lb:next:3:week')).toEqual({ dir: 'next', page: 3, period: 'week' });
    });

    it('parses a valid Prev click for all-time', () => {
        expect(parseLeaderboardCustomId('lb:prev:0:all')).toEqual({ dir: 'prev', page: 0, period: 'all' });
    });

    it('rejects wrong namespace', () => {
        expect(parseLeaderboardCustomId('xx:next:0:all')).toBeNull();
    });

    it('rejects unknown direction', () => {
        expect(parseLeaderboardCustomId('lb:sideways:0:all')).toBeNull();
    });

    it('rejects unknown period', () => {
        expect(parseLeaderboardCustomId('lb:next:0:year')).toBeNull();
    });

    it('rejects non-numeric page', () => {
        expect(parseLeaderboardCustomId('lb:next:abc:all')).toBeNull();
    });

    it('rejects negative page', () => {
        expect(parseLeaderboardCustomId('lb:next:-1:all')).toBeNull();
    });

    it('rejects too few parts', () => {
        expect(parseLeaderboardCustomId('lb:next:0')).toBeNull();
    });
});

describe('buildLeaderboardRow', () => {
    it('disables Previous on page 0', () => {
        const row = buildLeaderboardRow(0, true, 'all');
        const components = row.components;
        // biome-ignore lint/style/noNonNullAssertion: fixed-length row
        const prev = components[0]!.toJSON();
        expect(prev.disabled).toBe(true);
    });

    it('disables Next when !hasMore', () => {
        const row = buildLeaderboardRow(2, false, 'week');
        // biome-ignore lint/style/noNonNullAssertion: fixed-length row
        const next = row.components[1]!.toJSON();
        expect(next.disabled).toBe(true);
    });

    it('enables both when page>0 and hasMore', () => {
        const row = buildLeaderboardRow(2, true, 'month');
        // biome-ignore lint/style/noNonNullAssertion: fixed-length row
        const prev = row.components[0]!.toJSON();
        // biome-ignore lint/style/noNonNullAssertion: fixed-length row
        const next = row.components[1]!.toJSON();
        expect(prev.disabled).toBe(false);
        expect(next.disabled).toBe(false);
    });

    it('encodes page+period in customId', () => {
        const row = buildLeaderboardRow(5, true, 'week');
        // biome-ignore lint/style/noNonNullAssertion: fixed-length row
        const prev = row.components[0]!.toJSON();
        // biome-ignore lint/style/noNonNullAssertion: fixed-length row
        const next = row.components[1]!.toJSON();
        expect('custom_id' in prev ? prev.custom_id : null).toBe('lb:prev:5:week');
        expect('custom_id' in next ? next.custom_id : null).toBe('lb:next:5:week');
    });
});
