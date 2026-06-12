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
import { env } from '@/config/env.ts';
import { t } from '@/i18n/translator.ts';
import type { AppContext, Command } from '@/types/discord.ts';
import { getErrorMessage } from '@/utils/errors.ts';
import { logError, logInfo, logWarn } from '@/utils/logger.ts';

export function buildCheckCommand(ctx: AppContext): Command {
    return {
        data: new SlashCommandBuilder()
            .setName('check')
            .setDescription('[Admin Only] Show invite stats for a specific user.')
            .addUserOption((opt) =>
                opt.setName('user').setDescription('The user whose invite stats to inspect.').setRequired(true),
            )
            .setContexts(InteractionContextType.Guild)
            .setIntegrationTypes(ApplicationIntegrationType.GuildInstall),
        async execute(interaction: ChatInputCommandInteraction) {
            const { user, guild, options } = interaction;
            if (!guild) {
                await interaction.reply({
                    content: t('general.error_guild_only'),
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            const logPrefix = `[CheckCmd][Guild:${guild.id}][Admin:${user.id}]`;
            const guildLocale = ctx.repos.guildConfig.getLocale(guild.id);

            if (env.ADMIN_IDS.length === 0) {
                logWarn(`${logPrefix} ADMIN_IDS is empty in .env; command refused.`);
                await interaction.reply({
                    content: t('check.error_admin_id_not_set', {}, guildLocale),
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            if (!env.ADMIN_IDS.includes(user.id)) {
                logWarn(`${logPrefix} Unauthorized — user not in ADMIN_IDS.`);
                await interaction.reply({
                    content: t('check.error_permission_admin', {}, guildLocale),
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }

            const targetUser = options.getUser('user', true);
            const targetId = targetUser.id;
            logInfo(`${logPrefix} Admin ${user.username} inspecting ${targetUser.username} (${targetId}).`);

            try {
                const userInvite = ctx.repos.userInvites.get(targetId, guild.id);
                const inviteCode = userInvite?.inviteCode ?? null;
                const validated = ctx.repos.trackedJoins.countByStatus(guild.id, targetId, 'validated');
                const pending = ctx.repos.trackedJoins.countByStatus(guild.id, targetId, 'pending');
                const flagged = ctx.repos.joinHistory.getFlaggedForUser(guild.id, targetId);

                const inviteLine = inviteCode
                    ? `🔗 **${t('check.link_field_name', {}, guildLocale)}** https://discord.gg/${inviteCode}`
                    : `🔗 ${t('check.error_no_invite', { user_tag: targetUser.username }, guildLocale)}`;

                const container = new ContainerBuilder()
                    .setAccentColor(EMBED_COLORS.check)
                    .addTextDisplayComponents((td) =>
                        td.setContent(
                            `## 📊 ${t('check.embed_title', { username: targetUser.username }, guildLocale)}`,
                        ),
                    )
                    .addTextDisplayComponents((td) =>
                        td.setContent(
                            t(
                                'check.embed_description',
                                { user_tag: targetUser.username, guild_name: guild.name },
                                guildLocale,
                            ),
                        ),
                    )
                    .addSeparatorComponents((s) => s.setSpacing(SeparatorSpacingSize.Small))
                    .addTextDisplayComponents((td) => td.setContent(inviteLine))
                    .addTextDisplayComponents((td) =>
                        td.setContent(
                            `✅ **${t('check.validated_field_name', {}, guildLocale)}** \`${validated}\` · ⏳ **${t('check.pending_field_name', {}, guildLocale)}** \`${pending}\``,
                        ),
                    );

                if (flagged.length > 0) {
                    container
                        .addSeparatorComponents((s) => s.setSpacing(SeparatorSpacingSize.Small))
                        .addTextDisplayComponents((td) =>
                            td.setContent(`### 🚨 Rejoin history (flagged: ${flagged.length})`),
                        );
                    for (const row of flagged.slice(0, 5)) {
                        const inviter = row.inviterId ? `<@${row.inviterId}>` : '_(unknown inviter)_';
                        container.addTextDisplayComponents((td) =>
                            td.setContent(`• \`${row.joinTimestamp}\` — invited by ${inviter}`),
                        );
                    }
                    if (flagged.length > 5) {
                        container.addTextDisplayComponents((td) =>
                            td.setContent(`-# …and ${flagged.length - 5} more.`),
                        );
                    }
                }

                container
                    .addSeparatorComponents((s) => s.setSpacing(SeparatorSpacingSize.Small))
                    .addTextDisplayComponents((td) =>
                        td.setContent(`-# ${t('check.footer_success', { admin_tag: user.username }, guildLocale)}`),
                    );

                // Direct reply (no defer) — DB queries are synchronous and finish well under
                // the 3s defer deadline. Sidesteps the discord.js@14.26 type bug where
                // `deferReply.flags` is typed `Ephemeral` only.
                await interaction.reply({
                    components: [container],
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                });
            } catch (err) {
                logError(`${logPrefix} Critical error:`, err);
                const errorContainer = new ContainerBuilder().setAccentColor(0xed4245).addTextDisplayComponents((td) =>
                    td.setContent(
                        t(
                            'check.error_critical',
                            {
                                user_tag: targetUser.username,
                                error_message: getErrorMessage(err),
                            },
                            guildLocale,
                        ),
                    ),
                );
                if (interaction.replied) {
                    await interaction
                        .followUp({
                            components: [errorContainer],
                            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                        })
                        .catch(() => {});
                } else {
                    await interaction
                        .reply({
                            components: [errorContainer],
                            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                        })
                        .catch(() => {});
                }
            }
        },
    };
}
