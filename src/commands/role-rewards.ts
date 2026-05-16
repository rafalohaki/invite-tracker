import {
    ApplicationIntegrationType,
    type ChatInputCommandInteraction,
    ContainerBuilder,
    InteractionContextType,
    MessageFlags,
    PermissionFlagsBits,
    SeparatorSpacingSize,
    SlashCommandBuilder,
} from 'discord.js';
import { EMBED_COLORS } from '@/config/constants.ts';
import type { AppContext, Command } from '@/types/discord.ts';
import { getErrorMessage } from '@/utils/errors.ts';
import { logError, logInfo } from '@/utils/logger.ts';
import { canAssignRole } from '@/utils/permissions.ts';

export function buildRoleRewardsCommand(ctx: AppContext): Command {
    const data = new SlashCommandBuilder()
        .setName('role-rewards')
        .setDescription('Manage role rewards for validated invites (admin only).')
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand((s) =>
            s
                .setName('add')
                .setDescription('Grant a role automatically when an inviter reaches this many validated invites.')
                .addIntegerOption((o) =>
                    o
                        .setName('threshold')
                        .setDescription('Minimum validated invites (1+)')
                        .setRequired(true)
                        .setMinValue(1),
                )
                .addRoleOption((o) => o.setName('role').setDescription('Role to grant').setRequired(true)),
        )
        .addSubcommand((s) =>
            s
                .setName('remove')
                .setDescription('Remove the reward at the given threshold.')
                .addIntegerOption((o) =>
                    o.setName('threshold').setDescription('Threshold to remove').setRequired(true).setMinValue(1),
                ),
        )
        .addSubcommand((s) => s.setName('list').setDescription('List configured role rewards.'));

    return {
        data,
        async execute(interaction: ChatInputCommandInteraction) {
            const { guild, user } = interaction;
            if (!guild) {
                await interaction.reply({
                    content: 'This command can only be used in a server.',
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            const prefix = `[RoleRewardsCmd][Guild:${guild.id}][User:${user.id}]`;
            const sub = interaction.options.getSubcommand(true);

            try {
                if (sub === 'add') {
                    const threshold = interaction.options.getInteger('threshold', true);
                    const role = interaction.options.getRole('role', true);

                    // Hierarchy pre-check so we don't add a reward we can't grant.
                    const fetched = guild.roles.cache.get(role.id);
                    if (fetched) {
                        const check = canAssignRole(guild, fetched);
                        if (!check.ok) {
                            await interaction.reply({
                                content: `I won't be able to assign ${role.name}: ${check.reason}. Move my role above it, or grant Manage Roles.`,
                                flags: MessageFlags.Ephemeral,
                            });
                            return;
                        }
                    }

                    try {
                        ctx.repos.roleRewards.add(guild.id, threshold, role.id);
                        logInfo(`${prefix} Added reward: threshold=${threshold}, role=${role.id} (${role.name}).`);
                        await interaction.reply({
                            content: `Added reward: **${role.name}** at ${threshold} validated invites.`,
                            flags: MessageFlags.Ephemeral,
                        });
                    } catch (err) {
                        const msg = getErrorMessage(err);
                        if (msg.toLowerCase().includes('unique')) {
                            await interaction.reply({
                                content: `A reward at threshold ${threshold} already exists. Remove it first.`,
                                flags: MessageFlags.Ephemeral,
                            });
                        } else {
                            await interaction.reply({
                                content: `Failed to add reward: ${msg}`,
                                flags: MessageFlags.Ephemeral,
                            });
                        }
                    }
                    return;
                }

                if (sub === 'remove') {
                    const threshold = interaction.options.getInteger('threshold', true);
                    const changes = ctx.repos.roleRewards.removeByThreshold(guild.id, threshold);
                    if (changes === 0) {
                        await interaction.reply({
                            content: `No reward at threshold ${threshold}.`,
                            flags: MessageFlags.Ephemeral,
                        });
                    } else {
                        logInfo(`${prefix} Removed reward at threshold=${threshold}.`);
                        await interaction.reply({
                            content: `Removed reward at threshold ${threshold}.`,
                            flags: MessageFlags.Ephemeral,
                        });
                    }
                    return;
                }

                if (sub === 'list') {
                    const rewards = ctx.repos.roleRewards.listForGuild(guild.id);
                    if (rewards.length === 0) {
                        await interaction.reply({
                            content: 'No role rewards configured. Use `/role-rewards add` to create one.',
                            flags: MessageFlags.Ephemeral,
                        });
                        return;
                    }

                    // Components v2 — modern UI from discord.js v14.26 (ContainerBuilder).
                    // ContainerBuilder needs MessageFlags.IsComponentsV2; can be combined with
                    // Ephemeral via bitwise OR — but cannot coexist with `content` or `embeds`.
                    const container = new ContainerBuilder()
                        .setAccentColor(EMBED_COLORS.roleRewards)
                        .addTextDisplayComponents((td) => td.setContent(`## 🎁 Role rewards for ${guild.name}`))
                        .addSeparatorComponents((s) => s.setSpacing(SeparatorSpacingSize.Small));
                    for (const r of rewards) {
                        container.addTextDisplayComponents((td) =>
                            td.setContent(`**\`${r.threshold}\`** validated invites → <@&${r.roleId}>`),
                        );
                    }
                    container
                        .addSeparatorComponents((s) => s.setSpacing(SeparatorSpacingSize.Small))
                        .addTextDisplayComponents((td) => td.setContent(`-# ${rewards.length} reward(s) configured`));

                    await interaction.reply({
                        components: [container],
                        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                    });
                    return;
                }
            } catch (err) {
                logError(`${prefix} Critical error:`, err);
                await interaction
                    .reply({
                        content: `Error: ${getErrorMessage(err)}`,
                        flags: MessageFlags.Ephemeral,
                    })
                    .catch(() => {});
            }
        },
    };
}
