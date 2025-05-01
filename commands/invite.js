/**
 * @file commands/invite.js
 * @description Slash command to display a user's personal invite link, their validated invite count,
 * and their pending invite count. If the user doesn't have a link, or their existing link is
 * invalid, a new permanent, unlimited-use invite link is generated and stored.
 */

const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField, DiscordAPIError, ChannelType } = require('discord.js');
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

// --- Helper Functions ---

/**
 * Checks if the stored invite code is still valid on Discord.
 * Deletes the invite from the DB if it's invalid on Discord.
 * @param {import('discord.js').Guild} guild - The guild object.
 * @param {string} inviteCode - The invite code to check.
 * @param {string} userId - The user ID associated with the invite.
 * @param {string} logPrefix - Prefix for logging.
 * @returns {Promise<boolean>} True if the invite is valid on Discord, false otherwise.
 */
async function _validateExistingInvite(guild, inviteCode, userId, logPrefix) {
    try {
        await guild.invites.fetch({ code: inviteCode, force: true });
        return true; // Invite exists on Discord
    } catch (error) {
        if (error instanceof DiscordAPIError && error.code === DISCORD_ERROR_CODES.UNKNOWN_INVITE) {
            console.warn(`${logPrefix} Stored invite code ${inviteCode} is invalid/deleted on Discord. Removing DB record.`);
            try {
                await UserInvite.deleteOne({ userId, guildId: guild.id, inviteCode });
            } catch (dbDelError) {
                console.error(`${logPrefix} Failed to delete invalid invite ${inviteCode} from DB:`, dbDelError);
            }
        } else {
            console.error(`${logPrefix} Unexpected error verifying stored invite ${inviteCode}:`, error);
        }
        return false; // Invite is invalid or an error occurred
    }
}

/**
 * Creates a new permanent, unlimited invite link in the specified channel.
 * @param {import('discord.js').GuildTextBasedChannel} channel - The channel to create the invite in.
 * @param {import('discord.js').User} user - The user requesting the invite.
 * @param {string} logPrefix - Prefix for logging.
 * @param {function} t - The translator function.
 * @returns {Promise<import('discord.js').Invite | null>} The created Invite object or null on failure.
 */
async function _createNewDiscordInvite(channel, user, logPrefix, t) {
    const { guild } = channel;
    const botMember = guild.members.me ?? await guild.members.fetchMe().catch(fetchErr => {
        console.error(`${logPrefix} Failed to fetch bot member object:`, fetchErr);
        return null;
    });

    if (!botMember) {
        console.error(`${logPrefix} Could not obtain bot member object.`);
        // No interaction object here to reply to, caller should handle
        return null;
    }

    // Check permissions in the specific channel
    const channelPermissions = channel.permissionsFor(botMember);
    if (!channelPermissions || !channelPermissions.has(PermissionsBitField.Flags.CreateInstantInvite)) {
        console.warn(`${logPrefix} Bot lacks CreateInstantInvite permission in channel ${channel.id} (${channel.name}).`);
        // No interaction object here, caller handles reply
        return null; // Indicate permission failure
    }

    try {
        const newInvite = await channel.createInvite({
            maxAge: 0, // Permanent
            maxUses: 0, // Unlimited uses
            unique: true, // Attempt to get a unique code
            reason: `Generated for user ${user.tag} (${user.id}) via /invite command (Validated Tracking)`
        });
        console.log(`${logPrefix} Successfully created new Discord invite: ${newInvite.code}`);
        return newInvite;
    } catch (error) {
        console.error(`${logPrefix} Failed to create Discord invite:`, error);
        // Caller handles reply based on error type if needed
        return null;
    }
}

/**
 * Saves or updates the user's invite code in the database.
 * @param {string} guildId - The guild ID.
 * @param {string} userId - The user ID.
 * @param {string} inviteCode - The new invite code.
 * @param {string} logPrefix - Prefix for logging.
 * @returns {Promise<boolean>} True if save/update was successful, false otherwise.
 */
async function _saveInviteToDatabase(guildId, userId, inviteCode, logPrefix) {
    try {
        const updatedDoc = await UserInvite.findOneAndUpdate(
            { userId, guildId },
            { $set: { inviteCode: inviteCode } },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        ).lean(); // Use lean as we just need confirmation

        if (!updatedDoc) {
            console.error(`${logPrefix} Failed to save/update invite code ${inviteCode} in DB (findOneAndUpdate returned null).`);
            return false;
        }
        console.log(`${logPrefix} Successfully saved/updated invite code ${inviteCode} for user ${userId} in DB.`);
        return true;
    } catch (dbError) {
        console.error(`${logPrefix} Database error saving/updating invite code ${inviteCode}:`, dbError);
        return false;
    }
}


/**
 * Retrieves or creates and validates a user's invite link.
 * Handles DB lookup, Discord validation, creation, and saving.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object.
 * @param {string} guildId - The guild ID.
 * @param {string} userId - The user ID.
 * @param {string} logPrefix - Prefix for logging.
 * @param {function} t - The translator function.
 * @returns {Promise<string|null>} The valid invite code, or null if retrieval/creation failed critically. Replies on permission errors.
 */
async function _getOrCreateInvite(interaction, guildId, userId, logPrefix, t) {
    const { guild, channel, user } = interaction; // Need channel for creation

    // 1. Check DB for existing invite
    let userInviteDoc = await UserInvite.findOne({ userId, guildId }).lean().catch(err => {
        console.error(`${logPrefix} DB Error fetching UserInvite:`, err);
        return null; // Handle DB error gracefully
    });
    let inviteCode = userInviteDoc?.inviteCode;
    let needsNewInvite = !inviteCode; // Assume needs new if no code found

    // 2. Validate existing invite on Discord if found
    if (inviteCode) {
        const isValidOnDiscord = await _validateExistingInvite(guild, inviteCode, userId, logPrefix);
        if (!isValidOnDiscord) {
            inviteCode = null; // Clear invalid code
            needsNewInvite = true;
        }
    }

    // 3. Create new invite if necessary
    if (needsNewInvite) {
        console.log(`${logPrefix} No valid invite exists. Attempting to create one...`);

        // Ensure channel is appropriate for invite creation
        if (!channel || channel.type !== ChannelType.GuildText) {
            console.warn(`${logPrefix} Cannot create invite in non-text channel (${channel?.id}, type: ${channel?.type}).`);
            await interaction.editReply({ content: t('invite.error_invalid_channel_type'), ephemeral: true });
            return null;
        }

        const newInvite = await _createNewDiscordInvite(channel, user, logPrefix, t);

        if (!newInvite) {
            // _createNewDiscordInvite logs specific errors. Check permissions scenario.
            const botMember = guild.members.me;
            const channelPermissions = botMember ? channel.permissionsFor(botMember) : null;
            if (!channelPermissions || !channelPermissions.has(PermissionsBitField.Flags.CreateInstantInvite)) {
                await interaction.editReply({ content: t('invite.error_permission_create', { channel_name: channel.name }), ephemeral: true });
            } else {
                 // More generic creation failure
                await interaction.editReply({ content: t('invite.error_failed_create_save'), ephemeral: true });
            }
            return null; // Failed to create invite
        }

        // 4. Save the new invite to the database
        const saved = await _saveInviteToDatabase(guildId, userId, newInvite.code, logPrefix);
        if (!saved) {
            await interaction.editReply({ content: t('invite.error_failed_create_save'), ephemeral: true });
            // Attempt to delete the just-created invite from Discord to avoid orphans? Maybe too complex.
            return null; // Failed to save invite
        }
        inviteCode = newInvite.code; // Use the newly created and saved code
    }

    return inviteCode; // Return the valid invite code
}

/**
 * Fetches the validated and pending invite counts for a user.
 * @param {string} guildId - The guild ID.
 * @param {string} userId - The user ID (inviter).
 * @param {string} logPrefix - Prefix for logging.
 * @returns {Promise<{validatedCount: number, pendingCount: number, error: boolean}>} Counts and error status.
 */
async function _fetchInviteCounts(guildId, userId, logPrefix) {
    let validatedCount = 0;
    let pendingCount = 0;
    let errorOccurred = false;

    try {
        validatedCount = await TrackedJoin.countDocuments({
            guildId: guildId,
            inviterId: userId,
            status: 'validated'
        });
    } catch (dbError) {
        console.error(`${logPrefix} Failed to query validated join count:`, dbError);
        errorOccurred = true; // Mark error
    }

    try {
        pendingCount = await TrackedJoin.countDocuments({
            guildId: guildId,
            inviterId: userId,
            status: 'pending'
        });
    } catch (dbError) {
        console.error(`${logPrefix} Failed to query pending join count:`, dbError);
        errorOccurred = true; // Mark error
    }

    return { validatedCount, pendingCount, error: errorOccurred };
}

/**
 * Builds the response embed for the /invite command.
 * @param {import('discord.js').User} user - The user who ran the command.
 * @param {import('discord.js').Guild} guild - The guild context.
 * @param {string|null} inviteCode - The user's invite code (or null).
 * @param {{validatedCount: number, pendingCount: number, error: boolean}} counts - Fetched counts.
 * @param {function} t - The translator function.
 * @returns {EmbedBuilder} The constructed embed.
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

    if (user.avatar) {
         embed.setThumbnail(user.displayAvatarURL());
    }

    return embed;
}

// --- Command Definition ---

module.exports = {
    /**
     * @description Slash command definition.
     * @type {import('discord.js').SlashCommandBuilder}
     */
    data: new SlashCommandBuilder()
        .setName('invite')
        .setDescription('Shows your invite link, validated count (stayed > 1 week), and pending count.'),

    /**
     * @description Executes the /invite command logic.
     * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object.
     */
    async execute(interaction) {
        const { user, guild, channel } = interaction;
        const logPrefix = `[InviteCmd][Guild:${guild?.id ?? 'N/A'}][User:${user.id}]`;
        const t = interaction.client.t;

        // --- 1. Initial Validation ---
        if (!guild || !channel) {
            console.warn(`${logPrefix} Command used outside of a guild channel.`);
            return interaction.reply({ content: t('general.error_guild_only'), ephemeral: true });
        }

        // --- 2. Defer Reply ---
        try {
            await interaction.deferReply({ ephemeral: true });
        } catch (deferError) {
            console.error(`${logPrefix} Failed to defer reply:`, deferError);
            // Attempt direct reply if defer fails
            try {
                 await interaction.reply({ content: t('invite.error_start_command'), ephemeral: true });
            } catch (replyError) {
                 console.error(`${logPrefix} Failed to send fallback reply after deferral failure:`, replyError);
            }
            return; // Stop execution if we can't even defer/reply initially
        }

        try {
            const userId = user.id;
            const guildId = guild.id;

            // --- 3. Get or Create Invite Code ---
            const inviteCode = await _getOrCreateInvite(interaction, guildId, userId, logPrefix, t);
            if (!inviteCode) {
                // Error handled and replied within _getOrCreateInvite or its helpers
                console.log(`${logPrefix} Failed to get or create invite code. Execution stopped.`);
                return;
            }

            // --- 4. Fetch Invite Counts ---
            const counts = await _fetchInviteCounts(guildId, userId, logPrefix);
            // We proceed even if counts.error is true, the footer will indicate potential inaccuracy.

            // --- 5. Build Response Embed ---
            const embed = _buildInviteEmbed(user, guild, inviteCode, counts, t);

            // --- 6. Send Final Reply ---
            await interaction.editReply({ embeds: [embed] });
            console.log(`${logPrefix} Successfully processed /invite command for user ${user.tag}.`);

        } catch (error) {
            // Catch any unexpected critical errors during the process
            console.error(`${logPrefix} Critical error executing /invite command:`, error);
            const userErrorMessage = t('invite.error_critical', { error_message: error.message || 'Unknown error' });

            // Attempt to inform the user about the critical error (using editReply since we deferred)
             try {
                 if (interaction.deferred && !interaction.replied) { // Check state defensively
                    await interaction.editReply({ content: userErrorMessage, embeds: [], ephemeral: true });
                 } else {
                     console.warn(`${logPrefix} Could not edit reply with critical error message (interaction state unexpected: deferred=${interaction.deferred}, replied=${interaction.replied}). Attempting followUp.`);
                     // Fallback to followUp if editReply might fail or state is weird
                     await interaction.followUp({ content: userErrorMessage, ephemeral: true });
                 }
             } catch (editError) {
                  // Log if sending the error message itself fails
                  console.error(`${logPrefix} Failed to edit or follow up reply with critical error message:`, editError);
             }
        }
    },
};