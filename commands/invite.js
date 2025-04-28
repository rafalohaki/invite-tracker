/**
 * @file commands/invite.js
 * @description Slash command to display a user's personal invite link, their validated invite count,
 * and their pending invite count. If the user doesn't have a link, or their existing link is
 * invalid, a new permanent, unlimited-use invite link is generated and stored.
 */

const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField, DiscordAPIError } = require('discord.js');
const UserInvite = require('../database/models/UserInvite');
const TrackedJoin = require('../database/models/TrackedJoin');
const config = require('../config');

// Configuration for the /invite command appearance and behavior
const INVITE_COMMAND_CONFIG = config.inviteCommand;

// Specific Discord API error codes relevant to this command
const DISCORD_ERROR_CODES = {
    UNKNOWN_INVITE: 10006,      // Invite code is invalid or expired
    MISSING_PERMISSIONS: 50013, // Bot lacks necessary permissions (e.g., Create Invite)
};

module.exports = {
    /**
     * @description Slash command definition.
     * @type {import('discord.js').SlashCommandBuilder}
     */
    data: new SlashCommandBuilder()
        .setName('invite')
        // Updated description (shorter) - English is fine for command description:
        .setDescription('Shows your invite link, validated count (stayed > 1 week), and pending count.'),

    /**
     * @description Executes the /invite command logic.
     * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object.
     */
    async execute(interaction) {
        const { user, guild, channel } = interaction;
        // Enhanced log prefix for safety, using optional chaining for guild ID initially
        const logPrefix = `[InviteCmd][Guild:${guild?.id ?? 'N/A'}][User:${user.id}]`;
        const t = interaction.client.t; // Translator shortcut

        // Ensure the command is run within a server channel
        if (!guild || !channel) {
            console.warn(`${logPrefix} Command used outside of a guild channel?`);
            // Use translator
            return interaction.reply({ content: t('general.error_guild_only'), ephemeral: true });
        }

        // Acknowledge the command immediately; fetching/creating invites might take time.
        try {
            await interaction.deferReply({ ephemeral: true });
        } catch (deferError) {
            console.error(`${logPrefix} Failed to defer reply:`, deferError);
            try {
                 // Use translator
                 await interaction.reply({ content: t('invite.error_start_command'), ephemeral: true });
            } catch (replyError) {
                 console.error(`${logPrefix} Failed to send fallback reply after deferral failure:`, replyError);
            }
            return; // Stop execution if we can't even defer/reply initially
        }


        try {
            const userId = user.id;
            const guildId = guild.id; // Guild is confirmed non-null here

            // --- Step 1: Check Database for Existing Invite ---
            let userInviteDoc = await UserInvite.findOne({ userId, guildId }).lean();
            let inviteCode = userInviteDoc?.inviteCode;
            let inviteExistsOnDiscord = false; // Flag to track if the stored code is still valid on Discord

            // --- Step 2: Verify Stored Invite Code on Discord ---
            if (inviteCode) {
                try {
                    await guild.invites.fetch({ code: inviteCode, force: true });
                    inviteExistsOnDiscord = true;
                } catch (error) {
                    if (error instanceof DiscordAPIError && error.code === DISCORD_ERROR_CODES.UNKNOWN_INVITE) {
                        console.warn(`${logPrefix} Stored invite code ${inviteCode} is invalid/deleted on Discord. Removing DB record.`);
                        await UserInvite.deleteOne({ userId, guildId, inviteCode });
                        userInviteDoc = null;
                        inviteCode = null;
                    } else {
                        console.error(`${logPrefix} Unexpected error verifying stored invite ${inviteCode}:`, error);
                        inviteExistsOnDiscord = false; // Assume invalid on other errors too
                    }
                }
            }

            // --- Step 3: Create New Invite if Necessary ---
            if (!inviteCode || !inviteExistsOnDiscord) {
                 console.log(`${logPrefix} No valid invite exists in DB or on Discord. Attempting to create one...`);
                 // Fetch bot member object safely
                 const botMember = guild.members.me ?? await guild.members.fetchMe().catch(fetchErr => {
                    console.error(`${logPrefix} Failed to fetch bot member object:`, fetchErr);
                    return null;
                 });

                 if (!botMember) {
                     console.error(`${logPrefix} Could not obtain bot member object.`);
                     // Use translator
                     return interaction.editReply({ content: t('invite.error_internal_bot_perms'), ephemeral: true });
                 }

                 // Check permissions in the specific channel
                 const channelPermissions = channel.permissionsFor(botMember);
                 if (!channelPermissions || !channelPermissions.has(PermissionsBitField.Flags.CreateInstantInvite)) {
                    console.warn(`${logPrefix} Bot lacks CreateInstantInvite permission in channel ${channel.id} (${channel.name}).`);
                    // Use translator
                    return interaction.editReply({ content: t('invite.error_permission_create', { channel_name: channel.name }), ephemeral: true });
                }

                // Try creating the invite
                try {
                    const newInvite = await channel.createInvite({
                        maxAge: 0, // Permanent
                        maxUses: 0, // Unlimited uses
                        unique: true, // Attempt to get a unique code
                        reason: `Generated for user ${user.tag} (${userId}) via /invite command (Validated Tracking)`
                    });
                    console.log(`${logPrefix} Successfully created new invite: ${newInvite.code}`);

                    // Save or update the invite code in the database
                    userInviteDoc = await UserInvite.findOneAndUpdate(
                        { userId, guildId },
                        { $set: { inviteCode: newInvite.code } },
                        { new: true, upsert: true, setDefaultsOnInsert: true }
                    ).lean();

                     if (!userInviteDoc) {
                         // Use translator key, but error message itself is good for logs
                         throw new Error(t('invite.error_failed_create_save'));
                     }
                    inviteCode = newInvite.code;

                 } catch (error) {
                     console.error(`${logPrefix} Failed to create invite or save/update in DB:`, error);
                     // Check for specific permissions error during creation
                     if (error instanceof DiscordAPIError && error.code === DISCORD_ERROR_CODES.MISSING_PERMISSIONS) {
                        // Use translator
                        return interaction.editReply({ content: t('invite.error_permission_create_generic', { channel_name: channel.name }), ephemeral: true });
                     }
                    // Use translator key for generic create/save error
                     throw new Error(t('invite.error_failed_create_save'));
                 }
            }

            // --- Step 4: Get Validated and Pending Invite Counts ---
            let validatedCount = 0;
            let pendingCount = 0;
            let countError = false; // Flag for any count error

            if (inviteCode) {
                // Get Validated Count
                try {
                    validatedCount = await TrackedJoin.countDocuments({
                        guildId: guildId,
                        inviterId: userId, // Query by the user who ran the command
                        status: 'validated'
                    });
                } catch (dbError) {
                    console.error(`${logPrefix} Failed to query validated join count:`, dbError);
                    validatedCount = 0; // Default to 0 on error
                    countError = true; // Mark error
                }

                // Get Pending Count
                try {
                    pendingCount = await TrackedJoin.countDocuments({
                        guildId: guildId,
                        inviterId: userId, // Query by the user who ran the command
                        status: 'pending'  // Query for pending status
                    });
                } catch (dbError) {
                    console.error(`${logPrefix} Failed to query pending join count:`, dbError);
                    pendingCount = 0; // Default to 0 on error
                    countError = true; // Mark error (can be the same flag)
                }

            } else {
                 // This case should ideally not be reached due to creation logic, but handle defensively
                 console.error(`${logPrefix} Error: No valid inviteCode available to query counts after creation attempt.`);
                 countError = true;
            }

            // --- Step 5: Build and Send Response Embed ---
            // Build embed using translator
            const embed = new EmbedBuilder()
                .setColor(INVITE_COMMAND_CONFIG.embedColor)
                // Use translator for title and description
                .setTitle(t('invite.embed_title', { username: user.username }))
                .setDescription(t('invite.embed_description', { guild_name: guild.name }))
                .addFields(
                    // Use translator for field names and error value
                    { name: t('invite.link_field_name'), value: inviteCode ? `https://discord.gg/${inviteCode}` : t('invite.error_no_link') },
                    { name: t('invite.validated_field_name'), value: `\`${validatedCount}\``, inline: true },
                    { name: t('invite.pending_field_name'), value: `\`${pendingCount}\``, inline: true }
                )
                // Use translator for footer text
                .setFooter({ text: countError ? t('invite.footer_db_error') : t('invite.footer_success') })
                .setTimestamp();

            // Send the final reply
            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            // Catch any critical errors during the process
            console.error(`${logPrefix} Critical error executing /invite command:`, error);
            // Use translator for the generic critical error message
            const userErrorMessage = t('invite.error_critical', { error_message: error.message || 'Unknown error' });

            try {
                // Attempt to inform the user about the critical error
                if (!interaction.replied && interaction.deferred) {
                   await interaction.editReply({ content: userErrorMessage, embeds: [], ephemeral: true });
                } else if (interaction.replied) {
                    // If already replied (e.g., initial error message after defer fail), use followUp
                    await interaction.followUp({ content: userErrorMessage, ephemeral: true });
                } else {
                     // Log if we can't send the error message
                     console.warn(`${logPrefix} Could not edit or follow up reply with error message (interaction state unexpected).`);
                }
            } catch (editError) {
                 // Log if sending the error message itself fails
                 console.error(`${logPrefix} Failed to edit or follow up reply with error message:`, editError);
            }
        }
    },
};