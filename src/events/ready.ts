import { ActivityType, Events } from 'discord.js';
import { t } from '@/i18n/translator.ts';
import { cacheGuildInvites } from '@/services/invite-cache.ts';
import { startValidationScheduler } from '@/services/validation.ts';
import type { AppClient, AppContext } from '@/types/discord.ts';
import { logError, logInfo } from '@/utils/logger.ts';

export interface ReadyHandles {
    cancelValidation: () => void;
}

export function registerReady(client: AppClient, ctx: AppContext, handles: ReadyHandles): void {
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

            const scheduler = startValidationScheduler(client, ctx);
            handles.cancelValidation = () => scheduler.cancel();
        } catch (err) {
            logError('[Ready] Critical error during init:', err);
        }
    });
}
