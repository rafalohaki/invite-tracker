import type { Database } from 'bun:sqlite';
import type {
    AutocompleteInteraction,
    ButtonInteraction,
    ChatInputCommandInteraction,
    Client,
    Collection,
    SharedSlashCommand,
} from 'discord.js';
import type { GuildConfigRepository } from '@/db/repositories/guild-config.ts';
import type { JoinHistoryRepository } from '@/db/repositories/join-history.ts';
import type { RoleRewardsRepository } from '@/db/repositories/role-rewards.ts';
import type { TrackedJoinsRepository } from '@/db/repositories/tracked-joins.ts';
import type { UserInvitesRepository } from '@/db/repositories/user-invites.ts';

export interface Repositories {
    userInvites: UserInvitesRepository;
    trackedJoins: TrackedJoinsRepository;
    guildConfig: GuildConfigRepository;
    roleRewards: RoleRewardsRepository;
    joinHistory: JoinHistoryRepository;
}

/** Container passed to every command/event handler — pure DI, no module-level state. */
export interface AppContext {
    db: Database;
    repos: Repositories;
}

export interface Command {
    data: SharedSlashCommand;
    execute(interaction: ChatInputCommandInteraction): Promise<void>;
    autocomplete?(interaction: AutocompleteInteraction): Promise<void>;
}

export type AppClient = Client & {
    commands: Collection<string, Command>;
};

export type ButtonHandler = (interaction: ButtonInteraction, ctx: AppContext) => Promise<void>;
