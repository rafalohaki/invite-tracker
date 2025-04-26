/**
 * @file database/models/UserInvite.js
 * @description Mongoose model definition for storing the persistent invite code generated for each user in a specific guild.
 */

const mongoose = require('mongoose');

/**
 * @description Schema definition for the 'UserInvite' collection.
 * Stores the single, permanent invite code associated with a user for a particular guild.
 * @type {mongoose.Schema}
 */
const inviteSchema = new mongoose.Schema({
    /** @description Discord User ID of the user this invite belongs to. Part of the unique index. */
    userId: { type: String, required: true },

    /** @description Discord Guild (Server) ID where this invite is valid. Part of the unique index. */
    guildId: { type: String, required: true },

    /** @description The unique Discord invite code generated for the user. */
    inviteCode: { type: String, required: true },

    // Note: We do NOT store invite uses/counts here. Invite usage is determined
    // dynamically by comparing cached uses with live Discord API data upon joins.
    // This avoids stale data and complex synchronization issues.

}, {
    /** @description Automatically adds `createdAt` and `updatedAt` fields managed by Mongoose. */
    timestamps: true
});

/**
 * @description Ensures that only one document can exist per user per guild.
 * This is CRITICAL for the bot's logic, guaranteeing each user has only one tracked invite code per server.
 * Attempting to insert a duplicate combination of userId and guildId will result in a MongoDB unique index error.
 */
inviteSchema.index({ userId: 1, guildId: 1 }, { unique: true });

// Optional: Indexing inviteCode might offer a marginal speedup when verifying
// codes fetched from Discord against the database, but it's unlikely to be a bottleneck
// compared to API calls or the unique index lookups.
// inviteSchema.index({ inviteCode: 1 });

module.exports = mongoose.model('UserInvite', inviteSchema);