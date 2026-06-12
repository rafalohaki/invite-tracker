-- BonusInvites: admin-granted invite credit per user per guild. `amount` is a running
-- net total (add/remove adjust it) and may go negative — the leaderboard hides users
-- whose combined validated+bonus total is <= 0.
CREATE TABLE IF NOT EXISTS BonusInvites (
    guildId   TEXT NOT NULL,
    userId    TEXT NOT NULL,
    amount    INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (guildId, userId)
);
