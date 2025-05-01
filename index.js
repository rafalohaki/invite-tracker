/**
 * @file index.js
 * @description Main entry point for the Discord Invite Tracker bot.
 * Initializes the Discord client, connects to the database, loads commands,
 * handles events (ready, interactions, member joins/leaves), manages invite caching,
 * runs the periodic join validation task, and supports custom translations.
 * ---
 * Includes basic logging levels (DEBUG, INFO, WARN, ERROR) controlled by LOG_LEVEL env var.
 * Includes detection and warning for potential invite attribution ambiguity in rapid join scenarios.
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

// --- Logging Setup ---
const LOG_LEVELS = { DEBUG: 1, INFO: 2, WARN: 3, ERROR: 4 };
const configuredLogLevelName = process.env.LOG_LEVEL?.toUpperCase() || 'INFO';
const LOG_LEVEL = LOG_LEVELS[configuredLogLevelName] || LOG_LEVELS.INFO;

const logDebug = (...args) => { if (LOG_LEVEL <= LOG_LEVELS.DEBUG) console.debug('[DEBUG]', ...args); };
const logInfo = (...args) => { if (LOG_LEVEL <= LOG_LEVELS.INFO) console.info('[INFO]', ...args); };
const logWarn = (...args) => { if (LOG_LEVEL <= LOG_LEVELS.WARN) console.warn('[WARN]', ...args); };
const logError = (...args) => { if (LOG_LEVEL <= LOG_LEVELS.ERROR) console.error('[ERROR]', ...args); };

// --- Configuration & Constants ---
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const MONGODB_URI = process.env.MONGODB_URI;
const PERFORM_GUILD_DELETE_CLEANUP = process.env.PERFORM_GUILD_DELETE_CLEANUP === 'true';

const validationPeriodDays = parseInt(process.env.VALIDATION_PERIOD_DAYS || config.defaultValidationPeriodDays || 7, 10);
const VALIDATION_PERIOD_MS = validationPeriodDays * 24 * 60 * 60 * 1000;
const validationCheckIntervalMinutes = parseInt(process.env.VALIDATION_CHECK_INTERVAL_MINUTES || config.defaultValidationCheckIntervalMinutes || 60, 10);
const VALIDATION_CHECK_INTERVAL_MS = validationCheckIntervalMinutes * 60 * 1000;

const DISCORD_ERROR_CODES = {
    UNKNOWN_INVITE: 10006,
    UNKNOWN_MEMBER: 10007,
    UNKNOWN_USER: 10013,
    MISSING_PERMISSIONS: 50013,
    TOKEN_INVALID: 'TokenInvalid', // Used by older d.js or sometimes in error messages
};

// --- Critical Environment Variable Checks ---
if (!TOKEN || !CLIENT_ID || !MONGODB_URI) {
    logError("FATAL ERROR: DISCORD_TOKEN, CLIENT_ID, or MONGODB_URI is missing in the .env file.");
    process.exit(1);
}

logInfo(`[Config] Log Level: ${configuredLogLevelName} (${LOG_LEVEL})`);
logInfo(`[Config] Validation Period: ${validationPeriodDays} days (${VALIDATION_PERIOD_MS}ms)`);
logInfo(`[Config] Validation Check Interval: ${validationCheckIntervalMinutes} minutes (${VALIDATION_CHECK_INTERVAL_MS}ms)`);
logInfo(`[Config] Locale setting (LOCALE_LANG): ${process.env.LOCALE_LANG || 'en (default)'}`);
logInfo(`[Config] Guild delete cleanup: ${PERFORM_GUILD_DELETE_CLEANUP}`);

// --- Database Connection ---
connectDB(); // Handles its own logging and exit on failure

// --- Discord Client Initialization ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildInvites,
        GatewayIntentBits.GuildMembers // PRIVILEGED INTENT
    ],
    partials: [Partials.GuildMember] // Ensure GuildMember partial is enabled
});

// --- Translator & Command Setup ---
client.t = t; // Attach translator function to client
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
_loadCommands(client, commandsPath); // Use helper to load commands

// --- Invite Cache ---
// Structure: Map<GuildID, Map<InviteCode, UsesCount>>
const inviteUsesCache = new Map();

// --- Helper Functions ---

/** Loads slash commands from the specified directory into the client. */
function _loadCommands(clientInstance, directoryPath) {
    logInfo('[CommandLoader] Loading command files...');
    let loadedCount = 0;
    try {
        const commandFiles = fs.readdirSync(directoryPath).filter(file => file.endsWith('.js'));
        for (const file of commandFiles) {
            const filePath = path.join(directoryPath, file);
            try {
                // Bust cache to ensure updates are loaded on restart during development
                delete require.cache[require.resolve(filePath)];
                const command = require(filePath);

                if ('data' in command && 'execute' in command) {
                    clientInstance.commands.set(command.data.name, command);
                    logDebug(`[CommandLoader] Loaded command: ${command.data.name}`);
                    loadedCount++;
                } else {
                    logWarn(`[CommandLoader] Command file ${filePath} is missing required 'data' or 'execute'.`);
                }
            } catch (error) {
                logError(`[CommandLoader] Failed to load command file ${file}:`, error);
            }
        }
        logInfo(`[CommandLoader] Successfully loaded ${loadedCount} command(s).`);
    } catch (error) {
        logError("[CommandLoader] Failed to read commands directory:", error);
    }
}

/**
 * Checks bot permissions necessary for invite tracking.
 * @param {import('discord.js').Guild} guild - The guild to check permissions in.
 * @param {string} logPrefix - Prefix for logging.
 * @returns {boolean} True if permissions are sufficient, false otherwise. Logs warnings internally.
 */
function _hasRequiredPermissions(guild, logPrefix) {
    if (!guild.members.me) {
        logWarn(`${logPrefix} Bot member object (guild.members.me) is unavailable. Cannot check permissions.`);
        return false;
    }
    // Manage Guild is required to fetch invites reliably
    if (!guild.members.me.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
        logWarn(`${logPrefix} Missing 'Manage Guild' permission. Cannot cache or reliably track invites.`);
        return false;
    }
    // View Audit Log could potentially be used for more robust tracking, but not strictly required for count-based method
    // if (!guild.members.me.permissions.has(PermissionsBitField.Flags.ViewAuditLog)) {
    //    logWarn(`${logPrefix} Missing 'View Audit Log' permission. Cannot use audit logs for enhanced tracking.`);
    // }
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
        logDebug(`${logPrefix} Cached ${usesMap.size} invite uses.`);
        return true;
    } catch (error) {
        if (error instanceof DiscordAPIError && error.code === DISCORD_ERROR_CODES.MISSING_PERMISSIONS) {
            logWarn(`${logPrefix} Missing 'Manage Guild' permissions while trying to fetch invites for caching.`);
        } else {
            logError(`${logPrefix} Error caching invites:`, error);
        }
        inviteUsesCache.delete(guild.id); // Clear potentially bad cache on error
        return false;
    }
}

/**
 * Safely fetches current invites for a guild. Checks permissions first.
 * @param {import('discord.js').Guild} guild - The guild object.
 * @param {string} logPrefix - Prefix for logging.
 * @returns {Promise<Collection<string, import('discord.js').Invite>|null>} Invite collection or null on error/permission issue.
 */
async function _fetchGuildInvitesSafe(guild, logPrefix) {
    if (!_hasRequiredPermissions(guild, logPrefix)) {
        // Warning already logged by _hasRequiredPermissions
        return null;
    }
    try {
        return await guild.invites.fetch();
    } catch (error) {
         if (error instanceof DiscordAPIError && error.code === DISCORD_ERROR_CODES.MISSING_PERMISSIONS) {
            // This shouldn't happen if _hasRequiredPermissions passed, but check defensively
            logWarn(`${logPrefix} Missing 'Manage Guild' permissions during fetch (unexpected after check).`);
        } else {
            logError(`${logPrefix} Error fetching invites (needed for attribution):`, error);
        }
        return null;
    }
}

/**
 * Ensures the invite cache for a guild is populated. Attempts to cache if missing.
 * @param {import('discord.js').Guild} guild - The guild object.
 * @param {string} logPrefix - Prefix for logging.
 * @returns {Promise<Map<string, number>|null>} The uses map from cache, or null if cache cannot be established.
 */
async function _ensureInviteCache(guild, logPrefix) {
    let cachedUses = inviteUsesCache.get(guild.id);
    if (!cachedUses) {
        logWarn(`${logPrefix} Invite cache missing. Attempting to cache now...`);
        const cacheSuccess = await cacheGuildInvites(guild);
        cachedUses = inviteUsesCache.get(guild.id); // Re-fetch after attempting cache
        if (!cacheSuccess || !cachedUses) {
            logError(`${logPrefix} Failed to establish invite cache; cannot reliably attribute join.`);
            return null;
        }
        logInfo(`${logPrefix} Successfully repopulated invite cache.`);
    }
    return cachedUses;
}

/**
 * Fetches UserInvite documents (invites generated by the bot) for a specific guild.
 * @param {string} guildId - The guild ID.
 * @param {string} logPrefix - Prefix for logging.
 * @returns {Promise<Array<object>|null>} Array of lean UserInvite objects or null on database error.
 */
async function _getTrackedUserInvites(guildId, logPrefix) {
    try {
        // Fetch lean for performance as we only read data
        return await UserInvite.find({ guildId }).lean();
    } catch (dbError) {
        logError(`${logPrefix} Database error fetching UserInvites:`, dbError);
        return null;
    }
}

/**
 * Checks a single tracked invite against current Discord state and cache.
 * @param {object} userInvite - A lean UserInvite document from DB.
 * @param {Collection<string, import('discord.js').Invite>|null} currentInvites - Freshly fetched invites.
 * @param {Map<string, number>|null} cachedUses - Previously cached uses map.
 * @param {string} logPrefix - Prefix for logging.
 * @returns {{ isStale: boolean, usageIncreased: boolean, delta: number, inviterId: string, inviteCode: string }} - Result of the check.
 */
function _checkSingleInvite(userInvite, currentInvites, cachedUses, logPrefix) {
    const currentInvite = currentInvites?.get(userInvite.inviteCode);
    const cachedUseCount = cachedUses?.get(userInvite.inviteCode);
    let usageIncreased = false;
    let delta = 0;

    if (!currentInvite) {
        // Invite deleted on Discord or inaccessible
        logWarn(`${logPrefix} Tracked invite code ${userInvite.inviteCode} (Inviter: ${userInvite.userId}) not found on Discord. Marking as stale.`);
        cachedUses?.delete(userInvite.inviteCode); // Clean from live cache map immediately
        return { isStale: true, usageIncreased: false, delta: 0, inviterId: userInvite.userId, inviteCode: userInvite.inviteCode };
    }

    // Invite exists, check usage
    const currentUses = currentInvite.uses ?? 0;
    if (cachedUses && cachedUseCount !== undefined) {
        if (currentUses > cachedUseCount) {
             delta = currentUses - cachedUseCount;
             logDebug(`${logPrefix} Code ${userInvite.inviteCode} (Inviter: ${userInvite.userId}) uses increased from ${cachedUseCount} to ${currentUses} (Delta: ${delta}).`);
             usageIncreased = true;
        }
        // else: uses same or decreased (less likely, but possible if invite reset/deleted+recreated?)
    } else if (currentUses > 0) {
        // Fallback case: Cache or specific code was missing, attribute if uses > 0
        logInfo(`${logPrefix} Cache missing/incomplete for code ${userInvite.inviteCode}. Attributing based on current uses > 0 (${currentUses}). Delta assumed ${currentUses}.`);
        delta = currentUses; // Assume all current uses are new since cache miss
        usageIncreased = true;
    }
    // else: Cache missing and current uses is 0, no increase.

    return { isStale: false, usageIncreased, delta, inviterId: userInvite.userId, inviteCode: userInvite.inviteCode };
}

/**
 * Compares current invite uses with cached uses to find the used invite and identify stale ones.
 * Logs a warning if multiple invites show increased usage (attribution ambiguity).
 * @param {Collection<string, import('discord.js').Invite>|null} currentInvites - Freshly fetched invites.
 * @param {Map<string, number>|null} cachedUses - Previously cached uses map.
 * @param {Array<object>} trackedUserInvites - UserInvites from the database.
 * @param {string} logPrefix - Prefix for logging.
 * @returns {{ attribution: { inviterId: string, inviteCode: string } | null, staleInviteIds: string[] }} Result object.
 */
function _findUsedInviteAndStale(currentInvites, cachedUses, trackedUserInvites, logPrefix) {
    let attribution = null;
    const staleInviteIds = []; // Store DB IDs (_id) of invites to delete
    const potentialAttributions = []; // Store invites with increased usage

    if (!currentInvites) {
        logWarn(`${logPrefix} Cannot compare invites: currentInvites collection is null (likely permissions issue or API error).`);
        // Cannot determine stale invites reliably without current state. Attribution impossible.
        return { attribution: null, staleInviteIds: [] };
    }
    if (!cachedUses) {
        logWarn(`${logPrefix} Cannot compare invites: cachedUses map is null (cache failed?).`);
        // Cannot reliably determine usage increase. Attribution impossible.
        return { attribution: null, staleInviteIds: [] };
    }


    for (const userInvite of trackedUserInvites) {
        const checkResult = _checkSingleInvite(userInvite, currentInvites, cachedUses, logPrefix);

        if (checkResult.isStale) {
            staleInviteIds.push(userInvite._id.toString()); // Store the DB document ID
        } else if (checkResult.usageIncreased) {
            potentialAttributions.push({
                inviterId: checkResult.inviterId,
                inviteCode: checkResult.inviteCode,
                delta: checkResult.delta // Store the delta for potential future logic
            });
        }
    }

    // --- Attribution Logic ---
    if (potentialAttributions.length === 1) {
        // Single invite increased usage - clear case
        attribution = potentialAttributions[0];
        logInfo(`${logPrefix} Attributed join to User ${attribution.inviterId} via code ${attribution.inviteCode} (Usage increased by ${attribution.delta}).`);
    } else if (potentialAttributions.length > 1) {
        // Multiple invites increased usage - ambiguous case
        attribution = potentialAttributions[0]; // Default to attributing the first one found
        const ambiguousCodes = potentialAttributions.map(p => `${p.inviteCode} (+${p.delta})`).join(', ');
        logWarn(`${logPrefix} Attribution Ambiguity Detected! Multiple tracked invites increased usage: [${ambiguousCodes}]. Attributing to the first found (${attribution.inviteCode}), but accuracy is not guaranteed in rapid join scenarios.`);
    } else {
         // No tracked invite showed increased usage
         logInfo(`${logPrefix} No specific tracked invite usage increase detected.`);
         // Consider checking if *any* invite (even non-tracked) increased, though less useful
         // let totalCurrentUses = 0; currentInvites.forEach(inv => totalCurrentUses += (inv.uses ?? 0));
         // let totalCachedUses = 0; cachedUses.forEach(uses => totalCachedUses += uses);
         // if (totalCurrentUses > totalCachedUses) { logInfo(`${logPrefix} Note: Overall invite usage increased, but not matched to a tracked invite.` }
    }

    return { attribution, staleInviteIds };
}

/**
 * Deletes stale UserInvite records from the database.
 * @param {string[]} staleInviteIds - Array of UserInvite document IDs (_id) to delete.
 * @param {string} guildId - The guild ID for context.
 * @param {string} logPrefix - Prefix for logging.
 */
async function _cleanupStaleInvites(staleInviteIds, guildId, logPrefix) {
    if (staleInviteIds.length === 0) return;
    logInfo(`${logPrefix} Cleaning up ${staleInviteIds.length} stale UserInvite record(s) from DB...`);
    try {
        const result = await UserInvite.deleteMany({
            _id: { $in: staleInviteIds.map(id => new mongoose.Types.ObjectId(id)) }, // Ensure IDs are ObjectIds if needed
            guildId: guildId // Ensure guildId match for safety
        });
        logInfo(`${logPrefix} Deleted ${result.deletedCount} stale UserInvite record(s).`);
    } catch (dbDelErr) {
        logError(`${logPrefix} Failed to delete stale UserInvite records:`, dbDelErr);
    }
}

/**
 * Creates or updates a TrackedJoin record for a new member. Sets status to 'pending'.
 * @param {string} guildId - Guild ID.
 * @param {string} inviteeId - User ID of the new member.
 * @param {string} inviterId - User ID of the attributed inviter.
 * @param {string} inviteCode - The invite code used.
 * @param {string} logPrefix - Prefix for logging.
 */
async function _createOrUpdatePendingJoin(guildId, inviteeId, inviterId, inviteCode, logPrefix) {
    try {
        const joinTime = new Date();
        // Upsert: Find by guild+invitee. If found, update inviter/code/time. If not, insert new.
        // Crucially sets status to 'pending' always.
        const result = await TrackedJoin.findOneAndUpdate(
             { guildId, inviteeId }, // Find existing join record for this user in this guild
             {
                 $set: {
                     inviterId,
                     inviteCodeUsed: inviteCode,
                     joinTimestamp: joinTime,
                     status: 'pending', // Ensure status is pending
                     // Clear validation/leave timestamps if rejoining/re-attributed
                     validationTimestamp: undefined,
                     leaveTimestamp: undefined,
                 },
                 $setOnInsert: { guildId, inviteeId } // Set these only if inserting new doc
             },
             { upsert: true, new: true, setDefaultsOnInsert: true } // Upsert=create if not found, new=return updated doc
        );
        logInfo(`${logPrefix} Successfully created/updated TrackedJoin record (ID: ${result._id}, Status: ${result.status}).`);
    } catch (dbError) {
        logError(`${logPrefix} Failed to create/update TrackedJoin record:`, dbError);
    }
}

// --- START REFACTORED SECTION ---

/**
 * Handles errors encountered while fetching a partial guild member.
 * Determines if the error means the member left or if it's another issue.
 * Returns the original partial member if usable as fallback, otherwise null.
 * @param {Error} error - The error caught during fetch.
 * @param {import('discord.js').PartialGuildMember} originalMember - The initial partial member object.
 * @param {string} logPrefix - Prefix for logging.
 * @returns {import('discord.js').GuildMember | null} Original partial member or null.
 */
function _handleFetchMemberError(error, originalMember, logPrefix) {
    // Check if the error indicates the member is gone
    const isMemberGoneError = error instanceof DiscordAPIError &&
                             (error.code === DISCORD_ERROR_CODES.UNKNOWN_MEMBER || error.code === DISCORD_ERROR_CODES.UNKNOWN_USER);

    if (isMemberGoneError) {
        logInfo(`${logPrefix} Could not fetch partial member (likely already gone - Discord Error ${error.code}).`);
        // Return the original partial member *only if* it contains the essential IDs for fallback logic
        if (originalMember.user && originalMember.guild) {
            logDebug(`${logPrefix} Returning original partial member data as fallback.`);
            return originalMember; // Return the original partial data
        } else {
            logWarn(`${logPrefix} Fetch failed (member gone), and original partial data lacks essential IDs. Cannot proceed.`);
            return null; // Original partial is also unusable
        }
    } else {
        // Log other types of fetch errors (permissions, network, rate limits, etc.)
        logError(`${logPrefix} Failed to fetch partial member data due to unexpected error:`, error);
        return null; // Cannot proceed reliably after other errors
    }
}

/**
 * Ensures member object is not partial. Fetches if necessary.
 * Handles errors gracefully, especially when the member might have left.
 * @param {import('discord.js').GuildMember | import('discord.js').PartialGuildMember} member - The member object.
 * @returns {Promise<import('discord.js').GuildMember | null>} Full member object, the original partial if usable after fetch error, or null.
 */
async function _ensureFullMemberData(member) {
    const logPrefix = `[EnsureMember][Guild:${member.guild?.id ?? 'N/A'}][User:${member.id}]`;

    // 1. Handle non-partial members first
    if (!member.partial) {
        if (!member.user || !member.guild) {
            logWarn(`${logPrefix} Non-partial member object missing critical user/guild data.`);
            return null;
        }
        logDebug(`${logPrefix} Member data is already full and valid.`);
        return member;
    }

    // 2. Handle partial members: Attempt fetch
    logDebug(`${logPrefix} Member data is partial. Fetching...`);
    try {
        const fullMember = await member.fetch();
        // Check integrity *after* successful fetch
        if (!fullMember?.user || !fullMember?.guild) {
            logWarn(`${logPrefix} Fetched member successfully, but critical user/guild data is still missing.`);
            return null; // Fetch succeeded but result is unusable
        }
        logDebug(`${logPrefix} Successfully fetched full member data.`);
        return fullMember;
    } catch (error) {
        // 3. Handle fetch errors using the extracted method
        return _handleFetchMemberError(error, member, logPrefix);
    }
}

// --- END REFACTORED SECTION ---


/**
 * Updates pending TrackedJoin records to 'left_early' for a user leaving the guild.
 * @param {string} guildId - The guild ID.
 * @param {string} userId - The user ID who left.
 * @param {string} logPrefix - Prefix for logging.
 */
async function _markJoinsAsLeftEarly(guildId, userId, logPrefix) {
    try {
        const leaveTime = new Date();
        // Update only 'pending' joins for this user to 'left_early'
        const result = await TrackedJoin.updateMany(
            { guildId, inviteeId: userId, status: 'pending' },
            { $set: { status: 'left_early', leaveTimestamp: leaveTime } }
        );
        if (result.modifiedCount > 0) {
            logInfo(`${logPrefix} Updated ${result.modifiedCount} pending join record(s) to 'left_early'.`);
        } else {
            logDebug(`${logPrefix} No pending join records found for this user to mark as left_early.`);
        }
    } catch (error) {
        logError(`${logPrefix} Error updating join status on leave:`, error);
    }
}

/**
 * Performs database cleanup (TrackedJoin, UserInvite) when the bot leaves a guild, if enabled via .env.
 * @param {string} guildId - The ID of the guild left.
 */
async function _performGuildCleanup(guildId) {
    if (!PERFORM_GUILD_DELETE_CLEANUP) {
        logInfo(`[GuildDelete] Database cleanup for guild ${guildId} is disabled by configuration.`);
        return;
    }
    logInfo(`[GuildDelete] Initiating database cleanup for guild ${guildId}...`);
    try {
        const trackedResult = await TrackedJoin.deleteMany({ guildId });
        logInfo(`[GuildDelete][Cleanup] Deleted ${trackedResult.deletedCount} TrackedJoin records for guild ${guildId}.`);
    } catch (e) {
        logError(`[GuildDelete][Cleanup] Failed to cleanup TrackedJoins for guild ${guildId}:`, e);
    }
    try {
        const userInviteResult = await UserInvite.deleteMany({ guildId });
        logInfo(`[GuildDelete][Cleanup] Deleted ${userInviteResult.deletedCount} UserInvite records for guild ${guildId}.`);
    } catch (e) {
        logError(`[GuildDelete][Cleanup] Failed to cleanup UserInvites for guild ${guildId}:`, e);
    }
}

// --- Bot Event Handlers ---

client.once(Events.ClientReady, async readyClient => {
    try {
        logInfo(`Logged in as ${readyClient.user.tag} (ID: ${readyClient.user.id})`);
        logInfo(`Operating in ${readyClient.guilds.cache.size} guild(s).`);

        try {
            const activityText = client.t('general.activity_text');
            readyClient.user.setActivity(activityText, { type: ActivityType.Listening });
            logInfo(`Set activity to: "${activityText}"`);
        } catch (activityError) {
            logError("Error setting bot activity:", activityError);
            readyClient.user.setActivity('Tracking Invites', { type: ActivityType.Listening }); // Fallback
        }

        // Initial Invite Caching
        logInfo('[Ready] Starting initial invite caching for all guilds...');
        let cachedGuilds = 0, failedGuilds = 0;
        const guilds = Array.from(readyClient.guilds.cache.values());
        for (const guild of guilds) {
            logDebug(`[Ready] Caching invites for guild: ${guild.name} (${guild.id})`);
            if (await cacheGuildInvites(guild)) cachedGuilds++; else failedGuilds++;
            await new Promise(resolve => setTimeout(resolve, 300)); // Small delay between guilds
        }
        logInfo(`[Ready] Initial invite caching complete. Success: ${cachedGuilds}, Failed/No Perms: ${failedGuilds}`);

        // Start Periodic Validation Task
        logInfo(`[ValidationTask] Starting validation check every ${validationCheckIntervalMinutes} minutes.`);
        setInterval(validatePendingJoins, VALIDATION_CHECK_INTERVAL_MS);

        // Run initial check slightly delayed after startup caching
        const initialCheckDelay = 2 * 60 * 1000; // 2 min delay
        logInfo(`[ValidationTask] Scheduling initial validation check in ${initialCheckDelay / 1000} seconds.`);
        setTimeout(() => {
            logInfo('[ValidationTask] Running initial validation check post-startup.');
            validatePendingJoins();
        }, initialCheckDelay);

    } catch (error) {
        logError('[ClientReady] Critical error during initialization:', error);
        // Depending on the error, might need to exit
        // process.exit(1);
    }
});

client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const command = interaction.client.commands.get(interaction.commandName);
    const logPrefix = `[Interaction][Cmd:${interaction.commandName}][User:${interaction.user.id}][Guild:${interaction.guildId ?? 'N/A'}]`;

    if (!command) {
        logError(`${logPrefix} No command matching '${interaction.commandName}' was found.`);
        try {
            // Use the translator attached to the client
            await interaction.reply({ content: interaction.client.t('general.error_unknown_command'), ephemeral: true });
        } catch (replyError) {
            // Log error if replying itself fails
            logError(`${logPrefix} Failed to reply to unknown command interaction:`, replyError);
        }
        return;
    }

    try {
        logDebug(`${logPrefix} Executing command.`);
        await command.execute(interaction); // Commands access client.t if needed
    } catch (error) {
        logError(`${logPrefix} Uncaught error during command execution:`, error);
        const errorMessage = interaction.client.t('general.error_command_execution');
        try {
            // Try to inform the user, checking interaction state
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: errorMessage, ephemeral: true });
            } else {
                await interaction.reply({ content: errorMessage, ephemeral: true });
            }
        } catch (replyError) {
            logError(`${logPrefix} Failed to send command execution error reply to user:`, replyError);
        }
    }
});

// --- GuildMemberAdd Event (Handles New User Joins) ---
client.on(Events.GuildMemberAdd, async member => {
    const logPrefixBase = `[GuildMemberAdd][Guild:${member.guild?.id ?? 'N/A'}][User:${member.id}]`;
    try {
        // 1. Ensure Full Member Data (Handles partials, returns null if unusable)
        const usableMember = await _ensureFullMemberData(member);
        if (!usableMember) {
            // Logging handled within _ensureFullMemberData or _handleFetchMemberError
            logWarn(`${logPrefixBase} Could not obtain usable member data. Cannot process join.`);
            return;
        }
        // Use guaranteed non-null guild/user from the *potentially* refetched member object
        const { guild, user } = usableMember;
        const logPrefix = `[GuildMemberAdd][Guild:${guild.id}][User:${user.id}]`; // Corrected prefix
        logInfo(`${logPrefix} User ${user.tag} joined.`);

        // 2. Permission Check (Crucial for fetching invites)
        if (!_hasRequiredPermissions(guild, logPrefix)) {
            // Warning already logged by _hasRequiredPermissions
            return;
        }

        // 3. Delay for invite count stability (heuristic)
        const inviteFetchDelay = 2500; // ms
        logDebug(`${logPrefix} Waiting ${inviteFetchDelay}ms for invite count propagation...`);
        await new Promise(resolve => setTimeout(resolve, inviteFetchDelay));

        // 4. Fetch Current Invites (Safe fetch handles internal permissions/errors)
        const currentInvites = await _fetchGuildInvitesSafe(guild, logPrefix);
        // If fetch failed, currentInvites will be null. Subsequent logic handles this.

        // 5. Ensure Invite Cache (Attempts to rebuild if missing)
        const cachedUses = await _ensureInviteCache(guild, logPrefix);
        if (!cachedUses) {
            // Logging handled within _ensureInviteCache
            logWarn(`${logPrefix} Could not ensure invite cache. Skipping attribution.`);
            return;
        }

        // 6. Get Bot-Tracked Invites from DB
        const trackedUserInvites = await _getTrackedUserInvites(guild.id, logPrefix);
        if (!trackedUserInvites) { // DB error occurred fetching tracked invites
            logError(`${logPrefix} Failed to fetch tracked invites from DB. Skipping attribution.`);
            await cacheGuildInvites(guild); // Still attempt to update cache before exiting
            return;
        }
        if (trackedUserInvites.length === 0) {
            logInfo(`${logPrefix} No bot-tracked invites found for this guild. Cannot attribute join.`);
            await cacheGuildInvites(guild); // Update cache anyway, maybe a non-tracked invite was used
            return;
        }
        logDebug(`${logPrefix} Found ${trackedUserInvites.length} tracked invite(s) in DB.`);

        // 7. Compare Invites & Identify Attribution/Stale Invites
        //    _findUsedInviteAndStale handles null currentInvites/cachedUses and logs ambiguity warnings
        const { attribution, staleInviteIds } = _findUsedInviteAndStale(currentInvites, cachedUses, trackedUserInvites, logPrefix);

        // 8. Cleanup Stale Invites (Asynchronously)
        if (staleInviteIds.length > 0) {
            _cleanupStaleInvites(staleInviteIds, guild.id, logPrefix); // Fire-and-forget cleanup
        }

        // 9. Create/Update TrackedJoin Record if Attributed
        if (attribution) {
            // Create/update the join record (awaits DB operation for consistency)
            await _createOrUpdatePendingJoin(guild.id, user.id, attribution.inviterId, attribution.inviteCode, logPrefix);
        } else {
            // Attribution failed or no tracked invite used. Info/Warn logs handled within _findUsedInviteAndStale.
        }

        // 10. Update Cache with latest counts AFTER processing the join
        logDebug(`${logPrefix} Updating invite cache after processing join...`);
        await cacheGuildInvites(guild); // Update cache regardless of attribution success

    } catch (error) {
        logError(`${logPrefixBase} Uncaught error in GuildMemberAdd handler:`, error);
    }
});


// --- GuildMemberRemove Event (Handles User Leaves/Kicks/Bans) ---
client.on(Events.GuildMemberRemove, async member => {
    const logPrefixBase = `[GuildMemberRemove][Guild:${member.guild?.id ?? 'N/A'}][User:${member.id}]`;
    try {
        // 1. Ensure Full Member Data (Handles partials, returns null if unusable)
        const usableMember = await _ensureFullMemberData(member);
         if (!usableMember) { // If null, essential data (guild.id, user.id) was missing or unrecoverable
             // Logging handled within _ensureFullMemberData or _handleFetchMemberError
             logWarn(`${logPrefixBase} Could not obtain usable member data. Cannot accurately process leave.`);
             // Attempt update with just IDs if available *from the original partial*, though less ideal
             if (member.guild?.id && member.id) {
                 logWarn(`${logPrefixBase} Attempting leave update using only IDs from potentially incomplete member object.`);
                 await _markJoinsAsLeftEarly(member.guild.id, member.id, logPrefixBase);
             }
             return;
         }
        // Use guaranteed non-null guild/user from usableMember
        const { guild, user } = usableMember;
        const logPrefix = `[GuildMemberRemove][Guild:${guild.id}][User:${user.id}]`; // Corrected prefix
        logInfo(`${logPrefix} User ${user.tag ?? user.id} left or was removed.`);

        // 2. Update corresponding TrackedJoin Status to 'left_early'
        await _markJoinsAsLeftEarly(guild.id, user.id, logPrefix);

    } catch (error) {
        logError(`${logPrefixBase} Uncaught error in GuildMemberRemove handler:`, error);
    }
});

// --- Validation Task Helper Functions ---

/**
 * Checks if a member is present in the guild, using a cache for the current validation run.
 * @param {object} join - The lean TrackedJoin document.
 * @param {Map<string, {status: 'present'|'left'|'error_skip', guild: import('discord.js').Guild|null}>} cache - Cache map for this run.
 * @param {string} logPrefixVal - Logging prefix specific to validation task.
 * @returns {Promise<{status: 'present'|'left'|'error_skip', guild: import('discord.js').Guild|null}>} - Presence status and guild object.
 */
async function _checkMemberPresence(join, cache, logPrefixVal) {
    const memberCacheKey = `${join.guildId}-${join.inviteeId}`;
    if (cache.has(memberCacheKey)) {
        logDebug(`${logPrefixVal} Cache hit for member ${join.inviteeId}@${join.guildId}.`);
        return cache.get(memberCacheKey);
    }

    const guild = client.guilds.cache.get(join.guildId);
    if (!guild) {
        logWarn(`${logPrefixVal} Guild ${join.guildId} not found in cache for validating user ${join.inviteeId}. Skipping this join.`);
        cache.set(memberCacheKey, { status: 'error_skip', guild: null });
        return { status: 'error_skip', guild: null };
    }

    try {
        // Fetch member - force=false uses cache first, then API if needed. Efficient.
        await guild.members.fetch({ user: join.inviteeId, force: false });
        logDebug(`${logPrefixVal} Member ${join.inviteeId}@${join.guildId} is present.`);
        cache.set(memberCacheKey, { status: 'present', guild });
        return { status: 'present', guild };
    } catch (error) {
        if (error instanceof DiscordAPIError && (error.code === DISCORD_ERROR_CODES.UNKNOWN_MEMBER || error.code === DISCORD_ERROR_CODES.UNKNOWN_USER)) {
            // User definitely not in the guild
            logDebug(`${logPrefixVal} Member ${join.inviteeId}@${join.guildId} is not present (Unknown Member/User).`);
            cache.set(memberCacheKey, { status: 'left', guild });
            return { status: 'left', guild };
        } else {
            // Other error (permissions, rate limit, etc.) - skip this user for this run
            logError(`${logPrefixVal} Error fetching member ${join.inviteeId}@${join.guildId} for validation:`, error);
            cache.set(memberCacheKey, { status: 'error_skip', guild });
            return { status: 'error_skip', guild };
        }
    }
}

/**
 * Prepares the update operation object for MongoDB bulkWrite based on member presence status.
 * @param {object} join - The lean TrackedJoin document.
 * @param {'present'|'left'} memberStatus - The status from _checkMemberPresence.
 * @param {Date} eventTime - The timestamp for the validation or leave event.
 * @param {string} logPrefixVal - Logging prefix specific to validation task.
 * @returns {object|null} - The `updateOne` operation object for bulkWrite, or null if status invalid.
 */
function _prepareValidationUpdate(join, memberStatus, eventTime, logPrefixVal) {
    let newStatus, updateData;

    if (memberStatus === 'present') {
        newStatus = 'validated';
        updateData = { status: newStatus, validationTimestamp: eventTime };
        logDebug(`${logPrefixVal} Preparing update for Join ID ${join._id}: Set status to '${newStatus}'.`);
    } else if (memberStatus === 'left') {
        newStatus = 'left_early';
        updateData = { status: newStatus, leaveTimestamp: eventTime };
        logInfo(`${logPrefixVal} User ${join.inviteeId} (Join ID: ${join._id}) not in guild ${join.guildId}. Marking '${newStatus}'.`);
    } else {
        // Should not happen if called correctly after status check
        logError(`${logPrefixVal} Invalid memberStatus '${memberStatus}' passed to _prepareValidationUpdate for Join ID ${join._id}.`);
        return null;
    }

    // Return object formatted for Mongoose bulkWrite
    return {
        updateOne: {
            filter: { _id: join._id, status: 'pending' }, // IMPORTANT: Only update if still pending
            update: { $set: updateData }
        }
    };
}

// --- Periodic Validation Function (Checks Pending Joins) ---
async function validatePendingJoins() {
    const logPrefix = '[ValidationTask]';
    logInfo(`${logPrefix} Running periodic validation check...`);

    const validationCutoffDate = new Date(Date.now() - VALIDATION_PERIOD_MS);
    const validationTime = new Date(); // Use a consistent time for all updates in this batch
    const bulkOps = []; // Array to hold update operations for bulkWrite
    const guildMemberPresenceCache = new Map(); // Cache presence checks *per run*

    try {
        // 1. Find candidate joins efficiently using index on status and joinTimestamp
        const candidates = await TrackedJoin.find({
            status: 'pending',
            joinTimestamp: { $lte: validationCutoffDate } // Only check joins older than the validation period
        }).lean(); // Use lean for performance as we only need IDs and timestamps

        if (candidates.length === 0) {
             logInfo(`${logPrefix} No pending joins found older than the validation period (${validationPeriodDays} days).`);
             return;
        }
        logInfo(`${logPrefix} Found ${candidates.length} candidate join(s) eligible for validation/update.`);

        // 2. Process candidates: check presence and prepare bulk operations
        for (const join of candidates) {
            // Check member presence using helper (handles caching and fetch errors)
            const presenceResult = await _checkMemberPresence(join, guildMemberPresenceCache, logPrefix);

            // Skip if there was an error fetching guild/member info for this join
            if (presenceResult.status === 'error_skip') {
                logWarn(`${logPrefix} Skipping Join ID ${join._id} due to error during presence check.`);
                continue;
            }

            // Prepare the update operation using helper
            const updateOp = _prepareValidationUpdate(join, presenceResult.status, validationTime, logPrefix);
            if (updateOp) {
                bulkOps.push(updateOp);
            }
        } // End candidate loop

        // 3. Execute Bulk Write if there are operations to perform
        if (bulkOps.length > 0) {
            const validatedCount = bulkOps.filter(op => op.updateOne.update.$set.status === 'validated').length;
            const leftEarlyCount = bulkOps.length - validatedCount;
            logInfo(`${logPrefix} Preparing bulk update for ${bulkOps.length} records: ${validatedCount} to 'validated', ${leftEarlyCount} to 'left_early'.`);
            try {
                // Use ordered: false for potentially better performance if order doesn't matter
                const result = await TrackedJoin.bulkWrite(bulkOps, { ordered: false });
                logInfo(`${logPrefix} Bulk update result: ${result.modifiedCount ?? 0} modified (Matched: ${result.matchedCount ?? 0}).`);

                // Log warnings for potential inconsistencies (e.g., status changed between find and update)
                if (result.modifiedCount !== bulkOps.length && result.matchedCount === bulkOps.length) {
                    logWarn(`${logPrefix} Modified count (${result.modifiedCount}) differs from matched count (${result.matchedCount}). Some records might have already been updated by another process?`);
                } else if (result.matchedCount !== bulkOps.length) {
                    logWarn(`${logPrefix} Matched count (${result.matchedCount}) differs from expected operations (${bulkOps.length}). Some records might have changed status before update attempt.`);
                }
                if (result.hasWriteErrors()) {
                    logError(`${logPrefix} Bulk write reported errors:`, result.getWriteErrors());
                }

            } catch (bulkWriteError) {
                logError(`${logPrefix} Error executing bulk write for validation updates:`, bulkWriteError);
            }
        } else {
             logInfo(`${logPrefix} No update operations needed after checking ${candidates.length} candidate(s).`);
        }

    } catch (error) {
        // Catch errors during the initial find() or the processing loop itself
        logError(`${logPrefix} Critical error during validation process:`, error);
    } finally {
        // Clear the presence cache after each run to avoid stale data in the next interval
        guildMemberPresenceCache.clear();
        logDebug(`${logPrefix} Cleared guild member presence cache.`);
        logInfo(`${logPrefix} Validation check finished.`);
    }
}

// --- Other Client Event Handlers ---

client.on(Events.GuildCreate, async guild => {
    try {
        logInfo(`Joined new guild: ${guild.name} (ID: ${guild.id}). Members: ${guild.memberCount}`);
        logInfo(`[GuildCreate][Guild:${guild.id}] Caching invites for new guild...`);
        await cacheGuildInvites(guild); // Cache invites immediately
    } catch (error) {
        logError(`[GuildCreate][Guild:${guild.id}] Error during initial setup:`, error);
    }
});

client.on(Events.GuildDelete, async guild => {
    // Handle cases where guild object might be incomplete on leave/kick
    const guildId = guild?.id;
    const guildName = guild?.name ?? `ID: ${guildId ?? 'Unknown'}`;

    try {
        if (!guildId) {
            logWarn(`[GuildDelete] Left or was removed from a guild (ID unavailable). Cache/DB cleanup skipped.`);
            return;
        }
        logInfo(`[GuildDelete] Left guild: ${guildName} (ID: ${guildId}).`);

        // Clear invite cache for the guild
        const deleted = inviteUsesCache.delete(guildId);
        if(deleted) logInfo(`[GuildDelete] Cleared invite cache for guild ${guildId}.`);
        else logWarn(`[GuildDelete] No cache entry found for guild ${guildId} to clear.`);

        // Perform database cleanup if enabled
        await _performGuildCleanup(guildId);

    } catch (error) {
        logError(`[GuildDelete][Guild:${guildId ?? 'Unknown'}] Error during cleanup:`, error);
    }
});

// Log general warnings and errors from the Discord client
client.on(Events.Warn, warning => logWarn('[Discord Client Warning]', warning));
client.on(Events.Error, error => logError('[Discord Client Error]', error));

// --- Bot Login ---
logInfo("Attempting to log in to Discord...");
client.login(TOKEN).catch(error => {
    logError("FATAL ERROR: Failed to login to Discord:", error);
    if (error.code === DISCORD_ERROR_CODES.TOKEN_INVALID || error.message?.includes('TOKEN_INVALID')) {
        logError("Hint: The DISCORD_TOKEN in .env is invalid or missing.");
    } else if (error.message?.includes('disallowed intents') || error.message?.includes('Privileged Intents')) {
        logError("Hint: Ensure Guilds, GuildInvites, and GuildMembers (Privileged) intents are enabled in the Discord Developer Portal for the bot application.");
    } else if (error.code === 50013) { // Missing Permissions general code
         logError("Hint: Bot might be missing critical permissions in some guilds (e.g., View Channel, Send Messages, Manage Guild for invite tracking). Check roles and channel overrides.");
    } else if (error.code === 'CONNECT_TIMEOUT' || error.message?.includes('timeout')) {
         logError("Hint: Connection to Discord timed out. Check network connectivity and Discord status.");
    }
    process.exit(1); // Exit if login fails
});

// --- Graceful Shutdown Handling ---
async function shutdown(signal) {
    logInfo(`Received ${signal}. Shutting down gracefully...`);
    // Stop accepting new events/commands - client.destroy() handles this mostly
    // Optionally: Stop interval timers explicitly `clearInterval(...)`

    if (client && typeof client.destroy === 'function') {
        logInfo('Destroying Discord client...');
        client.destroy();
        logInfo('Discord client destroyed.');
    } else {
        logInfo('Discord client already destroyed or unavailable.');
    }

    try {
        // Check Mongoose connection state before trying to close
        if (mongoose.connection.readyState === 1 || mongoose.connection.readyState === 2) { // Connected or Connecting
            logInfo('Closing MongoDB connection...');
            await mongoose.connection.close();
            logInfo('MongoDB connection closed successfully.');
        } else {
            logInfo(`MongoDB connection already closed or not established (State: ${mongoose.connection.readyState}).`);
        }
    } catch (err) {
        logError('Error closing MongoDB connection during shutdown:', err);
    } finally {
        logInfo('Exiting process.');
        process.exit(0); // Exit cleanly
    }
}

// Ensure only one handler is attached for each signal to prevent multiple shutdowns
process.removeAllListeners('SIGINT').on('SIGINT', () => shutdown('SIGINT'));
process.removeAllListeners('SIGTERM').on('SIGTERM', () => shutdown('SIGTERM'));

// Optional: Catch unhandled promise rejections and uncaught exceptions
process.on('unhandledRejection', (reason, promise) => {
    logError('Unhandled Rejection at:', promise, 'reason:', reason);
    // Consider exiting or implementing more robust error handling/reporting
    // process.exit(1);
});

process.on('uncaughtException', (error, origin) => {
    logError(`Uncaught Exception: ${error.message}\nOrigin: ${origin}\nStack: ${error.stack}`);
    // It's generally recommended to exit after an uncaught exception
    process.exit(1);
});