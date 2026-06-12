import type { AppContext, Command } from '@/types/discord.ts';
import { buildBonusCommand } from './bonus.ts';
import { buildCheckCommand } from './check.ts';
import { buildConfigCommand } from './config.ts';
import { buildExportCommand } from './export.ts';
import { buildInviteCommand } from './invite.ts';
import { buildInviteLabelsCommand } from './invite-labels.ts';
import { buildInviteSourcesCommand } from './invite-sources.ts';
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
        buildInviteLabelsCommand(ctx),
        buildInviteSourcesCommand(ctx),
        buildExportCommand(ctx),
    ];
}
