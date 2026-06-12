import {
    ApplicationIntegrationType,
    type ChatInputCommandInteraction,
    ContainerBuilder,
    InteractionContextType,
    MessageFlags,
    SeparatorSpacingSize,
    SlashCommandBuilder,
} from 'discord.js';
import { EMBED_COLORS } from '@/config/constants.ts';
import { t } from '@/i18n/translator.ts';
import type { AppContext, Command } from '@/types/discord.ts';
import { logError, logInfo } from '@/utils/logger.ts';

export function buildInviteSourcesCommand(ctx: AppContext): Command {
    return {
        data: new SlashCommandBuilder()
            .setName('invite-sources')
            .setDescription('Where do members come from? Join counts per labeled invite.')
            .setContexts(InteractionContextType.Guild)
            .setIntegrationTypes(ApplicationIntegrationType.GuildInstall),
        async execute(interaction: ChatInputCommandInteraction) {
            const { guild } = interaction;
            if (!guild) {
                await interaction.reply({ content: t('general.error_guild_only'), flags: MessageFlags.Ephemeral });
                return;
            }
            const prefix = `[InviteSourcesCmd][Guild:${guild.id}][User:${interaction.user.id}]`;
            const guildLocale = ctx.repos.guildConfig.getLocale(guild.id);

            try {
                const stats = ctx.repos.inviteLabels.sourceStats(guild.id);
                const totalJoins = ctx.repos.joinHistory.guildStats(guild.id).joins;
                const labeledJoins = stats.reduce((sum, s) => sum + s.count, 0);
                const otherJoins = Math.max(0, totalJoins - labeledJoins);

                const container = new ContainerBuilder()
                    .setAccentColor(EMBED_COLORS.labels)
                    .addTextDisplayComponents((td) =>
                        td.setContent(`## 🏷️ ${t('sources.embed_title', { guild_name: guild.name }, guildLocale)}`),
                    )
                    .addSeparatorComponents((s) => s.setSpacing(SeparatorSpacingSize.Small));

                if (stats.length === 0) {
                    container.addTextDisplayComponents((td) => td.setContent(t('sources.no_labels', {}, guildLocale)));
                } else {
                    const max = Math.max(1, ...stats.map((s) => s.count));
                    for (const s of stats) {
                        const bar = '█'.repeat(Math.round((s.count / max) * 12)).padEnd(12, '░');
                        container.addTextDisplayComponents((td) =>
                            td.setContent(`\`${bar}\` **${s.label}** — \`${s.count}\``),
                        );
                    }
                    container
                        .addSeparatorComponents((s) => s.setSpacing(SeparatorSpacingSize.Small))
                        .addTextDisplayComponents((td) =>
                            td.setContent(
                                t('sources.other_line', { count: otherJoins, total: totalJoins }, guildLocale),
                            ),
                        );
                }

                await interaction.reply({
                    components: [container],
                    flags: MessageFlags.IsComponentsV2,
                    allowedMentions: { parse: [] },
                });
                logInfo(`${prefix} Served source stats (${stats.length} label(s)).`);
            } catch (err) {
                logError(`${prefix} Critical error:`, err);
                await interaction
                    .reply({ content: t('general.error_command_execution'), flags: MessageFlags.Ephemeral })
                    .catch(() => {});
            }
        },
    };
}
