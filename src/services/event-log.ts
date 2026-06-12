import type { Guild } from 'discord.js';
import { t } from '@/i18n/translator.ts';
import type { Locale } from '@/types/db.ts';
import type { AppContext } from '@/types/discord.ts';
import { logError, logInfo, logWarn } from '@/utils/logger.ts';

/** Which join-log line to render. Mirrors the decision branches in guild-member-add. */
export type JoinLogKind = 'attributed' | 'unattributed' | 'flagged_fake' | 'flagged_rejoin';

export interface JoinLogDetails {
    userId: string;
    inviterId?: string | null;
    inviteCode?: string | null;
    inviterTotal?: number;
    /** Invite-label source name (e.g. "YouTube") when the used code is labeled. */
    sourceLabel?: string | null;
}

/** Pure renderer — exported separately so tests can hit it without a Discord mock. */
export function renderJoinLogLine(kind: JoinLogKind, details: JoinLogDetails, locale?: Locale): string {
    const user = `<@${details.userId}>`;
    const inviter = details.inviterId ? `<@${details.inviterId}>` : '?';
    let line: string;
    switch (kind) {
        case 'attributed':
            line = t(
                'log.join_attributed',
                { user, inviter, code: details.inviteCode ?? '?', count: details.inviterTotal ?? 0 },
                locale,
            );
            break;
        case 'flagged_fake':
            line = t('log.join_flagged_fake', { user, inviter }, locale);
            break;
        case 'flagged_rejoin':
            line = t('log.join_flagged_rejoin', { user, inviter }, locale);
            break;
        default:
            line = t('log.join_unattributed', { user }, locale);
            break;
    }
    if (details.sourceLabel) {
        line += t('log.source_suffix', { label: details.sourceLabel }, locale);
    }
    return line;
}

/** Pure renderer for the leave line. */
export function renderLeaveLogLine(userId: string, inviterId: string | null, locale?: Locale): string {
    const user = `<@${userId}>`;
    if (inviterId) {
        return t('log.leave_attributed', { user, inviter: `<@${inviterId}>` }, locale);
    }
    return t('log.leave_unattributed', { user }, locale);
}

/**
 * Posts a line to the guild's configured log channel (`log_channel_id`).
 * Silent no-op when unconfigured; resilient to deleted channels.
 * Mentions render as names but never ping (`allowedMentions.parse: []`).
 */
export async function sendEventLog(ctx: AppContext, guild: Guild, content: string): Promise<void> {
    const prefix = `[EventLog][Guild:${guild.id}]`;
    const cfg = ctx.repos.guildConfig.getOrDefault(guild.id);
    const channelId = cfg.log_channel_id;
    if (!channelId) return;

    const channel = await guild.channels.fetch(channelId).catch((err: unknown) => {
        logWarn(`${prefix} Failed to fetch log channel ${channelId}:`, err);
        return null;
    });
    if (!channel || !('send' in channel) || typeof channel.send !== 'function') {
        logWarn(`${prefix} Log channel ${channelId} is null or not text-based.`);
        return;
    }

    try {
        await channel.send({ content, allowedMentions: { parse: [] } });
        logInfo(`${prefix} Posted event log line.`);
    } catch (err) {
        logError(`${prefix} Failed to send event log:`, err);
    }
}
