/**
 * @file commands/invite.js
 * @description Slash command to display a user's personal invite link and their validated invite count.
 * If the user doesn't have a link, or their existing link is invalid, a new permanent,
 * unlimited-use invite link is generated and stored.
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
        .setDescription('Shows your personal invite link and validated uses (users who stayed > 1 week).'),

    /**
     * @description Executes the /invite command logic.
     * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object.
     */
    async execute(interaction) {
        const { user, guild, channel } = interaction;
        // Enhanced log prefix for safety, using optional chaining for guild ID initially
        const logPrefix = `[InviteCmd][Guild:${guild?.id ?? 'N/A'}][User:${user.id}]`;

        // Ensure the command is run within a server channel
        if (!guild || !channel) {
            console.warn(`${logPrefix} Command used outside of a guild channel?`);
            // No deferral yet, so use reply
            return interaction.reply({ content: 'This command can only be used within a server channel.', ephemeral: true });
        }

        // Acknowledge the command immediately; fetching/creating invites might take time.
        // Ephemeral ensures only the user sees the reply.
        try {
            await interaction.deferReply({ ephemeral: true });
        } catch (deferError) {
            console.error(`${logPrefix} Failed to defer reply:`, deferError);
            // Attempt a direct reply if deferral fails
            try {
                 await interaction.reply({ content: 'An error occurred while starting the command. Please try again.', ephemeral: true });
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
                    // Fetch the invite from Discord API to confirm it exists.
                    // `force: true` bypasses Discord's internal cache for a fresh check.
                    await guild.invites.fetch({ code: inviteCode, force: true });
                    inviteExistsOnDiscord = true;
                } catch (error) {
                    if (error instanceof DiscordAPIError && error.code === DISCORD_ERROR_CODES.UNKNOWN_INVITE) {
                        // The stored invite code is no longer valid on Discord (deleted/expired).
                        console.warn(`${logPrefix} Stored invite code ${inviteCode} is invalid/deleted on Discord. Removing DB record.`);
                        // Remove the invalid record from the database.
                        await UserInvite.deleteOne({ userId, guildId, inviteCode });
                        userInviteDoc = null; // Clear local variable
                        inviteCode = null;    // Clear local variable
                        // inviteExistsOnDiscord remains false
                    } else {
                        // Log unexpected errors during verification but attempt to continue.
                        // The goal is to provide *an* invite, even if verification failed unexpectedly.
                        console.error(`${logPrefix} Unexpected error verifying stored invite ${inviteCode}:`, error);
                        // Treat as non-existent to be safe and attempt creation.
                        inviteExistsOnDiscord = false;
                        // Avoid re-throwing; allow the flow to proceed to create a new invite.
                    }
                }
            }

            // --- Step 3: Create New Invite if Necessary ---
            // If no code was found in the DB, or if the stored code was invalid on Discord.
            if (!inviteCode || !inviteExistsOnDiscord) {
                 console.log(`${logPrefix} No valid invite exists in DB or on Discord. Attempting to create one...`);

                 // Fetch the bot's member object to check permissions. Use cache first, then fetch if needed.
                 const botMember = guild.members.me ?? await guild.members.fetchMe().catch(fetchErr => {
                    console.error(`${logPrefix} Failed to fetch bot member object even after cache miss:`, fetchErr);
                    return null; // Return null if fetch also fails
                 });

                 if (!botMember) {
                     // This should be very rare, but handle it gracefully.
                     console.error(`${logPrefix} Could not obtain bot member object.`);
                     // Use editReply since we deferred
                     return interaction.editReply({ content: 'An internal error occurred (could not determine bot permissions). Please try again later.', ephemeral: true });
                 }

                 // Check if the bot has the required permission in the specific channel.
                 const channelPermissions = channel.permissionsFor(botMember);
                 // Added check for null permissions object as a safeguard
                 if (!channelPermissions || !channelPermissions.has(PermissionsBitField.Flags.CreateInstantInvite)) {
                    console.warn(`${logPrefix} Bot lacks CreateInstantInvite permission in channel ${channel.id} (${channel.name}). Permissions: ${channelPermissions?.toArray()?.join(', ') ?? 'N/A'}`);
                    return interaction.editReply({ content: `I don't have permission to create invites in the channel **#${channel.name}**. Please ask an admin for permission or try another channel.`, ephemeral: true });
                }

                // Attempt to create a new, permanent, unlimited-use invite.
                try {
                    const newInvite = await channel.createInvite({
                        maxAge: 0, // 0 means permanent invite
                        maxUses: 0, // 0 means unlimited uses
                        unique: true, // Request a unique code (helps prevent collisions, though Discord guarantees uniqueness)
                        reason: `Generated for user ${user.tag} (${userId}) via /invite command (Validated Tracking)` // Audit log reason
                    });
                    console.log(`${logPrefix} Successfully created new invite: ${newInvite.code}`);

                    // Save or update the invite code in the database.
                    // findOneAndUpdate with upsert:true is atomic.
                    userInviteDoc = await UserInvite.findOneAndUpdate(
                        { userId, guildId }, // Query
                        { $set: { inviteCode: newInvite.code } }, // Update
                        { new: true, upsert: true, setDefaultsOnInsert: true } // Options
                    ).lean(); // Use lean for performance

                     if (!userInviteDoc) {
                         // This is highly unlikely with upsert: true but handle defensively.
                         console.error(`${logPrefix} Failed to save/update invite code in DB after creation.`);
                         // Throw a specific error to be caught by the main handler
                         throw new Error('Failed to save or update the invite code in the database after creation.');
                     }
                    inviteCode = newInvite.code; // Update local variable with the newly created/confirmed code

                 } catch (error) {
                     console.error(`${logPrefix} Failed to create invite or save/update in DB:`, error);
                     // Provide specific feedback for permission errors during creation.
                     if (error instanceof DiscordAPIError && error.code === DISCORD_ERROR_CODES.MISSING_PERMISSIONS) {
                        // Edit reply directly here as it's a common, specific error
                        return interaction.editReply({ content: `I encountered a permission error creating the invite in **#${channel.name}**. Please check my 'Create Invite' permission.`, ephemeral: true });
                     }
                     // For other errors during creation/saving, throw a more generic message
                     // Let the main catch block handle replying to the user.
                    throw new Error('Failed to create or save a new invite link.');
                 }
            }

            // --- Step 4: Get Validated Invite Count ---
            let validatedCount = 0;
            let countError = false;

            if (inviteCode) {
                try {
                    validatedCount = await TrackedJoin.countDocuments({
                        guildId: guildId,
                        inviterId: userId,
                        status: 'validated'
                    });
                } catch (dbError) {
                    console.error(`${logPrefix} Failed to query validated join count:`, dbError);
                    validatedCount = 0; // Reset to 0 on error
                    countError = true;
                }
            } else {
                 // This state should ideally not be reached if creation succeeded,
                 // but indicates a failure occurred before the inviteCode variable was reliably set.
                 console.error(`${logPrefix} Error: No valid inviteCode available to query counts. Invite generation may have failed silently or an earlier error occurred.`);
                 countError = true;
                 // validatedCount remains 0
            }

            // --- Step 5: Build and Send Response Embed ---
            const embed = new EmbedBuilder()
                .setColor(INVITE_COMMAND_CONFIG.embedColor)
                .setTitle(`${user.username}'s Invite Link`)
                .setDescription(`Here is your personal invite link for **${guild.name}**. Share it with others!\nCounts update after invited users stay for 1 week.`)
                .addFields(
                    // Provide clear feedback if code couldn't be obtained
                    { name: '🔗 Invite Link', value: inviteCode ? `https://discord.gg/${inviteCode}` : '`Error: Could not retrieve or generate link.`' },
                    { name: '✅ Validated Invites', value: `\`${validatedCount}\``, inline: true }
                )
                .setFooter({ text: countError ? 'Validated invite count unavailable (database error)' : 'Tracking joins for 1-week validation.' })
                .setTimestamp();

            // Edit the deferred reply with the final embed.
            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            // Catch any unhandled errors from the main logic (e.g., invite creation failure caught and re-thrown).
            console.error(`${logPrefix} Critical error executing /invite command:`, error);

            // Provide a generic error message to the user. Use error.message if available.
            const userErrorMessage = `An unexpected error occurred: ${error.message || 'Unknown error'}. Please try again later or contact an admin.`;

            // Use editReply since we should have deferred successfully.
            // Check if interaction is still editable before attempting to edit.
            try {
                if (interaction.channel && !interaction.ephemeral) { // Check if channel exists and reply wasn't already ephemeral somehow
                   await interaction.editReply({ content: userErrorMessage, embeds: [], ephemeral: true });
                } else {
                     console.warn(`${logPrefix} Could not edit reply with error message (channel unavailable or already ephemeral?).`);
                }
            } catch (editError) {
                 // Log error if editing the reply fails (e.g., interaction expired)
                 console.error(`${logPrefix} Failed to edit reply with error message:`, editError);
            }
        }
    },
};