import { Events } from 'discord.js';
import type { AppClient, AppContext } from '@/types/discord.ts';
import { ensureFullMemberData } from '@/utils/discord-members.ts';
import { logError, logInfo, logWarn } from '@/utils/logger.ts';

export function registerGuildMemberRemove(client: AppClient, ctx: AppContext): void {
    client.on(Events.GuildMemberRemove, async (rawMember) => {
        const base = `[GuildMemberRemove][Guild:${rawMember.guild?.id ?? 'N/A'}][User:${rawMember.id}]`;
        try {
            const member = await ensureFullMemberData(rawMember);
            // Even when fetch fails, we know guild.id + user.id from the partial — try anyway.
            const guildId = member?.guild.id ?? rawMember.guild?.id;
            const userId = member?.user.id ?? rawMember.id;
            if (!guildId || !userId) {
                logWarn(`${base} No usable IDs — cannot mark leave.`);
                return;
            }

            const prefix = `[GuildMemberRemove][Guild:${guildId}][User:${userId}]`;
            logInfo(`${prefix} User left or was removed.`);

            const trackedChanges = ctx.repos.trackedJoins.markLeftEarly(guildId, userId);
            const historyChanges = ctx.repos.joinHistory.markLeft(guildId, userId);
            logInfo(
                `${prefix} Updates: TrackedJoins(pending→left_early)=${trackedChanges}, JoinHistory.markLeft=${historyChanges}.`,
            );
        } catch (err) {
            logError(`${base} Uncaught error in handler:`, err);
        }
    });
}
