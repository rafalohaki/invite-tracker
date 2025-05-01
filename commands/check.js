/**
 * @file commands/check.js
 * @description Admin-only slash command to check the invite statistics (validated and pending) for a specific user.
 * Reads multiple admin IDs from the ADMIN_IDS environment variable (comma-separated).
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const UserInvite = require('../database/models/UserInvite');
const TrackedJoin = require('../database/models/TrackedJoin');
const config = require('../config');
require('dotenv').config(); // Ensure .env variables are loaded FIRST

// Configuration for the embed color (using invite's config for consistency)
const CHECK_COMMAND_CONFIG = config.inviteCommand;

// Get the designated Admin IDs from environment variables
const ADMIN_IDS_STRING = process.env.ADMIN_IDS;
const ADMIN_IDS = ADMIN_IDS_STRING ? ADMIN_IDS_STRING.split(',').map(id => id.trim()).filter(id => id) : []; // Split, trim, remove empty

// --- Helper Functions ---

/**
 * Validates if the command context is appropriate (Designated Admin user, in a guild).
 * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object.
 * @param {string} logPrefix - Prefix for logging.
 * @returns {boolean} True if the context is valid, false otherwise. Replies with error internally.
 */
async function _validateAdminContext(interaction, logPrefix) {
    const { user, guild } = interaction;
    const t = interaction.client.t; // Access translator from client

    if (ADMIN_IDS.length === 0) {
        console.warn(`${logPrefix} Attempted use, but ADMIN_IDS is not set or empty in .env.`);
        await interaction.reply({ content: t('check.error_admin_id_not_set'), ephemeral: true });
        return false;
    }
    if (!ADMIN_IDS.includes(user.id)) {
        console.warn(`${logPrefix} Unauthorized use attempt by User:${user.id}. User not in ADMIN_IDS.`);
        await interaction.reply({ content: t('check.error_permission_admin'), ephemeral: true });
        return false;
    }
    if (!guild) {
        // This check might be redundant if command is guild-only, but good practice
        console.warn(`${logPrefix} Command used outside of a guild channel.`);
        await interaction.reply({ content: t('general.error_guild_only'), ephemeral: true });
        return false;
    }
    return true;
}

/**
 * Fetches the invite code and counts (validated, pending) for the target user.
 * @param {string} guildId - The ID of the guild.
 * @param {string} targetUserId - The ID of the user to check.
 * @param {string} logPrefix - Prefix for logging.
 * @returns {Promise<{inviteCode: string|null, validatedCount: number, pendingCount: number, error: boolean}>} The stats or nulls/zeros on error/no invite.
 */
async function _fetchUserInviteStats(guildId, targetUserId, logPrefix) {
    let inviteCode = null;
    let validatedCount = 0;
    let pendingCount = 0;
    let dbErrorOccurred = false; // Track if any DB operation failed

    try {
        // 1. Find Invite Code from UserInvite collection
        const userInviteDoc = await UserInvite.findOne({ userId: targetUserId, guildId }).lean();
        inviteCode = userInviteDoc?.inviteCode;

        if (!inviteCode) {
            console.log(`${logPrefix} Target user ${targetUserId} does not have a bot-generated invite code in this guild.`);
            // Not necessarily an error, just no data. Return defaults.
            return { inviteCode: null, validatedCount: 0, pendingCount: 0, error: false };
        }

        // 2. Get Validated Count from TrackedJoin collection
        try {
            validatedCount = await TrackedJoin.countDocuments({
                guildId: guildId,
                inviterId: targetUserId, // Count joins where the TARGET user was the inviter
                status: 'validated'
            });
        } catch (dbCountError) {
            console.error(`${logPrefix} DB Error counting validated joins for TargetUser:${targetUserId}:`, dbCountError);
            dbErrorOccurred = true; // Mark that a DB error happened
        }

        // 3. Get Pending Count from TrackedJoin collection
        try {
            pendingCount = await TrackedJoin.countDocuments({
                guildId: guildId,
                inviterId: targetUserId, // Count joins where the TARGET user was the inviter
                status: 'pending'
            });
        } catch (dbCountError) {
            console.error(`${logPrefix} DB Error counting pending joins for TargetUser:${targetUserId}:`, dbCountError);
            dbErrorOccurred = true; // Mark that a DB error happened
        }

    } catch (fetchError) {
        // Catch errors during the initial UserInvite fetch
        console.error(`${logPrefix} Critical DB Error fetching UserInvite for TargetUser:${targetUserId}:`, fetchError);
        dbErrorOccurred = true; // Mark that a critical DB error happened
        inviteCode = null; // Ensure inviteCode is null on critical error
        validatedCount = 0; // Reset counts on critical error
        pendingCount = 0;
    }

    return { inviteCode, validatedCount, pendingCount, error: dbErrorOccurred };
}

/**
 * Builds the response embed for the /check command.
 * @param {import('discord.js').User} targetUser - The user being checked.
 * @param {import('discord.js').Guild} guild - The guild context.
 * @param {object} stats - The fetched stats object {inviteCode, validatedCount, pendingCount, error}.
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
            // Field for Invite Link (shows error message if no link found)
            {
                name: t('check.link_field_name'),
                value: stats.inviteCode
                    ? `https://discord.gg/${stats.inviteCode}`
                    : t('check.error_no_invite_value', { user_tag: targetUser.tag }) // Use a specific key for the *value* when no invite
            },
            // Fields for Counts
            { name: t('check.validated_field_name'), value: `\`${stats.validatedCount}\``, inline: true },
            { name: t('check.pending_field_name'), value: `\`${stats.pendingCount}\``, inline: true }
        )
        // Footer indicates potential DB errors or success
        .setFooter({
            text: stats.error
                ? t('check.footer_db_error', { admin_tag: requesterTag })
                : t('check.footer_success', { admin_tag: requesterTag })
        })
        .setTimestamp();

    // Add thumbnail if user has an avatar
    if (targetUser.displayAvatarURL()) { // Check if URL is valid/exists
        embed.setThumbnail(targetUser.displayAvatarURL());
    }

    return embed;
}

/**
 * Safely replies or edits the reply to an interaction. Handles deferrals.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object.
 * @param {import('discord.js').InteractionReplyOptions | string} options - Reply options or content string.
 * @param {string} logPrefix - Prefix for logging.
 */
async function _sendSafeReply(interaction, options, logPrefix) {
     try {
        // Ensure options is an object if it's just a string
        const replyOptions = typeof options === 'string' ? { content: options, ephemeral: true } : options;

         if (interaction.replied || interaction.deferred) {
             await interaction.editReply(replyOptions);
         } else {
             // This path shouldn't normally be hit if we always defer first
             console.warn(`${logPrefix} Attempting to reply directly without prior deferral.`);
             await interaction.reply(replyOptions);
         }
     } catch (replyError) {
         console.error(`${logPrefix} Failed to send or edit reply:`, replyError);
         // Attempt followUp as a last resort if editReply failed after deferral
         if (interaction.deferred && !interaction.replied) {
             try {
                 await interaction.followUp(typeof options === 'string' ? { content: options, ephemeral: true } : options);
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
        .setDescription('[Admin Only] Checks invite stats (validated/pending) for a specific user.')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user whose invite stats you want to check.')
                .setRequired(true))
        // We use internal ID check, so default permissions aren't strictly needed,
        // but could be added as an extra layer if desired:
        // .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild) // Example permission
        .setDMPermission(false) // Ensure command is only available in guilds
        ,

    async execute(interaction) {
        // Interaction guaranteed to be in a guild due to setDMPermission(false) and guild check
        const { user, guild, options } = interaction;
        const logPrefix = `[CheckCmd][Guild:${guild.id}][Admin:${user.id}]`;
        const t = interaction.client.t; // Translator function from client

        // --- 1. Validation ---
        if (!await _validateAdminContext(interaction, logPrefix)) {
            return; // Validation failed, error reply already sent by helper
        }

        // --- 2. Deferral ---
        // Defer ephemerally as this is admin info
        try {
            await interaction.deferReply({ ephemeral: true });
        } catch (deferError) {
            console.error(`${logPrefix} Failed to defer reply:`, deferError);
            // Attempt direct reply if defer fails (ephemeral might be lost)
            try {
                // Use a generic start error from translation
                await interaction.reply({ content: t('check.error_start_command'), ephemeral: true });
            } catch (replyError) {
                console.error(`${logPrefix} Failed to send fallback reply after deferral failure:`, replyError);
            }
            return; // Stop if we can't acknowledge interaction
        }

        // --- 3. Target User Retrieval ---
        const targetUser = options.getUser('user', true); // Required option, should always exist
        // Redundant check, but safe:
        if (!targetUser) {
            console.error(`${logPrefix} Target user option was somehow missing despite being required.`);
            await _sendSafeReply(interaction, { content: t('check.error_user_retrieve'), ephemeral: true }, logPrefix);
            return;
        }
        const targetUserId = targetUser.id;
        const guildId = guild.id; // Safe to use guild.id now
        console.log(`${logPrefix} Admin ${user.tag} checking invite stats for TargetUser:${targetUserId} (${targetUser.tag}).`);

        // --- 4. Main Logic ---
        try {
            // Fetch Invite Stats (code, validated count, pending count)
            const stats = await _fetchUserInviteStats(guildId, targetUserId, logPrefix);

            // Handle case where user simply has no invite link generated by the bot
            // (This is distinct from a DB error during the check)
            if (!stats.inviteCode && !stats.error) {
                 console.log(`${logPrefix} Target user ${targetUserId} has no invite link generated by the bot.`);
                 // Build embed showing counts are 0 and indicating no link
                 const embed = _buildCheckEmbed(targetUser, guild, stats, user.tag, t);
                 await _sendSafeReply(interaction, { embeds: [embed], ephemeral: true }, logPrefix);
                 return; // Execution successful, just no link data
            }

            // Build and Send Response Embed (handles DB error display in footer)
            const embed = _buildCheckEmbed(targetUser, guild, stats, user.tag, t);
            await _sendSafeReply(interaction, { embeds: [embed], ephemeral: true }, logPrefix);
            console.log(`${logPrefix} Successfully displayed stats for TargetUser:${targetUserId}. Validated: ${stats.validatedCount}, Pending: ${stats.pendingCount}, DB Error: ${stats.error}`);

        } catch (error) {
            // Catch unexpected errors during the process (e.g., embed building issues, though unlikely)
            console.error(`${logPrefix} Critical error during /check execution for TargetUser:${targetUserId}:`, error);
            // Send a generic critical error message
            const userErrorMessage = t('check.error_critical', {
                user_tag: targetUser.tag, // Provide context
                error_message: error.message || 'Unknown error' // Include error details if possible
            });
            await _sendSafeReply(interaction, { content: userErrorMessage, embeds: [], ephemeral: true }, logPrefix);
        }
    },
};