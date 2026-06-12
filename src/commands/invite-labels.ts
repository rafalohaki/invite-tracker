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
import { isUnknownInvite } from '@/utils/discord-errors.ts';
import { getErrorMessage } from '@/utils/errors.ts';
import { logError, logInfo } from '@/utils/logger.ts';
import { canAssignRole } from '@/utils/permissions.ts';

const MAX_LABEL_LENGTH = 50;
/** CV2 messages allow at most 40 components total — cap list entries with headroom. */
const MAX_LISTED_LABELS = 30;

/** Accepts a bare code or a full invite URL (with or without protocol) and returns the bare code. */
export function normalizeInviteCode(input: string): string {
    return input
        .trim()
        .replace(/^(https?:\/\/)?(www\.)?(discord\.gg|discord\.com\/invite|discordapp\.com\/invite)\//i, '')
        .replace(/\/+$/, '');
}

export function buildInviteLabelsCommand(ctx: AppContext): Command {
    const data = new SlashCommandBuilder()
        .setName('invite-labels')
        .setDescription('Label invite codes to track join sources (admin only).')
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand((s) =>
            s
                .setName('add')
                .setDescription('Label an invite code (any invite, not just bot-generated).')
                .addStringOption((o) =>
                    o.setName('code').setDescription('Invite code or full invite URL').setRequired(true),
                )
                .addStringOption((o) =>
                    o
                        .setName('label')
                        .setDescription('Source name, e.g. "YouTube"')
                        .setRequired(true)
                        .setMaxLength(MAX_LABEL_LENGTH),
                )
                .addRoleOption((o) =>
                    o
                        .setName('role')
                        .setDescription('Auto-role for members joining via this invite')
                        .setRequired(false),
                ),
        )
        .addSubcommand((s) =>
            s
                .setName('remove')
                .setDescription('Remove the label from an invite code.')
                .addStringOption((o) =>
                    o.setName('code').setDescription('Invite code or full invite URL').setRequired(true),
                ),
        )
        .addSubcommand((s) => s.setName('list').setDescription('List labeled invite codes.'));

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
            const prefix = `[InviteLabelsCmd][Guild:${guild.id}][User:${user.id}]`;
            const sub = interaction.options.getSubcommand(true);

            try {
                if (sub === 'add') {
                    const code = normalizeInviteCode(interaction.options.getString('code', true));
                    const label = interaction.options.getString('label', true).trim();
                    const role = interaction.options.getRole('role');
                    if (!code || !label) {
                        await interaction.reply({
                            content: 'Invite code and label must not be empty.',
                            flags: MessageFlags.Ephemeral,
                        });
                        return;
                    }

                    // Verify the invite exists in THIS guild (catches typos and foreign invites).
                    try {
                        const invite = await guild.invites.fetch({ code, force: true });
                        if (invite.guild?.id && invite.guild.id !== guild.id) {
                            await interaction.reply({
                                content: `Invite \`${code}\` belongs to a different server.`,
                                flags: MessageFlags.Ephemeral,
                            });
                            return;
                        }
                    } catch (err) {
                        if (isUnknownInvite(err)) {
                            await interaction.reply({
                                content: `Invite \`${code}\` does not exist in this server.`,
                                flags: MessageFlags.Ephemeral,
                            });
                            return;
                        }
                        throw err;
                    }

                    if (role) {
                        const fetched = guild.roles.cache.get(role.id);
                        if (fetched) {
                            const check = canAssignRole(guild, fetched);
                            if (!check.ok) {
                                await interaction.reply({
                                    content: `I won't be able to assign ${role.name} as auto-role: ${check.reason}. Move my role above it, or grant Manage Roles.`,
                                    flags: MessageFlags.Ephemeral,
                                });
                                return;
                            }
                        }
                    }

                    ctx.repos.inviteLabels.upsert(guild.id, code, label, role?.id ?? null);
                    logInfo(`${prefix} Labeled ${code} as '${label}' (autoRole=${role?.id ?? 'none'}).`);
                    await interaction.reply({
                        content: `Labeled \`${code}\` as **${label}**${role ? ` with auto-role **${role.name}**` : ''}. Joins via this invite now show up in \`/invite-sources\`.`,
                        flags: MessageFlags.Ephemeral,
                    });
                    return;
                }

                if (sub === 'remove') {
                    const code = normalizeInviteCode(interaction.options.getString('code', true));
                    const changes = ctx.repos.inviteLabels.remove(guild.id, code);
                    await interaction.reply({
                        content: changes > 0 ? `Removed label from \`${code}\`.` : `No label found on \`${code}\`.`,
                        flags: MessageFlags.Ephemeral,
                    });
                    if (changes > 0) logInfo(`${prefix} Removed label from ${code}.`);
                    return;
                }

                if (sub === 'list') {
                    const rows = ctx.repos.inviteLabels.list(guild.id);
                    if (rows.length === 0) {
                        await interaction.reply({
                            content: 'No invite labels configured. Use `/invite-labels add` to create one.',
                            flags: MessageFlags.Ephemeral,
                        });
                        return;
                    }
                    // Discord caps CV2 messages at 40 components total — keep headroom
                    // for the header/separators/footer.
                    const shown = rows.slice(0, MAX_LISTED_LABELS);
                    const container = new ContainerBuilder()
                        .setAccentColor(EMBED_COLORS.labels)
                        .addTextDisplayComponents((td) => td.setContent(`## 🏷️ Invite labels for ${guild.name}`))
                        .addSeparatorComponents((s) => s.setSpacing(SeparatorSpacingSize.Small));
                    for (const r of shown) {
                        const rolePart = r.autoRoleId ? ` → auto-role <@&${r.autoRoleId}>` : '';
                        container.addTextDisplayComponents((td) =>
                            td.setContent(`**${r.label}** — \`discord.gg/${r.inviteCode}\`${rolePart}`),
                        );
                    }
                    const overflow = rows.length - shown.length;
                    container
                        .addSeparatorComponents((s) => s.setSpacing(SeparatorSpacingSize.Small))
                        .addTextDisplayComponents((td) =>
                            td.setContent(
                                `-# ${rows.length} label(s)${overflow > 0 ? ` (showing first ${shown.length})` : ''} · see \`/invite-sources\` for join counts`,
                            ),
                        );
                    await interaction.reply({
                        components: [container],
                        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                    });
                    return;
                }
            } catch (err) {
                logError(`${prefix} Critical error:`, err);
                await interaction
                    .reply({ content: `Error: ${getErrorMessage(err)}`, flags: MessageFlags.Ephemeral })
                    .catch(() => {});
            }
        },
    };
}
