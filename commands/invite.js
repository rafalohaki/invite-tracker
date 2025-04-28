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
        // Updated description (shorter):
        .setDescription('Shows your invite link, validated count (stayed > 1 week), and pending count.'),

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
            return interaction.reply({ content: 'This command can only be used within a server channel.', ephemeral: true });
        }

        // Acknowledge the command immediately; fetching/creating invites might take time.
        try {
            await interaction.deferReply({ ephemeral: true });
        } catch (deferError) {
            console.error(`${logPrefix} Failed to defer reply:`, deferError);
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
                        inviteExistsOnDiscord = false;
                    }
                }
            }

            // --- Step 3: Create New Invite if Necessary ---
            if (!inviteCode || !inviteExistsOnDiscord) {
                 console.log(`${logPrefix} No valid invite exists in DB or on Discord. Attempting to create one...`);
                 const botMember = guild.members.me ?? await guild.members.fetchMe().catch(fetchErr => {
                    console.error(`${logPrefix} Failed to fetch bot member object:`, fetchErr);
                    return null;
                 });

                 if (!botMember) {
                     console.error(`${logPrefix} Could not obtain bot member object.`);
                     return interaction.editReply({ content: 'An internal error occurred (could not determine bot permissions). Please try again later.', ephemeral: true });
                 }

                 const channelPermissions = channel.permissionsFor(botMember);
                 if (!channelPermissions || !channelPermissions.has(PermissionsBitField.Flags.CreateInstantInvite)) {
                    console.warn(`${logPrefix} Bot lacks CreateInstantInvite permission in channel ${channel.id} (${channel.name}).`);
                    return interaction.editReply({ content: `I don't have permission to create invites in the channel **#${channel.name}**. Please ask an admin for permission or try another channel.`, ephemeral: true });
                }

                try {
                    const newInvite = await channel.createInvite({
                        maxAge: 0,
                        maxUses: 0,
                        unique: true,
                        reason: `Generated for user ${user.tag} (${userId}) via /invite command (Validated Tracking)`
                    });
                    console.log(`${logPrefix} Successfully created new invite: ${newInvite.code}`);

                    userInviteDoc = await UserInvite.findOneAndUpdate(
                        { userId, guildId },
                        { $set: { inviteCode: newInvite.code } },
                        { new: true, upsert: true, setDefaultsOnInsert: true }
                    ).lean();

                     if (!userInviteDoc) {
                         throw new Error('Failed to save or update the invite code in the database after creation.');
                     }
                    inviteCode = newInvite.code;

                 } catch (error) {
                     console.error(`${logPrefix} Failed to create invite or save/update in DB:`, error);
                     if (error instanceof DiscordAPIError && error.code === DISCORD_ERROR_CODES.MISSING_PERMISSIONS) {
                        return interaction.editReply({ content: `I encountered a permission error creating the invite in **#${channel.name}**. Please check my 'Create Invite' permission.`, ephemeral: true });
                     }
                    throw new Error('Failed to create or save a new invite link.');
                 }
            }

            // --- Step 4: Get Validated and Pending Invite Counts ---
            let validatedCount = 0;
            let pendingCount = 0; // <-- Initialize pending count
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
                    validatedCount = 0;
                    countError = true; // Mark error
                }

                // Get Pending Count
                try {
                    pendingCount = await TrackedJoin.countDocuments({ // <-- New query
                        guildId: guildId,
                        inviterId: userId, // Query by the user who ran the command
                        status: 'pending'  // <-- Query for pending status
                    });
                } catch (dbError) {
                    console.error(`${logPrefix} Failed to query pending join count:`, dbError);
                    pendingCount = 0;
                    countError = true; // Mark error (can be the same flag)
                }

            } else {
                 console.error(`${logPrefix} Error: No valid inviteCode available to query counts.`);
                 countError = true;
            }

            // --- Step 5: Build and Send Response Embed ---
            const embed = new EmbedBuilder()
                .setColor(INVITE_COMMAND_CONFIG.embedColor)
                .setTitle(`${user.username}'s Invite Link`)
                .setDescription(`Oto twój link do **${guild.name}**. Udostępnij go znajomym!\nZaproszona osoba zalicza się dopiero po tygodniu bycia na serwerze (status 'validated'). Osoby oczekujące ('pending') jeszcze nie ukończyły tego okresu.`) // Description for embed is fine
                .addFields(
                    { name: '🔗 Link Zaproszenia', value: inviteCode ? `https://discord.gg/${inviteCode}` : '`Error: Could not retrieve or generate link.`' },
                    { name: '✅ Prawidłowe (Validated)', value: `\`${validatedCount}\``, inline: true },
                    { name: '⏳ Oczekujące (Pending)', value: `\`${pendingCount}\``, inline: true } // <-- Added Pending field
                )
                .setFooter({ text: countError ? 'Invite counts may be inaccurate due to a DB error.' : 'Validated = stayed 1 week | Pending = awaiting 1 week' }) // Updated footer
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error(`${logPrefix} Critical error executing /invite command:`, error);
            const userErrorMessage = `An unexpected error occurred: ${error.message || 'Unknown error'}. Please try again later or contact an admin.`;

            try {
                // Check if interaction is still editable and was deferred before attempting to edit.
                // Ensure it's not already replied to, as editReply might fail if a direct reply happened due to deferral failure.
                if (!interaction.replied && interaction.deferred) {
                   await interaction.editReply({ content: userErrorMessage, embeds: [], ephemeral: true });
                } else if (interaction.replied) {
                    // If already replied (e.g., initial error message after defer fail), use followUp
                    await interaction.followUp({ content: userErrorMessage, ephemeral: true });
                } else {
                     console.warn(`${logPrefix} Could not edit or follow up reply with error message (interaction state unexpected).`);
                }
            } catch (editError) {
                 console.error(`${logPrefix} Failed to edit or follow up reply with error message:`, editError);
            }
        }
    },
};