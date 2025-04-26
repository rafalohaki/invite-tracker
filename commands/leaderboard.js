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

// Cache removed as counts depend on dynamic validation status. Re-adding requires careful invalidation logic.

module.exports = {
    /**
     * @description Slash command definition.
     * @type {import('discord.js').SlashCommandBuilder}
     */
    data: new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription(`Shows the top ${LEADERBOARD_CONFIG.limit} inviters based on validated invites (user stayed > 1 week).`),

    /**
     * @description Executes the /leaderboard command logic.
     * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object.
     */
    async execute(interaction) {
        const { guild } = interaction;

        // Ensure the command is run within a server
        if (!guild) {
            return interaction.reply({ content: 'This command can only be used within a server.', ephemeral: true });
        }

        // Acknowledge the command immediately; aggregation and member fetching can take time.
        await interaction.deferReply();

        const logPrefix = `[LeaderboardCmd][Guild:${guild.id}]`;

        try {
            console.log(`${logPrefix} Aggregating validated joins from DB...`);

            // --- Step 1: Aggregate Validated Joins from Database ---
            // Use MongoDB's aggregation pipeline for efficient processing directly in the database.
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
                return interaction.editReply({ content: 'No validated invite data found yet. Users need to join via `/invite` links and stay for 1 week!', ephemeral: true });
            }
            console.log(`${logPrefix} Found ${leaderboardData.length} leaderboard entries.`);

            // --- Step 2: Fetch Member Details for Usernames ---
            // The aggregation only returns IDs; we need to fetch usernames for display.
            console.log(`${logPrefix} Fetching member details for top entries...`);
            const leaderboardEntries = [];
            for (const entry of leaderboardData) {
                let username = `Unknown User (${entry._id})`; // Default fallback if member fetching fails

                try {
                    // Fetch the GuildMember object using the inviter's ID.
                    const member = await guild.members.fetch(entry._id);

                    // Ensure the fetched object is actually a GuildMember (paranoid check).
                    if (member instanceof GuildMember) {
                       username = member.user.tag; // Use "Username#Discriminator" format
                    } else {
                         // Log if fetch returned something unexpected.
                         console.warn(`${logPrefix} Fetched data for ID ${entry._id} was not a GuildMember.`);
                    }
                } catch (fetchError) {
                     // Handle cases where the inviter might have left the server after their invites were validated.
                    if (fetchError.code === 10007 /* Unknown Member */ || fetchError.code === 10013 /* Unknown User */) {
                        console.warn(`${logPrefix} Inviter ${entry._id} not found in guild (likely left).`);
                        username = `Left User (${entry._id})`; // Indicate the user has left
                    } else {
                        // Log other unexpected errors during member fetching.
                        console.error(`${logPrefix} Error fetching member ${entry._id}:`, fetchError);
                        // Keep the default 'Unknown User' username.
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

            // Format each entry into a numbered list string.
            const descriptionLines = leaderboardEntries.map((entry, index) => {
                // Using backticks for the count makes it stand out.
                return `${index + 1}. **${entry.username}** - \`${entry.count}\` validated invites`;
            });

            // Join the lines into a single description string, providing a fallback message.
            let embedDescription = descriptionLines.join('\n') || 'No validated invites yet.';

            // Discord embed descriptions have a character limit (4096). Truncate if necessary.
            if (embedDescription.length > 4096) {
                console.warn(`${logPrefix} Leaderboard description exceeded 4096 characters. Truncating.`);
                embedDescription = embedDescription.substring(0, 4090) + '\n...'; // Truncate slightly below limit
            }

            // Construct the embed object.
            const embed = new EmbedBuilder()
                .setColor(LEADERBOARD_CONFIG.embedColor)
                .setTitle(`🏆 Validated Invite Leaderboard for ${guild.name}`)
                .setDescription(embedDescription)
                .setTimestamp()
                // Footer clarifies the scope and validation criteria.
                .setFooter({ text: `Showing Top ${leaderboardEntries.length} | Invites count after 1 week stay` });
                // Consider adding total validated invites in the server (requires another DB query) if desired.

            // Edit the deferred reply with the final embed.
            await interaction.editReply({ embeds: [embed] });
            console.log(`${logPrefix} Successfully displayed leaderboard.`);

        } catch (error) {
            // Catch any unhandled errors during aggregation, fetching, or embed building.
            console.error(`[LeaderboardCmd][Guild:${guild.id}] Critical error in execute block:`, error);

            // Provide a generic error message to the user.
            const userErrorMessage = 'An unexpected error occurred while generating the leaderboard. Please try again later.';

            // Edit the deferred reply with the error message.
            if (interaction.deferred || interaction.replied) {
                 await interaction.editReply({ content: userErrorMessage, ephemeral: true });
            }
            // No fallback needed here as deferReply was mandatory.
        }
    },
};