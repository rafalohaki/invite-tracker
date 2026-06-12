import { Events } from 'discord.js';
import { removeCachedUse, setCachedUse } from '@/services/invite-cache.ts';
import type { AppClient, AppContext } from '@/types/discord.ts';
import { logDebug, logError, logInfo } from '@/utils/logger.ts';

/**
 * Keeps the invite-uses cache in sync between full refetches, and purges
 * bot-tracked invites from the DB the moment they're deleted on Discord
 * (instead of waiting for the next join to discover the stale row).
 *
 * Both events arrive on the GuildInvites intent which the client already requests.
 */
export function registerInviteEvents(client: AppClient, ctx: AppContext): void {
    client.on(Events.InviteCreate, (invite) => {
        const guildId = invite.guild?.id;
        if (!guildId) return;
        try {
            setCachedUse(guildId, invite.code, invite.uses ?? 0);
            logDebug(`[InviteCreate][Guild:${guildId}] Cached new invite ${invite.code}.`);
        } catch (err) {
            logError(`[InviteCreate][Guild:${guildId}] Failed to cache invite:`, err);
        }
    });

    client.on(Events.InviteDelete, (invite) => {
        const guildId = invite.guild?.id;
        if (!guildId) return;
        const prefix = `[InviteDelete][Guild:${guildId}]`;
        try {
            removeCachedUse(guildId, invite.code);
            const tracked = ctx.repos.userInvites.getByCode(invite.code, guildId);
            if (tracked) {
                ctx.repos.userInvites.delete(tracked.userId, guildId, invite.code);
                logInfo(
                    `${prefix} Tracked invite ${invite.code} (user ${tracked.userId}) deleted on Discord — DB row purged.`,
                );
            } else {
                logDebug(`${prefix} Untracked invite ${invite.code} deleted.`);
            }
        } catch (err) {
            logError(`${prefix} Failed to process invite deletion:`, err);
        }
    });
}
