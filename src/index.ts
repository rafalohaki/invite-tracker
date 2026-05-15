import { createClient } from '@/client.ts';
import { buildCommands } from '@/commands/index.ts';
import { env } from '@/config/env.ts';
import { createDb } from '@/db/client.ts';
import { GuildConfigRepository } from '@/db/repositories/guild-config.ts';
import { JoinHistoryRepository } from '@/db/repositories/join-history.ts';
import { RoleRewardsRepository } from '@/db/repositories/role-rewards.ts';
import { TrackedJoinsRepository } from '@/db/repositories/tracked-joins.ts';
import { UserInvitesRepository } from '@/db/repositories/user-invites.ts';
import { registerEvents } from '@/events/index.ts';
import { loadTranslations } from '@/i18n/translator.ts';
import type { AppContext } from '@/types/discord.ts';
import { configuredLogLevel, logError, logInfo } from '@/utils/logger.ts';

logInfo('Bot booting…');
logInfo(`[Config] Log Level: ${configuredLogLevel()}`);
logInfo(`[Config] Database: ${env.DATABASE_PATH}`);
logInfo(`[Config] Locale (global default): ${env.LOCALE_LANG}`);
logInfo(
    `[Config] Validation: every ${env.VALIDATION_CHECK_INTERVAL_MINUTES}min, period ${env.VALIDATION_PERIOD_DAYS}d`,
);
logInfo(`[Config] Anti-cheat window (default): ${env.ANTI_CHEAT_WINDOW_DAYS}d`);

loadTranslations();

const db = createDb(env.DATABASE_PATH);
const ctx: AppContext = {
    db,
    repos: {
        userInvites: new UserInvitesRepository(db),
        trackedJoins: new TrackedJoinsRepository(db),
        guildConfig: new GuildConfigRepository(db),
        roleRewards: new RoleRewardsRepository(db),
        joinHistory: new JoinHistoryRepository(db),
    },
};

const client = createClient();
for (const command of buildCommands(ctx)) {
    client.commands.set(command.data.name, command);
}
registerEvents(client, ctx);

// Graceful shutdown.
let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    logInfo(`Received ${signal}. Shutting down gracefully…`);
    try {
        client.destroy();
        logInfo('Discord client destroyed.');
    } catch (err) {
        logError('Failed to destroy client:', err);
    }
    try {
        db.close();
        logInfo('SQLite database closed.');
    } catch (err) {
        logError('Failed to close database:', err);
    }
    process.exit(0);
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => logError('Unhandled promise rejection:', reason));
process.on('uncaughtException', (err) => {
    logError('Uncaught exception:', err);
    process.exit(1);
});

logInfo('Logging in to Discord…');
client.login(env.DISCORD_TOKEN).catch((err: unknown) => {
    logError('FATAL: Discord login failed:', err);
    process.exit(1);
});
