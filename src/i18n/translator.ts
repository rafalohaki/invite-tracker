import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { env } from '@/config/env.ts';
import type { Locale } from '@/types/db.ts';
import { logError, logWarn } from '@/utils/logger.ts';

interface TranslationsFile {
    en?: Record<string, unknown>;
    custom?: Record<string, unknown>;
}

let translations: TranslationsFile = {};
let loaded = false;

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const TRANSLATION_FILE = path.join(moduleDir, 'custom-lang.yaml');

/**
 * Loads `custom-lang.yaml` once at startup. Safe to call multiple times — subsequent calls no-op.
 * Logs warnings if a section is missing but never throws — missing keys surface as
 * `[MISSING_TRANSLATION:key]` at lookup time.
 */
export function loadTranslations(): void {
    if (loaded) return;
    try {
        const raw = readFileSync(TRANSLATION_FILE, 'utf8');
        const parsed = yaml.load(raw);
        if (!parsed || typeof parsed !== 'object') {
            throw new Error('YAML is empty or not an object');
        }
        translations = parsed as TranslationsFile;
        if (!translations.en || typeof translations.en !== 'object') {
            logWarn(`[Translator] Default 'en' section missing/invalid; fallback will be empty.`);
            translations.en = {};
        }
        if (!translations.custom || typeof translations.custom !== 'object') {
            logWarn(`[Translator] 'custom' section missing/invalid; LOCALE_LANG=custom will fall back to en.`);
            translations.custom = {};
        }
        loaded = true;
    } catch (err) {
        logError('[Translator] Failed to load custom-lang.yaml:', err);
        translations = { en: {}, custom: {} };
        loaded = true;
    }
}

function lookup(section: Record<string, unknown> | undefined, key: string): string | undefined {
    if (!section) return undefined;
    const parts = key.split('.');
    let cursor: unknown = section;
    for (const part of parts) {
        if (cursor && typeof cursor === 'object' && part in (cursor as Record<string, unknown>)) {
            cursor = (cursor as Record<string, unknown>)[part];
        } else {
            return undefined;
        }
    }
    return typeof cursor === 'string' || typeof cursor === 'number' ? String(cursor) : undefined;
}

/**
 * Translate `key` (dot-notation), substituting `{placeholder}` tokens.
 *
 * Resolution order:
 *   1. `locale ?? env.LOCALE_LANG` section (e.g. `custom`)
 *   2. fallback to `en`
 *   3. `[MISSING_TRANSLATION:key]` (logged as error)
 *
 * `locale` lets per-guild config override the global default; pass it from a slash-command
 * handler that knows the guildId. Omit for static contexts (boot logs).
 */
export function t(
    key: string,
    placeholders: Record<string, string | number | null | undefined> = {},
    locale?: Locale,
): string {
    if (!loaded) loadTranslations();
    const activeLocale: Locale = locale ?? env.LOCALE_LANG;

    let raw = activeLocale === 'custom' ? lookup(translations.custom, key) : undefined;
    raw ??= lookup(translations.en, key);

    if (raw === undefined) {
        logError(`[Translator] Missing translation: '${key}' (locale: ${activeLocale})`);
        return `[MISSING_TRANSLATION:${key}]`;
    }

    let out = raw;
    for (const [name, value] of Object.entries(placeholders)) {
        const replacement = value === null || value === undefined ? '' : String(value);
        out = out.replaceAll(`{${name}}`, replacement);
    }
    return out;
}

export function getActiveLocale(): Locale {
    return env.LOCALE_LANG;
}
