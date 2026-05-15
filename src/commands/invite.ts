import {
    ChannelType,
    type ChatInputCommandInteraction,
    EmbedBuilder,
    type Guild,
    type GuildBasedChannel,
    type Invite,
    MessageFlags,
    PermissionFlagsBits,
    SlashCommandBuilder,
} from 'discord.js';
import { t } from '@/i18n/translator.ts';
import type { AppContext, Command } from '@/types/discord.ts';
import { DISCORD_ERROR_CODES, hasErrorCode, isUnknownInvite } from '@/utils/discord-errors.ts';
import { logError, logInfo, logWarn } from '@/utils/logger.ts';

const INVITE_EMBED_COLOR = 0x0099ff;

const INVITE_CAPABLE_CHANNEL_TYPES = new Set<number>([
    ChannelType.GuildText,
    ChannelType.GuildAnnouncement,
    ChannelType.GuildVoice,
    ChannelType.GuildStageVoice,
]);

function resolveInviteChannel(channel: GuildBasedChannel | null): GuildBasedChannel | null {
    if (!channel) return null;
    if (channel.isThread()) {
        const parent = channel.parent;
        if (parent && INVITE_CAPABLE_CHANNEL_TYPES.has(parent.type)) return parent;
        return null;
    }
    return INVITE_CAPABLE_CHANNEL_TYPES.has(channel.type) ? channel : null;
}

async function validateExistingInvite(
    guild: Guild,
    inviteCode: string,
    userId: string,
    logPrefix: string,
    ctx: AppContext,
): Promise<boolean> {
    try {
        await guild.invites.fetch({ code: inviteCode, force: true });
        return true;
    } catch (err) {
        if (isUnknownInvite(err)) {
            logWarn(`${logPrefix} Stored invite ${inviteCode} is gone on Discord; deleting DB record.`);
            ctx.repos.userInvites.delete(userId, guild.id, inviteCode);
        } else {
            logError(`${logPrefix} Unexpected error verifying invite ${inviteCode}:`, err);
        }
        return false;
    }
}

async function createNewInvite(
    channel: GuildBasedChannel,
    userId: string,
    username: string,
    logPrefix: string,
): Promise<Invite | null> {
    const { guild } = channel;
    const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
    if (!me) {
        logError(`${logPrefix} Could not obtain bot's GuildMember.`);
        return null;
    }
    const channelPerms = channel.permissionsFor(me);
    if (!channelPerms?.has(PermissionFlagsBits.CreateInstantInvite)) {
        logWarn(`${logPrefix} Bot lacks CreateInstantInvite in #${channel.name}.`);
        return null;
    }
    if (!('createInvite' in channel) || typeof channel.createInvite !== 'function') {
        logWarn(`${logPrefix} Channel type ${channel.type} does not support createInvite().`);
        return null;
    }
    try {
        const invite = await channel.createInvite({
            maxAge: 0,
            maxUses: 0,
            unique: true,
            reason: `Generated for ${username} (${userId}) via /invite`,
        });
        logInfo(`${logPrefix} Created new invite ${invite.code}.`);
        return invite;
    } catch (err) {
        logError(`${logPrefix} Failed to create invite:`, err);
        return null;
    }
}

export function buildInviteCommand(ctx: AppContext): Command {
    return {
        data: new SlashCommandBuilder().setName('invite').setDescription('Show your personal invite link and stats.'),
        async execute(interaction: ChatInputCommandInteraction) {
            const { user, guild, channel } = interaction;
            if (!guild || !channel || !('guild' in channel)) {
                await interaction.reply({
                    content: t('general.error_guild_only'),
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }

            const logPrefix = `[InviteCmd][Guild:${guild.id}][User:${user.id}]`;

            try {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            } catch (err) {
                logError(`${logPrefix} Failed to defer reply:`, err);
                return;
            }

            try {
                // 1. Read existing invite code, validate on Discord, create if needed.
                let inviteCode = ctx.repos.userInvites.get(user.id, guild.id)?.inviteCode ?? null;
                if (inviteCode) {
                    const stillValid = await validateExistingInvite(guild, inviteCode, user.id, logPrefix, ctx);
                    if (!stillValid) inviteCode = null;
                }
                if (!inviteCode) {
                    const targetChannel = resolveInviteChannel(channel as GuildBasedChannel);
                    if (!targetChannel) {
                        await interaction.editReply({ content: t('invite.error_invalid_channel_type') });
                        return;
                    }
                    const newInvite = await createNewInvite(targetChannel, user.id, user.username, logPrefix);
                    if (!newInvite) {
                        await interaction.editReply({
                            content: t('invite.error_permission_create', { channel_name: targetChannel.name }),
                        });
                        return;
                    }
                    ctx.repos.userInvites.upsert(user.id, guild.id, newInvite.code);
                    inviteCode = newInvite.code;
                }

                // 2. Aggregate counts.
                const validated = ctx.repos.trackedJoins.countByStatus(guild.id, user.id, 'validated');
                const pending = ctx.repos.trackedJoins.countByStatus(guild.id, user.id, 'pending');

                // 3. Build embed.
                const guildLocale = ctx.repos.guildConfig.getOrDefault(guild.id).locale;
                const embed = new EmbedBuilder()
                    .setColor(INVITE_EMBED_COLOR)
                    .setTitle(t('invite.embed_title', { username: user.username }, guildLocale))
                    .setDescription(t('invite.embed_description', { guild_name: guild.name }, guildLocale))
                    .addFields(
                        {
                            name: t('invite.link_field_name', {}, guildLocale),
                            value: `https://discord.gg/${inviteCode}`,
                        },
                        {
                            name: t('invite.validated_field_name', {}, guildLocale),
                            value: `\`${validated}\``,
                            inline: true,
                        },
                        {
                            name: t('invite.pending_field_name', {}, guildLocale),
                            value: `\`${pending}\``,
                            inline: true,
                        },
                    )
                    .setFooter({ text: t('invite.footer_success', {}, guildLocale) })
                    .setTimestamp();

                if (user.avatar) embed.setThumbnail(user.displayAvatarURL());

                await interaction.editReply({ embeds: [embed] });
                logInfo(`${logPrefix} Served invite ${inviteCode} (validated=${validated}, pending=${pending}).`);
            } catch (err) {
                logError(`${logPrefix} Critical error in /invite:`, err);
                if (hasErrorCode(err, DISCORD_ERROR_CODES.MISSING_ACCESS)) {
                    // Token-level access loss — no point editing.
                    return;
                }
                try {
                    await interaction.editReply({
                        content: t('invite.error_critical', {
                            error_message: err instanceof Error ? err.message : 'unknown',
                        }),
                        embeds: [],
                    });
                } catch (replyErr) {
                    logError(`${logPrefix} Failed to send error reply:`, replyErr);
                }
            }
        },
    };
}
