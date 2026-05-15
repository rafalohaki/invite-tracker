-- GuildConfig: per-guild override of environment defaults. Every column is NULLable;
-- a NULL means "fall back to env default". Reads go through repositories/guild-config.ts
-- which layers env defaults on top of the row.
CREATE TABLE IF NOT EXISTS GuildConfig (
    guildId                TEXT PRIMARY KEY,
    validation_period_days INTEGER,
    welcome_channel_id     TEXT,
    welcome_template       TEXT,
    locale                 TEXT CHECK (locale IN ('en', 'custom')),
    anti_cheat_window_days INTEGER,
    createdAt              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updatedAt              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
