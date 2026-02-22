/**
 * @file database/db.js
 * @description SQLite database management using bun:sqlite.
 * Handles table creation, indexes, and provides a clean API for the bot.
 */

'use strict';

const { Database } = require('bun:sqlite');
const path = require('node:path');
const { logInfo, logError } = require('../utils/logger');

// Database file path
const dbPath = path.join(__dirname, '..', 'invites.db');
const db = new Database(dbPath);

/**
 * Initializes the database schema.
 */
function initDB() {
    try {
        // Table for storing user invite codes per guild
        db.run(`
            CREATE TABLE IF NOT EXISTS UserInvites (
                userId TEXT NOT NULL,
                guildId TEXT NOT NULL,
                inviteCode TEXT NOT NULL,
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (userId, guildId)
            )
        `);

        // Table for tracking joins
        db.run(`
            CREATE TABLE IF NOT EXISTS TrackedJoins (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guildId TEXT NOT NULL,
                inviteeId TEXT NOT NULL,
                inviterId TEXT NOT NULL,
                inviteCodeUsed TEXT NOT NULL,
                joinTimestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                status TEXT CHECK(status IN ('pending', 'validated', 'left_early')) DEFAULT 'pending',
                validationTimestamp DATETIME,
                leaveTimestamp DATETIME,
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Indexes for performance
        db.run('CREATE INDEX IF NOT EXISTS idx_joins_guild_invitee ON TrackedJoins(guildId, inviteeId)');
        db.run('CREATE INDEX IF NOT EXISTS idx_joins_validation ON TrackedJoins(guildId, status, joinTimestamp)');
        db.run('CREATE INDEX IF NOT EXISTS idx_user_invites_code ON UserInvites(inviteCode)');

        logInfo('SQLite Database initialized successfully.');
    } catch (err) {
        logError('Failed to initialize SQLite Database:', err);
        process.exit(1);
    }
}

// Initialize tables on load
initDB();

/**
 * Database API helpers
 */
const dbInterface = {
    /**
     * UserInvites Operations
     */
    userInvites: {
        get: (userId, guildId) => {
            return db.query('SELECT * FROM UserInvites WHERE userId = ? AND guildId = ?').get(userId, guildId);
        },
        getByCode: (inviteCode, guildId) => {
            return db.query('SELECT * FROM UserInvites WHERE inviteCode = ? AND guildId = ?').get(inviteCode, guildId);
        },
        getAllInGuild: (guildId) => {
            return db.query('SELECT * FROM UserInvites WHERE guildId = ?').all(guildId);
        },
        upsert: (userId, guildId, inviteCode) => {
            const now = new Date().toISOString();
            return db.run(`
                INSERT INTO UserInvites (userId, guildId, inviteCode, updatedAt)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(userId, guildId) DO UPDATE SET
                    inviteCode = excluded.inviteCode,
                    updatedAt = excluded.updatedAt
            `, [userId, guildId, inviteCode, now]);
        },
        delete: (userId, guildId, inviteCode) => {
            return db.run('DELETE FROM UserInvites WHERE userId = ? AND guildId = ? AND inviteCode = ?', [userId, guildId, inviteCode]);
        },
        deleteMany: (ids, guildId) => {
            // IDs are not very useful in SQLite as we use composite keys, 
            // but for compatibility with the cleanup logic:
            const stmt = db.prepare('DELETE FROM UserInvites WHERE inviteCode = ? AND guildId = ?');
            const transaction = db.transaction((codes) => {
                for (const code of codes) stmt.run(code, guildId);
            });
            transaction(ids);
        },
        deleteAllInGuild: (guildId) => {
            return db.run('DELETE FROM UserInvites WHERE guildId = ?', [guildId]);
        }
    },

    /**
     * TrackedJoins Operations
     */
    trackedJoins: {
        getPending: (guildId, inviteeId) => {
            return db.query('SELECT * FROM TrackedJoins WHERE guildId = ? AND inviteeId = ? AND status = "pending"').get(guildId, inviteeId);
        },
        upsertPending: (guildId, inviteeId, inviterId, inviteCode) => {
            const now = new Date().toISOString();
            return db.run(`
                INSERT INTO TrackedJoins (guildId, inviteeId, inviterId, inviteCodeUsed, joinTimestamp, status)
                VALUES (?, ?, ?, ?, ?, 'pending')
                ON CONFLICT(guildId, inviteeId) DO UPDATE SET
                    inviterId = excluded.inviterId,
                    inviteCodeUsed = excluded.inviteCodeUsed,
                    joinTimestamp = excluded.joinTimestamp,
                    status = 'pending',
                    validationTimestamp = NULL,
                    leaveTimestamp = NULL
            `, [guildId, inviteeId, inviterId, inviteCode, now]);
        },
        // Wait, SQLite doesn't have a direct conflict on (guildId, inviteeId) unless we add a unique index
        // Let's ensure the unique index exists for the upsert to work.
        addUniqueConstraint: () => {
            try {
                db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_join ON TrackedJoins(guildId, inviteeId)');
            } catch (e) { }
        },
        markLeftEarly: (guildId, inviteeId) => {
            const now = new Date().toISOString();
            return db.run(`
                UPDATE TrackedJoins 
                SET status = 'left_early', leaveTimestamp = ? 
                WHERE guildId = ? AND inviteeId = ? AND status = 'pending'
            `, [now, guildId, inviteeId]);
        },
        findCandidatesForValidation: (cutoffDate) => {
            return db.query(`
                SELECT * FROM TrackedJoins 
                WHERE status = 'pending' AND joinTimestamp <= ?
            `).all(cutoffDate.toISOString());
        },
        bulkUpdateStatus: (updates) => {
            const stmt = db.prepare(`
                UPDATE TrackedJoins 
                SET status = ?, validationTimestamp = ?, leaveTimestamp = ? 
                WHERE id = ? AND status = 'pending'
            `);
            const transaction = db.transaction((ops) => {
                for (const op of ops) {
                    stmt.run(op.status, op.validationTime, op.leaveTime, op.id);
                }
            });
            transaction(updates);
        },
        countByStatus: (guildId, inviterId, status) => {
            const res = db.query('SELECT COUNT(*) as count FROM TrackedJoins WHERE guildId = ? AND inviterId = ? AND status = ?')
                .get(guildId, inviterId, status);
            return res ? res.count : 0;
        },
        getLeaderboard: (guildId, limit) => {
            return db.query(`
                SELECT inviterId as _id, COUNT(*) as count 
                FROM TrackedJoins 
                WHERE guildId = ? AND status = 'validated' 
                GROUP BY inviterId 
                ORDER BY count DESC 
                LIMIT ?
            `).all(guildId, limit);
        },
        deleteAllInGuild: (guildId) => {
            return db.run('DELETE FROM TrackedJoins WHERE guildId = ?', [guildId]);
        }
    }
};

dbInterface.trackedJoins.addUniqueConstraint();

module.exports = dbInterface;
