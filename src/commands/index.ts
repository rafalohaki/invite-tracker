import type { AppContext, Command } from '@/types/discord.ts';
import { buildCheckCommand } from './check.ts';
import { buildInviteCommand } from './invite.ts';
import { buildLeaderboardCommand } from './leaderboard.ts';

export function buildCommands(ctx: AppContext): Command[] {
    return [buildInviteCommand(ctx), buildLeaderboardCommand(ctx), buildCheckCommand(ctx)];
}
