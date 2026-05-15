import {
    type ChatInputCommandInteraction,
    EmbedBuilder,
    type Guild,
    GuildMember,
    SlashCommandBuilder,
} from 'discord.js';
import { t } from '@/i18n/translator.ts';
import { buildLeaderboardRow, LEADERBOARD_PAGE_SIZE } from '@/interactions/leaderboard-buttons.ts';
import type { LeaderboardPeriod } from '@/types/db.ts';
import type { AppContext, Command } from '@/types/discord.ts';
import { logError, logInfo, logWarn } from '@/utils/logger.ts';

const LEADERBOARD_EMBED_COLOR = 0xffd700;

const PERIOD_LABEL: Record<LeaderboardPeriod, string> = {
    all: 'All time',
    week: 'Last 7 days',
    month: 'Last 30 days',
};

/**
 * Pure renderer for a single page — shared between the slash command (initial render)
 * and the button dispatcher (page navigation).
 *
 * Strategy: query LIMIT+1 rows to peek whether there's a next page, without a
 * separate COUNT(DISTINCT inviterId) query.
 */
export async function renderLeaderboardPage(
    ctx: AppContext,
    guild: Guild,
    page: number,
    period: LeaderboardPeriod,
): Promise<{ embed: EmbedBuilder; row: ReturnType<typeof buildLeaderboardRow>; rowsOnPage: number }> {
    const logPrefix = `[LeaderboardRender][Guild:${guild.id}]`;
    const guildLocale = ctx.repos.guildConfig.getOrDefault(guild.id).locale;

    const offset = page * LEADERBOARD_PAGE_SIZE;
    const rows = ctx.repos.trackedJoins.getLeaderboardPage(guild.id, LEADERBOARD_PAGE_SIZE + 1, offset, period);
    const hasMore = rows.length > LEADERBOARD_PAGE_SIZE;
    const pageRows = hasMore ? rows.slice(0, LEADERBOARD_PAGE_SIZE) : rows;

    let description: string;
    if (pageRows.length === 0) {
        description = t('leaderboard.no_data', {}, guildLocale);
    } else {
        const lines: string[] = [];
        for (let i = 0; i < pageRows.length; i++) {
            // biome-ignore lint/style/noNonNullAssertion: bounded loop
            const entry = pageRows[i]!;
            const rank = offset + i + 1;
            let displayName = t('leaderboard.unknown_user_format', { userId: entry.inviterId }, guildLocale);
            try {
                const member = await guild.members.fetch(entry.inviterId);
                if (member instanceof GuildMember) displayName = member.displayName;
            } catch (err) {
                if (typeof err === 'object' && err && 'code' in err && (err.code === 10007 || err.code === 10013)) {
                    displayName = t('leaderboard.left_user_format', { userId: entry.inviterId }, guildLocale);
                } else {
                    logWarn(`${logPrefix} Failed to fetch inviter ${entry.inviterId}:`, err);
                }
            }
            lines.push(t('leaderboard.entry_format', { rank, username: displayName, count: entry.count }, guildLocale));
        }
        description = lines.join('\n');
        if (description.length > 4096) {
            logWarn(`${logPrefix} Description exceeded 4096 chars; truncating.`);
            description = `${description.substring(0, 4090)}\n…`;
        }
    }

    const embed = new EmbedBuilder()
        .setColor(LEADERBOARD_EMBED_COLOR)
        .setTitle(t('leaderboard.embed_title', { guild_name: guild.name }, guildLocale))
        .setDescription(description)
        .setFooter({
            text: `${PERIOD_LABEL[period]} • Page ${page + 1}${hasMore ? '+' : ''}`,
        })
        .setTimestamp();

    const row = buildLeaderboardRow(page, hasMore, period);
    return { embed, row, rowsOnPage: pageRows.length };
}

export function buildLeaderboardCommand(ctx: AppContext): Command {
    return {
        data: new SlashCommandBuilder()
            .setName('leaderboard')
            .setDescription('Top inviters in this server (validated joins).')
            .addStringOption((o) =>
                o
                    .setName('period')
                    .setDescription('Time window for counting validated invites')
                    .addChoices(
                        { name: 'All time', value: 'all' },
                        { name: 'Last 7 days', value: 'week' },
                        { name: 'Last 30 days', value: 'month' },
                    ),
            ),
        async execute(interaction: ChatInputCommandInteraction) {
            const { guild } = interaction;
            if (!guild) {
                await interaction.reply({ content: t('general.error_guild_only') });
                return;
            }
            const period = (interaction.options.getString('period') as LeaderboardPeriod | null) ?? 'all';
            const logPrefix = `[LeaderboardCmd][Guild:${guild.id}]`;
            await interaction.deferReply();

            try {
                const { embed, row, rowsOnPage } = await renderLeaderboardPage(ctx, guild, 0, period);
                if (rowsOnPage === 0) {
                    await interaction.editReply({ embeds: [embed] });
                    return;
                }
                await interaction.editReply({ embeds: [embed], components: [row] });
                logInfo(`${logPrefix} Served leaderboard (period=${period}, page=0, rows=${rowsOnPage}).`);
            } catch (err) {
                logError(`${logPrefix} Critical error:`, err);
                if (interaction.deferred || interaction.replied) {
                    await interaction
                        .followUp({
                            content: t(
                                'leaderboard.error_critical',
                                {},
                                ctx.repos.guildConfig.getOrDefault(guild.id).locale,
                            ),
                        })
                        .catch(() => {});
                }
            }
        },
    };
}
