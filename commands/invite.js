/**
 * @file commands/invite.js
 * @description Slash command to display a user's personal invite link, their validated invite count,
 * and their pending invite count. If the user doesn't have a link, or their existing link is
 * invalid, a new permanent, unlimited-use invite link is generated and stored.
 */

'use strict';

const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField, DiscordAPIError, ChannelType } = require('discord.js');
const db = require('../database/db');
const config = require('../config');
const { logDebug, logInfo, logWarn, logError } = require('../utils/logger');

const INVITE_COMMAND_CONFIG = config.inviteCommand;

const DISCORD_ERROR_CODES = {
    UNKNOWN_INVITE: 10006,
    MISSING_PERMISSIONS: 50013,
};

// Channel types where Discord allows creating invites
const INVITE_CAPABLE_CHANNEL_TYPES = new Set([
    ChannelType.GuildText,
    ChannelType.GuildAnnouncement,
    ChannelType.GuildVoice,
    ChannelType.GuildStageVoice,
]);

// --- Helper Functions ---

/**
 * Checks if the stored invite code is still valid on Discord.
 * Deletes the invite from the DB if it's invalid on Discord.
 */
async function _validateExistingInvite(guild, inviteCode, userId, logPrefix) {
    try {
        await guild.invites.fetch({ code: inviteCode, force: true });
        return true;
    } catch (error) {
        if (error instanceof DiscordAPIError && error.code === DISCORD_ERROR_CODES.UNKNOWN_INVITE) {
            logWarn(`${logPrefix} Stored invite code ${inviteCode} is invalid/deleted on Discord. Removing DB record.`);
            try {
                db.userInvites.delete(userId, guild.id, inviteCode);
            } catch (dbDelError) {
                logError(`${logPrefix} Failed to delete invalid invite ${inviteCode} from DB:`, dbDelError);
            }
        } else {
            logError(`${logPrefix} Unexpected error verifying stored invite ${inviteCode}:`, error);
        }
        return false;
    }
}

/**
 * Resolves the best channel to create an invite in.
 * For threads/forums, returns the parent channel. Returns null if no suitable channel found.
 */
function _resolveInviteChannel(channel, logPrefix) {
    if (!channel) return null;

    // Threads don't support invites — use parent channel
    if (channel.isThread()) {
        const parent = channel.parent;
        if (parent && INVITE_CAPABLE_CHANNEL_TYPES.has(parent.type)) {
            logDebug(`${logPrefix} Channel is a thread; using parent channel ${parent.id} for invite creation.`);
            return parent;
        }
        logWarn(`${logPrefix} Thread's parent channel is unavailable or not invite-capable.`);
        return null;
    }

    if (INVITE_CAPABLE_CHANNEL_TYPES.has(channel.type)) return channel;

    logWarn(`${logPrefix} Channel type ${channel.type} is not invite-capable.`);
    return null;
}

/**
 * Creates a new permanent, unlimited invite link in the specified channel.
 */
async function _createNewDiscordInvite(channel, user, logPrefix) {
    const { guild } = channel;
    const botMember = guild.members.me ?? await guild.members.fetchMe().catch(err => {
        logError(`${logPrefix} Failed to fetch bot member object:`, err);
        return null;
    });

    if (!botMember) {
        logError(`${logPrefix} Could not obtain bot member object.`);
        return null;
    }

    const channelPermissions = channel.permissionsFor(botMember);
    if (!channelPermissions?.has(PermissionsBitField.Flags.CreateInstantInvite)) {
        logWarn(`${logPrefix} Bot lacks CreateInstantInvite permission in channel ${channel.id} (${channel.name}).`);
        return null;
    }

    try {
        const newInvite = await channel.createInvite({
            maxAge: 0,    // Permanent
            maxUses: 0,   // Unlimited uses
            unique: true,
            reason: `Generated for user ${user.username} (${user.id}) via /invite command`,
        });
        logInfo(`${logPrefix} Successfully created new Discord invite: ${newInvite.code}`);
        return newInvite;
    } catch (error) {
        logError(`${logPrefix} Failed to create Discord invite:`, error);
        return null;
    }
}

/**
 * Saves or updates the user's invite code in the database.
 */
async function _saveInviteToDatabase(guildId, userId, inviteCode, logPrefix) {
    try {
        db.userInvites.upsert(userId, guildId, inviteCode);
        logInfo(`${logPrefix} Saved/updated invite code ${inviteCode} for user ${userId}.`);
        return true;
    } catch (dbError) {
        logError(`${logPrefix} Database error saving invite code ${inviteCode}:`, dbError);
        return false;
    }
}

/**
 * Retrieves or creates and validates a user's invite link.
 */
async function _getOrCreateInvite(interaction, guildId, userId, logPrefix, t) {
    const { guild, channel, user } = interaction;

    // 1. Check DB for existing invite
    let userInviteDoc = null;
    try {
        userInviteDoc = db.userInvites.get(userId, guildId);
    } catch (err) {
        logError(`${logPrefix} DB Error fetching UserInvite:`, err);
    }
    let inviteCode = userInviteDoc?.inviteCode;
    let needsNewInvite = !inviteCode;

    // 2. Validate existing invite on Discord if found
    if (inviteCode) {
        const isValidOnDiscord = await _validateExistingInvite(guild, inviteCode, userId, logPrefix);
        if (!isValidOnDiscord) {
            inviteCode = null;
            needsNewInvite = true;
        }
    }

    // 3. Create new invite if necessary
    if (needsNewInvite) {
        logInfo(`${logPrefix} No valid invite exists. Attempting to create one...`);

        const targetChannel = _resolveInviteChannel(channel, logPrefix);
        if (!targetChannel) {
            await interaction.editReply({ content: t('invite.error_invalid_channel_type'), ephemeral: true });
            return null;
        }

        const newInvite = await _createNewDiscordInvite(targetChannel, user, logPrefix);
        if (!newInvite) {
            const botMember = guild.members.me;
            const channelPermissions = botMember ? targetChannel.permissionsFor(botMember) : null;
            if (!channelPermissions?.has(PermissionsBitField.Flags.CreateInstantInvite)) {
                await interaction.editReply({ content: t('invite.error_permission_create', { channel_name: targetChannel.name }), ephemeral: true });
            } else {
                await interaction.editReply({ content: t('invite.error_failed_create_save'), ephemeral: true });
            }
            return null;
        }

        // 4. Save the new invite to the database
        const saved = await _saveInviteToDatabase(guildId, userId, newInvite.code, logPrefix);
        if (!saved) {
            await interaction.editReply({ content: t('invite.error_failed_create_save'), ephemeral: true });
            return null;
        }
        inviteCode = newInvite.code;
    }

    return inviteCode;
}

/**
 * Fetches the validated and pending invite counts for a user.
 */
async function _fetchInviteCounts(guildId, userId, logPrefix) {
    let validatedCount = 0;
    let pendingCount = 0;
    let errorOccurred = false;

    try {
        validatedCount = db.trackedJoins.countByStatus(guildId, userId, 'validated');
    } catch (dbError) {
        logError(`${logPrefix} Failed to query validated join count:`, dbError);
        errorOccurred = true;
    }

    try {
        pendingCount = db.trackedJoins.countByStatus(guildId, userId, 'pending');
    } catch (dbError) {
        logError(`${logPrefix} Failed to query pending join count:`, dbError);
        errorOccurred = true;
    }

    return { validatedCount, pendingCount, error: errorOccurred };
}

/**
 * Builds the response embed for the /invite command.
 */
function _buildInviteEmbed(user, guild, inviteCode, counts, t) {
    const embed = new EmbedBuilder()
        .setColor(INVITE_COMMAND_CONFIG.embedColor)
        .setTitle(t('invite.embed_title', { username: user.username }))
        .setDescription(t('invite.embed_description', { guild_name: guild.name }))
        .addFields(
            { name: t('invite.link_field_name'), value: inviteCode ? `https://discord.gg/${inviteCode}` : t('invite.error_no_link') },
            { name: t('invite.validated_field_name'), value: `\`${counts.validatedCount}\``, inline: true },
            { name: t('invite.pending_field_name'), value: `\`${counts.pendingCount}\``, inline: true }
        )
        .setFooter({ text: counts.error ? t('invite.footer_db_error') : t('invite.footer_success') })
        .setTimestamp();

    if (user.avatar) embed.setThumbnail(user.displayAvatarURL());

    return embed;
}

// --- Command Definition ---

module.exports = {
    data: new SlashCommandBuilder()
        .setName('invite')
        .setDescription('Shows your invite link, validated count (stayed > 1 week), and pending count.'),

    async execute(interaction) {
        const { user, guild, channel } = interaction;
        const logPrefix = `[InviteCmd][Guild:${guild?.id ?? 'N/A'}][User:${user.id}]`;
        const t = interaction.client.t;

        // --- 1. Initial Validation ---
        if (!guild || !channel) {
            logWarn(`${logPrefix} Command used outside of a guild channel.`);
            return interaction.reply({ content: t('general.error_guild_only'), ephemeral: true });
        }

        // --- 2. Defer Reply ---
        try {
            await interaction.deferReply({ ephemeral: true });
        } catch (deferError) {
            logError(`${logPrefix} Failed to defer reply:`, deferError);
            try {
                await interaction.reply({ content: t('invite.error_start_command'), ephemeral: true });
            } catch { /* interaction likely expired */ }
            return;
        }

        try {
            const userId = user.id;
            const guildId = guild.id;

            // --- 3. Get or Create Invite Code ---
            const inviteCode = await _getOrCreateInvite(interaction, guildId, userId, logPrefix, t);
            if (!inviteCode) return; // Error already sent inside _getOrCreateInvite

            // --- 4. Fetch Invite Counts ---
            const counts = await _fetchInviteCounts(guildId, userId, logPrefix);

            // --- 5. Build and Send Response ---
            const embed = _buildInviteEmbed(user, guild, inviteCode, counts, t);
            await interaction.editReply({ embeds: [embed] });
            logInfo(`${logPrefix} Successfully processed /invite for user ${user.username}.`);

        } catch (error) {
            logError(`${logPrefix} Critical error executing /invite:`, error);
            const userErrorMessage = t('invite.error_critical', { error_message: error.message || 'Unknown error' });
            try {
                if (interaction.deferred && !interaction.replied) {
                    await interaction.editReply({ content: userErrorMessage, embeds: [], ephemeral: true });
                } else {
                    await interaction.followUp({ content: userErrorMessage, ephemeral: true });
                }
            } catch (editError) {
                logError(`${logPrefix} Failed to send error reply:`, editError);
            }
        }
    },
};