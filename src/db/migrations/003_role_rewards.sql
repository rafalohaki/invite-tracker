-- RoleRewards: when an inviter crosses a threshold of validated invites, the bot grants the role.
-- UNIQUE(guildId, threshold) blocks duplicate rewards at the same threshold; a single roleId can
-- appear at multiple thresholds (admin's call).
CREATE TABLE IF NOT EXISTS RoleRewards (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    guildId   TEXT NOT NULL,
    threshold INTEGER NOT NULL CHECK (threshold > 0),
    roleId    TEXT NOT NULL,
    createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (guildId, threshold)
);
CREATE INDEX IF NOT EXISTS idx_role_rewards_guild     ON RoleRewards(guildId);
CREATE INDEX IF NOT EXISTS idx_role_rewards_threshold ON RoleRewards(guildId, threshold);
