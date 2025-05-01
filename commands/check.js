/**
 * @file commands/check.js
 * @description Admin-only slash command to check the invite statistics (validated and pending) for a specific user.
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const UserInvite = require('../database/models/UserInvite');
const TrackedJoin = require('../database/models/TrackedJoin');
const config = require('../config');
require('dotenv').config(); // Ensure .env variables are loaded

// Configuration for the embed color
const CHECK_COMMAND_CONFIG = config.inviteCommand; // Or define config.checkCommand

// Get the designated Admin ID from environment variables
const ADMIN_USER_ID = process.env.ADMIN_ID;

// --- Helper Functions ---

/**
 * Validates if the command context is appropriate (Admin user, in a guild).
 * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object.
 * @param {string} logPrefix - Prefix for logging.
 * @returns {boolean} True if the context is valid, false otherwise. Replies with error internally.
 */
async function _validateAdminContext(interaction, logPrefix) {
    const { user, guild } = interaction;
    const t = interaction.client.t;

    if (!ADMIN_USER_ID) {
        console.warn(`${logPrefix} Attempted use, but ADMIN_ID is not set.`);
        await interaction.reply({ content: t('check.error_admin_id_not_set'), ephemeral: true });
        return false;
    }
    if (user.id !== ADMIN_USER_ID) {
        console.warn(`${logPrefix} Unauthorized use attempt by User:${user.id}.`);
        await interaction.reply({ content: t('check.error_permission_admin'), ephemeral: true });
        return false;
    }
    if (!guild) {
        console.warn(`${logPrefix} Command used outside of a guild channel.`);
        await interaction.reply({ content: t('general.error_guild_only'), ephemeral: true });
        return false;
    }
    return true;
}

/**
 * Fetches the invite code and counts for the target user.
 * @param {string} guildId - The ID of the guild.
 * @param {string} targetUserId - The ID of the user to check.
 * @param {string} logPrefix - Prefix for logging.
 * @returns {Promise<{inviteCode: string|null, validatedCount: number, pendingCount: number, error: boolean}>} The stats or nulls on error.
 */
async function _fetchUserInviteStats(guildId, targetUserId, logPrefix) {
    let inviteCode = null;
    let validatedCount = 0;
    let pendingCount = 0;
    let errorOccurred = false;

    try {
        // Find Invite Code
        const userInviteDoc = await UserInvite.findOne({ userId: targetUserId, guildId }).lean();
        inviteCode = userInviteDoc?.inviteCode;

        if (!inviteCode) {
            console.log(`${logPrefix} Target user ${targetUserId} does not have a tracked invite code.`);
            // Return early, inviteCode is already null, error handled in execute
            return { inviteCode: null, validatedCount: 0, pendingCount: 0, error: false }; // Not an error, just no invite
        }

        // Get Validated Count
        try {
            validatedCount = await TrackedJoin.countDocuments({ guildId, inviterId: targetUserId, status: 'validated' });
        } catch (dbError) {
            console.error(`${logPrefix} Failed to query validated join count for TargetUser:${targetUserId}:`, dbError);
            errorOccurred = true; // Mark that a DB error happened
        }

        // Get Pending Count
        try {
            pendingCount = await TrackedJoin.countDocuments({ guildId, inviterId: targetUserId, status: 'pending' });
        } catch (dbError) {
            console.error(`${logPrefix} Failed to query pending join count for TargetUser:${targetUserId}:`, dbError);
            errorOccurred = true; // Mark that a DB error happened
        }

    } catch (fetchError) {
        console.error(`${logPrefix} Error fetching initial UserInvite for TargetUser:${targetUserId}:`, fetchError);
        errorOccurred = true; // Mark that a critical DB error happened
        inviteCode = null; // Ensure inviteCode is null on critical error
    }

    return { inviteCode, validatedCount, pendingCount, error: errorOccurred };
}

/**
 * Builds the response embed.
 * @param {import('discord.js').User} targetUser - The user being checked.
 * @param {import('discord.js').Guild} guild - The guild context.
 * @param {object} stats - The fetched stats object from _fetchUserInviteStats.
 * @param {string} requesterTag - The tag of the admin running the command.
 * @param {function} t - The translator function.
 * @returns {EmbedBuilder} The constructed embed.
 */
function _buildCheckEmbed(targetUser, guild, stats, requesterTag, t) {
    const embed = new EmbedBuilder()
        .setColor(CHECK_COMMAND_CONFIG.embedColor)
        .setTitle(t('check.embed_title', { username: targetUser.username }))
        .setDescription(t('check.embed_description', { user_tag: targetUser.tag, guild_name: guild.name }))
        .addFields(
            { name: t('check.link_field_name'), value: stats.inviteCode ? `https://discord.gg/${stats.inviteCode}` : t('check.error_no_invite', { user_tag: targetUser.tag }) }, // Handle no invite case here
            { name: t('check.validated_field_name'), value: `\`${stats.validatedCount}\``, inline: true },
            { name: t('check.pending_field_name'), value: `\`${stats.pendingCount}\``, inline: true }
        )
        .setFooter({ text: stats.error ? t('check.footer_db_error', { admin_tag: requesterTag }) : t('check.footer_success', { admin_tag: requesterTag }) })
        .setTimestamp();

    if (targetUser.avatar) {
        embed.setThumbnail(targetUser.displayAvatarURL());
    }
    return embed;
}

/**
 * Safely replies or follows up to an interaction.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object.
 * @param {import('discord.js').InteractionReplyOptions} options - The reply options (content, embeds, ephemeral).
 * @param {string} logPrefix - Prefix for logging.
 */
async function _sendSafeReply(interaction, options, logPrefix) {
     try {
         if (interaction.replied || interaction.deferred) {
             await interaction.editReply(options);
         } else {
             await interaction.reply(options); // Should ideally not happen if deferred first
         }
     } catch (replyError) {
         console.error(`${logPrefix} Failed to send final reply/edit:`, replyError);
         // Attempt followUp as last resort if edit fails after deferral
         if (interaction.deferred && !interaction.replied) {
             try {
                 await interaction.followUp(options);
             } catch (followUpError) {
                 console.error(`${logPrefix} Failed to follow up after editReply failure:`, followUpError);
             }
         }
     }
}

// --- Command Definition ---

module.exports = {
    data: new SlashCommandBuilder()
        .setName('check')
        .setDescription('[Admin Only] Checks validated and pending invite counts for a specific user.')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user whose invite stats you want to check.')
                .setRequired(true))
        // .setDefaultMemberPermissions(...) // Keeping internal ID check as primary
        ,

    async execute(interaction) {
        const { user, guild, options } = interaction; // Guild will be non-null due to validation
        const logPrefix = `[CheckCmd][Guild:${guild?.id ?? 'N/A'}][Admin:${user.id}]`;
        const t = interaction.client.t;

        // --- Validation ---
        if (!await _validateAdminContext(interaction, logPrefix)) {
            return; // Validation failed, error reply already sent
        }

        // --- Deferral ---
        try {
            await interaction.deferReply({ ephemeral: true });
        } catch (deferError) {
            console.error(`${logPrefix} Failed to defer reply:`, deferError);
            // Attempt direct reply if defer fails (ephemeral might be lost)
            try {
                await interaction.reply({ content: t('check.error_start_command'), ephemeral: true });
            } catch (replyError) {
                console.error(`${logPrefix} Failed to send fallback reply after deferral failure:`, replyError);
            }
            return;
        }

        // --- Target User Retrieval ---
        const targetUser = options.getUser('user');
        if (!targetUser) {
            console.error(`${logPrefix} Target user option was somehow missing despite being required.`);
            await _sendSafeReply(interaction, { content: t('check.error_user_retrieve'), ephemeral: true }, logPrefix);
            return;
        }
        const targetUserId = targetUser.id;
        const guildId = guild.id; // Safe to use guild.id now
        console.log(`${logPrefix} Checking invite stats for TargetUser:${targetUserId} (${targetUser.tag}).`);

        // --- Main Logic ---
        try {
            // --- Fetch Stats ---
            const stats = await _fetchUserInviteStats(guildId, targetUserId, logPrefix);

            // Handle case where user has no invite link specifically
            if (!stats.inviteCode && !stats.error) {
                 // Invite code is null, but no DB error occurred during the check
                 console.log(`${logPrefix} Target user ${targetUserId} does not have a tracked invite.`);
                 await _sendSafeReply(interaction, { content: t('check.error_no_invite', { user_tag: targetUser.tag }), ephemeral: true }, logPrefix);
                 return; // Stop execution, message sent
            }

            // --- Build and Send Response ---
            const embed = _buildCheckEmbed(targetUser, guild, stats, user.tag, t);
            await _sendSafeReply(interaction, { embeds: [embed], ephemeral: true }, logPrefix);
            console.log(`${logPrefix} Successfully displayed stats for TargetUser:${targetUserId}.`);

        } catch (error) {
            // Catch unexpected errors during the process (e.g., in embed building, though unlikely)
            console.error(`${logPrefix} Critical error executing /check command for TargetUser:${targetUserId}:`, error);
            const userErrorMessage = t('check.error_critical', { user_tag: targetUser.tag, error_message: error.message || 'Unknown error' });
            await _sendSafeReply(interaction, { content: userErrorMessage, embeds: [], ephemeral: true }, logPrefix);
        }
    },
};