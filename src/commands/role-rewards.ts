import {
    type ChatInputCommandInteraction,
    EmbedBuilder,
    InteractionContextType,
    MessageFlags,
    PermissionFlagsBits,
    SlashCommandBuilder,
} from 'discord.js';
import type { AppContext, Command } from '@/types/discord.ts';
import { logError, logInfo } from '@/utils/logger.ts';
import { canAssignRole } from '@/utils/permissions.ts';

const ROLE_REWARDS_EMBED_COLOR = 0x57f287;

export function buildRoleRewardsCommand(ctx: AppContext): Command {
    const data = new SlashCommandBuilder()
        .setName('role-rewards')
        .setDescription('Manage role rewards for validated invites (admin only).')
        .setContexts(InteractionContextType.Guild)
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
                        const msg = err instanceof Error ? err.message : 'unknown';
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
                    const lines = rewards.map((r) => `• \`${r.threshold}\` validated → <@&${r.roleId}>`);
                    const embed = new EmbedBuilder()
                        .setColor(ROLE_REWARDS_EMBED_COLOR)
                        .setTitle(`Role rewards for ${guild.name}`)
                        .setDescription(lines.join('\n'))
                        .setFooter({ text: `${rewards.length} reward(s) configured` });
                    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
                    return;
                }
            } catch (err) {
                logError(`${prefix} Critical error:`, err);
                await interaction
                    .reply({
                        content: `Error: ${err instanceof Error ? err.message : 'unknown'}`,
                        flags: MessageFlags.Ephemeral,
                    })
                    .catch(() => {});
            }
        },
    };
}
