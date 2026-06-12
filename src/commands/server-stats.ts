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

export function buildServerStatsCommand(ctx: AppContext): Command {
    return {
        data: new SlashCommandBuilder()
            .setName('server-stats')
            .setDescription('Server-wide invite tracking statistics.')
            .setContexts(InteractionContextType.Guild)
            .setIntegrationTypes(ApplicationIntegrationType.GuildInstall),
        async execute(interaction: ChatInputCommandInteraction) {
            const { guild } = interaction;
            if (!guild) {
                await interaction.reply({ content: t('general.error_guild_only'), flags: MessageFlags.Ephemeral });
                return;
            }
            const prefix = `[ServerStatsCmd][Guild:${guild.id}][User:${interaction.user.id}]`;
            const guildLocale = ctx.repos.guildConfig.getLocale(guild.id);

            try {
                const totals = ctx.repos.trackedJoins.statusTotals(guild.id);
                const history = ctx.repos.joinHistory.guildStats(guild.id);
                const top = ctx.repos.trackedJoins.getLeaderboard(guild.id, 1, 'all')[0] ?? null;

                const container = new ContainerBuilder()
                    .setAccentColor(EMBED_COLORS.stats)
                    .addTextDisplayComponents((td) =>
                        td.setContent(`## 📈 ${t('stats.embed_title', { guild_name: guild.name }, guildLocale)}`),
                    )
                    .addSeparatorComponents((s) => s.setSpacing(SeparatorSpacingSize.Small))
                    .addTextDisplayComponents((td) =>
                        td.setContent(
                            `${JOIN_STATUS_EMOJI.validated} **${t('status.validated', {}, guildLocale)}** \`${totals.validated}\` · ` +
                                `${JOIN_STATUS_EMOJI.pending} **${t('status.pending', {}, guildLocale)}** \`${totals.pending}\``,
                        ),
                    )
                    .addTextDisplayComponents((td) =>
                        td.setContent(
                            `${JOIN_STATUS_EMOJI.left_early} **${t('status.left_early', {}, guildLocale)}** \`${totals.left_early}\` · ` +
                                `${JOIN_STATUS_EMOJI.flagged} **${t('status.flagged', {}, guildLocale)}** \`${totals.flagged}\``,
                        ),
                    )
                    .addSeparatorComponents((s) => s.setSpacing(SeparatorSpacingSize.Small))
                    .addTextDisplayComponents((td) =>
                        td.setContent(
                            t(
                                'stats.history_line',
                                { joins: history.joins, leaves: history.leaves, rejoins: history.flaggedRejoins },
                                guildLocale,
                            ),
                        ),
                    );

                if (top) {
                    container.addTextDisplayComponents((td) =>
                        td.setContent(
                            `🏆 ${t('stats.top_inviter', { inviter: `<@${top.inviterId}>`, count: top.count }, guildLocale)}`,
                        ),
                    );
                }

                container
                    .addSeparatorComponents((s) => s.setSpacing(SeparatorSpacingSize.Small))
                    .addTextDisplayComponents((td) => td.setContent(`-# ${t('stats.footer', {}, guildLocale)}`));

                // Public reply — like /leaderboard, stats are interesting for everyone.
                await interaction.reply({
                    components: [container],
                    flags: MessageFlags.IsComponentsV2,
                    allowedMentions: { parse: [] },
                });
                logInfo(`${prefix} Served stats (joins=${history.joins}).`);
            } catch (err) {
                logError(`${prefix} Critical error:`, err);
                await interaction
                    .reply({ content: t('general.error_command_execution'), flags: MessageFlags.Ephemeral })
                    .catch(() => {});
            }
        },
    };
}
