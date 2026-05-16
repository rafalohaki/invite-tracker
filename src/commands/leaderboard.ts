import {
    type ActionRowBuilder,
    ApplicationIntegrationType,
    type ButtonBuilder,
    type ChatInputCommandInteraction,
    ContainerBuilder,
    type Guild,
    InteractionContextType,
    MessageFlags,
    SeparatorSpacingSize,
    SlashCommandBuilder,
} from 'discord.js';
import { EMBED_COLORS } from '@/config/constants.ts';
import { t } from '@/i18n/translator.ts';
import { buildLeaderboardRow, LEADERBOARD_PAGE_SIZE } from '@/interactions/leaderboard-buttons.ts';
import type { LeaderboardPeriod } from '@/types/db.ts';
import type { AppContext, Command } from '@/types/discord.ts';
import { fetchMembersBatch } from '@/utils/discord-members.ts';
import { logError, logInfo } from '@/utils/logger.ts';

const PERIOD_LABEL: Record<LeaderboardPeriod, string> = {
    all: 'All time',
    week: 'Last 7 days',
    month: 'Last 30 days',
};

/**
 * Renders one page of the leaderboard as a Components v2 payload.
 *
 * Returned `components` array is `[Container, ActionRow]` (ActionRow only when
 * there is at least one row to paginate). Caller passes the whole array straight
 * to `editReply({ components })`. Flags are set once on the initial `deferReply`
 * (`MessageFlags.IsComponentsV2`) and inherited by every subsequent edit.
 *
 * Strategy: query LIMIT+1 rows to peek whether there's a next page — no separate
 * COUNT(DISTINCT inviterId) query.
 */
export async function renderLeaderboardPage(
    ctx: AppContext,
    guild: Guild,
    page: number,
    period: LeaderboardPeriod,
): Promise<{
    components: [ContainerBuilder] | [ContainerBuilder, ActionRowBuilder<ButtonBuilder>];
    rowsOnPage: number;
}> {
    const logPrefix = `[LeaderboardRender][Guild:${guild.id}]`;
    const guildLocale = ctx.repos.guildConfig.getLocale(guild.id);

    const offset = page * LEADERBOARD_PAGE_SIZE;
    const rows = ctx.repos.trackedJoins.getLeaderboardPage(guild.id, LEADERBOARD_PAGE_SIZE + 1, offset, period);
    const hasMore = rows.length > LEADERBOARD_PAGE_SIZE;
    const pageRows = hasMore ? rows.slice(0, LEADERBOARD_PAGE_SIZE) : rows;

    const container = new ContainerBuilder()
        .setAccentColor(EMBED_COLORS.leaderboard)
        .addTextDisplayComponents((td) =>
            td.setContent(`## 🏆 ${t('leaderboard.embed_title', { guild_name: guild.name }, guildLocale)}`),
        )
        .addSeparatorComponents((s) => s.setSpacing(SeparatorSpacingSize.Small));

    if (pageRows.length === 0) {
        container.addTextDisplayComponents((td) => td.setContent(t('leaderboard.no_data', {}, guildLocale)));
    } else {
        // Batch-fetch every inviter for this page in one API call instead of N (~10x latency cut).
        const presence = await fetchMembersBatch(
            guild,
            pageRows.map((r) => r.inviterId),
            logPrefix,
        );
        for (let i = 0; i < pageRows.length; i++) {
            // biome-ignore lint/style/noNonNullAssertion: bounded loop
            const entry = pageRows[i]!;
            const rank = offset + i + 1;
            const result = presence.get(entry.inviterId);
            const displayName =
                result?.status === 'present'
                    ? result.member.displayName
                    : result?.status === 'left'
                      ? t('leaderboard.left_user_format', { userId: entry.inviterId }, guildLocale)
                      : t('leaderboard.unknown_user_format', { userId: entry.inviterId }, guildLocale);
            container.addTextDisplayComponents((td) =>
                td.setContent(
                    t('leaderboard.entry_format', { rank, username: displayName, count: entry.count }, guildLocale),
                ),
            );
        }
    }

    container
        .addSeparatorComponents((s) => s.setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents((td) =>
            td.setContent(`-# ${PERIOD_LABEL[period]} • Page ${page + 1}${hasMore ? '+' : ''}`),
        );

    if (pageRows.length === 0) {
        return { components: [container], rowsOnPage: 0 };
    }
    const row = buildLeaderboardRow(page, hasMore, period);
    return { components: [container, row], rowsOnPage: pageRows.length };
}

export function buildLeaderboardCommand(ctx: AppContext): Command {
    return {
        data: new SlashCommandBuilder()
            .setName('leaderboard')
            .setDescription('Top inviters in this server (validated joins).')
            .setContexts(InteractionContextType.Guild)
            .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
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
                await interaction.reply({
                    content: t('general.error_guild_only'),
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            const period = (interaction.options.getString('period') as LeaderboardPeriod | null) ?? 'all';
            const logPrefix = `[LeaderboardCmd][Guild:${guild.id}]`;

            // Public reply (no Ephemeral flag) — leaderboard is visible to everyone.
            // Cast around discord.js@14.26.4 type bug: `deferReply.flags` is typed as Ephemeral
            // only; the runtime accepts IsComponentsV2. No behavioural impact.
            await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 as MessageFlags.Ephemeral });

            try {
                const { components, rowsOnPage } = await renderLeaderboardPage(ctx, guild, 0, period);
                await interaction.editReply({ components });
                logInfo(`${logPrefix} Served leaderboard (period=${period}, page=0, rows=${rowsOnPage}).`);
            } catch (err) {
                logError(`${logPrefix} Critical error:`, err);
                const guildLocale = ctx.repos.guildConfig.getLocale(guild.id);
                const errorContainer = new ContainerBuilder()
                    .setAccentColor(0xed4245)
                    .addTextDisplayComponents((td) => td.setContent(t('leaderboard.error_critical', {}, guildLocale)));
                await interaction.editReply({ components: [errorContainer] }).catch(() => {});
            }
        },
    };
}
