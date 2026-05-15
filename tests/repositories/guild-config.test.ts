import { beforeEach, describe, expect, it } from 'bun:test';
import { env } from '@/config/env.ts';
import { GuildConfigRepository } from '@/db/repositories/guild-config.ts';
import { createTestDb } from '../helpers/in-memory-db.ts';

describe('GuildConfigRepository', () => {
    let repo: GuildConfigRepository;

    beforeEach(() => {
        repo = new GuildConfigRepository(createTestDb());
    });

    it('getOrDefault returns env defaults when no row exists', () => {
        const cfg = repo.getOrDefault('g-missing');
        expect(cfg.validation_period_days).toBe(env.VALIDATION_PERIOD_DAYS);
        expect(cfg.anti_cheat_window_days).toBe(env.ANTI_CHEAT_WINDOW_DAYS);
        expect(cfg.locale).toBe(env.LOCALE_LANG);
        expect(cfg.welcome_channel_id).toBeNull();
        expect(cfg.welcome_template).toBeNull();
    });

    it('set + getOrDefault overrides env defaults', () => {
        repo.set('g1', 'validation_period_days', 14);
        repo.set('g1', 'welcome_channel_id', '1234567890');
        repo.set('g1', 'welcome_template', 'Welcome {user}!');
        repo.set('g1', 'locale', 'custom');
        repo.set('g1', 'anti_cheat_window_days', 60);
        const cfg = repo.getOrDefault('g1');
        expect(cfg.validation_period_days).toBe(14);
        expect(cfg.welcome_channel_id).toBe('1234567890');
        expect(cfg.welcome_template).toBe('Welcome {user}!');
        expect(cfg.locale).toBe('custom');
        expect(cfg.anti_cheat_window_days).toBe(60);
    });

    it('reset restores env default for a single key', () => {
        repo.set('g1', 'validation_period_days', 99);
        expect(repo.getOrDefault('g1').validation_period_days).toBe(99);
        repo.reset('g1', 'validation_period_days');
        expect(repo.getOrDefault('g1').validation_period_days).toBe(env.VALIDATION_PERIOD_DAYS);
    });

    it('per-guild isolation — guild1 set does not affect guild2', () => {
        repo.set('g1', 'validation_period_days', 1);
        repo.set('g2', 'validation_period_days', 99);
        expect(repo.getOrDefault('g1').validation_period_days).toBe(1);
        expect(repo.getOrDefault('g2').validation_period_days).toBe(99);
    });

    it('deleteForGuild wipes the row entirely', () => {
        repo.set('g1', 'validation_period_days', 14);
        repo.deleteForGuild('g1');
        expect(repo.get('g1')).toBeNull();
        expect(repo.getOrDefault('g1').validation_period_days).toBe(env.VALIDATION_PERIOD_DAYS);
    });
});
