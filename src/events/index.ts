import { Events } from 'discord.js';
import type { AppClient, AppContext } from '@/types/discord.ts';
import { logError, logWarn } from '@/utils/logger.ts';
import { registerGuildCreate } from './guild-create.ts';
import { registerGuildDelete } from './guild-delete.ts';
import { registerInteractionCreate } from './interaction-create.ts';
import { registerReady } from './ready.ts';

export function registerEvents(client: AppClient, ctx: AppContext): void {
    registerReady(client);
    registerInteractionCreate(client);
    registerGuildCreate(client);
    registerGuildDelete(client, ctx);

    client.on(Events.Warn, (warning) => logWarn('[Discord Client Warn]', warning));
    client.on(Events.Error, (error) => logError('[Discord Client Error]', error));
}
