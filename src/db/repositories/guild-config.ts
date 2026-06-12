import type { Database } from 'bun:sqlite';
import { env } from '@/config/env.ts';
import type { GuildConfigRow, Locale } from '@/types/db.ts';

export const CONFIG_KEYS = [
    'validation_period_days',
    'welcome_channel_id',
    'welcome_template',
    'locale',
    'anti_cheat_window_days',
    'min_account_age_days',
    'log_channel_id',
] as const;
export type ConfigKey = (typeof CONFIG_KEYS)[number];

export interface ResolvedGuildConfig {
    validation_period_days: number;
    welcome_channel_id: string | null;
    welcome_template: string | null;
    locale: Locale;
    anti_cheat_window_days: number;
    min_account_age_days: number;
    log_channel_id: string | null;
}

type ConfigValue = string | number | null;

export class GuildConfigRepository {
    private readonly stmtGet;
    private readonly stmtUpsertEmpty;
    private readonly stmtSetValidationPeriod;
    private readonly stmtSetWelcomeChannel;
    private readonly stmtSetWelcomeTemplate;
    private readonly stmtSetLocale;
    private readonly stmtSetAntiCheatWindow;
    private readonly stmtSetMinAccountAge;
    private readonly stmtSetLogChannel;
    private readonly stmtDeleteForGuild;

    constructor(db: Database) {
        this.stmtGet = db.query<GuildConfigRow, [string]>('SELECT * FROM GuildConfig WHERE guildId = ?');
        this.stmtUpsertEmpty = db.prepare<unknown, [string]>('INSERT OR IGNORE INTO GuildConfig (guildId) VALUES (?)');
        this.stmtSetValidationPeriod = db.prepare<unknown, [number | null, string]>(
            "UPDATE GuildConfig SET validation_period_days = ?, updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE guildId = ?",
        );
        this.stmtSetWelcomeChannel = db.prepare<unknown, [string | null, string]>(
            "UPDATE GuildConfig SET welcome_channel_id = ?, updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE guildId = ?",
        );
        this.stmtSetWelcomeTemplate = db.prepare<unknown, [string | null, string]>(
            "UPDATE GuildConfig SET welcome_template = ?, updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE guildId = ?",
        );
        this.stmtSetLocale = db.prepare<unknown, [Locale | null, string]>(
            "UPDATE GuildConfig SET locale = ?, updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE guildId = ?",
        );
        this.stmtSetAntiCheatWindow = db.prepare<unknown, [number | null, string]>(
            "UPDATE GuildConfig SET anti_cheat_window_days = ?, updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE guildId = ?",
        );
        this.stmtSetMinAccountAge = db.prepare<unknown, [number | null, string]>(
            "UPDATE GuildConfig SET min_account_age_days = ?, updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE guildId = ?",
        );
        this.stmtSetLogChannel = db.prepare<unknown, [string | null, string]>(
            "UPDATE GuildConfig SET log_channel_id = ?, updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE guildId = ?",
        );
        this.stmtDeleteForGuild = db.prepare<unknown, [string]>('DELETE FROM GuildConfig WHERE guildId = ?');
    }

    get(guildId: string): GuildConfigRow | null {
        return this.stmtGet.get(guildId) ?? null;
    }

    /** Convenience accessor — saves call-sites from `.getOrDefault(guildId).locale`. */
    getLocale(guildId: string): Locale {
        return this.getOrDefault(guildId).locale;
    }

    /** Reads the row (creating an empty one if missing) and applies env defaults to NULL columns. */
    getOrDefault(guildId: string): ResolvedGuildConfig {
        const row = this.stmtGet.get(guildId);
        return {
            validation_period_days: row?.validation_period_days ?? env.VALIDATION_PERIOD_DAYS,
            welcome_channel_id: row?.welcome_channel_id ?? null,
            welcome_template: row?.welcome_template ?? null,
            locale: row?.locale ?? env.LOCALE_LANG,
            anti_cheat_window_days: row?.anti_cheat_window_days ?? env.ANTI_CHEAT_WINDOW_DAYS,
            min_account_age_days: row?.min_account_age_days ?? env.MIN_ACCOUNT_AGE_DAYS,
            log_channel_id: row?.log_channel_id ?? null,
        };
    }

    /** Writes a single key. Use ConfigValueSchema (in commands/config.ts) to validate `value` first. */
    set(guildId: string, key: ConfigKey, value: ConfigValue): void {
        this.stmtUpsertEmpty.run(guildId);
        this.dispatchSet(guildId, key, value);
    }

    /** Sets the key back to NULL → falls back to env default on next read. */
    reset(guildId: string, key: ConfigKey): void {
        this.stmtUpsertEmpty.run(guildId);
        this.dispatchSet(guildId, key, null);
    }

    deleteForGuild(guildId: string): void {
        this.stmtDeleteForGuild.run(guildId);
    }

    private dispatchSet(guildId: string, key: ConfigKey, value: ConfigValue): void {
        switch (key) {
            case 'validation_period_days':
                this.stmtSetValidationPeriod.run(value as number | null, guildId);
                return;
            case 'welcome_channel_id':
                this.stmtSetWelcomeChannel.run(value as string | null, guildId);
                return;
            case 'welcome_template':
                this.stmtSetWelcomeTemplate.run(value as string | null, guildId);
                return;
            case 'locale':
                this.stmtSetLocale.run(value as Locale | null, guildId);
                return;
            case 'anti_cheat_window_days':
                this.stmtSetAntiCheatWindow.run(value as number | null, guildId);
                return;
            case 'min_account_age_days':
                this.stmtSetMinAccountAge.run(value as number | null, guildId);
                return;
            case 'log_channel_id':
                this.stmtSetLogChannel.run(value as string | null, guildId);
                return;
        }
    }
}
