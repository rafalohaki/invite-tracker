/**
 * @file commands/check.js
 * @description Admin-only slash command to check the invite statistics (validated and pending) for a specific user.
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js'); // PermissionsBitField removed as check is internal ID based
const UserInvite = require('../database/models/UserInvite');
const TrackedJoin = require('../database/models/TrackedJoin');
const config = require('../config');
require('dotenv').config(); // Ensure .env variables are loaded

// Configuration for the embed color (can reuse invite or add a new one in config.js)
const CHECK_COMMAND_CONFIG = config.inviteCommand; // Or define config.checkCommand

// Get the designated Admin ID from environment variables
const ADMIN_USER_ID = process.env.ADMIN_ID;

module.exports = {
    /**
     * @description Slash command definition.
     * @type {import('discord.js').SlashCommandBuilder}
     */
    data: new SlashCommandBuilder()
        .setName('check')
        .setDescription('[Admin Only] Checks the validated and pending invite counts for a specific user.') // Keep description concise/English is fine
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user whose invite stats you want to check.') // English fine
                .setRequired(true))
        // .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator) // Keep internal ID check
        // .setDMPermission(false) // Ensure it's only usable in guilds
        ,

    /**
     * @description Executes the /check command logic.
     * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object.
     */
    async execute(interaction) {
        const { user, guild, options } = interaction;
        const logPrefix = `[CheckCmd][Guild:${guild?.id ?? 'N/A'}][Admin:${user.id}]`;
        const t = interaction.client.t; // Translator shortcut

        // --- Permission Check ---
        if (!ADMIN_USER_ID) {
            console.warn(`${logPrefix} Attempted use, but ADMIN_ID is not set in the .env file.`);
            // Use translator for error message
            return interaction.reply({ content: t('check.error_admin_id_not_set'), ephemeral: true });
        }
        if (user.id !== ADMIN_USER_ID) {
            console.warn(`${logPrefix} Unauthorized use attempt by User:${user.id}.`);
            // Use translator for error message
            return interaction.reply({ content: t('check.error_permission_admin'), ephemeral: true });
        }

        // Ensure the command is run within a server channel
        if (!guild) {
            console.warn(`${logPrefix} Command used outside of a guild channel.`);
            // Use translator for error message
            return interaction.reply({ content: t('general.error_guild_only'), ephemeral: true });
        }

        // Acknowledge the command - ephemeral is good for admin commands
        try {
            await interaction.deferReply({ ephemeral: true });
        } catch (deferError) {
            console.error(`${logPrefix} Failed to defer reply:`, deferError);
            // Attempt a direct reply if defer fails
             try {
                  // Use translator for error message
                  await interaction.reply({ content: t('check.error_start_command'), ephemeral: true });
             } catch (replyError) {
                  console.error(`${logPrefix} Failed to send fallback reply after deferral failure:`, replyError);
             }
            return; // Stop if we can't acknowledge
        }

        // Get the target user from the command options
        const targetUser = options.getUser('user');
        if (!targetUser) {
             // Should not happen due to 'setRequired(true)', but good practice to check
            console.error(`${logPrefix} Target user option was somehow missing.`);
             // Use translator for error message
             return interaction.editReply({ content: t('check.error_user_retrieve'), ephemeral: true });
        }

        const targetUserId = targetUser.id;
        const guildId = guild.id;
        console.log(`${logPrefix} Checking invite stats for TargetUser:${targetUserId} (${targetUser.tag}).`);

        try {
            // --- Step 1: Find the Target User's Invite Code ---
            const userInviteDoc = await UserInvite.findOne({ userId: targetUserId, guildId }).lean();
            const inviteCode = userInviteDoc?.inviteCode;

            if (!inviteCode) {
                console.log(`${logPrefix} Target user ${targetUserId} does not have a tracked invite code in this guild.`);
                // Use translator for error message
                return interaction.editReply({ content: t('check.error_no_invite', { user_tag: targetUser.tag }), ephemeral: true });
            }

            // --- Step 2: Get Validated and Pending Invite Counts for the Target User ---
            let validatedCount = 0;
            let pendingCount = 0;
            let countError = false;

            // Get Validated Count
            try {
                validatedCount = await TrackedJoin.countDocuments({
                    guildId: guildId,
                    inviterId: targetUserId, // Filter by the target user's ID
                    status: 'validated'
                });
            } catch (dbError) {
                console.error(`${logPrefix} Failed to query validated join count for TargetUser:${targetUserId}:`, dbError);
                countError = true;
            }

            // Get Pending Count
            try {
                pendingCount = await TrackedJoin.countDocuments({
                    guildId: guildId,
                    inviterId: targetUserId, // Filter by the target user's ID
                    status: 'pending'
                });
            } catch (dbError) {
                console.error(`${logPrefix} Failed to query pending join count for TargetUser:${targetUserId}:`, dbError);
                countError = true;
            }

            // --- Step 3: Build and Send Response Embed ---
            // Build embed using translator
            const embed = new EmbedBuilder()
                .setColor(CHECK_COMMAND_CONFIG.embedColor)
                // Use translator for title and description
                .setTitle(t('check.embed_title', { username: targetUser.username }))
                .setDescription(t('check.embed_description', { user_tag: targetUser.tag, guild_name: guild.name }))
                .addFields(
                    // Use translator for field names
                    { name: t('check.link_field_name'), value: `https://discord.gg/${inviteCode}` },
                    { name: t('check.validated_field_name'), value: `\`${validatedCount}\``, inline: true },
                    { name: t('check.pending_field_name'), value: `\`${pendingCount}\``, inline: true }
                )
                // Use translator for footer text
                .setFooter({ text: countError ? t('check.footer_db_error', { admin_tag: user.tag }) : t('check.footer_success', { admin_tag: user.tag }) })
                .setTimestamp();

             if (targetUser.avatar) { // Add target user's avatar if available
                 embed.setThumbnail(targetUser.displayAvatarURL());
             }

            await interaction.editReply({ embeds: [embed] });
            console.log(`${logPrefix} Successfully displayed stats for TargetUser:${targetUserId}.`);

        } catch (error) {
            console.error(`${logPrefix} Critical error executing /check command for TargetUser:${targetUserId}:`, error);
            // Use translator for error message
            const userErrorMessage = t('check.error_critical', { user_tag: targetUser.tag, error_message: error.message || 'Unknown error' });

            try {
                // Check if interaction is still editable
                if (!interaction.replied && interaction.deferred) {
                    await interaction.editReply({ content: userErrorMessage, embeds: [], ephemeral: true });
                } else if (interaction.replied) {
                    await interaction.followUp({ content: userErrorMessage, ephemeral: true });
                } else {
                    console.warn(`${logPrefix} Could not edit or follow up reply with error message (interaction state unexpected).`);
                }
            } catch (editError) {
                console.error(`${logPrefix} Failed to send error message reply:`, editError);
            }
        }
    },
};