/**
 * @file database/models/TrackedJoin.js
 * @description Mongoose model definition for tracking individual user joins attributed to an invite.
 * This collection stores the core data for tracking invite validity and leaderboard counts.
 */

const mongoose = require('mongoose');

/**
 * @description Schema definition for the 'TrackedJoin' collection.
 * Each document represents a user joining the server via a tracked invite link.
 * @type {mongoose.Schema}
 */
const trackedJoinSchema = new mongoose.Schema({
    /** @description Discord Guild (Server) ID where the join occurred. Indexed for efficient guild-specific queries. */
    guildId: { type: String, required: true, index: true },

    /** @description Discord User ID of the user who joined (the invitee). */
    inviteeId: { type: String, required: true },

    /** @description Discord User ID of the user who generated the invite link (the inviter). Indexed for leaderboard aggregation. */
    inviterId: { type: String, required: true, index: true },

    /** @description The specific invite code used for the join. */
    inviteCodeUsed: { type: String, required: true },

    /** @description Timestamp when the user joined the server. Defaults to the time of document creation. */
    joinTimestamp: { type: Date, required: true, default: Date.now },

    /**
     * @description Current status of the tracked join, used for validation logic. Indexed for validation queries.
     * 'pending': User has joined but hasn't met the validation period yet.
     * 'validated': User has stayed for the required duration.
     * 'left_early': User left before the validation period ended.
     */
    status: {
        type: String,
        required: true,
        enum: ['pending', 'validated', 'left_early'], // Enforces allowed values
        default: 'pending', // New joins start as pending
        index: true, // Crucial for efficiently querying joins needing validation
    },

    /** @description Timestamp when the status was changed to 'validated'. */
    validationTimestamp: { type: Date },

    /** @description Timestamp when the status was changed to 'left_early'. */
    leaveTimestamp: { type: Date },

}, {
    /** @description Automatically adds `createdAt` and `updatedAt` fields managed by Mongoose. */
    timestamps: true
});

// Optional: Compound index if frequently querying by guild and invitee together.
// trackedJoinSchema.index({ guildId: 1, inviteeId: 1 });

// Optional: Compound index for querying pending joins within a specific guild and timeframe.
// trackedJoinSchema.index({ guildId: 1, status: 1, joinTimestamp: 1 }); // Useful for the validation task

module.exports = mongoose.model('TrackedJoin', trackedJoinSchema);