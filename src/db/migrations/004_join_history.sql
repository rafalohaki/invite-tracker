-- JoinHistory: full audit trail of every join/leave for anti-cheat rejoin detection (PR #9).
-- A row is created on every GuildMemberAdd, leftTimestamp is filled on GuildMemberRemove.
-- flaggedAsRejoin=1 if anti-cheat decided this rejoin came from a different inviter inside the window.
CREATE TABLE IF NOT EXISTS JoinHistory (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    guildId         TEXT NOT NULL,
    userId          TEXT NOT NULL,
    inviterId       TEXT,
    inviteCodeUsed  TEXT,
    joinTimestamp   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    leftTimestamp   TEXT,
    flaggedAsRejoin INTEGER NOT NULL DEFAULT 0 CHECK (flaggedAsRejoin IN (0, 1))
);
CREATE INDEX IF NOT EXISTS idx_join_history_user ON JoinHistory(guildId, userId, joinTimestamp DESC);
-- Partial index speeds up the GuildMemberRemove update (find the row still open).
CREATE INDEX IF NOT EXISTS idx_join_history_open ON JoinHistory(guildId, userId) WHERE leftTimestamp IS NULL;
