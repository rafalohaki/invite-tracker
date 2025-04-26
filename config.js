/**
 * @file config.js
 * @description Central configuration file for the Discord Invite Tracker bot.
 * Allows easy modification of settings without changing core code.
 */

module.exports = {
    /**
     * @description Configuration options for the /leaderboard command.
     */
    leaderboard: {
        /** @description Maximum number of users to display on the leaderboard. */
        limit: 15,
        /** @description Hex color code for the leaderboard embed's side bar. */
        embedColor: '#FFD700', // Gold
    },

    /**
     * @description Configuration options for the /invite command.
     */
    inviteCommand: {
        /** @description Hex color code for the invite command embed's side bar. */
        embedColor: '#0099FF', // Blue
    },

    // --- General Bot Settings (Add as needed) ---
    /**
     * @description Default validation period in days (how long a user must stay).
     * Environment variable `VALIDATION_PERIOD_DAYS` overrides this.
     * @type {number}
     */
    defaultValidationPeriodDays: 7,

    /**
     * @description Default interval in minutes for checking pending joins for validation.
     * Environment variable `VALIDATION_CHECK_INTERVAL_MINUTES` overrides this.
     * @type {number}
     */
    defaultValidationCheckIntervalMinutes: 60,


    // Add other global or feature-specific configurations below.
    // Example:
    // logging: {
    //     level: 'info', // e.g., 'debug', 'info', 'warn', 'error'
    //     filePath: '/var/log/dcinvitetracker.log',
    // }
};

// Note: Sensitive information like tokens, API keys, or database URIs
// should NEVER be stored here. Use environment variables (.env file) instead.