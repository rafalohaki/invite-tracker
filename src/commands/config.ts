import {
    ApplicationIntegrationType,
    type AutocompleteInteraction,
    type ChatInputCommandInteraction,
    ContainerBuilder,
    InteractionContextType,
    MessageFlags,
    PermissionFlagsBits,
    SeparatorSpacingSize,
    SlashCommandBuilder,
} from 'discord.js';
import { z } from 'zod';
import { EMBED_COLORS } from '@/config/constants.ts';
import { CONFIG_KEYS, type ConfigKey } from '@/db/repositories/guild-config.ts';
import { t } from '@/i18n/translator.ts';
import type { AppContext, Command } from '@/types/discord.ts';
import { getErrorMessage } from '@/utils/errors.ts';
import { logError, logInfo, logWarn } from '@/utils/logger.ts';

const SNOWFLAKE = /^\d{17,20}$/;

const ConfigValueSchema = {
    validation_period_days: z.coerce.number().int().min(1).max(365),
    welcome_channel_id: z.string().regex(SNOWFLAKE, 'must be a valid Discord channel ID (17–20 digits)'),
    welcome_template: z.string().min(1).max(1000),
    locale: z.enum(['en', 'custom']),
    anti_cheat_window_days: z.coerce.number().int().min(1).max(365),
    min_account_age_days: z.coerce.number().int().min(0).max(365),
    log_channel_id: z.string().regex(SNOWFLAKE, 'must be a valid Discord channel ID (17–20 digits)'),
} satisfies Record<ConfigKey, z.ZodType>;

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
            const guildLocale = ctx.repos.guildConfig.getLocale(guild.id);
            const sub = interaction.options.getSubcommand(true);

            try {
                if (sub === 'get') {
                    const cfg = ctx.repos.guildConfig.getOrDefault(guild.id);
                    const welcomeChannel = cfg.welcome_channel_id ? `<#${cfg.welcome_channel_id}>` : '_(unset)_';
                    const welcomeTemplate = cfg.welcome_template
                        ? `\`\`\`\n${cfg.welcome_template}\n\`\`\``
                        : '_(unset)_';
                    const container = new ContainerBuilder()
                        .setAccentColor(EMBED_COLORS.config)
                        .addTextDisplayComponents((td) => td.setContent(`## ⚙️ Configuration for ${guild.name}`))
                        .addSeparatorComponents((s) => s.setSpacing(SeparatorSpacingSize.Small))
                        .addTextDisplayComponents((td) =>
                            td.setContent(`**validation_period_days** \`${cfg.validation_period_days}\``),
                        )
                        .addTextDisplayComponents((td) =>
                            td.setContent(`**anti_cheat_window_days** \`${cfg.anti_cheat_window_days}\``),
                        )
                        .addTextDisplayComponents((td) =>
                            td.setContent(
                                `**min_account_age_days** \`${cfg.min_account_age_days}\`${cfg.min_account_age_days === 0 ? ' _(fake detection off)_' : ''}`,
                            ),
                        )
                        .addTextDisplayComponents((td) => td.setContent(`**locale** \`${cfg.locale}\``))
                        .addTextDisplayComponents((td) => td.setContent(`**welcome_channel_id** ${welcomeChannel}`))
                        .addTextDisplayComponents((td) => td.setContent(`**welcome_template** ${welcomeTemplate}`))
                        .addTextDisplayComponents((td) =>
                            td.setContent(
                                `**log_channel_id** ${cfg.log_channel_id ? `<#${cfg.log_channel_id}>` : '_(unset)_'}`,
                            ),
                        )
                        .addSeparatorComponents((s) => s.setSpacing(SeparatorSpacingSize.Small))
                        .addTextDisplayComponents((td) =>
                            td.setContent('-# Values reflect env defaults when the DB row is NULL.'),
                        );
                    await interaction.reply({
                        components: [container],
                        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                    });
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
                const msg = getErrorMessage(err);
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
