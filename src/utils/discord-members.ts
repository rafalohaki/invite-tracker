import type { Guild, GuildMember, PartialGuildMember } from 'discord.js';
import { MEMBER_FETCH_CHUNK_SIZE } from '@/config/constants.ts';
import { isUnknownMemberOrUser } from './discord-errors.ts';
import { logDebug, logError, logWarn } from './logger.ts';

export type MemberFetchResult =
    | { status: 'present'; member: GuildMember }
    | { status: 'left' }
    | { status: 'error_skip' };

/**
 * Resolve {userId → MemberFetchResult} for many users using batched fetch.
 *
 * - `present` — user is in the guild.
 * - `left` — Discord returned UNKNOWN_MEMBER / UNKNOWN_USER (definitively gone).
 * - `error_skip` — transient failure; caller should retry later (e.g. validation pass).
 *
 * Issues one `guild.members.fetch({ user: [...ids] })` per `MEMBER_FETCH_CHUNK_SIZE`
 * (100, Discord API limit) instead of N individual fetches. Falls back to per-user
 * fetches only when the batch errors, so a single bad ID doesn't poison the rest.
 */
export async function fetchMembersBatch(
    guild: Guild,
    userIds: readonly string[],
    logPrefix: string,
): Promise<Map<string, MemberFetchResult>> {
    const result = new Map<string, MemberFetchResult>();
    if (userIds.length === 0) return result;

    for (let i = 0; i < userIds.length; i += MEMBER_FETCH_CHUNK_SIZE) {
        const chunk = userIds.slice(i, i + MEMBER_FETCH_CHUNK_SIZE);
        try {
            const members = await guild.members.fetch({ user: [...chunk] });
            for (const id of chunk) {
                const member = members.get(id);
                result.set(id, member ? { status: 'present', member } : { status: 'left' });
            }
        } catch (err) {
            logWarn(`${logPrefix} Batch fetch failed for ${chunk.length} member(s); falling back per-user:`, err);
            for (const id of chunk) {
                try {
                    const m = await guild.members.fetch({ user: id, force: true });
                    result.set(id, { status: 'present', member: m });
                } catch (perUserErr) {
                    if (isUnknownMemberOrUser(perUserErr)) {
                        result.set(id, { status: 'left' });
                    } else {
                        logWarn(`${logPrefix} Per-user fetch failed for ${id}:`, perUserErr);
                        result.set(id, { status: 'error_skip' });
                    }
                }
            }
        }
    }
    return result;
}

/**
 * Resolves a possibly-partial member into a usable GuildMember.
 *
 * Returns the original partial as a fallback when the fetch fails with
 * UNKNOWN_MEMBER / UNKNOWN_USER (the user already left) — the caller can still
 * read `.user.id` and `.guild.id` to mark records as left/flagged.
 *
 * Returns null when:
 *   - the input is non-partial but missing critical guild/user fields, or
 *   - the fetch failed for a reason other than "user already gone".
 */
export async function ensureFullMemberData(member: GuildMember | PartialGuildMember): Promise<GuildMember | null> {
    const prefix = `[EnsureMember][Guild:${member.guild?.id ?? 'N/A'}][User:${member.id}]`;

    if (!member.partial) {
        if (!member.user || !member.guild) {
            logWarn(`${prefix} Non-partial member missing critical user/guild data.`);
            return null;
        }
        return member as GuildMember;
    }

    logDebug(`${prefix} Member is partial — fetching…`);
    try {
        const full = await member.fetch();
        if (!full?.user || !full?.guild) {
            logWarn(`${prefix} Fetched member missing critical fields after fetch.`);
            return null;
        }
        return full;
    } catch (err) {
        if (isUnknownMemberOrUser(err)) {
            if (member.user && member.guild) {
                logDebug(`${prefix} Member already gone; returning partial as fallback.`);
                return member as unknown as GuildMember;
            }
            logWarn(`${prefix} Member gone and partial has no usable IDs.`);
            return null;
        }
        logError(`${prefix} Unexpected fetch error:`, err);
        return null;
    }
}
