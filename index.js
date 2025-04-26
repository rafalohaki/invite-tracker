/**
 * @file index.js
 * @description Main entry point for the Discord Invite Tracker bot.
 * Initializes the Discord client, connects to the database, loads commands,
 * handles events (ready, interactions, member joins/leaves), manages invite caching,
 * and runs the periodic join validation task.
 */

// Load environment variables from .env file early
require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { Client, GatewayIntentBits, Collection, Events, Partials, DiscordAPIError, PermissionsBitField } = require('discord.js'); // Added PermissionsBitField
const mongoose = require('mongoose'); // Required for graceful shutdown
const connectDB = require('./database/connection');
const UserInvite = require('./database/models/UserInvite'); // Needed for attributing joins and cleanup
const TrackedJoin = require('./database/models/TrackedJoin'); // Needed for tracking and validation
const config = require('./config'); // Load bot configuration

// --- Configuration & Constants ---

// Calculate validation period in milliseconds from config/env
const validationPeriodDays = process.env.VALIDATION_PERIOD_DAYS
    ? parseInt(process.env.VALIDATION_PERIOD_DAYS, 10)
    : config.defaultValidationPeriodDays || 7; // Default to 7 days if not set
const VALIDATION_PERIOD_MS = validationPeriodDays * 24 * 60 * 60 * 1000;

// Calculate validation check interval in milliseconds from config/env
const validationCheckIntervalMinutes = process.env.VALIDATION_CHECK_INTERVAL_MINUTES
    ? parseInt(process.env.VALIDATION_CHECK_INTERVAL_MINUTES, 10)
    : config.defaultValidationCheckIntervalMinutes || 60; // Default to check every 60 minutes
const VALIDATION_CHECK_INTERVAL_MS = validationCheckIntervalMinutes * 60 * 1000;

// Specific Discord API error codes relevant to this file
const DISCORD_ERROR_CODES = {
    UNKNOWN_INVITE: 10006,      // Invite code is invalid or expired
    UNKNOWN_MEMBER: 10007,      // Member not found
    UNKNOWN_USER: 10013,        // User not found (can happen if member not found)
    MISSING_PERMISSIONS: 50013, // Bot lacks necessary permissions
    TOKEN_INVALID: 'TokenInvalid', // Used for login error check
};


// --- Critical Environment Variable Checks ---
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
// MONGODB_URI is checked within connection.js, but an early check here adds clarity.
const MONGODB_URI = process.env.MONGODB_URI;

if (!TOKEN) {
    console.error("FATAL ERROR: DISCORD_TOKEN is not defined in the .env file. Bot cannot log in.");
    process.exit(1);
}
if (!CLIENT_ID) {
     // While not strictly needed for login, it's essential for command deployment and often useful elsewhere.
     console.error("FATAL ERROR: CLIENT_ID is not defined in the .env file.");
     process.exit(1);
}
if (!MONGODB_URI) {
    // Redundant check for emphasis and early failure detection.
    console.error("FATAL ERROR: MONGODB_URI is not defined in the .env file. Database connection required.");
    process.exit(1);
}

console.log(`[Config] Validation Period: ${validationPeriodDays} days (${VALIDATION_PERIOD_MS}ms)`);
console.log(`[Config] Validation Check Interval: ${validationCheckIntervalMinutes} minutes (${VALIDATION_CHECK_INTERVAL_MS}ms)`);


// --- Database Connection ---
// Initiate the connection to MongoDB defined in connection.js
connectDB();

// --- Discord Client Initialization ---
const client = new Client({
    // Define the events the bot needs to receive from Discord's Gateway.
    // Ensure these are ENABLED in the Discord Developer Portal!
    intents: [
        GatewayIntentBits.Guilds,           // Required for basic guild information, guild create/delete events.
        GatewayIntentBits.GuildInvites,     // Required to fetch invites and detect invite uses.
        GatewayIntentBits.GuildMembers      // Required for GuildMemberAdd and GuildMemberRemove events. *** This is a PRIVILEGED INTENT ***
    ],
    // Enable partials to receive events for uncached structures.
    partials: [
        // Required to reliably get member data (like user ID) in GuildMemberRemove events,
        // as the member might not be in the cache when they leave.
        Partials.GuildMember,
        // Add other partials if needed (e.g., Partials.User, Partials.Channel) depending on future features
    ]
});

// --- Command Handling Setup ---
// Use a Discord.js Collection to store commands, mapping command name to module.
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
let loadedCommandsCount = 0;

console.log('[CommandLoader] Loading command files...');
try {
    // Read command files from the 'commands' directory
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        try {
            // Require the command module
            const command = require(filePath);
            // Validate the command structure
            if ('data' in command && 'execute' in command) {
                // Store the command in the Collection
                client.commands.set(command.data.name, command);
                loadedCommandsCount++;
            } else {
                console.warn(`[CommandLoader] WARNING: Command file ${filePath} is missing required 'data' or 'execute' property.`);
            }
        } catch (error) {
             console.error(`[CommandLoader] ERROR: Failed to load command file ${file}:`, error);
        }
    }
    console.log(`[CommandLoader] Successfully loaded ${loadedCommandsCount} command(s).`);
} catch (error) {
     console.error("[CommandLoader] ERROR: Failed to read commands directory:", error);
     // Consider exiting if command loading fails critically, depending on bot requirements.
     // process.exit(1);
}


// --- Invite Cache ---
// Structure: Map<GuildID, Map<InviteCode, UsesCount>>
// Stores the last known usage count for each invite in each guild the bot is in.
// This is crucial for detecting which invite was used when a new member joins.
const inviteUsesCache = new Map();

/**
 * Fetches all invites for a given guild and populates the inviteUsesCache.
 * Requires 'Manage Guild' permissions.
 * @param {import('discord.js').Guild} guild - The guild to cache invites for.
 * @returns {Promise<boolean>} - True if caching was successful, false otherwise (e.g., missing permissions).
 */
async function cacheGuildInvites(guild) {
    const logPrefix = `[InviteCache][Guild:${guild.id}]`;

    // Check for 'Manage Guild' permission, which is required to fetch all invites.
    // `guild.members.me` might be null if the bot's member object isn't cached yet, hence the optional chaining.
    if (!guild.members.me?.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
        console.warn(`${logPrefix} Missing 'Manage Guild' permission. Cannot cache or reliably track invites.`);
        // Ensure no potentially stale cache exists if permissions are lost.
        inviteUsesCache.delete(guild.id);
        return false; // Indicate failure
    }

    try {
        // Fetch all invites for the guild from the Discord API.
        const invites = await guild.invites.fetch();

        // Create a new map to store invite codes and their current uses for this guild.
        const usesMap = new Map();
        invites.forEach(invite => {
            // Store the code and its uses count (default to 0 if null/undefined).
            usesMap.set(invite.code, invite.uses ?? 0);
        });

        // Update the main cache with the new uses map for this guild.
        inviteUsesCache.set(guild.id, usesMap);
        // console.log(`${logPrefix} Cached ${usesMap.size} invite uses.`); // Verbose logging removed
        return true; // Indicate success

    } catch (error) {
        // Log errors during the fetch process. This might happen despite the permission check
        // due to transient Discord issues or unexpected scenarios.
        console.error(`${logPrefix} Error caching invites:`, error);
        // Clear potentially stale cache on error to prevent incorrect attributions.
        inviteUsesCache.delete(guild.id);
        return false; // Indicate failure
    }
}

// --- Bot Event Handlers ---

// --- ClientReady Event ---
// Fired once the bot successfully connects to Discord and is ready.
client.once(Events.ClientReady, async readyClient => {
    console.log(`Logged in as ${readyClient.user.tag} (ID: ${readyClient.user.id})`);
    console.log(`Operating in ${readyClient.guilds.cache.size} guild(s).`);

    // Validate activity type - LISTENING is deprecated, use ActivityType enum or string values like 'Listening'
    try {
        readyClient.user.setActivity(`/invite | /leaderboard`, { type: 'Listening' }); // Adjust type as needed (Playing, Watching, Competing) - use string for now
    } catch (activityError) {
        console.error("Error setting bot activity:", activityError);
        // Fallback or alternative activity setting
        readyClient.user.setActivity('Tracking Invites');
    }

    // --- Initial Invite Caching ---
    // Cache invites for all guilds the bot is currently in upon startup.
    // Processing guilds sequentially with a small delay can help avoid hitting Discord rate limits.
    console.log('[Ready] Starting initial invite caching for all guilds...');
    let cachedGuilds = 0;
    let failedGuilds = 0;
    const guilds = Array.from(readyClient.guilds.cache.values()); // Get guilds as an array for stable iteration

    for (const guild of guilds) {
        const success = await cacheGuildInvites(guild);
        if (success) {
            cachedGuilds++;
        } else {
            failedGuilds++;
        }
        // Small delay between processing each guild to avoid potential rate limits on invite fetching.
        await new Promise(resolve => setTimeout(resolve, 300)); // 300ms delay
    }
    console.log(`[Ready] Initial invite caching complete. Success: ${cachedGuilds}, Failed/No Perms: ${failedGuilds}`);

    // --- Start Periodic Validation Task ---
    // Schedule the `validatePendingJoins` function to run at regular intervals.
    console.log(`[ValidationTask] Starting validation check every ${validationCheckIntervalMinutes} minutes.`);
    setInterval(validatePendingJoins, VALIDATION_CHECK_INTERVAL_MS);

    // Optional: Run the validation task once shortly after startup to process any joins
    // that might have become eligible while the bot was offline.
    setTimeout(() => {
         console.log('[ValidationTask] Running initial validation check post-startup.');
         validatePendingJoins();
    }, 5 * 60 * 1000); // Run 5 minutes after startup
});

// --- InteractionCreate Event ---
// Fired when a user interacts with the bot (e.g., uses a slash command).
client.on(Events.InteractionCreate, async interaction => {
    // Ignore interactions that are not chat input commands (e.g., button clicks, select menus).
    if (!interaction.isChatInputCommand()) return;

    // Retrieve the command logic from the client.commands collection based on the command name.
    const command = interaction.client.commands.get(interaction.commandName);

    // Handle cases where the command might not be registered or found.
    if (!command) {
        console.error(`[Interaction] No command matching '${interaction.commandName}' was found.`);
        try {
             // Inform the user that the command is unavailable.
             await interaction.reply({ content: 'Error: This command seems to be unregistered or invalid.', ephemeral: true });
        } catch (replyError) {
             // Log if replying to the interaction fails.
             console.error(`[Interaction] Failed to reply to unknown command interaction:`, replyError);
        }
        return;
    }

    // Basic logging for command execution attempts.
    const logPrefix = `[Interaction][Cmd:${interaction.commandName}][User:${interaction.user.id}][Guild:${interaction.guildId}]`;
    // console.log(`${logPrefix} Executing...`); // Verbose logging removed

    try {
        // Execute the command's logic, passing the interaction object.
        await command.execute(interaction);
    } catch (error) {
        // Catch and log any errors that occur during command execution.
        console.error(`${logPrefix} Execution Error:`, error);

        // Inform the user about the error gracefully, without exposing internal details.
        const errorMessage = 'Sorry, an unexpected error occurred while executing that command. Please try again later.';
        try {
            // Check if the interaction has already been replied to or deferred.
            if (interaction.replied || interaction.deferred) {
                // If so, use followUp to send the error message.
                await interaction.followUp({ content: errorMessage, ephemeral: true });
            } else {
                // Otherwise, use reply for the initial response.
                await interaction.reply({ content: errorMessage, ephemeral: true });
            }
        } catch (replyError) {
             // Log if sending the error reply itself fails.
             console.error(`${logPrefix} Failed to send error reply to user:`, replyError);
        }
    }
});

// --- GuildMemberAdd Event ---
// Fired when a new user joins a guild the bot is in.
client.on(Events.GuildMemberAdd, async member => {
    const { guild, user } = member;
    const logPrefix = `[GuildMemberAdd][Guild:${guild.id}][User:${user.id}]`;
    console.log(`${logPrefix} User ${user.tag} joined.`);

    // --- Step 1: Permission Check ---
    // Verify the bot has 'Manage Guild' permission *before* attempting invite operations.
    if (!guild.members.me?.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
        console.warn(`${logPrefix} Cannot determine inviter: Missing 'Manage Guild' permission.`);
        return; // Cannot proceed without permissions
    }

    // --- Step 2: Delay ---
    // Introduce a short delay. Discord's invite use counts might not update instantaneously.
    // This increases the likelihood of detecting the correct usage increase.
    await new Promise(resolve => setTimeout(resolve, 2500)); // 2.5 seconds delay

    // --- Step 3: Fetch Current Invites ---
    let currentInvites;
    try {
        // Fetch the latest state of all invites in the guild.
        currentInvites = await guild.invites.fetch();
    } catch (error) {
        console.error(`${logPrefix} Error fetching invites on join (despite permission check):`, error);
        // Cannot attribute the join without fetching current invite states.
        return;
    }

    // --- Step 4: Get Cached Invite Uses ---
    // Retrieve the previously cached invite uses for this guild.
    let cachedUses = inviteUsesCache.get(guild.id);

    // If the cache is missing (e.g., bot restarted, joined guild recently), try to cache now.
    if (!cachedUses) {
        console.warn(`${logPrefix} Invite cache missing for guild. Attempting to cache now...`);
        const cacheSuccess = await cacheGuildInvites(guild);
        // Update local variable after attempting to cache
        cachedUses = inviteUsesCache.get(guild.id);
         if (!cacheSuccess || !cachedUses) {
             // If caching still fails (e.g., permissions lost between check and now), we cannot reliably attribute.
             console.error(`${logPrefix} Failed to establish invite cache; cannot reliably attribute join.`);
             return;
         }
    }

    // --- Step 5: Compare Invites & Attribute Join ---
    // Find the invite whose use count has increased since the last cache.
    // We only care about invites generated *by this bot* via the /invite command.
    let trackedUserInvites;
    try {
        trackedUserInvites = await UserInvite.find({ guildId: guild.id }).lean(); // Fetch bot-tracked invites for this guild
    } catch (dbError) {
         console.error(`${logPrefix} Database error fetching UserInvites:`, dbError);
         // Update cache anyway before returning, as state has changed.
         await cacheGuildInvites(guild);
         return;
    }


    // If no users in this guild have used the /invite command yet, there are no bot invites to check.
    if (trackedUserInvites.length === 0) {
        // console.log(`${logPrefix} No bot-tracked invites found for this guild. Cannot attribute join.`); // Less verbose
        // Update the cache anyway to reflect the current state after the join.
        await cacheGuildInvites(guild);
        return;
    }

    let attributedInviterId = null; // The ID of the user whose invite was likely used
    let attributedInviteCode = null; // The specific invite code used
    let useCountIncreased = false;   // Flag if *any* tracked invite's use count increased

    // Use Promise.all for potential async operations inside the loop (like DB delete)
    const processingPromises = [];

    // Iterate through each invite code stored in our UserInvite collection for this guild.
    for (const userInvite of trackedUserInvites) {
        const currentInvite = currentInvites.get(userInvite.inviteCode); // Get the current state of this specific invite
        const cachedUseCount = cachedUses?.get(userInvite.inviteCode);   // Get the cached use count (handle case where cache might be partially missing)

        if (currentInvite) {
            // The invite still exists on Discord.
            const currentUses = currentInvite.uses ?? 0;

            // Compare current uses with the cached count.
            // Need `cachedUses` map to exist and the specific code to be present in it.
            if (cachedUses && cachedUseCount !== undefined && currentUses > cachedUseCount) {
                // Use count increased - this is a potential match!
                console.log(`${logPrefix} Potential attribution: Code ${userInvite.inviteCode} (Inviter: ${userInvite.userId}) uses increased from ${cachedUseCount} to ${currentUses}.`);

                // Attribute the join to the *first* invite found with an increased count.
                // Simple strategy - acknowledge potential race conditions if multiple increase.
                if (!attributedInviterId) {
                    attributedInviterId = userInvite.userId;
                    attributedInviteCode = userInvite.inviteCode;
                }
                useCountIncreased = true; // Mark that at least one use count increased
                // Don't break the loop; allow logging if other invites *also* mysteriously increased.
            } else if (cachedUses && cachedUseCount === undefined && currentUses > 0) {
                // Cache existed, but was missing this specific code (e.g., invite created while cache was stale).
                // Less reliable attribution: assume increase if uses > 0 and we haven't attributed yet.
                console.log(`${logPrefix} Note: Cache was missing for code ${userInvite.inviteCode}. Attributing if uses > 0 (${currentUses}).`);
                 if (!attributedInviterId) {
                     attributedInviterId = userInvite.userId;
                     attributedInviteCode = userInvite.inviteCode;
                     useCountIncreased = true;
                 }
            } else if (!cachedUses && currentUses > 0) {
                // Entire cache was missing initially, and this invite has uses. Weakest attribution case.
                 console.log(`${logPrefix} Note: Cache was initially missing. Attributing code ${userInvite.inviteCode} if uses > 0 (${currentUses}).`);
                 if (!attributedInviterId) {
                     attributedInviterId = userInvite.userId;
                     attributedInviteCode = userInvite.inviteCode;
                     useCountIncreased = true;
                 }
            }
        } else {
            // The invite code stored in our DB no longer exists on Discord (deleted/expired).
            console.warn(`${logPrefix} Tracked invite code ${userInvite.inviteCode} (Inviter: ${userInvite.userId}) not found on Discord. Deleting DB record.`);

            // Clean it up from the cache if it was present.
            cachedUses?.delete(userInvite.inviteCode); // Remove from the live cache map if cache exists

            // *** FIX: Delete the stale UserInvite record from the database ***
            // Use deleteOne for precision. Add promise to array for parallel execution.
            processingPromises.push(
                UserInvite.deleteOne({ _id: userInvite._id }) // Assuming lean() still provides _id
                    .then(() => console.log(`${logPrefix} Successfully deleted stale UserInvite record for code ${userInvite.inviteCode}.`))
                    .catch(dbDelErr => console.error(`${logPrefix} Failed to delete stale UserInvite record for code ${userInvite.inviteCode}:`, dbDelErr))
            );
        }
    }

    // Wait for any pending delete operations to complete
    await Promise.all(processingPromises);

    // --- Step 6: Create TrackedJoin Record ---
    if (attributedInviterId) {
        // An inviter was successfully identified.
        console.log(`${logPrefix} Attributed join to User ${attributedInviterId} via code ${attributedInviteCode}. Creating TrackedJoin record.`);
        try {
            // Create or update a TrackedJoin document for this join event.
            // Using findOneAndUpdate with upsert:true prevents duplicate 'pending' records
            // if the same user joins rapidly or if event processing is delayed.
            // It finds an existing 'pending' join for this invitee and updates it, or creates a new one.
            await TrackedJoin.findOneAndUpdate(
                { guildId: guild.id, inviteeId: user.id, status: 'pending' }, // Query: Look for existing pending join by this specific invitee
                { // Data to insert or update with:
                    $set: { // Use $set to avoid overwriting existing fields unintentionally if upserting an existing doc
                        guildId: guild.id,
                        inviteeId: user.id,
                        inviterId: attributedInviterId,     // The attributed inviter
                        inviteCodeUsed: attributedInviteCode, // The invite code used
                        joinTimestamp: new Date(),         // Record the join time accurately
                        status: 'pending',                 // Set initial status
                     },
                     // Removed $setOnInsert as we handle defaults via schema or the $set structure above
                 },
                 { upsert: true, new: true, setDefaultsOnInsert: true } // Options: Create if not found, return new doc, apply defaults
            );
            console.log(`${logPrefix} Successfully created/updated TrackedJoin record.`);
        } catch (dbError) {
            // Log failures during database interaction.
            console.error(`${logPrefix} Failed to create/update TrackedJoin record:`, dbError);
        }
    } else if (useCountIncreased) {
         // This case might occur if a non-bot invite's use count increased, but no bot-tracked invite did.
         console.log(`${logPrefix} Invite use counts increased, but couldn't attribute to a *specific* known user invite. Maybe a non-tracked invite was used?`);
    } else {
         // No invite use count increased among the tracked invites.
         // console.log(`${logPrefix} No tracked invite code usage increased. Could not attribute join.`); // Less verbose
    }

    // --- Step 7: Update Cache ---
    // Regardless of attribution success, update the cache with the latest invite counts fetched earlier.
    // This ensures the cache is current for the *next* join event.
    await cacheGuildInvites(guild);
});


// --- GuildMemberRemove Event ---
// Fired when a user leaves or is kicked/banned from a guild the bot is in.
client.on(Events.GuildMemberRemove, async member => {
    // --- Handle Partial Member Data ---
    // The 'member' object might be partial if the member wasn't cached when they left.
    // We need to attempt fetching the full member data to ensure we have IDs.
    if (member.partial) {
        try {
            // Attempt to fetch the full member object from the API.
            await member.fetch();
             // Use optional chaining for safety as `user` might still be null in rare cases.
             console.log(`[GuildMemberRemove][Guild:${member.guild?.id}] Fetched partial member ${member.user?.tag ?? member.id}`);
        } catch (error) {
            // Check if the error is due to the member being gone (expected) or another issue
            if (error instanceof DiscordAPIError && (error.code === DISCORD_ERROR_CODES.UNKNOWN_MEMBER || error.code === DISCORD_ERROR_CODES.UNKNOWN_USER)) {
                // This is expected if the user is truly gone, we can proceed if IDs are present.
                 console.log(`[GuildMemberRemove][Guild:${member.guild?.id}] Partial member ${member.id} could not be fully fetched (likely already gone), proceeding with available data.`);
            } else {
                // Log unexpected errors during fetch
                 console.error(`[GuildMemberRemove][Guild:${member.guild?.id}] Failed to fetch partial member ${member.id}:`, error);
            }
            // Proceed only if critical IDs are available even after fetch failure/expected error.
            if (!member.user || !member.guild) {
                 console.error(`[GuildMemberRemove] Partial member object missing critical IDs (user or guild) after fetch attempt. Cannot process leave for ${member.id}.`);
                 return; // Cannot proceed without user and guild IDs.
            }
        }
    }

    // --- Get IDs (Ensure they are available) ---
    // Safely access IDs, falling back to null if somehow unavailable after partial handling.
    const guildId = member.guild?.id;
    const userId = member.user?.id; // This is the ID of the user who LEFT

    // Final check for necessary IDs before proceeding.
    if (!guildId || !userId) {
         // Log if IDs couldn't be obtained even after attempting fetch.
         console.error(`[GuildMemberRemove] Could not obtain Guild ID or User ID for leaving member (ID: ${member.id}).`);
         return;
    }

    const logPrefix = `[GuildMemberRemove][Guild:${guildId}][User:${userId}]`;
    console.log(`${logPrefix} User ${member.user?.tag ?? userId} left or was removed.`);

    try {
        // --- Update TrackedJoin Status ---
        // Find any 'pending' join records for the user who left this specific guild.
        // Use updateMany for safety, although typically there should only be one pending record per user per guild.
        const result = await TrackedJoin.updateMany(
            {
                guildId: guildId,    // Match the guild
                inviteeId: userId,   // Match the user who left
                status: 'pending',   // Only update records that are still pending validation
            },
            {
                // Set the status to 'left_early' and record the timestamp.
                $set: {
                    status: 'left_early',
                    leaveTimestamp: new Date() // Record when the leave was processed
                }
            }
        );

        // Log how many records were updated.
        if (result.modifiedCount > 0) {
            // `matchedCount` = found records matching filter; `modifiedCount` = records actually changed.
            console.log(`${logPrefix} Found and updated ${result.modifiedCount} pending join record(s) for user to 'left_early'.`);
        } else {
            // It's normal for this to find 0 records if the user wasn't tracked or had already been validated/left.
            // console.log(`${logPrefix} No pending join record found for this user.`); // Less verbose logging
        }
    } catch (error) {
        // Log errors during the database update process.
        console.error(`${logPrefix} Error updating join status on leave:`, error);
    }
});

// --- Periodic Validation Function ---
/**
 * Checks for 'pending' joins that are older than the defined validation period
 * and updates their status to 'validated' if the member is still in the guild,
 * or 'left_early' if they are not found.
 * NOTE: For very large servers, consider implementing batching or cursor-based processing
 *       to avoid high memory usage when fetching many pending joins.
 */
async function validatePendingJoins() {
    const logPrefix = '[ValidationTask]';
    console.log(`${logPrefix} Running validation check...`);

    // Calculate the cutoff date: joins before this date are eligible for validation.
    const validationCutoffDate = new Date(Date.now() - VALIDATION_PERIOD_MS);

    try {
        // --- Query for Candidate Joins ---
        // Find all TrackedJoin documents that are still 'pending' and were created
        // at or before the cutoff date.
        const joinsToValidateQuery = {
            status: 'pending',
            joinTimestamp: { $lte: validationCutoffDate } // less than or equal to cutoff date
        };

        // Fetch candidate documents. Using .lean() improves performance as we only need the data.
        // SCALABILITY NOTE: For extremely large numbers of pending joins, fetch in batches
        // using .limit() and .skip() or use a Mongoose cursor (.cursor().eachAsync())
        // to avoid loading all candidates into memory at once.
        const candidates = await TrackedJoin.find(joinsToValidateQuery).lean();

        if (candidates.length === 0) {
            // console.log(`${logPrefix} No pending joins found meeting validation criteria.`); // Less verbose
            return; // Nothing to do
        }

        console.log(`${logPrefix} Found ${candidates.length} candidate join(s) for validation.`);

        // --- Prepare Bulk Operations ---
        const bulkOps = []; // Array to hold MongoDB bulk write operations
        const validationTime = new Date(); // Consistent timestamp for this validation batch
        // Cache member presence checks *within this run* to avoid multiple fetches for the same user/guild if they have multiple pending joins (unlikely but possible).
        const guildMemberPresenceCache = new Map(); // <guildId-userId, boolean>

        // --- Iterate and Verify Member Presence ---
        for (const join of candidates) {
            let guild = client.guilds.cache.get(join.guildId); // Get guild from bot's cache
            if (!guild) {
                // If the guild isn't in the cache (e.g., bot left the guild), skip this record.
                console.warn(`${logPrefix} Guild ${join.guildId} not found in cache during validation for user ${join.inviteeId}. Skipping.`);
                // Consider adding logic here to mark these joins as 'unknown' or 'guild_unavailable' if needed.
                continue;
            }

            let memberStillPresent = false;
            const memberCacheKey = `${join.guildId}-${join.inviteeId}`; // Unique key for the cache

            // Check run-specific cache first to avoid redundant API calls
            if (guildMemberPresenceCache.has(memberCacheKey)) {
                memberStillPresent = guildMemberPresenceCache.get(memberCacheKey);
                 // console.log(`${logPrefix} Using cached presence (${memberStillPresent}) for ${memberCacheKey}`); // Verbose logging
            } else {
                // Member presence not cached for this run, check Discord API.
                try {
                    // Attempt to fetch the member from the guild. If successful, they are present.
                    // Using `fetch({ user: ID })` is generally efficient. `force: false` uses Discord cache first.
                    await guild.members.fetch({ user: join.inviteeId, force: false });
                    memberStillPresent = true;
                    // console.log(`${logPrefix} Member ${join.inviteeId} found in guild ${join.guildId}.`); // Verbose logging
                } catch (error) {
                    // Check for specific errors indicating the member is not found.
                    if (error instanceof DiscordAPIError && (error.code === DISCORD_ERROR_CODES.UNKNOWN_MEMBER || error.code === DISCORD_ERROR_CODES.UNKNOWN_USER)) {
                        // Member is confirmed to be no longer in the guild.
                        memberStillPresent = false;
                        // console.log(`${logPrefix} Member ${join.inviteeId} NOT found in guild ${join.guildId} (Error Code: ${error.code}).`); // Verbose logging
                    } else {
                        // Log other unexpected errors during fetch (e.g., rate limits, network issues, permissions).
                        console.error(`${logPrefix} Unexpected error fetching member ${join.inviteeId} in guild ${join.guildId} during validation:`, error);
                        // Skip processing this join for now, hoping the error resolves by the next check.
                        // Add this candidate to the cache as 'undetermined' for this run to avoid retrying immediately.
                        guildMemberPresenceCache.set(memberCacheKey, 'error_skip');
                        continue;
                    }
                }
                // Cache the result (true or false) for this run
                guildMemberPresenceCache.set(memberCacheKey, memberStillPresent);
            }

             // If presence was 'error_skip' from cache, skip bulk op prep
             if (guildMemberPresenceCache.get(memberCacheKey) === 'error_skip') {
                continue;
            }

            // --- Prepare Bulk Operation based on Presence ---
            if (memberStillPresent) {
                // Member is still in the guild, mark the join as 'validated'.
                bulkOps.push({
                    updateOne: {
                        // Filter precisely by document ID and ensure status is still 'pending'
                        // (in case it changed between the initial find and now).
                        filter: { _id: join._id, status: 'pending' },
                        update: {
                            $set: {
                                status: 'validated',
                                validationTimestamp: validationTime // Record when validation occurred
                            }
                        }
                    }
                });
            } else {
                // Member was not found in the guild. Mark as 'left_early' retroactively.
                // This handles cases where the GuildMemberRemove event was missed (e.g., bot offline).
                console.log(`${logPrefix} User ${join.inviteeId} (Join ID: ${join._id}) not found in guild ${join.guildId}. Marking as 'left_early'.`);
                bulkOps.push({
                     updateOne: {
                         filter: { _id: join._id, status: 'pending' },
                         update: {
                             $set: {
                                 status: 'left_early',
                                 // Use validationTime as the best guess for when they were confirmed gone.
                                 leaveTimestamp: validationTime
                             }
                         }
                     }
                 });
            }
        } // End of candidate loop

        // --- Execute Bulk Write Operation ---
        if (bulkOps.length > 0) {
            const validatedCount = bulkOps.filter(op => op.updateOne.update.$set.status === 'validated').length;
            const leftEarlyCount = bulkOps.filter(op => op.updateOne.update.$set.status === 'left_early').length;
            console.log(`${logPrefix} Attempting bulk update for ${validatedCount} validations and ${leftEarlyCount} retroactive leaves.`);

            try {
                // Execute all prepared update operations in a single batch.
                // `ordered: false` allows MongoDB to process operations in parallel (potentially faster)
                // and continue even if one operation fails.
                const result = await TrackedJoin.bulkWrite(bulkOps, { ordered: false });
                console.log(`${logPrefix} Bulk update result: ${result.modifiedCount} document(s) modified (Matched: ${result.matchedCount}, Upserted: ${result.upsertedCount}).`);

                // Optional: Check if the modified count matches the expected count. Mismatches could indicate
                // race conditions where a record's status changed between the `find` and `bulkWrite`.
                const expectedModifications = bulkOps.length; // Simpler check based on operations prepared
                 if (result.modifiedCount !== expectedModifications) {
                     // This can happen if a record's status changed (e.g., to 'left_early' by GuildMemberRemove) between the find and bulkWrite.
                     console.warn(`${logPrefix} Mismatch in expected modified count. Expected ${expectedModifications}, Got ${result.modifiedCount}. Some records might have changed status or failed update individually (check MongoDB logs if needed).`);
                 }
            } catch (bulkWriteError) {
                console.error(`${logPrefix} Error executing bulk write operation:`, bulkWriteError);
                 // Handle bulk write errors (e.g., log details, potentially retry failed operations).
                 // If ordered:false, check bulkWriteError.writeErrors for individual failures.
            }
        } else {
             // This message now accounts for candidates skipped due to errors or missing guilds.
            console.log(`${logPrefix} No update operations to perform after checking member presence/guild status for ${candidates.length} candidate(s).`);
        }

    } catch (error) {
        // Catch errors related to the initial find query or other unexpected issues.
        console.error(`${logPrefix} Critical error during validation process:`, error);
    }
}

// --- Other Client Event Handlers ---

// --- GuildCreate Event ---
// Fired when the bot joins a new guild.
client.on(Events.GuildCreate, async guild => {
    console.log(`Joined new guild: ${guild.name} (ID: ${guild.id}). Members: ${guild.memberCount}`);
    // Cache invites for the new guild immediately.
    await cacheGuildInvites(guild);
});

// --- GuildDelete Event ---
// Fired when the bot leaves or is kicked from a guild.
client.on(Events.GuildDelete, async guild => { // Made async for potential cleanup
     // Check if the guild object is available (it might be partial or unavailable if kicked abruptly)
     if (!guild || !guild.id) { // Only ID is strictly necessary for cache/DB cleanup
         console.log(`Left or was removed from a guild (ID unavailable or guild object partial). Cache/DB cleanup skipped.`);
         return;
     }

     const guildId = guild.id;
     const guildName = guild.name ?? `ID: ${guildId}`; // Use name if available, else ID

     console.log(`Left guild: ${guildName}.`);
     // Clear the invite cache for the guild the bot left.
     inviteUsesCache.delete(guildId);
     console.log(`[GuildDelete] Cleared invite cache for guild ${guildId}.`);

     // Optional: Add database cleanup logic here if desired.
     // This could involve deleting UserInvite and TrackedJoin records associated with the removed guild.
     // Use with caution, as this is destructive. Consider adding a config flag to enable/disable this.
     const performCleanup = process.env.PERFORM_GUILD_DELETE_CLEANUP === 'true'; // Example flag check
     if (performCleanup) {
        console.log(`[GuildDelete] Initiating database cleanup for guild ${guildId}...`);
        try {
            const trackedResult = await TrackedJoin.deleteMany({ guildId: guildId });
            console.log(`[GuildDelete][Cleanup] Deleted ${trackedResult.deletedCount} TrackedJoin records for guild ${guildId}.`);
        } catch (e) {
            console.error(`[GuildDelete][Cleanup] Failed to cleanup TrackedJoins for guild ${guildId}:`, e);
        }
        try {
            const userInviteResult = await UserInvite.deleteMany({ guildId: guildId });
            console.log(`[GuildDelete][Cleanup] Deleted ${userInviteResult.deletedCount} UserInvite records for guild ${guildId}.`);
        } catch (e) {
             console.error(`[GuildDelete][Cleanup] Failed to cleanup UserInvites for guild ${guildId}:`, e);
        }
     } else {
        console.log(`[GuildDelete] Database cleanup for guild ${guildId} is disabled.`);
     }
});

// --- Warn Event ---
// Fired for warnings from the discord.js library itself.
client.on(Events.Warn, warning => {
    console.warn('[Discord Client Warning]', warning);
});

// --- Error Event ---
// Fired for non-fatal errors from the discord.js library.
client.on(Events.Error, error => {
    console.error('[Discord Client Error]', error);
});


// --- Bot Login ---
console.log("Attempting to log in to Discord...");
client.login(TOKEN).catch(error => {
    // Catch critical errors during the login process.
    console.error("FATAL ERROR: Failed to login to Discord:", error);
    // Provide specific hints based on common login errors.
    if (error.code === DISCORD_ERROR_CODES.TOKEN_INVALID) {
         console.error("Error details: The DISCORD_TOKEN in your .env file is invalid or missing. Please check it.");
    } else if (error.message.includes('disallowed intents') || error.message.includes('Privileged Intents')) {
         console.error("Error details: Ensure all required intents (Guilds, GuildInvites, GuildMembers) are enabled in your bot's settings on the Discord Developer Portal.");
         console.error("Hint: 'GuildMembers' is a PRIVILEGED INTENT and must be explicitly enabled.");
    } else {
         console.error("An unexpected error occurred during login. Check network connectivity and Discord status.");
    }
    // Exit the process if login fails critically.
    process.exit(1);
});

// --- Graceful Shutdown Integration ---
// The SIGINT/SIGTERM handlers in connection.js handle mongoose closing.
// We integrate client destruction before calling the original handler.

// Helper function to avoid code duplication in signal handlers
async function shutdown(signal) {
    console.log(`Received ${signal}. Shutting down gracefully...`);
    console.log('Destroying Discord client...');
    client.destroy(); // Close Discord connection
    console.log('Discord client destroyed.');
    // Now call the gracefulShutdown function exported or defined in connection.js
    // Assuming connection.js handles mongoose.close() and process.exit()
    // We need to make sure the DB connection function runs AFTER client.destroy()

    // If connection.js's gracefulShutdown wasn't exported, we replicate its core logic here:
    console.log(`Closing MongoDB connection via ${signal} handler...`);
    try {
        await mongoose.connection.close();
        console.log('MongoDB connection closed successfully.');
    } catch (err) {
        console.error('Error closing MongoDB connection during shutdown:', err);
    } finally {
        console.log('Exiting process.');
        process.exit(0); // Exit cleanly
    }
}

// Replace default handlers with our combined shutdown logic
process.removeAllListeners('SIGINT'); // Remove any default or connection.js handlers first
process.on('SIGINT', () => shutdown('SIGINT'));

process.removeAllListeners('SIGTERM');
process.on('SIGTERM', () => shutdown('SIGTERM'));