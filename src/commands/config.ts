import {
    ApplicationIntegrationType,
    type AutocompleteInteraction,
    type ChatInputCommandInteraction,
    EmbedBuilder,
    InteractionContextType,
    MessageFlags,
    PermissionFlagsBits,
    SlashCommandBuilder,
} from 'discord.js';
import { z } from 'zod';
import { EMBED_COLORS } from '@/config/constants.ts';
import { CONFIG_KEYS, type ConfigKey } from '@/db/repositories/guild-config.ts';
import { t } from '@/i18n/translator.ts';
import type { AppContext, Command } from '@/types/discord.ts';
import { logError, logInfo, logWarn } from '@/utils/logger.ts';

const SNOWFLAKE = /^\d{17,20}$/;

const ConfigValueSchema = {
    validation_period_days: z.coerce.number().int().min(1).max(365),
    welcome_channel_id: z.string().regex(SNOWFLAKE, 'must be a valid Discord channel ID (17–20 digits)'),
    welcome_template: z.string().min(1).max(1000),
    locale: z.enum(['en', 'custom']),
    anti_cheat_window_days: z.coerce.number().int().min(1).max(365),
} satisfies Record<ConfigKey, z.ZodTypeAny>;

function isConfigKey(input: string): input is ConfigKey {
    return (CONFIG_KEYS as readonly string[]).includes(input);
}

export function buildConfigCommand(ctx: AppContext): Command {
    const data = new SlashCommandBuilder()
        .setName('config')
        .setDescription('Per-guild bot configuration (admin only).')
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand((s) => s.setName('get').setDescription('Show the current per-guild configuration.'))
        .addSubcommand((s) =>
            s
                .setName('set')
                .setDescription('Set a configuration value for this guild.')
                .addStringOption((o) =>
                    o.setName('key').setDescription('Config key').setRequired(true).setAutocomplete(true),
                )
                .addStringOption((o) => o.setName('value').setDescription('New value').setRequired(true)),
        )
        .addSubcommand((s) =>
            s
                .setName('reset')
                .setDescription('Reset a key to its environment default (NULL in DB).')
                .addStringOption((o) =>
                    o.setName('key').setDescription('Config key').setRequired(true).setAutocomplete(true),
                ),
        );

    return {
        data,
        async autocomplete(interaction: AutocompleteInteraction) {
            const focused = interaction.options.getFocused().toLowerCase();
            const matches = CONFIG_KEYS.filter((k) => k.startsWith(focused));
            await interaction.respond(matches.map((k) => ({ name: k, value: k })));
        },
        async execute(interaction: ChatInputCommandInteraction) {
            const { guild, user } = interaction;
            if (!guild) {
                await interaction.reply({ content: t('general.error_guild_only'), flags: MessageFlags.Ephemeral });
                return;
            }
            const prefix = `[ConfigCmd][Guild:${guild.id}][User:${user.id}]`;
            const guildLocale = ctx.repos.guildConfig.getOrDefault(guild.id).locale;
            const sub = interaction.options.getSubcommand(true);

            try {
                if (sub === 'get') {
                    const cfg = ctx.repos.guildConfig.getOrDefault(guild.id);
                    const embed = new EmbedBuilder()
                        .setColor(EMBED_COLORS.config)
                        .setTitle(`Configuration for ${guild.name}`)
                        .addFields(
                            {
                                name: 'validation_period_days',
                                value: `\`${cfg.validation_period_days}\``,
                                inline: true,
                            },
                            {
                                name: 'anti_cheat_window_days',
                                value: `\`${cfg.anti_cheat_window_days}\``,
                                inline: true,
                            },
                            { name: 'locale', value: `\`${cfg.locale}\``, inline: true },
                            {
                                name: 'welcome_channel_id',
                                value: cfg.welcome_channel_id ? `<#${cfg.welcome_channel_id}>` : '_(unset)_',
                            },
                            {
                                name: 'welcome_template',
                                value: cfg.welcome_template ? `\`\`\`\n${cfg.welcome_template}\n\`\`\`` : '_(unset)_',
                            },
                        )
                        .setFooter({ text: 'Values shown reflect env defaults when DB row is NULL.' })
                        .setTimestamp();
                    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
                    return;
                }

                const rawKey = interaction.options.getString('key', true);
                if (!isConfigKey(rawKey)) {
                    await interaction.reply({
                        content: `Unknown config key \`${rawKey}\`. Valid keys: ${CONFIG_KEYS.join(', ')}.`,
                        flags: MessageFlags.Ephemeral,
                    });
                    return;
                }

                if (sub === 'reset') {
                    ctx.repos.guildConfig.reset(guild.id, rawKey);
                    logInfo(`${prefix} Reset key \`${rawKey}\` to env default.`);
                    await interaction.reply({
                        content: `\`${rawKey}\` reset to env default.`,
                        flags: MessageFlags.Ephemeral,
                    });
                    return;
                }

                if (sub === 'set') {
                    const rawValue = interaction.options.getString('value', true);
                    const schema = ConfigValueSchema[rawKey];
                    const parsed = schema.safeParse(rawValue);
                    if (!parsed.success) {
                        const issue = parsed.error.issues[0]?.message ?? 'invalid value';
                        await interaction.reply({
                            content: `Invalid value for \`${rawKey}\`: ${issue}`,
                            flags: MessageFlags.Ephemeral,
                        });
                        return;
                    }
                    ctx.repos.guildConfig.set(guild.id, rawKey, parsed.data as string | number);
                    logInfo(`${prefix} Set \`${rawKey}\` = ${JSON.stringify(parsed.data)}.`);
                    await interaction.reply({
                        content: `\`${rawKey}\` set successfully.`,
                        flags: MessageFlags.Ephemeral,
                    });
                    return;
                }

                logWarn(`${prefix} Unknown subcommand: ${sub}`);
            } catch (err) {
                logError(`${prefix} Critical error:`, err);
                const msg = err instanceof Error ? err.message : 'unknown';
                await interaction
                    .reply({
                        content: `Error: ${msg}`,
                        flags: MessageFlags.Ephemeral,
                    })
                    .catch(() => {});
            }

            void guildLocale; // Reserved for future per-guild error translation.
        },
    };
}
