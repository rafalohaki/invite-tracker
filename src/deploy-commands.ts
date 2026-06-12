/**
 * Registers (or updates) the bot's slash commands with Discord's REST API.
 * Run as: `bun src/deploy-commands.ts`
 *
 * If TEST_GUILD_ID is set, deploys to that guild (near-instant updates for dev).
 * Otherwise deploys globally (may take up to 1h to propagate).
 */
import { REST, Routes } from 'discord.js';
import { buildCommands } from '@/commands/index.ts';
import { env } from '@/config/env.ts';
import { createDb } from '@/db/client.ts';
import { createRepositories } from '@/db/repositories/index.ts';
import type { AppContext } from '@/types/discord.ts';
import { logError, logInfo } from '@/utils/logger.ts';

// We only need command metadata to deploy, not a live DB. But buildCommands(ctx) wants ctx,
// so we create a throwaway in-memory DB rather than touching the real one.
const db = createDb(':memory:');
const ctx: AppContext = { db, repos: createRepositories(db) };

const commands = buildCommands(ctx);
const payload = commands.map((c) => c.data.toJSON());
logInfo(`[Deploy] Built ${payload.length} command(s): ${commands.map((c) => c.data.name).join(', ')}`);

const rest = new REST().setToken(env.DISCORD_TOKEN);

async function main() {
    try {
        const route = env.TEST_GUILD_ID
            ? Routes.applicationGuildCommands(env.CLIENT_ID, env.TEST_GUILD_ID)
            : Routes.applicationCommands(env.CLIENT_ID);
        const scope = env.TEST_GUILD_ID ? `guild ${env.TEST_GUILD_ID}` : 'GLOBAL';
        logInfo(`[Deploy] Refreshing ${payload.length} commands (${scope})…`);
        const result = (await rest.put(route, { body: payload })) as unknown[];
        logInfo(`[Deploy] Discord acknowledged ${result.length} commands (${scope}).`);
    } catch (err) {
        logError('[Deploy] Failed to deploy commands:', err);
        process.exitCode = 1;
    } finally {
        db.close();
        // We never logged in, but discord.js REST keeps an internal agent alive.
        await new Promise<void>((resolve) => setImmediate(() => resolve()));
    }
}

await main();
