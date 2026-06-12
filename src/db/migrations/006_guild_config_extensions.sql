-- New per-guild config keys (NULL = fall back to env default, same convention as 002):
--   min_account_age_days — joins from Discord accounts younger than this are flagged
--                          as fake and earn no invite credit (0/NULL = disabled).
--   log_channel_id       — channel for join/leave log messages (NULL = disabled).
ALTER TABLE GuildConfig ADD COLUMN min_account_age_days INTEGER;
ALTER TABLE GuildConfig ADD COLUMN log_channel_id TEXT;
