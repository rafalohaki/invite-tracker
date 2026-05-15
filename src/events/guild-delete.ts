import { Events } from 'discord.js';
import { env } from '@/config/env.ts';
import { clearGuildCache } from '@/services/invite-cache.ts';
import type { AppClient, AppContext } from '@/types/discord.ts';
import { logError, logInfo, logWarn } from '@/utils/logger.ts';

export function registerGuildDelete(client: AppClient, ctx: AppContext): void {
    client.on(Events.GuildDelete, async (guild) => {
        const guildId = guild?.id;
        const guildName = guild?.name ?? `id:${guildId ?? 'unknown'}`;
        try {
            if (!guildId) {
                logWarn('[GuildDelete] guild object missing id — cache/db cleanup skipped.');
                return;
            }
            logInfo(`Left guild: ${guildName} (id ${guildId}).`);
            clearGuildCache(guildId);

            if (!env.PERFORM_GUILD_DELETE_CLEANUP) {
                logInfo(`[GuildDelete][Guild:${guildId}] DB cleanup disabled by config.`);
                return;
            }
            logInfo(`[GuildDelete][Guild:${guildId}] cleaning up DB rows…`);
            ctx.repos.trackedJoins.deleteAllInGuild(guildId);
            ctx.repos.userInvites.deleteAllInGuild(guildId);
            ctx.repos.joinHistory.deleteAllInGuild(guildId);
            ctx.repos.roleRewards.deleteAllInGuild(guildId);
            ctx.repos.guildConfig.deleteForGuild(guildId);
        } catch (err) {
            logError(`[GuildDelete][Guild:${guildId ?? 'unknown'}] cleanup failed:`, err);
        }
    });
}
