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

const MAX_LISTED = 20;

export function buildInvitedCommand(ctx: AppContext): Command {
    return {
        data: new SlashCommandBuilder()
            .setName('invited')
            .setDescription('List the members someone has invited (defaults to you).')
            .addUserOption((opt) =>
                opt.setName('user').setDescription('The inviter to inspect (default: you).').setRequired(false),
            )
            .setContexts(InteractionContextType.Guild)
            .setIntegrationTypes(ApplicationIntegrationType.GuildInstall),
        async execute(interaction: ChatInputCommandInteraction) {
            const { guild } = interaction;
            if (!guild) {
                await interaction.reply({ content: t('general.error_guild_only'), flags: MessageFlags.Ephemeral });
                return;
            }
            const target = interaction.options.getUser('user') ?? interaction.user;
            const prefix = `[InvitedCmd][Guild:${guild.id}][User:${interaction.user.id}]`;
            const guildLocale = ctx.repos.guildConfig.getLocale(guild.id);

            try {
                const rows = ctx.repos.trackedJoins.listByInviter(guild.id, target.id, MAX_LISTED + 1);
                const hasMore = rows.length > MAX_LISTED;
                const shown = hasMore ? rows.slice(0, MAX_LISTED) : rows;
                const validated = ctx.repos.trackedJoins.countByStatus(guild.id, target.id, 'validated');
                const pending = ctx.repos.trackedJoins.countByStatus(guild.id, target.id, 'pending');
                const bonus = ctx.repos.bonusInvites.get(guild.id, target.id);

                const container = new ContainerBuilder()
                    .setAccentColor(EMBED_COLORS.invited)
                    .addTextDisplayComponents((td) =>
                        td.setContent(`## 📋 ${t('invited.embed_title', { username: target.username }, guildLocale)}`),
                    )
                    .addTextDisplayComponents((td) =>
                        td.setContent(
                            `✅ \`${validated}\` · ⏳ \`${pending}\` · 🎁 \`${bonus}\` · Σ \`${validated + bonus}\``,
                        ),
                    )
                    .addSeparatorComponents((s) => s.setSpacing(SeparatorSpacingSize.Small));

                if (shown.length === 0) {
                    container.addTextDisplayComponents((td) =>
                        td.setContent(t('invited.no_data', { username: target.username }, guildLocale)),
                    );
                } else {
                    for (const row of shown) {
                        container.addTextDisplayComponents((td) =>
                            td.setContent(
                                `${JOIN_STATUS_EMOJI[row.status]} <@${row.inviteeId}> — ${toDiscordTimestamp(row.joinTimestamp)}`,
                            ),
                        );
                    }
                    if (hasMore) {
                        container.addTextDisplayComponents((td) =>
                            td.setContent(`-# ${t('invited.more_footer', { shown: MAX_LISTED }, guildLocale)}`),
                        );
                    }
                }

                await interaction.reply({
                    components: [container],
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                });
                logInfo(`${prefix} Listed ${shown.length} invitee(s) of ${target.id}.`);
            } catch (err) {
                logError(`${prefix} Critical error:`, err);
                await interaction
                    .reply({ content: t('general.error_command_execution'), flags: MessageFlags.Ephemeral })
                    .catch(() => {});
            }
        },
    };
}
