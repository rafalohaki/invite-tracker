/**
 * @file utils/translator.js
 * @description Handles loading translations from custom-lang.yaml and provides a translation function.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

let translations = {};
let activeLocale = 'en'; // Default locale
const defaultLangKey = 'en';
const customLangKey = 'custom';

/**
 * Loads translations from the YAML file and sets the active locale.
 * Should be called once at startup.
 */
function loadTranslations() {
    const filePath = path.join(__dirname, '..', 'custom-lang.yaml'); // Path relative to this file
    try {
        if (!fs.existsSync(filePath)) {
             throw new Error(`Translation file not found at ${filePath}`);
        }
        const fileContents = fs.readFileSync(filePath, 'utf8');
        translations = yaml.load(fileContents);

        if (!translations || typeof translations !== 'object') {
            throw new Error('Failed to parse YAML or file is empty.');
        }
        if (!translations[defaultLangKey] || typeof translations[defaultLangKey] !== 'object') {
            console.warn(`[Translator] WARNING: Default language key '${defaultLangKey}' missing or invalid in YAML file. Fallback might not work.`);
            translations[defaultLangKey] = {}; // Prevent errors later
        }
         if (!translations[customLangKey] || typeof translations[customLangKey] !== 'object') {
             console.warn(`[Translator] WARNING: Custom language key '${customLangKey}' missing or invalid in YAML file. 'custom' locale may not work correctly.`);
             translations[customLangKey] = {}; // Prevent errors later
         }


        // Determine active locale from environment variable, default to 'en'
        activeLocale = process.env.LOCALE_LANG?.toLowerCase() === customLangKey ? customLangKey : defaultLangKey;

        console.log(`[Translator] Translations loaded successfully. Active locale: '${activeLocale}'.`);

    } catch (error) {
        console.error('[Translator] FATAL ERROR loading translations:', error);
        console.error('[Translator] Bot may not function correctly without translations. Please check custom-lang.yaml and file permissions.');
        // Optionally exit if translations are critical: process.exit(1);
        translations = { [defaultLangKey]: {}, [customLangKey]: {} }; // Set empty objects to prevent crashes
    }
}

/**
 * Retrieves a nested property from an object using a dot-notation string key.
 * @param {object} obj The object to search within.
 * @param {string} key The dot-notation key (e.g., 'invite.embed_title').
 * @returns {string|undefined} The found string or undefined.
 */
function getString(obj, key) {
    if (!obj || typeof obj !== 'object' || !key) return undefined;
    return key.split('.').reduce((o, i) => (o?.[i]), obj);
}

/**
 * Translates a given key based on the active locale.
 * Falls back to the default language ('en') if the key is missing in the 'custom' locale.
 * Replaces placeholders in the format {placeholder_key}.
 * @param {string} key The translation key (e.g., 'invite.embed_title').
 * @param {object} [placeholders={}] Optional key-value pairs for replacement (e.g., { username: 'User' }).
 * @returns {string} The translated (and processed) string.
 */
function t(key, placeholders = {}) {
    let langToUse = activeLocale === customLangKey ? customLangKey : defaultLangKey;
    let text = getString(translations[langToUse], key);

    // Fallback to default language if using 'custom' and key is missing
    if (text === undefined && langToUse === customLangKey) {
        // console.warn(`[Translator] Key '${key}' not found in '${customLangKey}', falling back to '${defaultLangKey}'.`); // Optional warning
        text = getString(translations[defaultLangKey], key);
    }

    // If still not found, return a noticeable error string
    if (text === undefined) {
        console.error(`[Translator] ERROR: Translation key '${key}' not found in '${langToUse}' or fallback '${defaultLangKey}'.`);
        return `[MISSING_TRANSLATION:${key}]`;
    }

    // Replace placeholders
    if (typeof text === 'string' && placeholders && typeof placeholders === 'object') {
        for (const [placeholder, value] of Object.entries(placeholders)) {
            // Ensure value is stringifiable (handles numbers, etc.)
            const replacement = (value !== null && value !== undefined) ? String(value) : '';
            // Use a regex to replace all occurrences of {placeholder}
            text = text.replace(new RegExp(`\\{${placeholder}\\}`, 'g'), replacement);
        }
    }

    // Ensure the final result is a string
    return String(text);
}

// Expose the translation function and the loader
module.exports = {
    loadTranslations,
    t, // Make the translation function available
    getActiveLocale: () => activeLocale // Optionally expose the active locale
};