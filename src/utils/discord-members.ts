import type { GuildMember, PartialGuildMember } from 'discord.js';
import { isUnknownMemberOrUser } from './discord-errors.ts';
import { logDebug, logError, logWarn } from './logger.ts';

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
