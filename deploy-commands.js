/**
 * @file deploy-commands.js
 * @description Script to register or update slash commands with Discord's API.
 * Reads command definitions from the 'commands' directory and sends them to Discord.
 * Can deploy globally or to a specific test guild (faster updates).
 */

require('dotenv').config(); // Load environment variables from .env file
const { REST, Routes } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');

// --- Configuration and Environment Variables ---
const TOKEN = process.env.DISCORD_TOKEN;       // Bot's authentication token
const CLIENT_ID = process.env.CLIENT_ID;       // Bot's application ID
const GUILD_ID = process.env.TEST_GUILD_ID; // Optional: Guild ID for testing deployment

// --- Critical Environment Variable Checks ---
if (!TOKEN || !CLIENT_ID) {
    console.error("FATAL ERROR: DISCORD_TOKEN or CLIENT_ID missing in .env file. Cannot deploy commands.");
    process.exit(1);
}

// --- Load Command Files ---
const commands = []; // Array to hold command data in the format Discord API expects
const commandsPath = path.join(__dirname, 'commands'); // Path to the commands directory
let loadedCount = 0;

console.log('[Deploy] Reading command files...');
try {
    // Read all .js files from the commands directory
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
    console.log(`[Deploy] Found ${commandFiles.length} potential command file(s).`);

    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        try {
            // Require the command file
            const command = require(filePath);
            // Validate that the command module has the required 'data' (SlashCommandBuilder) and 'execute' properties
            if ('data' in command && 'execute' in command) {
                // Add the command's JSON representation to the list
                commands.push(command.data.toJSON());
                loadedCount++;
                 console.log(`[Deploy] Added command data: ${command.data.name}`);
            } else {
                // Warn if a file is missing the required structure
                console.warn(`[Deploy] WARNING: Command file ${filePath} is missing a required 'data' or 'execute' property.`);
            }
        } catch (error) {
             // Log errors encountered while requiring a specific command file
             console.error(`[Deploy] ERROR: Could not load command file ${file}:`, error);
        }
    }
} catch (error) {
     // Log errors encountered while reading the commands directory itself
     console.error("[Deploy] ERROR: Failed to read commands directory:", error);
     process.exit(1); // Exit if we can't even read the directory
}

// --- Check if any commands were loaded ---
if (commands.length === 0) {
     console.error("[Deploy] ERROR: No valid command data found to deploy. Check command files for errors.");
     process.exit(1); // Exit if there's nothing to deploy
}

// --- Prepare REST Client ---
// Create a new REST client instance to interact with the Discord API
const rest = new REST().setToken(TOKEN);

// --- Deploy Commands (IIFE - Immediately Invoked Function Expression) ---
(async () => {
    try {
        console.log(`[Deploy] Started refreshing ${commands.length} application (/) commands.`);

        let route;
        let deployScope;

        // Determine the deployment route based on whether a TEST_GUILD_ID is provided
        if (GUILD_ID) {
            // Deploying to a specific guild (for testing) - updates are near-instant
            route = Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID);
            deployScope = `TEST guild (ID: ${GUILD_ID})`;
            console.log(`[Deploy] Target: Deploying to TEST guild.`);
        } else {
            // Deploying globally - updates can take up to an hour to propagate to all guilds
            route = Routes.applicationCommands(CLIENT_ID);
            deployScope = 'GLOBALLY';
            console.log(`[Deploy] Target: Deploying GLOBALLY. (Updates may take up to 1 hour)`);
        }

        console.log(`[Deploy] Sending ${commands.length} commands to Discord via route: ${route}`);

        // Send the PUT request to Discord to update the commands
        // The body contains the array of command JSON data
        const data = await rest.put(
            route,
            { body: commands },
        );

        // Log success message, indicating the scope and number of commands refreshed
        console.log(`[Deploy] Successfully reloaded ${data.length} application (/) commands ${deployScope}.`);

    } catch (error) {
        // Catch and log any errors during the deployment process
        console.error('[Deploy] Failed to refresh commands:', error);

        // Provide more detailed error information if available from the Discord API response
        if (error.rawError) {
            console.error('[Deploy] Discord API Error Details:', JSON.stringify(error.rawError, null, 2));
        }
        // Provide specific hints for common error codes
        if (error.code === 50001 && GUILD_ID) {
             console.error("[Deploy] Hint: Error 50001 (Missing Access) when deploying to a guild usually means the bot (CLIENT_ID) is NOT in the specified TEST_GUILD_ID.");
        }
         if (error.code === 50001 && !GUILD_ID) {
             console.error("[Deploy] Hint: Error 50001 (Missing Access) when deploying globally might indicate an incorrect CLIENT_ID or the bot hasn't been invited with the 'application.commands' scope.");
        }
         // Add more hints for other potential error codes as needed
    }
})();