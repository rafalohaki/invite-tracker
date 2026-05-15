import { type ChatInputCommandInteraction, EmbedBuilder, GuildMember, SlashCommandBuilder } from 'discord.js';
import { t } from '@/i18n/translator.ts';
import type { AppContext, Command } from '@/types/discord.ts';
import { logError, logInfo, logWarn } from '@/utils/logger.ts';

const LEADERBOARD_EMBED_COLOR = 0xffd700;
const LEADERBOARD_LIMIT = 15;

export function buildLeaderboardCommand(ctx: AppContext): Command {
    return {
        data: new SlashCommandBuilder()
            .setName('leaderboard')
            .setDescription(`Top ${LEADERBOARD_LIMIT} inviters in this server (validated joins).`),
        async execute(interaction: ChatInputCommandInteraction) {
            const { guild } = interaction;
            if (!guild) {
                await interaction.reply({ content: t('general.error_guild_only') });
                return;
            }
            const logPrefix = `[LeaderboardCmd][Guild:${guild.id}]`;
            const guildLocale = ctx.repos.guildConfig.getOrDefault(guild.id).locale;

            await interaction.deferReply();

            try {
                const rows = ctx.repos.trackedJoins.getLeaderboard(guild.id, LEADERBOARD_LIMIT, 'all');
                if (rows.length === 0) {
                    await interaction.editReply({ content: t('leaderboard.no_data', {}, guildLocale) });
                    return;
                }

                const lines: string[] = [];
                for (let i = 0; i < rows.length; i++) {
                    // biome-ignore lint/style/noNonNullAssertion: bounded loop over rows
                    const entry = rows[i]!;
                    let displayName = t('leaderboard.unknown_user_format', { userId: entry.inviterId }, guildLocale);
                    try {
                        const member = await guild.members.fetch(entry.inviterId);
                        if (member instanceof GuildMember) displayName = member.displayName;
                    } catch (err) {
                        if (
                            typeof err === 'object' &&
                            err &&
                            'code' in err &&
                            (err.code === 10007 || err.code === 10013)
                        ) {
                            displayName = t('leaderboard.left_user_format', { userId: entry.inviterId }, guildLocale);
                        } else {
                            logWarn(`${logPrefix} Failed to fetch inviter ${entry.inviterId}:`, err);
                        }
                    }
                    lines.push(
                        t(
                            'leaderboard.entry_format',
                            { rank: i + 1, username: displayName, count: entry.count },
                            guildLocale,
                        ),
                    );
                }

                let description = lines.join('\n');
                if (description.length > 4096) {
                    logWarn(`${logPrefix} Description exceeded 4096 chars; truncating.`);
                    description = `${description.substring(0, 4090)}\n…`;
                }

                const embed = new EmbedBuilder()
                    .setColor(LEADERBOARD_EMBED_COLOR)
                    .setTitle(t('leaderboard.embed_title', { guild_name: guild.name }, guildLocale))
                    .setDescription(description)
                    .setFooter({ text: t('leaderboard.footer_text', { count: rows.length }, guildLocale) })
                    .setTimestamp();

                await interaction.editReply({ embeds: [embed] });
                logInfo(`${logPrefix} Served leaderboard (${rows.length} entries).`);
            } catch (err) {
                logError(`${logPrefix} Critical error:`, err);
                if (interaction.deferred || interaction.replied) {
                    await interaction
                        .followUp({ content: t('leaderboard.error_critical', {}, guildLocale) })
                        .catch(() => {});
                }
            }
        },
    };
}
