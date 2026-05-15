import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import type { LeaderboardPeriod } from '@/types/db.ts';

export const LEADERBOARD_PAGE_SIZE = 10;

/** Builds the Prev/Next row. State is encoded entirely in `customId` — no in-memory collector. */
export function buildLeaderboardRow(
    page: number,
    hasMore: boolean,
    period: LeaderboardPeriod,
): ActionRowBuilder<ButtonBuilder> {
    const prev = new ButtonBuilder()
        .setCustomId(`lb:prev:${page}:${period}`)
        .setLabel('◀ Previous')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page <= 0);
    const next = new ButtonBuilder()
        .setCustomId(`lb:next:${page}:${period}`)
        .setLabel('Next ▶')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!hasMore);
    return new ActionRowBuilder<ButtonBuilder>().setComponents(prev, next);
}

export interface LeaderboardButtonState {
    dir: 'prev' | 'next';
    page: number;
    period: LeaderboardPeriod;
}

/** Parses a customId like `lb:next:3:week`. Returns null if the format doesn't match. */
export function parseLeaderboardCustomId(customId: string): LeaderboardButtonState | null {
    const parts = customId.split(':');
    if (parts.length !== 4) return null;
    const [ns, dir, pageStr, period] = parts;
    if (ns !== 'lb') return null;
    if (dir !== 'prev' && dir !== 'next') return null;
    if (period !== 'all' && period !== 'week' && period !== 'month') return null;
    const page = Number(pageStr);
    if (!Number.isFinite(page) || page < 0 || !Number.isInteger(page)) return null;
    return { dir, page, period };
}
