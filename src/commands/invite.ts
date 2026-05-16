import {
    ApplicationIntegrationType,
    ChannelType,
    type ChatInputCommandInteraction,
    ContainerBuilder,
    type Guild,
    type GuildBasedChannel,
    InteractionContextType,
    type Invite,
    MessageFlags,
    PermissionFlagsBits,
    SeparatorSpacingSize,
    SlashCommandBuilder,
} from 'discord.js';
import { EMBED_COLORS } from '@/config/constants.ts';
import { t } from '@/i18n/translator.ts';
import type { AppContext, Command } from '@/types/discord.ts';
import { DISCORD_ERROR_CODES, hasErrorCode, isUnknownInvite } from '@/utils/discord-errors.ts';
import { getErrorMessage } from '@/utils/errors.ts';
import { logError, logInfo, logWarn } from '@/utils/logger.ts';

/** Tiny helper: wrap a plain text string as a Components v2 Container, so editReply works under IsComponentsV2. */
function plainTextContainer(message: string, accentColor: number): ContainerBuilder {
    return new ContainerBuilder().setAccentColor(accentColor).addTextDisplayComponents((td) => td.setContent(message));
}

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
        data: new SlashCommandBuilder()
            .setName('invite')
            .setDescription('Show your personal invite link and stats.')
            .setContexts(InteractionContextType.Guild)
            .setIntegrationTypes(ApplicationIntegrationType.GuildInstall),
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
                // Defer with Components v2 + Ephemeral combined. Cast around discord.js@14.26.4
                // type bug — `InteractionDeferReplyOptions.flags` is typed as `Ephemeral` only,
                // but the runtime accepts `IsComponentsV2 | Ephemeral`. The cast does not change
                // behaviour, only silences a misleading compile-time error.
                await interaction.deferReply({
                    flags: (MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral) as MessageFlags.Ephemeral,
                });
            } catch (err) {
                logError(`${logPrefix} Failed to defer reply:`, err);
                return;
            }

            const guildLocale = ctx.repos.guildConfig.getLocale(guild.id);

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
                        await interaction.editReply({
                            components: [plainTextContainer(t('invite.error_invalid_channel_type'), 0xed4245)],
                        });
                        return;
                    }
                    const newInvite = await createNewInvite(targetChannel, user.id, user.username, logPrefix);
                    if (!newInvite) {
                        await interaction.editReply({
                            components: [
                                plainTextContainer(
                                    t('invite.error_permission_create', { channel_name: targetChannel.name }),
                                    0xed4245,
                                ),
                            ],
                        });
                        return;
                    }
                    ctx.repos.userInvites.upsert(user.id, guild.id, newInvite.code);
                    inviteCode = newInvite.code;
                }

                // 2. Aggregate counts.
                const validated = ctx.repos.trackedJoins.countByStatus(guild.id, user.id, 'validated');
                const pending = ctx.repos.trackedJoins.countByStatus(guild.id, user.id, 'pending');

                // 3. Build Components v2 container.
                const container = new ContainerBuilder()
                    .setAccentColor(EMBED_COLORS.invite)
                    .addTextDisplayComponents((td) =>
                        td.setContent(`## 🔗 ${t('invite.embed_title', { username: user.username }, guildLocale)}`),
                    )
                    .addTextDisplayComponents((td) =>
                        td.setContent(t('invite.embed_description', { guild_name: guild.name }, guildLocale)),
                    )
                    .addSeparatorComponents((s) => s.setSpacing(SeparatorSpacingSize.Small))
                    .addTextDisplayComponents((td) =>
                        td.setContent(
                            `**${t('invite.link_field_name', {}, guildLocale)}** https://discord.gg/${inviteCode}`,
                        ),
                    )
                    .addTextDisplayComponents((td) =>
                        td.setContent(
                            `✅ **${t('invite.validated_field_name', {}, guildLocale)}** \`${validated}\` · ⏳ **${t('invite.pending_field_name', {}, guildLocale)}** \`${pending}\``,
                        ),
                    )
                    .addSeparatorComponents((s) => s.setSpacing(SeparatorSpacingSize.Small))
                    .addTextDisplayComponents((td) =>
                        td.setContent(`-# ${t('invite.footer_success', {}, guildLocale)}`),
                    );

                await interaction.editReply({ components: [container] });
                logInfo(`${logPrefix} Served invite ${inviteCode} (validated=${validated}, pending=${pending}).`);
            } catch (err) {
                logError(`${logPrefix} Critical error in /invite:`, err);
                if (hasErrorCode(err, DISCORD_ERROR_CODES.MISSING_ACCESS)) {
                    // Token-level access loss — no point editing.
                    return;
                }
                try {
                    await interaction.editReply({
                        components: [
                            plainTextContainer(
                                t('invite.error_critical', {
                                    error_message: getErrorMessage(err),
                                }),
                                0xed4245,
                            ),
                        ],
                    });
                } catch (replyErr) {
                    logError(`${logPrefix} Failed to send error reply:`, replyErr);
                }
            }
        },
    };
}
