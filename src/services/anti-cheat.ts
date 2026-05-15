import type { AppContext } from '@/types/discord.ts';

export type AntiCheatVerdict =
    | { isSuspicious: false; sameInviter?: boolean; previousInviterId?: string }
    | { isSuspicious: true; sameInviter: false; previousInviterId: string };

/**
 * Detects whether a join is a suspicious rejoin (same user, different inviter, inside
 * the configured window) — used to flag potential alt-account farming.
 *
 * Rules:
 *   - No prior record (or last record never closed) → not suspicious.
 *   - Same inviterId as before → not suspicious; treat as honest rejoin.
 *   - Different inviterId → SUSPICIOUS. Caller should mark TrackedJoin as 'flagged'
 *     instead of 'pending', skip welcome, and add to JoinHistory.flaggedAsRejoin.
 */
export function detectRejoin(
    ctx: AppContext,
    guildId: string,
    userId: string,
    inviterId: string,
    windowDays: number,
): AntiCheatVerdict {
    if (windowDays <= 0) return { isSuspicious: false };
    const cutoffMs = Date.now() - windowDays * 24 * 60 * 60 * 1000;
    const cutoff = new Date(cutoffMs).toISOString();
    const recent = ctx.repos.joinHistory.getRecentRejoin(guildId, userId, cutoff);
    if (!recent) return { isSuspicious: false };

    if (recent.inviterId === inviterId) {
        return { isSuspicious: false, sameInviter: true, previousInviterId: inviterId };
    }
    if (recent.inviterId === null) {
        // Previous join wasn't attributed — no inviter to compare against; treat as not suspicious.
        return { isSuspicious: false };
    }
    return { isSuspicious: true, sameInviter: false, previousInviterId: recent.inviterId };
}
