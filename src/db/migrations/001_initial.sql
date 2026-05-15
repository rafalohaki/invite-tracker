-- UserInvites: maps a user to the invite code the bot generated for them in a guild.
CREATE TABLE IF NOT EXISTS UserInvites (
    userId     TEXT NOT NULL,
    guildId    TEXT NOT NULL,
    inviteCode TEXT NOT NULL,
    createdAt  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updatedAt  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (userId, guildId)
);
CREATE INDEX IF NOT EXISTS idx_user_invites_guild ON UserInvites(guildId);
CREATE INDEX IF NOT EXISTS idx_user_invites_code  ON UserInvites(guildId, inviteCode);

-- TrackedJoins: a single attributed join event. status='flagged' is included up-front
-- to avoid an ALTER TABLE on the CHECK constraint later (anti-cheat lands in PR #9).
CREATE TABLE IF NOT EXISTS TrackedJoins (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    guildId             TEXT NOT NULL,
    inviteeId           TEXT NOT NULL,
    inviterId           TEXT NOT NULL,
    inviteCodeUsed      TEXT NOT NULL,
    joinTimestamp       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    status              TEXT NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'validated', 'left_early', 'flagged')),
    validationTimestamp TEXT,
    leaveTimestamp      TEXT,
    createdAt           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updatedAt           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (guildId, inviteeId)
);
CREATE INDEX IF NOT EXISTS idx_joins_validation ON TrackedJoins(guildId, status, joinTimestamp);
CREATE INDEX IF NOT EXISTS idx_joins_inviter    ON TrackedJoins(guildId, inviterId, status);
