/**
 * @file index.js
 * @description Main entry point for the Discord Invite Tracker bot.
 * Initializes the Discord client, connects to the database, loads commands,
 * handles events (ready, interactions, member joins/leaves), manages invite caching,
 * runs the periodic join validation task, and supports custom translations.
 */

// Load environment variables from .env file early
require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { Client, GatewayIntentBits, Collection, Events, Partials, DiscordAPIError, PermissionsBitField, ActivityType } = require('discord.js');
const mongoose = require('mongoose');
const connectDB = require('./database/connection');
const UserInvite = require('./database/models/UserInvite');
const TrackedJoin = require('./database/models/TrackedJoin');
const config = require('./config');
const { loadTranslations, t } = require('./utils/translator');

// --- Load Translations ---
loadTranslations();

// --- Configuration & Constants ---
const validationPeriodDays = parseInt(process.env.VALIDATION_PERIOD_DAYS || config.defaultValidationPeriodDays || 7, 10);
const VALIDATION_PERIOD_MS = validationPeriodDays * 24 * 60 * 60 * 1000;
const validationCheckIntervalMinutes = parseInt(process.env.VALIDATION_CHECK_INTERVAL_MINUTES || config.defaultValidationCheckIntervalMinutes || 60, 10);
const VALIDATION_CHECK_INTERVAL_MS = validationCheckIntervalMinutes * 60 * 1000;
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const MONGODB_URI = process.env.MONGODB_URI;
const PERFORM_GUILD_DELETE_CLEANUP = process.env.PERFORM_GUILD_DELETE_CLEANUP === 'true';

const DISCORD_ERROR_CODES = {
    UNKNOWN_INVITE: 10006,
    UNKNOWN_MEMBER: 10007,
    UNKNOWN_USER: 10013,
    MISSING_PERMISSIONS: 50013,
    TOKEN_INVALID: 'TokenInvalid',
};

// --- Critical Environment Variable Checks ---
if (!TOKEN || !CLIENT_ID || !MONGODB_URI) {
    console.error("FATAL ERROR: DISCORD_TOKEN, CLIENT_ID, or MONGODB_URI is missing in the .env file.");
    process.exit(1);
}

console.log(`[Config] Validation Period: ${validationPeriodDays} days (${VALIDATION_PERIOD_MS}ms)`);
console.log(`[Config] Validation Check Interval: ${validationCheckIntervalMinutes} minutes (${VALIDATION_CHECK_INTERVAL_MS}ms)`);
console.log(`[Config] Locale setting (LOCALE_LANG): ${process.env.LOCALE_LANG || 'en (default)'}`);
console.log(`[Config] Guild delete cleanup: ${PERFORM_GUILD_DELETE_CLEANUP}`);

// --- Database Connection ---
connectDB();

// --- Discord Client Initialization ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildInvites,
        GatewayIntentBits.GuildMembers // PRIVILEGED INTENT
    ],
    partials: [Partials.GuildMember]
});

// --- Translator & Command Setup ---
client.t = t;
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
_loadCommands(client, commandsPath); // Use helper

// --- Invite Cache ---
// Structure: Map<GuildID, Map<InviteCode, UsesCount>>
const inviteUsesCache = new Map();

// --- Helper Functions ---

/** Loads slash commands from the specified directory into the client. */
function _loadCommands(clientInstance, directoryPath) {
    console.log('[CommandLoader] Loading command files...');
    let loadedCount = 0;
    try {
        const commandFiles = fs.readdirSync(directoryPath).filter(file => file.endsWith('.js'));
        for (const file of commandFiles) {
            const filePath = path.join(directoryPath, file);
            try {
                const command = require(filePath);
                if ('data' in command && 'execute' in command) {
                    clientInstance.commands.set(command.data.name, command);
                    loadedCount++;
                } else {
                    console.warn(`[CommandLoader] WARNING: Command file ${filePath} is missing required 'data' or 'execute'.`);
                }
            } catch (error) {
                console.error(`[CommandLoader] ERROR: Failed to load command file ${file}:`, error);
            }
        }
        console.log(`[CommandLoader] Successfully loaded ${loadedCount} command(s).`);
    } catch (error) {
        console.error("[CommandLoader] ERROR: Failed to read commands directory:", error);
    }
}

/**
 * Checks bot permissions necessary for invite tracking.
 * @param {import('discord.js').Guild} guild - The guild to check permissions in.
 * @param {string} logPrefix - Prefix for logging.
 * @returns {boolean} True if permissions are sufficient, false otherwise.
 */
function _hasRequiredPermissions(guild, logPrefix) {
    // Ensure guild.members.me is available
    if (!guild.members.me) {
        console.warn(`${logPrefix} Bot member object (guild.members.me) is unavailable. Cannot check permissions.`);
        return false;
    }
    if (!guild.members.me.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
        console.warn(`${logPrefix} Missing 'Manage Guild' permission. Cannot cache or reliably track invites.`);
        return false;
    }
    return true;
}

/**
 * Fetches all invites for a guild and populates the inviteUsesCache.
 * Requires 'Manage Guild' permissions.
 * @param {import('discord.js').Guild} guild - The guild to cache invites for.
 * @returns {Promise<boolean>} - True if caching was successful, false otherwise.
 */
async function cacheGuildInvites(guild) {
    const logPrefix = `[InviteCache][Guild:${guild.id}]`;

    if (!_hasRequiredPermissions(guild, logPrefix)) {
        inviteUsesCache.delete(guild.id); // Clear stale cache if perms lost
        return false;
    }

    try {
        const invites = await guild.invites.fetch();
        const usesMap = new Map();
        invites.forEach(invite => usesMap.set(invite.code, invite.uses ?? 0));
        inviteUsesCache.set(guild.id, usesMap);
        // console.log(`${logPrefix} Cached ${usesMap.size} invite uses.`); // Less verbose
        return true;
    } catch (error) {
        if (error instanceof DiscordAPIError && error.code === DISCORD_ERROR_CODES.MISSING_PERMISSIONS) {
            console.warn(`${logPrefix} Missing 'Manage Guild' permissions while trying to fetch invites.`);
        } else {
            console.error(`${logPrefix} Error caching invites:`, error);
        }
        inviteUsesCache.delete(guild.id); // Clear potentially bad cache on error
        return false;
    }
}

/**
 * Safely fetches current invites for a guild.
 * @param {import('discord.js').Guild} guild - The guild object.
 * @param {string} logPrefix - Prefix for logging.
 * @returns {Promise<Collection<string, import('discord.js').Invite>|null>} Invite collection or null on error.
 */
async function _fetchGuildInvitesSafe(guild, logPrefix) {
    try {
        // Before fetching, ensure we still have permissions
        if (!_hasRequiredPermissions(guild, logPrefix)) return null;
        return await guild.invites.fetch();
    } catch (error) {
         if (error instanceof DiscordAPIError && error.code === DISCORD_ERROR_CODES.MISSING_PERMISSIONS) {
            console.warn(`${logPrefix} Missing 'Manage Guild' permissions while trying to fetch invites.`);
        } else {
            console.error(`${logPrefix} Error fetching invites (needed for attribution):`, error);
        }
        return null;
    }
}

/**
 * Ensures the invite cache for a guild is populated.
 * @param {import('discord.js').Guild} guild - The guild object.
 * @param {string} logPrefix - Prefix for logging.
 * @returns {Promise<Map<string, number>|null>} The uses map from cache, or null if failed.
 */
async function _ensureInviteCache(guild, logPrefix) {
    let cachedUses = inviteUsesCache.get(guild.id);
    if (!cachedUses) {
        console.warn(`${logPrefix} Invite cache missing. Attempting to cache now...`);
        const cacheSuccess = await cacheGuildInvites(guild);
        cachedUses = inviteUsesCache.get(guild.id); // Re-fetch after attempting cache
        if (!cacheSuccess || !cachedUses) {
            console.error(`${logPrefix} Failed to establish invite cache; cannot reliably attribute join.`);
            return null;
        }
    }
    return cachedUses;
}

/**
 * Fetches UserInvite documents relevant to the bot for a specific guild.
 * @param {string} guildId - The guild ID.
 * @param {string} logPrefix - Prefix for logging.
 * @returns {Promise<Array<object>|null>} Array of lean UserInvite objects or null on error.
 */
async function _getTrackedUserInvites(guildId, logPrefix) {
    try {
        return await UserInvite.find({ guildId }).lean();
    } catch (dbError) {
        console.error(`${logPrefix} Database error fetching UserInvites:`, dbError);
        return null;
    }
}

/**
 * Checks a single tracked invite against current Discord state and cache.
 * @param {object} userInvite - A lean UserInvite document from DB.
 * @param {Collection<string, import('discord.js').Invite>|null} currentInvites - Freshly fetched invites.
 * @param {Map<string, number>|null} cachedUses - Previously cached uses map.
 * @param {string} logPrefix - Prefix for logging.
 * @returns {{ isStale: boolean, usageIncreased: boolean }} - Result of the check.
 */
function _checkSingleInvite(userInvite, currentInvites, cachedUses, logPrefix) {
    const currentInvite = currentInvites?.get(userInvite.inviteCode);
    const cachedUseCount = cachedUses?.get(userInvite.inviteCode);
    let usageIncreased = false;

    if (!currentInvite) {
        // Invite deleted on Discord
        console.warn(`${logPrefix} Tracked invite code ${userInvite.inviteCode} (Inviter: ${userInvite.userId}) not found on Discord. Marking for DB deletion.`);
        cachedUses?.delete(userInvite.inviteCode); // Clean from live cache map immediately
        return { isStale: true, usageIncreased: false };
    }

    // Invite exists, check usage
    const currentUses = currentInvite.uses ?? 0;
    if (cachedUses && cachedUseCount !== undefined && currentUses > cachedUseCount) {
        // Standard case: Cache exists and usage increased
        console.log(`${logPrefix} Potential attribution: Code ${userInvite.inviteCode} (Inviter: ${userInvite.userId}) uses increased from ${cachedUseCount} to ${currentUses}.`);
        usageIncreased = true;
    } else if ((!cachedUses || cachedUseCount === undefined) && currentUses > 0) {
        // Fallback case: Cache or specific code was missing, attribute if uses > 0
        console.log(`${logPrefix} Note: Cache missing/incomplete for code ${userInvite.inviteCode}. Attributing based on current uses > 0 (${currentUses}).`);
        usageIncreased = true;
    }

    return { isStale: false, usageIncreased: usageIncreased };
}


/**
 * Compares current invite uses with cached uses to find the used invite and identify stale ones.
 * Refactored to use _checkSingleInvite. Complexity reduced.
 * @param {Collection<string, import('discord.js').Invite>|null} currentInvites - Freshly fetched invites.
 * @param {Map<string, number>|null} cachedUses - Previously cached uses map.
 * @param {Array<object>} trackedUserInvites - UserInvites from the database.
 * @param {string} logPrefix - Prefix for logging.
 * @returns {{ attribution: { inviterId: string, inviteCode: string } | null, staleInviteIds: string[] }} Result object.
 */
function _findUsedInviteAndStale(currentInvites, cachedUses, trackedUserInvites, logPrefix) {
    let attribution = null;
    const staleInviteIds = []; // Store IDs (_id from lean object) of invites to delete from DB
    let anyUsageIncreased = false; // Track if *any* invite saw an increase

    if (!currentInvites) {
        console.warn(`${logPrefix} Cannot compare invites: currentInvites collection is null.`);
        // Mark all tracked invites as potentially stale if we can't verify? Or just return empty?
        // Safest is to do nothing and let next join/cache attempt sort it out.
        return { attribution: null, staleInviteIds: [] };
    }

    for (const userInvite of trackedUserInvites) {
        const checkResult = _checkSingleInvite(userInvite, currentInvites, cachedUses, logPrefix);

        if (checkResult.isStale) {
            staleInviteIds.push(userInvite._id.toString()); // Store the DB document ID
        }

        if (checkResult.usageIncreased) {
            anyUsageIncreased = true;
            // Only attribute the *first* invite found with increased usage
            if (!attribution) {
                attribution = { inviterId: userInvite.userId, inviteCode: userInvite.inviteCode };
            }
        }
    }

     // Log if uses increased overall, but not for the invite we ended up attributing (or if none was attributed)
     if (anyUsageIncreased && !attribution) {
         console.log(`${logPrefix} Invite use counts increased, but couldn't attribute to a *specific* known user invite. Maybe a non-tracked invite was used?`);
     } else if (anyUsageIncreased && attribution) {
        // This just confirms attribution happened when an increase was detected. Debug log mostly.
        // console.log(`${logPrefix} Attributed join based on usage increase for ${attribution.inviteCode}.`);
     }


    return { attribution, staleInviteIds };
}

/**
 * Deletes stale UserInvite records from the database.
 * @param {string[]} staleInviteIds - Array of UserInvite document IDs (_id) to delete.
 * @param {string} guildId - The guild ID.
 * @param {string} logPrefix - Prefix for logging.
 */
async function _cleanupStaleInvites(staleInviteIds, guildId, logPrefix) {
    if (staleInviteIds.length === 0) return;
    try {
        const result = await UserInvite.deleteMany({ _id: { $in: staleInviteIds }, guildId }); // Ensure guildId match for safety
        console.log(`${logPrefix} Deleted ${result.deletedCount} stale UserInvite record(s) from DB.`);
    } catch (dbDelErr) {
        console.error(`${logPrefix} Failed to delete stale UserInvite records:`, dbDelErr);
    }
}

/**
 * Creates or updates a TrackedJoin record for a new member.
 * @param {string} guildId - Guild ID.
 * @param {string} inviteeId - User ID of the new member.
 * @param {string} inviterId - User ID of the attributed inviter.
 * @param {string} inviteCode - The invite code used.
 * @param {string} logPrefix - Prefix for logging.
 */
async function _createOrUpdatePendingJoin(guildId, inviteeId, inviterId, inviteCode, logPrefix) {
    try {
        await TrackedJoin.findOneAndUpdate(
            // Find existing pending joins for this user in this guild.
            { guildId, inviteeId, status: 'pending' },
            // Set inviter, code, timestamp, and ensure status is pending.
            // If upserting, ensure guildId and inviteeId are set.
            {
                $set: {
                    inviterId,
                    inviteCodeUsed: inviteCode,
                    joinTimestamp: new Date(),
                    status: 'pending' // Explicitly set status on update/insert
                 },
                 $setOnInsert: { guildId, inviteeId }
             },
             { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        console.log(`${logPrefix} Successfully created/updated TrackedJoin record.`);
    } catch (dbError) {
        console.error(`${logPrefix} Failed to create/update TrackedJoin record:`, dbError);
    }
}

/**
 * Ensures member object is not partial. Fetches if necessary.
 * @param {import('discord.js').GuildMember | import('discord.js').PartialGuildMember} member - The member object.
 * @returns {Promise<import('discord.js').GuildMember | null>} Full member object or null if fetch fails critically.
 */
async function _ensureFullMemberData(member) {
    if (member.partial) {
        const logPrefix = `[PartialFetch][Guild:${member.guild?.id ?? 'N/A'}][User:${member.id}]`;
        console.log(`${logPrefix} Member data is partial. Fetching...`);
        try {
            return await member.fetch();
        } catch (error) {
            if (error instanceof DiscordAPIError && (error.code === DISCORD_ERROR_CODES.UNKNOWN_MEMBER || error.code === DISCORD_ERROR_CODES.UNKNOWN_USER)) {
                console.log(`${logPrefix} Could not fully fetch partial member (likely already gone). Proceeding with available data.`);
                // Return the partially-fetched member if critical IDs are still present
                return (member.user && member.guild) ? member : null;
            } else {
                console.error(`${logPrefix} Failed to fetch partial member:`, error);
                return null; // Cannot proceed reliably
            }
        }
    }
    return member; // Already full
}

/**
 * Updates pending TrackedJoin records to 'left_early' for a user.
 * @param {string} guildId - The guild ID.
 * @param {string} userId - The user ID.
 * @param {string} logPrefix - Prefix for logging.
 */
async function _markJoinsAsLeftEarly(guildId, userId, logPrefix) {
    try {
        const result = await TrackedJoin.updateMany(
            { guildId, inviteeId: userId, status: 'pending' },
            { $set: { status: 'left_early', leaveTimestamp: new Date() } }
        );
        if (result.modifiedCount > 0) {
            console.log(`${logPrefix} Updated ${result.modifiedCount} pending join record(s) to 'left_early'.`);
        }
        // else { console.log(`${logPrefix} No pending join record found for this user.`); } // Less verbose
    } catch (error) {
        console.error(`${logPrefix} Error updating join status on leave:`, error);
    }
}

/**
 * Performs database cleanup when the bot leaves a guild, if enabled.
 * @param {string} guildId - The ID of the guild left.
 */
async function _performGuildCleanup(guildId) {
    if (!PERFORM_GUILD_DELETE_CLEANUP) {
        console.log(`[GuildDelete] Database cleanup for guild ${guildId} is disabled.`);
        return;
    }
    console.log(`[GuildDelete] Initiating database cleanup for guild ${guildId}...`);
    try {
        const trackedResult = await TrackedJoin.deleteMany({ guildId });
        console.log(`[GuildDelete][Cleanup] Deleted ${trackedResult.deletedCount} TrackedJoin records for guild ${guildId}.`);
    } catch (e) {
        console.error(`[GuildDelete][Cleanup] Failed to cleanup TrackedJoins for guild ${guildId}:`, e);
    }
    try {
        const userInviteResult = await UserInvite.deleteMany({ guildId });
        console.log(`[GuildDelete][Cleanup] Deleted ${userInviteResult.deletedCount} UserInvite records for guild ${guildId}.`);
    } catch (e) {
        console.error(`[GuildDelete][Cleanup] Failed to cleanup UserInvites for guild ${guildId}:`, e);
    }
}


// --- Bot Event Handlers ---

client.once(Events.ClientReady, async readyClient => {
    console.log(`Logged in as ${readyClient.user.tag} (ID: ${readyClient.user.id})`);
    console.log(`Operating in ${readyClient.guilds.cache.size} guild(s).`);

    try {
        const activityText = client.t('general.activity_text');
        readyClient.user.setActivity(activityText, { type: ActivityType.Listening });
    } catch (activityError) {
        console.error("Error setting bot activity:", activityError);
        readyClient.user.setActivity('Tracking Invites'); // Fallback
    }

    // Initial Invite Caching
    console.log('[Ready] Starting initial invite caching...');
    let cachedGuilds = 0, failedGuilds = 0;
    const guilds = Array.from(readyClient.guilds.cache.values());
    for (const guild of guilds) {
        if (await cacheGuildInvites(guild)) cachedGuilds++; else failedGuilds++;
        await new Promise(resolve => setTimeout(resolve, 300)); // Rate limit delay
    }
    console.log(`[Ready] Initial invite caching complete. Success: ${cachedGuilds}, Failed/No Perms: ${failedGuilds}`);

    // Start Periodic Validation Task
    console.log(`[ValidationTask] Starting validation check every ${validationCheckIntervalMinutes} minutes.`);
    setInterval(validatePendingJoins, VALIDATION_CHECK_INTERVAL_MS);
    // Run initial check slightly delayed after startup caching
    setTimeout(() => {
        console.log('[ValidationTask] Running initial validation check post-startup.');
        validatePendingJoins();
    }, 2 * 60 * 1000); // 2 min delay
});

client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const command = interaction.client.commands.get(interaction.commandName);
    const logPrefix = `[Interaction][Cmd:${interaction.commandName}][User:${interaction.user.id}][Guild:${interaction.guildId ?? 'N/A'}]`; // Handle DM interaction possibility

    if (!command) {
        console.error(`${logPrefix} No command matching '${interaction.commandName}' was found.`);
        try {
            await interaction.reply({ content: interaction.client.t('general.error_unknown_command'), ephemeral: true });
        } catch (replyError) {
            console.error(`${logPrefix} Failed to reply to unknown command interaction:`, replyError);
        }
        return;
    }

    try {
        // Pass the translator function to the command context if needed (though commands access it via client.t)
        // await command.execute(interaction, interaction.client.t);
        await command.execute(interaction);
    } catch (error) {
        console.error(`${logPrefix} Execution Error:`, error);
        const errorMessage = interaction.client.t('general.error_command_execution');
        try {
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: errorMessage, ephemeral: true });
            } else {
                await interaction.reply({ content: errorMessage, ephemeral: true });
            }
        } catch (replyError) {
            console.error(`${logPrefix} Failed to send error reply to user:`, replyError);
        }
    }
});

// --- GuildMemberAdd Event (Refactored) ---
client.on(Events.GuildMemberAdd, async member => {
    // Fetch full member data if partial
    const fullMember = await _ensureFullMemberData(member);
    if (!fullMember || !fullMember.guild || !fullMember.user) {
        console.error(`[GuildMemberAdd] Could not obtain full member data for joining member ID: ${member.id}. Cannot process join.`);
        return; // Exit if we don't have critical info
    }

    const { guild, user } = fullMember; // Use data from the potentially fetched fullMember
    const logPrefix = `[GuildMemberAdd][Guild:${guild.id}][User:${user.id}]`;
    console.log(`${logPrefix} User ${user.tag} joined.`);

    // 1. Permission Check
    if (!_hasRequiredPermissions(guild, logPrefix)) return;

    // 2. Delay for invite count update stability on Discord's side
    await new Promise(resolve => setTimeout(resolve, 2500));

    // 3. Fetch Current Invites (handles permissions internally)
    const currentInvites = await _fetchGuildInvitesSafe(guild, logPrefix);
    // If fetch fails (likely perms), currentInvites will be null. _findUsedInviteAndStale handles null.

    // 4. Ensure Invite Cache (attempts to rebuild if missing)
    const cachedUses = await _ensureInviteCache(guild, logPrefix);
    if (!cachedUses) return; // Error already logged, cannot proceed without cache

    // 5. Get Bot-Tracked Invites from DB
    const trackedUserInvites = await _getTrackedUserInvites(guild.id, logPrefix);
    if (!trackedUserInvites) { // DB error occurred
        await cacheGuildInvites(guild); // Still attempt to update cache before exiting
        return;
    }
    if (trackedUserInvites.length === 0) {
        // console.log(`${logPrefix} No bot-tracked invites found for this guild.`); // Less verbose
        await cacheGuildInvites(guild); // Update cache anyway, maybe non-tracked invite used
        return;
    }

    // 6. Compare Invites & Identify Attribution/Stale Invites (Uses refactored helper)
    const { attribution, staleInviteIds } = _findUsedInviteAndStale(currentInvites, cachedUses, trackedUserInvites, logPrefix);

    // 7. Cleanup Stale Invites (async, don't wait)
     if (staleInviteIds.length > 0) {
        _cleanupStaleInvites(staleInviteIds, guild.id, logPrefix); // Fire-and-forget cleanup
     }

    // 8. Create TrackedJoin Record if Attributed
    if (attribution) {
        console.log(`${logPrefix} Attributed join to User ${attribution.inviterId} via code ${attribution.inviteCode}. Creating TrackedJoin record.`);
        // Create/update the join record (awaits DB operation)
        await _createOrUpdatePendingJoin(guild.id, user.id, attribution.inviterId, attribution.inviteCode, logPrefix);
    } else {
        // Logged inside _findUsedInviteAndStale if uses increased but no match
        // console.log(`${logPrefix} No tracked invite code usage increased or attributed.`); // Less verbose
    }

    // 9. Update Cache with latest counts AFTER processing the join
    await cacheGuildInvites(guild);
});


// --- GuildMemberRemove Event (Refactored) ---
client.on(Events.GuildMemberRemove, async member => {
    // 1. Ensure Full Member Data
    const fullMember = await _ensureFullMemberData(member);
    if (!fullMember || !fullMember.guild || !fullMember.user) {
        console.error(`[GuildMemberRemove] Could not obtain full member data or critical IDs for leaving member ID: ${member.id}. Cannot process leave.`);
        return;
    }

    const { guild, user } = fullMember;
    const guildId = guild.id;
    const userId = user.id;
    const logPrefix = `[GuildMemberRemove][Guild:${guildId}][User:${userId}]`;
    console.log(`${logPrefix} User ${user.tag ?? userId} left or was removed.`);

    // 2. Update TrackedJoin Status
    await _markJoinsAsLeftEarly(guildId, userId, logPrefix);
});

// --- Validation Task Helper Functions ---

/**
 * Checks if a member is present in the guild, using a cache for the current run.
 * @param {object} join - The TrackedJoin document (lean).
 * @param {Map<string, {status: 'present'|'left'|'error_skip', guild: import('discord.js').Guild|null}>} cache - Cache map for this run.
 * @param {string} logPrefix - Logging prefix.
 * @returns {Promise<{status: 'present'|'left'|'error_skip', guild: import('discord.js').Guild|null}>} - The presence status and guild object.
 */
async function _checkMemberPresence(join, cache, logPrefix) {
    const memberCacheKey = `${join.guildId}-${join.inviteeId}`;
    if (cache.has(memberCacheKey)) {
        return cache.get(memberCacheKey);
    }

    const guild = client.guilds.cache.get(join.guildId);
    if (!guild) {
        // console.warn(`${logPrefix} Guild ${join.guildId} not found in cache for user ${join.inviteeId}. Skipping.`);
        cache.set(memberCacheKey, { status: 'error_skip', guild: null });
        return { status: 'error_skip', guild: null };
    }

    try {
        // Fetch member - force=false uses cache first, then API if needed.
        await guild.members.fetch({ user: join.inviteeId, force: false });
        cache.set(memberCacheKey, { status: 'present', guild });
        return { status: 'present', guild };
    } catch (error) {
        if (error instanceof DiscordAPIError && (error.code === DISCORD_ERROR_CODES.UNKNOWN_MEMBER || error.code === DISCORD_ERROR_CODES.UNKNOWN_USER)) {
            // User definitely not in the guild
            cache.set(memberCacheKey, { status: 'left', guild });
            return { status: 'left', guild };
        } else {
            // Other error (permissions, rate limit, etc.) - skip this user for this run
            console.error(`${logPrefix} Error fetching member ${join.inviteeId}@${join.guildId} for validation:`, error);
            cache.set(memberCacheKey, { status: 'error_skip', guild });
            return { status: 'error_skip', guild };
        }
    }
}

/**
 * Prepares the update operation object for bulkWrite based on member status.
 * @param {object} join - The TrackedJoin document (lean).
 * @param {'present'|'left'} memberStatus - The status returned by _checkMemberPresence.
 * @param {Date} validationTime - The timestamp for the validation/leave event.
 * @param {string} logPrefix - Logging prefix.
 * @returns {object|null} - The `updateOne` operation object or null if status is invalid.
 */
function _prepareValidationUpdate(join, memberStatus, validationTime, logPrefix) {
    let newStatus, updateData;

    if (memberStatus === 'present') {
        newStatus = 'validated';
        updateData = { status: newStatus, validationTimestamp: validationTime };
    } else if (memberStatus === 'left') {
        newStatus = 'left_early';
        updateData = { status: newStatus, leaveTimestamp: validationTime };
         console.log(`${logPrefix} User ${join.inviteeId} (Join ID: ${join._id}) not in guild ${join.guildId}. Marking '${newStatus}'.`);
    } else {
        return null; // Should not happen if called correctly
    }

    return {
        updateOne: {
            filter: { _id: join._id, status: 'pending' }, // Ensure status hasn't changed concurrently
            update: { $set: updateData }
        }
    };
}

// --- Periodic Validation Function (Refactored) ---
async function validatePendingJoins() {
    const logPrefix = '[ValidationTask]';
    console.log(`${logPrefix} Running validation check...`);

    const validationCutoffDate = new Date(Date.now() - VALIDATION_PERIOD_MS);
    const validationTime = new Date(); // Use consistent time for this batch
    const bulkOps = [];
    const guildMemberPresenceCache = new Map(); // Cache presence checks per run

    try {
        // Find potential candidates efficiently
        const candidates = await TrackedJoin.find({
            status: 'pending',
            joinTimestamp: { $lte: validationCutoffDate } // Only check joins older than the period
        }).lean(); // Use lean for performance

        if (candidates.length === 0) {
             // console.log(`${logPrefix} No pending joins found older than the validation period.`); // Less verbose
             return;
        }
        console.log(`${logPrefix} Found ${candidates.length} candidate join(s) eligible for validation.`);

        // Process candidates
        for (const join of candidates) {
            // Check member presence using helper (handles caching and errors)
            const presenceResult = await _checkMemberPresence(join, guildMemberPresenceCache, logPrefix);

            // Skip if there was an error fetching guild/member info
            if (presenceResult.status === 'error_skip') {
                continue;
            }

            // Prepare the update operation using helper
            const updateOp = _prepareValidationUpdate(join, presenceResult.status, validationTime, logPrefix);
            if (updateOp) {
                bulkOps.push(updateOp);
            }
        } // End candidate loop

        // Execute Bulk Write if there are operations to perform
        if (bulkOps.length > 0) {
            const validatedCount = bulkOps.filter(op => op.updateOne.update.$set.status === 'validated').length;
            const leftEarlyCount = bulkOps.length - validatedCount;
            console.log(`${logPrefix} Preparing bulk update: ${validatedCount} to 'validated', ${leftEarlyCount} to 'left_early'.`);
            try {
                const result = await TrackedJoin.bulkWrite(bulkOps, { ordered: false }); // Unordered for better performance
                console.log(`${logPrefix} Bulk update result: ${result.modifiedCount ?? 0} modified (Matched: ${result.matchedCount ?? 0}).`);
                // Check for potential inconsistencies
                 if (result.modifiedCount !== bulkOps.length && result.matchedCount === bulkOps.length) {
                      console.warn(`${logPrefix} Warning: Modified count (${result.modifiedCount}) differs from matched count (${result.matchedCount}). Some records might have already been updated.`);
                  } else if (result.matchedCount !== bulkOps.length) {
                     console.warn(`${logPrefix} Warning: Matched count (${result.matchedCount}) differs from expected operations (${bulkOps.length}). Some records might have changed status before update.`);
                  }
                 if (result.hasWriteErrors()) {
                     console.error(`${logPrefix} Bulk write reported errors:`, result.getWriteErrors());
                 }

            } catch (bulkWriteError) {
                console.error(`${logPrefix} Error executing bulk write:`, bulkWriteError);
            }
        } else {
             console.log(`${logPrefix} No update operations needed after checking ${candidates.length} candidate(s).`);
        }

    } catch (error) {
        console.error(`${logPrefix} Critical error during validation process query or loop:`, error);
    } finally {
        // Clear cache after run to avoid stale data in next run
        guildMemberPresenceCache.clear();
    }
}

// --- Other Client Event Handlers ---

client.on(Events.GuildCreate, async guild => {
    console.log(`Joined new guild: ${guild.name} (ID: ${guild.id}). Members: ${guild.memberCount}`);
    await cacheGuildInvites(guild); // Cache invites immediately
});

client.on(Events.GuildDelete, async guild => {
    // Handle cases where guild object might be incomplete on leave
    const guildId = guild?.id;
    const guildName = guild?.name ?? `ID: ${guildId}`;

    if (!guildId) {
        console.log(`Left or was removed from a guild (ID unavailable). Cache/DB cleanup skipped.`);
        return;
    }
    console.log(`Left guild: ${guildName}.`);
    inviteUsesCache.delete(guildId); // Clear cache
    console.log(`[GuildDelete] Cleared invite cache for guild ${guildId}.`);
    await _performGuildCleanup(guildId); // Perform DB cleanup if enabled
});

client.on(Events.Warn, warning => console.warn('[Discord Client Warning]', warning));
client.on(Events.Error, error => console.error('[Discord Client Error]', error));

// --- Bot Login ---
console.log("Attempting to log in to Discord...");
client.login(TOKEN).catch(error => {
    console.error("FATAL ERROR: Failed to login to Discord:", error);
    if (error.code === DISCORD_ERROR_CODES.TOKEN_INVALID || error.message.includes('TOKEN_INVALID')) { // d.js v14 uses message sometimes
        console.error("Hint: The DISCORD_TOKEN in .env is invalid or missing.");
    } else if (error.message.includes('disallowed intents') || error.message.includes('Privileged Intents')) {
        console.error("Hint: Ensure Guilds, GuildInvites, and GuildMembers (Privileged) intents are enabled in the Discord Developer Portal.");
    } else if (error.code === 50013) { // Missing Permissions general code
         console.error("Hint: Bot might be missing critical permissions in some guilds (e.g., View Channel, Send Messages, Manage Guild for invite tracking).");
    }
    process.exit(1);
});

// --- Graceful Shutdown ---
async function shutdown(signal) {
    console.log(`Received ${signal}. Shutting down gracefully...`);
    if (client && typeof client.destroy === 'function') {
        client.destroy();
        console.log('Discord client destroyed.');
    } else {
        console.log('Discord client already destroyed or unavailable.');
    }
    try {
        // Check mongoose state before trying to close
        if (mongoose.connection.readyState === 1 || mongoose.connection.readyState === 2) { // Connected or Connecting
            await mongoose.connection.close();
            console.log('MongoDB connection closed successfully.');
        } else {
            console.log('MongoDB connection already closed or not established.');
        }
    } catch (err) {
        console.error('Error closing MongoDB connection during shutdown:', err);
    } finally {
        console.log('Exiting process.');
        process.exit(0); // Exit cleanly
    }
}

// Ensure only one handler is attached for each signal
process.removeAllListeners('SIGINT').on('SIGINT', () => shutdown('SIGINT'));
process.removeAllListeners('SIGTERM').on('SIGTERM', () => shutdown('SIGTERM'));