import type { AppContext, Command } from '@/types/discord.ts';
import { buildBonusCommand } from './bonus.ts';
import { buildCheckCommand } from './check.ts';
import { buildConfigCommand } from './config.ts';
import { buildInviteCommand } from './invite.ts';
import { buildInvitedCommand } from './invited.ts';
import { buildLeaderboardCommand } from './leaderboard.ts';
import { buildRoleRewardsCommand } from './role-rewards.ts';
import { buildServerStatsCommand } from './server-stats.ts';
import { buildWhoInvitedCommand } from './who-invited.ts';

export function buildCommands(ctx: AppContext): Command[] {
    return [
        buildInviteCommand(ctx),
        buildLeaderboardCommand(ctx),
        buildCheckCommand(ctx),
        buildConfigCommand(ctx),
        buildRoleRewardsCommand(ctx),
        buildBonusCommand(ctx),
        buildWhoInvitedCommand(ctx),
        buildInvitedCommand(ctx),
        buildServerStatsCommand(ctx),
    ];
}
