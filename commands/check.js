/**
 * @file commands/check.js
 * @description Admin-only slash command to check the invite statistics (validated and pending) for a specific user.
 * Reads multiple admin IDs from the ADMIN_IDS environment variable (comma-separated).
 */

'use strict';

const { SlashCommandBuilder, EmbedBuilder, MessageFlags, InteractionContextType } = require('discord.js');
const db = require('../database/db');
const config = require('../config');
const { logInfo, logWarn, logError } = require('../utils/logger');

const CHECK_COMMAND_CONFIG = config.inviteCommand;

// Parse admin IDs once at module load
const ADMIN_IDS = (process.env.ADMIN_IDS ?? '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);

// --- Helper Functions ---

/**
 * Validates if the command context is appropriate (Designated Admin user, in a guild).
 */
async function _validateAdminContext(interaction, logPrefix) {
    const { user, guild } = interaction;
    const t = interaction.client.t;

    if (ADMIN_IDS.length === 0) {
        logWarn(`${logPrefix} Attempted use, but ADMIN_IDS is not set or empty in .env.`);
        await interaction.reply({ content: t('check.error_admin_id_not_set'), flags: MessageFlags.Ephemeral });
        return false;
    }
    if (!ADMIN_IDS.includes(user.id)) {
        logWarn(`${logPrefix} Unauthorized use attempt by User:${user.id}. User not in ADMIN_IDS.`);
        await interaction.reply({ content: t('check.error_permission_admin'), flags: MessageFlags.Ephemeral });
        return false;
    }
    if (!guild) {
        logWarn(`${logPrefix} Command used outside of a guild channel.`);
        await interaction.reply({ content: t('general.error_guild_only'), flags: MessageFlags.Ephemeral });
        return false;
    }
    return true;
}

/**
 * Fetches the invite code and counts (validated, pending) for the target user.
 */
async function _fetchUserInviteStats(guildId, targetUserId, logPrefix) {
    let inviteCode = null;
    let validatedCount = 0;
    let pendingCount = 0;
    let dbErrorOccurred = false;

    try {
        const userInviteDoc = db.userInvites.get(targetUserId, guildId);
        inviteCode = userInviteDoc?.inviteCode;

        if (!inviteCode) {
            logInfo(`${logPrefix} Target user ${targetUserId} has no bot-generated invite in this guild.`);
            return { inviteCode: null, validatedCount: 0, pendingCount: 0, error: false };
        }

        try {
            validatedCount = db.trackedJoins.countByStatus(guildId, targetUserId, 'validated');
        } catch (dbCountError) {
            logError(`${logPrefix} DB Error counting validated joins for TargetUser:${targetUserId}:`, dbCountError);
            dbErrorOccurred = true;
        }

        try {
            pendingCount = db.trackedJoins.countByStatus(guildId, targetUserId, 'pending');
        } catch (dbCountError) {
            logError(`${logPrefix} DB Error counting pending joins for TargetUser:${targetUserId}:`, dbCountError);
            dbErrorOccurred = true;
        }

    } catch (fetchError) {
        logError(`${logPrefix} Critical DB Error fetching UserInvite for TargetUser:${targetUserId}:`, fetchError);
        dbErrorOccurred = true;
        inviteCode = null;
        validatedCount = 0;
        pendingCount = 0;
    }

    return { inviteCode, validatedCount, pendingCount, error: dbErrorOccurred };
}

/**
 * Builds the response embed for the /check command.
 */
function _buildCheckEmbed(targetUser, guild, stats, requesterUsername, t) {
    const embed = new EmbedBuilder()
        .setColor(CHECK_COMMAND_CONFIG.embedColor)
        .setTitle(t('check.embed_title', { username: targetUser.username }))
        .setDescription(t('check.embed_description', { user_tag: targetUser.username, guild_name: guild.name }))
        .addFields(
            {
                name: t('check.link_field_name'),
                value: stats.inviteCode
                    ? `https://discord.gg/${stats.inviteCode}`
                    : t('check.error_no_invite_value', { user_tag: targetUser.username }),
            },
            { name: t('check.validated_field_name'), value: `\`${stats.validatedCount}\``, inline: true },
            { name: t('check.pending_field_name'), value: `\`${stats.pendingCount}\``, inline: true }
        )
        .setFooter({
            text: stats.error
                ? t('check.footer_db_error', { admin_tag: requesterUsername })
                : t('check.footer_success', { admin_tag: requesterUsername }),
        })
        .setTimestamp();

    if (targetUser.avatar) embed.setThumbnail(targetUser.displayAvatarURL());

    return embed;
}

/**
 * Safely edits or replies to an interaction after deferral.
 */
async function _sendSafeReply(interaction, options, logPrefix) {
    try {
        const replyOptions = typeof options === 'string' ? { content: options, flags: MessageFlags.Ephemeral } : options;
        if (interaction.replied || interaction.deferred) {
            await interaction.editReply(replyOptions);
        } else {
            logWarn(`${logPrefix} Replying directly without prior deferral.`);
            await interaction.reply(replyOptions);
        }
    } catch (replyError) {
        logError(`${logPrefix} Failed to send or edit reply:`, replyError);
        if (interaction.deferred && !interaction.replied) {
            try {
                await interaction.followUp(typeof options === 'string' ? { content: options, flags: MessageFlags.Ephemeral } : options);
            } catch (followUpError) {
                logError(`${logPrefix} Failed to follow up after editReply failure:`, followUpError);
            }
        }
    }
}

// --- Command Definition ---

module.exports = {
    data: new SlashCommandBuilder()
        .setName('check')
        .setDescription('[Admin Only] Checks invite stats (validated/pending) for a specific user.')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user whose invite stats you want to check.')
                .setRequired(true))
        .setContexts(InteractionContextType.Guild),

    async execute(interaction) {
        const { user, guild, options } = interaction;
        const logPrefix = `[CheckCmd][Guild:${guild.id}][Admin:${user.id}]`;
        const t = interaction.client.t;

        // --- 1. Validation ---
        if (!await _validateAdminContext(interaction, logPrefix)) return;

        // --- 2. Deferral ---
        try {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        } catch (deferError) {
            logError(`${logPrefix} Failed to defer reply:`, deferError);
            try {
                await interaction.reply({ content: t('check.error_start_command'), flags: MessageFlags.Ephemeral });
            } catch { /* interaction likely expired */ }
            return;
        }

        // --- 3. Target User Retrieval ---
        const targetUser = options.getUser('user', true);
        if (!targetUser) {
            logError(`${logPrefix} Target user option was somehow missing despite being required.`);
            await _sendSafeReply(interaction, { content: t('check.error_user_retrieve'), flags: MessageFlags.Ephemeral }, logPrefix);
            return;
        }

        const targetUserId = targetUser.id;
        const guildId = guild.id;
        logInfo(`${logPrefix} Admin ${user.username} checking stats for TargetUser:${targetUserId} (${targetUser.username}).`);

        // --- 4. Main Logic ---
        try {
            const stats = await _fetchUserInviteStats(guildId, targetUserId, logPrefix);

            const embed = _buildCheckEmbed(targetUser, guild, stats, user.username, t);
            await _sendSafeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral }, logPrefix);
            logInfo(`${logPrefix} Stats for TargetUser:${targetUserId}. Validated: ${stats.validatedCount}, Pending: ${stats.pendingCount}, DB Error: ${stats.error}`);

        } catch (error) {
            logError(`${logPrefix} Critical error during /check for TargetUser:${targetUserId}:`, error);
            const userErrorMessage = t('check.error_critical', {
                user_tag: targetUser.username,
                error_message: error.message || 'Unknown error',
            });
            await _sendSafeReply(interaction, { content: userErrorMessage, embeds: [], flags: MessageFlags.Ephemeral }, logPrefix);
        }
    },
};