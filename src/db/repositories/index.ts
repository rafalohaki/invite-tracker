import type { Database } from 'bun:sqlite';
import type { Repositories } from '@/types/discord.ts';
import { BonusInvitesRepository } from './bonus-invites.ts';
import { GuildConfigRepository } from './guild-config.ts';
import { JoinHistoryRepository } from './join-history.ts';
import { RoleRewardsRepository } from './role-rewards.ts';
import { TrackedJoinsRepository } from './tracked-joins.ts';
import { UserInvitesRepository } from './user-invites.ts';

/**
 * Single place that wires every repository to a database handle.
 * Used by the bot bootstrap, the command deployer, and test fixtures —
 * adding a repository means touching exactly this file plus the
 * `Repositories` interface.
 */
export function createRepositories(db: Database): Repositories {
    return {
        userInvites: new UserInvitesRepository(db),
        trackedJoins: new TrackedJoinsRepository(db),
        guildConfig: new GuildConfigRepository(db),
        roleRewards: new RoleRewardsRepository(db),
        joinHistory: new JoinHistoryRepository(db),
        bonusInvites: new BonusInvitesRepository(db),
    };
}
