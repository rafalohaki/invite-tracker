import { Events } from 'discord.js';
import type { AppClient, AppContext } from '@/types/discord.ts';
import { logError, logWarn } from '@/utils/logger.ts';
import { registerGuildCreate } from './guild-create.ts';
import { registerGuildDelete } from './guild-delete.ts';
import { registerGuildMemberAdd } from './guild-member-add.ts';
import { registerGuildMemberRemove } from './guild-member-remove.ts';
import { registerInteractionCreate } from './interaction-create.ts';
import { type ReadyHandles, registerReady } from './ready.ts';

export function registerEvents(client: AppClient, ctx: AppContext): ReadyHandles {
    const handles: ReadyHandles = { cancelValidation: () => {} };
    registerReady(client, ctx, handles);
    registerInteractionCreate(client);
    registerGuildCreate(client);
    registerGuildDelete(client, ctx);
    registerGuildMemberAdd(client, ctx);
    registerGuildMemberRemove(client, ctx);

    client.on(Events.Warn, (warning) => logWarn('[Discord Client Warn]', warning));
    client.on(Events.Error, (error) => logError('[Discord Client Error]', error));

    return handles;
}
