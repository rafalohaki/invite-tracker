import {
    type ChatInputCommandInteraction,
    EmbedBuilder,
    InteractionContextType,
    MessageFlags,
    SlashCommandBuilder,
} from 'discord.js';
import { env } from '@/config/env.ts';
import { t } from '@/i18n/translator.ts';
import type { AppContext, Command } from '@/types/discord.ts';
import { logError, logInfo, logWarn } from '@/utils/logger.ts';

const CHECK_EMBED_COLOR = 0x0099ff;

export function buildCheckCommand(ctx: AppContext): Command {
    return {
        data: new SlashCommandBuilder()
            .setName('check')
            .setDescription('[Admin Only] Show invite stats for a specific user.')
            .addUserOption((opt) =>
                opt.setName('user').setDescription('The user whose invite stats to inspect.').setRequired(true),
            )
            .setContexts(InteractionContextType.Guild),
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
            const guildLocale = ctx.repos.guildConfig.getOrDefault(guild.id).locale;

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

            try {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            } catch (err) {
                logError(`${logPrefix} Failed to defer:`, err);
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

                const embed = new EmbedBuilder()
                    .setColor(CHECK_EMBED_COLOR)
                    .setTitle(t('check.embed_title', { username: targetUser.username }, guildLocale))
                    .setDescription(
                        t(
                            'check.embed_description',
                            { user_tag: targetUser.username, guild_name: guild.name },
                            guildLocale,
                        ),
                    )
                    .addFields(
                        {
                            name: t('check.link_field_name', {}, guildLocale),
                            value: inviteCode
                                ? `https://discord.gg/${inviteCode}`
                                : t('check.error_no_invite_value', { user_tag: targetUser.username }, guildLocale),
                        },
                        {
                            name: t('check.validated_field_name', {}, guildLocale),
                            value: `\`${validated}\``,
                            inline: true,
                        },
                        {
                            name: t('check.pending_field_name', {}, guildLocale),
                            value: `\`${pending}\``,
                            inline: true,
                        },
                    )
                    .setFooter({ text: t('check.footer_success', { admin_tag: user.username }, guildLocale) })
                    .setTimestamp();

                if (flagged.length > 0) {
                    const lines = flagged.slice(0, 5).map((row) => {
                        const inviter = row.inviterId ? `<@${row.inviterId}>` : '_(unknown inviter)_';
                        return `• \`${row.joinTimestamp}\` — invited by ${inviter}`;
                    });
                    const more = flagged.length > 5 ? `\n…and ${flagged.length - 5} more.` : '';
                    embed.addFields({
                        name: `Rejoin history (flagged: ${flagged.length})`,
                        value: `${lines.join('\n')}${more}`,
                    });
                }

                if (targetUser.avatar) embed.setThumbnail(targetUser.displayAvatarURL());
                await interaction.editReply({ embeds: [embed] });
            } catch (err) {
                logError(`${logPrefix} Critical error:`, err);
                await interaction
                    .editReply({
                        content: t(
                            'check.error_critical',
                            {
                                user_tag: targetUser.username,
                                error_message: err instanceof Error ? err.message : 'unknown',
                            },
                            guildLocale,
                        ),
                        embeds: [],
                    })
                    .catch(() => {});
            }
        },
    };
}
