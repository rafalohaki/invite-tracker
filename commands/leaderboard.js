/**
 * @file commands/leaderboard.js
 * @description Slash command to display the top inviters based on validated joins (users who stayed > 1 week).
 * Uses SQLite GROUP BY aggregation for efficient data retrieval.
 */

'use strict';

const { SlashCommandBuilder, EmbedBuilder, GuildMember, MessageFlags } = require('discord.js');
const db = require('../database/db');
const config = require('../config');
const { logDebug, logInfo, logWarn, logError } = require('../utils/logger');

const LEADERBOARD_CONFIG = config.leaderboard;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription(`Shows the top ${LEADERBOARD_CONFIG.limit} inviters based on validated invites (user stayed > 1 week).`),

    async execute(interaction) {
        const { guild } = interaction;
        const t = interaction.client.t;

        if (!guild) {
            return interaction.reply({ content: t('general.error_guild_only'), flags: MessageFlags.Ephemeral });
        }

        await interaction.deferReply();

        const logPrefix = `[LeaderboardCmd][Guild:${guild.id}]`;

        try {
            logInfo(`${logPrefix} Aggregating validated joins from DB...`);

            // --- Step 1: Aggregate Validated Joins from Database ---
            const leaderboardData = db.trackedJoins.getLeaderboard(guild.id, LEADERBOARD_CONFIG.limit);

            if (!leaderboardData || leaderboardData.length === 0) {
                logInfo(`${logPrefix} No validated invites found in DB.`);
                return interaction.editReply({ content: t('leaderboard.no_data') });
            }
            logInfo(`${logPrefix} Found ${leaderboardData.length} leaderboard entries.`);

            // --- Step 2: Fetch Member Details for Display Names ---
            logDebug(`${logPrefix} Fetching member details for top entries...`);
            const leaderboardEntries = [];

            for (const entry of leaderboardData) {
                let displayName = t('leaderboard.unknown_user_format', { userId: entry.inviterId });

                try {
                    const member = await guild.members.fetch(entry.inviterId);
                    if (member instanceof GuildMember) {
                        displayName = member.displayName;
                    } else {
                        logWarn(`${logPrefix} Fetched data for ID ${entry.inviterId} was not a GuildMember.`);
                    }
                } catch (fetchError) {
                    if (fetchError.code === 10007 || fetchError.code === 10013) {
                        logWarn(`${logPrefix} Inviter ${entry.inviterId} not found in guild (likely left).`);
                        displayName = t('leaderboard.left_user_format', { userId: entry.inviterId });
                    } else {
                        logError(`${logPrefix} Error fetching member ${entry.inviterId}:`, fetchError);
                    }
                }

                leaderboardEntries.push({ userId: entry.inviterId, displayName, count: entry.count });
            }

            // --- Step 3: Build the Leaderboard Embed ---
            logDebug(`${logPrefix} Building leaderboard embed...`);

            const descriptionLines = leaderboardEntries.map((entry, index) =>
                t('leaderboard.entry_format', {
                    rank: index + 1,
                    username: entry.displayName,
                    count: entry.count,
                })
            );

            let embedDescription = descriptionLines.join('\n') || t('leaderboard.no_data');
            if (embedDescription.length > 4096) {
                logWarn(`${logPrefix} Leaderboard description exceeded 4096 characters. Truncating.`);
                embedDescription = embedDescription.substring(0, 4090) + '\n...';
            }

            const embed = new EmbedBuilder()
                .setColor(LEADERBOARD_CONFIG.embedColor)
                .setTitle(t('leaderboard.embed_title', { guild_name: guild.name }))
                .setDescription(embedDescription)
                .setTimestamp()
                .setFooter({ text: t('leaderboard.footer_text', { count: leaderboardEntries.length }) });

            await interaction.editReply({ embeds: [embed] });
            logInfo(`${logPrefix} Successfully displayed leaderboard.`);

        } catch (error) {
            logError(`${logPrefix} Critical error in execute block:`, error);
            const userErrorMessage = t('leaderboard.error_critical');
            if (interaction.deferred || interaction.replied) {
                await interaction.followUp({ content: userErrorMessage, flags: MessageFlags.Ephemeral });
            }
        }
    },
};