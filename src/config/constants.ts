/**
 * Bot-wide constants. Centralised so that branding tweaks, rate-limit tuning,
 * and timing knobs do not require grepping across the source tree.
 */

import type { JoinStatus } from '@/types/db.ts';

/** Semantic embed colors per command. Discord embeds accept a 0xRRGGBB integer. */
export const EMBED_COLORS = {
    invite: 0x0099ff,
    check: 0x0099ff,
    leaderboard: 0xffd700,
    config: 0x5865f2,
    roleRewards: 0x57f287,
    whoInvited: 0x0099ff,
    invited: 0x0099ff,
    stats: 0xeb459e,
    labels: 0xfee75c,
} as const;

/** One emoji per TrackedJoin status — shared by /invited, /who-invited, /server-stats. */
export const JOIN_STATUS_EMOJI: Record<JoinStatus, string> = {
    validated: '✅',
    pending: '⏳',
    left_early: '📤',
    flagged: '🚩',
} as const;

/**
 * Delay after a GuildMemberAdd event before fetching the guild's invites.
 * Gives Discord a moment to bump the `uses` counter so we don't read a stale value.
 */
export const INVITE_FETCH_DELAY_MS = 2500;

/**
 * Soft throttle between successive role-reward grants in the validation sweep.
 * Discord limits role updates to ~10 per 10 seconds per guild — 1.5s between members
 * gives a comfortable margin even when a single pass promotes many inviters at once.
 */
export const ROLE_ASSIGN_THROTTLE_MS = 1500;

/** Initial validation pass delay after the bot becomes ready. Lets the invite cache warm up first. */
export const INITIAL_VALIDATION_DELAY_MS = 2 * 60 * 1000;

/** Discord API limit on bulk member fetch (`guild.members.fetch({ user: ids })`). */
export const MEMBER_FETCH_CHUNK_SIZE = 100;
