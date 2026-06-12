import {
    ApplicationIntegrationType,
    type ChatInputCommandInteraction,
    InteractionContextType,
    MessageFlags,
    PermissionFlagsBits,
    SlashCommandBuilder,
} from 'discord.js';
import { assignEligibleRoles } from '@/services/role-rewards.ts';
import type { AppContext, Command } from '@/types/discord.ts';
import { getErrorMessage } from '@/utils/errors.ts';
import { logError, logInfo } from '@/utils/logger.ts';

const MAX_ADJUST = 10_000;

export function buildBonusCommand(ctx: AppContext): Command {
    const data = new SlashCommandBuilder()
        .setName('bonus')
        .setDescription('Manage bonus invites (admin only).')
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand((s) =>
            s
                .setName('add')
                .setDescription('Grant bonus invites to a user.')
                .addUserOption((o) => o.setName('user').setDescription('User to credit').setRequired(true))
                .addIntegerOption((o) =>
                    o
                        .setName('amount')
                        .setDescription(`Bonus invites to add (1–${MAX_ADJUST})`)
                        .setRequired(true)
                        .setMinValue(1)
                        .setMaxValue(MAX_ADJUST),
                ),
        )
        .addSubcommand((s) =>
            s
                .setName('remove')
                .setDescription('Take bonus invites away from a user.')
                .addUserOption((o) => o.setName('user').setDescription('User to debit').setRequired(true))
                .addIntegerOption((o) =>
                    o
                        .setName('amount')
                        .setDescription(`Bonus invites to remove (1–${MAX_ADJUST})`)
                        .setRequired(true)
                        .setMinValue(1)
                        .setMaxValue(MAX_ADJUST),
                ),
        )
        .addSubcommand((s) =>
            s
                .setName('show')
                .setDescription("Show a user's bonus invite balance.")
                .addUserOption((o) => o.setName('user').setDescription('User to inspect').setRequired(true)),
        );

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
            const prefix = `[BonusCmd][Guild:${guild.id}][User:${user.id}]`;
            const sub = interaction.options.getSubcommand(true);
            const target = interaction.options.getUser('user', true);

            try {
                if (sub === 'show') {
                    const bonus = ctx.repos.bonusInvites.get(guild.id, target.id);
                    const validated = ctx.repos.trackedJoins.countByStatus(guild.id, target.id, 'validated');
                    await interaction.reply({
                        content: `**${target.username}** has \`${bonus}\` bonus invite(s) (validated \`${validated}\`, total \`${validated + bonus}\`).`,
                        flags: MessageFlags.Ephemeral,
                    });
                    return;
                }

                const amount = interaction.options.getInteger('amount', true);
                const delta = sub === 'remove' ? -amount : amount;
                const newBonus = ctx.repos.bonusInvites.adjust(guild.id, target.id, delta);
                const validated = ctx.repos.trackedJoins.countByStatus(guild.id, target.id, 'validated');
                const total = validated + newBonus;
                logInfo(`${prefix} ${sub} ${amount} bonus for ${target.id}: bonus=${newBonus}, total=${total}.`);

                // A bonus grant can push the user past a role-reward threshold — check immediately
                // instead of waiting for the next validation sweep (which only sees promotions).
                if (delta > 0) {
                    const member = await guild.members.fetch(target.id).catch(() => null);
                    if (member) {
                        await assignEligibleRoles(ctx, guild, member, total);
                    }
                }

                const verb = delta > 0 ? 'Added' : 'Removed';
                await interaction.reply({
                    content: `${verb} \`${amount}\` bonus invite(s) ${delta > 0 ? 'to' : 'from'} **${target.username}**. New balance: bonus \`${newBonus}\`, total \`${total}\`.`,
                    flags: MessageFlags.Ephemeral,
                });
            } catch (err) {
                logError(`${prefix} Critical error:`, err);
                await interaction
                    .reply({ content: `Error: ${getErrorMessage(err)}`, flags: MessageFlags.Ephemeral })
                    .catch(() => {});
            }
        },
    };
}
