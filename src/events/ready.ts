import { ActivityType, Events } from 'discord.js';
import { t } from '@/i18n/translator.ts';
import { cacheGuildInvites } from '@/services/invite-cache.ts';
import type { AppClient } from '@/types/discord.ts';
import { logError, logInfo } from '@/utils/logger.ts';

export function registerReady(client: AppClient): void {
    client.once(Events.ClientReady, async (readyClient) => {
        try {
            logInfo(`Logged in as ${readyClient.user.tag} (id ${readyClient.user.id})`);
            logInfo(`Operating in ${readyClient.guilds.cache.size} guild(s).`);

            try {
                const activityText = t('general.activity_text');
                readyClient.user.setActivity(activityText, { type: ActivityType.Listening });
            } catch (err) {
                logError('Failed to set activity:', err);
                readyClient.user.setActivity('Tracking invites', { type: ActivityType.Listening });
            }

            logInfo('[Ready] Initial invite caching…');
            let ok = 0;
            let failed = 0;
            for (const guild of readyClient.guilds.cache.values()) {
                if (await cacheGuildInvites(guild)) ok++;
                else failed++;
                await new Promise((r) => setTimeout(r, 300));
            }
            logInfo(`[Ready] Initial caching done: ${ok} ok, ${failed} failed/no-perm.`);
        } catch (err) {
            logError('[Ready] Critical error during init:', err);
        }
    });
}
