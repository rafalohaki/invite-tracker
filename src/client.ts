import { Client, Collection, GatewayIntentBits, Partials } from 'discord.js';
import type { AppClient, Command } from '@/types/discord.ts';

export function createClient(): AppClient {
    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildInvites,
            GatewayIntentBits.GuildMembers, // PRIVILEGED — enable in Developer Portal
        ],
        partials: [Partials.GuildMember],
    }) as AppClient;
    client.commands = new Collection<string, Command>();
    return client;
}
