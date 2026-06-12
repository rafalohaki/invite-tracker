import {
    ApplicationIntegrationType,
    AttachmentBuilder,
    type ChatInputCommandInteraction,
    InteractionContextType,
    MessageFlags,
    PermissionFlagsBits,
    SlashCommandBuilder,
} from 'discord.js';
import type { AppContext, Command } from '@/types/discord.ts';
import { toCsv } from '@/utils/csv.ts';
import { fetchMembersBatch } from '@/utils/discord-members.ts';
import { getErrorMessage } from '@/utils/errors.ts';
import { logError, logInfo } from '@/utils/logger.ts';

const LEADERBOARD_EXPORT_LIMIT = 1000;
const JOINS_EXPORT_LIMIT = 5000;

export function buildExportCommand(ctx: AppContext): Command {
    const data = new SlashCommandBuilder()
        .setName('export')
        .setDescription('Export invite data as CSV (admin only).')
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand((s) =>
            s.setName('leaderboard').setDescription('All-time leaderboard with validated/bonus/total per inviter.'),
        )
        .addSubcommand((s) => s.setName('joins').setDescription('Raw tracked joins (newest first, up to 5000 rows).'));

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
            const prefix = `[ExportCmd][Guild:${guild.id}][User:${user.id}]`;
            const sub = interaction.options.getSubcommand(true);
            // Defer: leaderboard export batch-fetches display names, which can take a moment.
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            try {
                let csv: string;
                let filename: string;

                if (sub === 'leaderboard') {
                    const rows = ctx.repos.trackedJoins.getLeaderboard(guild.id, LEADERBOARD_EXPORT_LIMIT, 'all');
                    const presence = await fetchMembersBatch(
                        guild,
                        rows.map((r) => r.inviterId),
                        prefix,
                    );
                    csv = toCsv(
                        ['rank', 'userId', 'displayName', 'validated', 'bonus', 'total'],
                        rows.map((r, i) => {
                            const member = presence.get(r.inviterId);
                            const displayName = member?.status === 'present' ? member.member.displayName : '';
                            const validated = ctx.repos.trackedJoins.countByStatus(guild.id, r.inviterId, 'validated');
                            const bonus = ctx.repos.bonusInvites.get(guild.id, r.inviterId);
                            return [i + 1, r.inviterId, displayName, validated, bonus, r.count];
                        }),
                    );
                    filename = `leaderboard-${guild.id}.csv`;
                } else {
                    const rows = ctx.repos.trackedJoins.listAllInGuild(guild.id, JOINS_EXPORT_LIMIT);
                    csv = toCsv(
                        ['inviteeId', 'inviterId', 'inviteCode', 'status', 'joinedAt', 'validatedAt', 'leftAt'],
                        rows.map((r) => [
                            r.inviteeId,
                            r.inviterId,
                            r.inviteCodeUsed,
                            r.status,
                            r.joinTimestamp,
                            r.validationTimestamp,
                            r.leaveTimestamp,
                        ]),
                    );
                    filename = `joins-${guild.id}.csv`;
                }

                const attachment = new AttachmentBuilder(Buffer.from(csv, 'utf8'), { name: filename });
                await interaction.editReply({
                    content: `Export ready: **${filename}**`,
                    files: [attachment],
                });
                logInfo(`${prefix} Exported ${sub} (${csv.length} bytes).`);
            } catch (err) {
                logError(`${prefix} Critical error:`, err);
                await interaction.editReply({ content: `Export failed: ${getErrorMessage(err)}` }).catch(() => {});
            }
        },
    };
}
