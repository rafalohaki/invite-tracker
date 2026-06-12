import {
    ApplicationIntegrationType,
    type ChatInputCommandInteraction,
    ContainerBuilder,
    InteractionContextType,
    MessageFlags,
    SeparatorSpacingSize,
    SlashCommandBuilder,
} from 'discord.js';
import { EMBED_COLORS, JOIN_STATUS_EMOJI } from '@/config/constants.ts';
import { t } from '@/i18n/translator.ts';
import type { AppContext, Command } from '@/types/discord.ts';
import { logError, logInfo } from '@/utils/logger.ts';
import { toDiscordTimestamp } from '@/utils/time.ts';

export function buildWhoInvitedCommand(ctx: AppContext): Command {
    return {
        data: new SlashCommandBuilder()
            .setName('who-invited')
            .setDescription('Show who invited a member to this server.')
            .addUserOption((opt) => opt.setName('user').setDescription('The member to look up.').setRequired(true))
            .setContexts(InteractionContextType.Guild)
            .setIntegrationTypes(ApplicationIntegrationType.GuildInstall),
        async execute(interaction: ChatInputCommandInteraction) {
            const { guild } = interaction;
            if (!guild) {
                await interaction.reply({ content: t('general.error_guild_only'), flags: MessageFlags.Ephemeral });
                return;
            }
            const target = interaction.options.getUser('user', true);
            const prefix = `[WhoInvitedCmd][Guild:${guild.id}][User:${interaction.user.id}]`;
            const guildLocale = ctx.repos.guildConfig.getLocale(guild.id);

            try {
                // Prefer the tracked join (has status); fall back to raw join history
                // (covers joins recorded before attribution or without it).
                const tracked = ctx.repos.trackedJoins.getByInvitee(guild.id, target.id);
                const history = tracked ? null : ctx.repos.joinHistory.getLatestForUser(guild.id, target.id);

                const inviterId = tracked?.inviterId ?? history?.inviterId ?? null;
                const inviteCode = tracked?.inviteCodeUsed ?? history?.inviteCodeUsed ?? null;
                const joinedAt = tracked?.joinTimestamp ?? history?.joinTimestamp ?? null;

                let body: string;
                if (inviterId) {
                    body = t(
                        'whoinvited.result',
                        {
                            username: target.username,
                            inviter: `<@${inviterId}>`,
                            code: inviteCode ?? '?',
                            joined_at: joinedAt ? toDiscordTimestamp(joinedAt) : '?',
                        },
                        guildLocale,
                    );
                    if (tracked) {
                        body += `\n${JOIN_STATUS_EMOJI[tracked.status]} ${t(`status.${tracked.status}`, {}, guildLocale)}`;
                    }
                } else if (joinedAt) {
                    body = t('whoinvited.unknown_inviter', { username: target.username }, guildLocale);
                } else {
                    body = t('whoinvited.no_data', { username: target.username }, guildLocale);
                }

                const container = new ContainerBuilder()
                    .setAccentColor(EMBED_COLORS.whoInvited)
                    .addTextDisplayComponents((td) =>
                        td.setContent(
                            `## 🔍 ${t('whoinvited.embed_title', { username: target.username }, guildLocale)}`,
                        ),
                    )
                    .addSeparatorComponents((s) => s.setSpacing(SeparatorSpacingSize.Small))
                    .addTextDisplayComponents((td) => td.setContent(body));

                await interaction.reply({
                    components: [container],
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                });
                logInfo(`${prefix} Lookup for ${target.id}: inviter=${inviterId ?? 'none'}.`);
            } catch (err) {
                logError(`${prefix} Critical error:`, err);
                await interaction
                    .reply({ content: t('general.error_command_execution'), flags: MessageFlags.Ephemeral })
                    .catch(() => {});
            }
        },
    };
}
