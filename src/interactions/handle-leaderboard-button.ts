import type { ButtonInteraction } from 'discord.js';
import { renderLeaderboardPage } from '@/commands/leaderboard.ts';
import type { AppContext } from '@/types/discord.ts';
import { logError, logInfo } from '@/utils/logger.ts';
import { parseLeaderboardCustomId } from './leaderboard-buttons.ts';

export async function handleLeaderboardButton(interaction: ButtonInteraction, ctx: AppContext): Promise<void> {
    const state = parseLeaderboardCustomId(interaction.customId);
    if (!state) return;
    if (!interaction.guild) return;

    const newPage = state.dir === 'next' ? state.page + 1 : Math.max(0, state.page - 1);
    const prefix = `[LeaderboardBtn][Guild:${interaction.guild.id}][User:${interaction.user.id}]`;

    try {
        await interaction.deferUpdate();
        const { embed, row, rowsOnPage } = await renderLeaderboardPage(ctx, interaction.guild, newPage, state.period);
        await interaction.editReply({ embeds: [embed], components: rowsOnPage > 0 ? [row] : [] });
        logInfo(`${prefix} Navigated to page ${newPage} (period=${state.period}, rows=${rowsOnPage}).`);
    } catch (err) {
        logError(`${prefix} Failed to handle pagination:`, err);
    }
}
