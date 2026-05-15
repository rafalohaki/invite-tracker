import type { Guild, GuildMember, User } from 'discord.js';
import type { AppContext } from '@/types/discord.ts';
import { logError, logInfo, logWarn } from '@/utils/logger.ts';

/**
 * Pure template renderer — substitutes `{user}`, `{inviter}`, `{count}`.
 * Exported separately so tests can hit it without a Discord mock.
 */
export function renderWelcomeTemplate(
    template: string,
    inviteeMention: string,
    inviterMention: string,
    count: number,
): string {
    return template
        .replaceAll('{user}', inviteeMention)
        .replaceAll('{inviter}', inviterMention)
        .replaceAll('{count}', String(count));
}

/**
 * Sends the welcome message after a successful invite attribution.
 *
 * Skips silently when the guild has no welcome_channel_id or welcome_template
 * configured. Resilient to a deleted channel (catch + log).
 *
 * `allowedMentions` is whitelisted to invitee + inviter, with empty `parse` —
 * blocks `@everyone` / `@here` / role mention injection in the template.
 */
export async function sendWelcomeMessage(
    ctx: AppContext,
    guild: Guild,
    invitee: GuildMember,
    inviter: User,
    validatedCount: number,
): Promise<void> {
    const prefix = `[Welcome][Guild:${guild.id}]`;
    const cfg = ctx.repos.guildConfig.getOrDefault(guild.id);

    const channelId = cfg.welcome_channel_id;
    const template = cfg.welcome_template;
    if (!channelId) return;
    if (!template || template.trim() === '') return;

    const channel = await guild.channels.fetch(channelId).catch((err: unknown) => {
        logWarn(`${prefix} Failed to fetch welcome channel ${channelId}:`, err);
        return null;
    });
    if (!channel || !('send' in channel) || typeof channel.send !== 'function') {
        logWarn(`${prefix} Welcome channel ${channelId} is null or not text-based.`);
        return;
    }

    const content = renderWelcomeTemplate(template, `<@${invitee.id}>`, `<@${inviter.id}>`, validatedCount);

    try {
        await channel.send({
            content,
            allowedMentions: { users: [invitee.id, inviter.id], roles: [], parse: [] },
        });
        logInfo(`${prefix} Sent welcome message to channel ${channelId}.`);
    } catch (err) {
        logError(`${prefix} Failed to send welcome message:`, err);
    }
}
