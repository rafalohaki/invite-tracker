/**
 * @file commands/leaderboard.js
 * @description Slash command to display the top inviters based on validated joins (users who stayed > 1 week).
 * Uses MongoDB aggregation for efficient data retrieval.
 */

const { SlashCommandBuilder, EmbedBuilder, GuildMember } = require('discord.js'); // GuildMember needed for type checking
const TrackedJoin = require('../database/models/TrackedJoin'); // Use the TrackedJoin model for aggregation
const config = require('../config');

// Configuration for the leaderboard appearance and behavior
const LEADERBOARD_CONFIG = config.leaderboard;

module.exports = {
    /**
     * @description Slash command definition.
     * @type {import('discord.js').SlashCommandBuilder}
     */
    data: new SlashCommandBuilder()
        .setName('leaderboard')
        // English description is fine
        .setDescription(`Shows the top ${LEADERBOARD_CONFIG.limit} inviters based on validated invites (user stayed > 1 week).`),

    /**
     * @description Executes the /leaderboard command logic.
     * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object.
     */
    async execute(interaction) {
        const { guild } = interaction;
        const t = interaction.client.t; // Translator shortcut

        // Ensure the command is run within a server
        if (!guild) {
            // Use translator
            return interaction.reply({ content: t('general.error_guild_only'), ephemeral: true });
        }

        // Acknowledge the command immediately; aggregation and member fetching can take time.
        await interaction.deferReply();

        const logPrefix = `[LeaderboardCmd][Guild:${guild.id}]`;

        try {
            console.log(`${logPrefix} Aggregating validated joins from DB...`);

            // --- Step 1: Aggregate Validated Joins from Database ---
            const leaderboardData = await TrackedJoin.aggregate([
                {
                    // Filter documents to include only 'validated' joins within the specific guild.
                    $match: {
                        guildId: guild.id,
                        status: 'validated'
                    }
                },
                {
                    // Group the filtered documents by the inviter's ID.
                    $group: {
                        _id: '$inviterId', // The field to group by (inviter's Discord ID)
                        count: { $sum: 1 } // Count the number of documents (validated joins) in each group
                    }
                },
                {
                    // Sort the results by the calculated 'count' in descending order (highest first).
                    $sort: {
                        count: -1
                    }
                },
                {
                    // Limit the results to the top N inviters defined in the config.
                    $limit: LEADERBOARD_CONFIG.limit
                }
            ]);

            // Handle cases where no validated invites exist yet.
            if (!leaderboardData || leaderboardData.length === 0) {
                console.log(`${logPrefix} No validated invites found in DB.`);
                // Use translator
                return interaction.editReply({ content: t('leaderboard.no_data'), ephemeral: true });
            }
            console.log(`${logPrefix} Found ${leaderboardData.length} leaderboard entries.`);

            // --- Step 2: Fetch Member Details for Usernames ---
            console.log(`${logPrefix} Fetching member details for top entries...`);
            const leaderboardEntries = [];
            for (const entry of leaderboardData) {
                 // Use translator for fallback format
                let username = t('leaderboard.unknown_user_format', { userId: entry._id });

                try {
                    // Fetch the GuildMember object using the inviter's ID.
                    const member = await guild.members.fetch(entry._id);

                    // Ensure the fetched object is actually a GuildMember.
                    if (member instanceof GuildMember) {
                       username = member.user.tag; // Use "Username#Discriminator" format
                    } else {
                         console.warn(`${logPrefix} Fetched data for ID ${entry._id} was not a GuildMember.`);
                    }
                } catch (fetchError) {
                     // Handle cases where the inviter might have left the server.
                    if (fetchError.code === 10007 /* Unknown Member */ || fetchError.code === 10013 /* Unknown User */) {
                        console.warn(`${logPrefix} Inviter ${entry._id} not found in guild (likely left).`);
                         // Use translator for left user format
                        username = t('leaderboard.left_user_format', { userId: entry._id });
                    } else {
                        // Log other unexpected errors during member fetching.
                        console.error(`${logPrefix} Error fetching member ${entry._id}:`, fetchError);
                        // Keep the default 'Unknown User' username from translator.
                    }
                }
                // Store the processed entry data.
                leaderboardEntries.push({
                    userId: entry._id,
                    username: username,
                    count: entry.count
                });
            }

            // --- Step 3: Build the Leaderboard Embed ---
            console.log(`${logPrefix} Building leaderboard embed...`);

            // Format each entry into a numbered list string using translator.
            const descriptionLines = leaderboardEntries.map((entry, index) => {
                return t('leaderboard.entry_format', {
                    rank: index + 1,
                    username: entry.username,
                    count: entry.count
                });
            });

            // Join the lines, providing a fallback message using translator if no entries processed.
            let embedDescription = descriptionLines.join('\n') || t('leaderboard.no_data'); // Fallback

            // Discord embed descriptions have a character limit (4096). Truncate if necessary.
            if (embedDescription.length > 4096) {
                console.warn(`${logPrefix} Leaderboard description exceeded 4096 characters. Truncating.`);
                embedDescription = embedDescription.substring(0, 4090) + '\n...'; // Truncate slightly below limit
            }

            // Construct the embed object using translator.
            const embed = new EmbedBuilder()
                .setColor(LEADERBOARD_CONFIG.embedColor)
                // Use translator for title and footer
                .setTitle(t('leaderboard.embed_title', { guild_name: guild.name }))
                .setDescription(embedDescription)
                .setTimestamp()
                // Footer clarifies the scope and validation criteria using translator.
                .setFooter({ text: t('leaderboard.footer_text', { count: leaderboardEntries.length }) });

            // Edit the deferred reply with the final embed.
            await interaction.editReply({ embeds: [embed] });
            console.log(`${logPrefix} Successfully displayed leaderboard.`);

        } catch (error) {
            // Catch any unhandled errors.
            console.error(`[LeaderboardCmd][Guild:${guild.id}] Critical error in execute block:`, error);

            // Provide a generic error message to the user using translator.
            const userErrorMessage = t('leaderboard.error_critical');

            // Edit the deferred reply with the error message.
            // Check if deferred/replied to avoid errors when editing.
            if (interaction.deferred || interaction.replied) {
                 await interaction.editReply({ content: userErrorMessage, ephemeral: true });
            }
            // No fallback needed here as deferReply was mandatory.
        }
    },
};