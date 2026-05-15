import { Events } from 'discord.js';
import { cacheGuildInvites } from '@/services/invite-cache.ts';
import type { AppClient } from '@/types/discord.ts';
import { logError, logInfo } from '@/utils/logger.ts';

export function registerGuildCreate(client: AppClient): void {
    client.on(Events.GuildCreate, async (guild) => {
        try {
            logInfo(`Joined new guild: ${guild.name} (id ${guild.id}, ~${guild.memberCount} members).`);
            await cacheGuildInvites(guild);
        } catch (err) {
            logError(`[GuildCreate][Guild:${guild.id}] error during setup:`, err);
        }
    });
}
