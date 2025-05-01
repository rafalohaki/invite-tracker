/**
 * @file utils/translator.js
 * @description Handles loading translations from custom-lang.yaml and provides a translation function (t).
 * Supports fallback from 'custom' locale to 'en' locale.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

let translations = {};
let activeLocale = 'en'; // Default locale if not set or invalid
const defaultLangKey = 'en';
const customLangKey = 'custom';
const translationFilePath = path.join(__dirname, '..', 'custom-lang.yaml'); // Path relative to this file

/**
 * Loads translations from the YAML file and sets the active locale based on process.env.LOCALE_LANG.
 * Should be called once at application startup.
 */
function loadTranslations() {
    console.log(`[Translator] Attempting to load translations from: ${translationFilePath}`);
    try {
        if (!fs.existsSync(translationFilePath)) {
             console.error(`[Translator] FATAL ERROR: Translation file not found at ${translationFilePath}`);
             // Set empty objects to prevent crashes, but functionality will be impaired.
             translations = { [defaultLangKey]: {}, [customLangKey]: {} };
             return; // Stop loading process
        }

        const fileContents = fs.readFileSync(translationFilePath, 'utf8');
        const loadedYaml = yaml.load(fileContents);

        // Basic validation of loaded YAML structure
        if (!loadedYaml || typeof loadedYaml !== 'object') {
            throw new Error('Failed to parse YAML or the file is empty/invalid.');
        }
        translations = loadedYaml; // Assign successfully loaded translations

        // Ensure default language section exists
        if (!translations[defaultLangKey] || typeof translations[defaultLangKey] !== 'object') {
            console.warn(`[Translator] WARNING: Default language key '${defaultLangKey}' missing or invalid in YAML file. Fallback might not work correctly.`);
            translations[defaultLangKey] = {}; // Create empty object to prevent errors during lookup
        }
         // Warn if custom language section is missing, as it might be intended
         if (!translations[customLangKey] || typeof translations[customLangKey] !== 'object') {
             console.warn(`[Translator] WARNING: Custom language key '${customLangKey}' missing or invalid in YAML file. Using 'LOCALE_LANG=custom' might lead to missing strings.`);
             translations[customLangKey] = {}; // Create empty object
         }

        // Determine active locale from environment variable, default to 'en'
        const envLocale = process.env.LOCALE_LANG?.toLowerCase();
        if (envLocale === customLangKey && translations[customLangKey]) { // Ensure custom exists before setting
            activeLocale = customLangKey;
        } else {
            activeLocale = defaultLangKey;
             if (envLocale && envLocale !== defaultLangKey) {
                 console.warn(`[Translator] Invalid or unsupported LOCALE_LANG '${process.env.LOCALE_LANG}'. Defaulting to '${defaultLangKey}'.`);
             }
        }

        console.log(`[Translator] Translations loaded successfully. Active locale: '${activeLocale}'.`);

    } catch (error) {
        console.error('[Translator] FATAL ERROR loading or parsing translations:', error);
        console.error('[Translator] Bot may not function correctly. Please check custom-lang.yaml syntax and file permissions.');
        // Set empty objects to prevent crashes, but functionality will be severely impacted.
        translations = { [defaultLangKey]: {}, [customLangKey]: {} };
        activeLocale = defaultLangKey; // Ensure active locale is set even on error
        // Consider exiting if translations are absolutely critical: process.exit(1);
    }
}

/**
 * Retrieves a nested property from an object using a dot-notation string key.
 * Gracefully handles missing keys or invalid paths.
 * @param {object} obj The object to search within.
 * @param {string} key The dot-notation key (e.g., 'invite.embed_title').
 * @returns {string|number|boolean|object|undefined} The found value or undefined if path is invalid.
 */
function getString(obj, key) {
    // Basic validation
    if (!obj || typeof obj !== 'object' || typeof key !== 'string' || key === '') {
        return undefined;
    }
    // Use reduce to traverse the object based on the key parts
    try {
        return key.split('.').reduce((currentLevel, keyPart) => {
            // If currentLevel becomes null or undefined at any point, stop traversal
            return currentLevel?.[keyPart];
        }, obj);
    } catch (e) {
         // Catch potential errors during reduce (though unlikely with the checks)
         console.error(`[Translator] Error accessing key '${key}':`, e);
         return undefined;
    }
}

/**
 * Translates a given key based on the active locale ('custom' or 'en').
 * - If activeLocale is 'custom', it first tries to find the key in the 'custom' section.
 * - If not found in 'custom' (or if activeLocale is 'en'), it falls back to the 'en' section.
 * - Replaces placeholders in the format {placeholder_key} within the retrieved string.
 * - Returns a noticeable error string if the key is not found in either the active locale or the fallback.
 *
 * @param {string} key The translation key (e.g., 'invite.embed_title').
 * @param {object} [placeholders={}] Optional key-value pairs for replacement (e.g., { username: 'User' }).
 * @returns {string} The translated (and processed) string, or an error placeholder string.
 */
function t(key, placeholders = {}) {
    let text;

    // 1. Try fetching from the active locale ('custom' or 'en')
    if (activeLocale === customLangKey) {
        text = getString(translations[customLangKey], key);
        // Log if we are using custom but the key was missing (will fallback next)
        // Optional: Add more verbose logging for debugging missing keys
        // if (text === undefined) {
        //     console.log(`[Translator] DEBUG: Key '${key}' not found in '${customLangKey}', attempting fallback to '${defaultLangKey}'.`);
        // }
    }

    // 2. Fallback to default language ('en') if:
    //    - Active locale is 'en' OR
    //    - Active locale is 'custom' BUT the key was not found (text is undefined)
    if (text === undefined) {
        text = getString(translations[defaultLangKey], key);
    }

    // 3. Handle case where key is not found in either locale
    if (text === undefined) {
        console.error(`[Translator] ERROR: Translation key '${key}' not found in active locale ('${activeLocale}') or fallback ('${defaultLangKey}').`);
        // Return a clearly marked placeholder string
        return `[MISSING_TRANSLATION:${key}]`;
    }

    // Ensure the result is a string before replacing placeholders
    let resultString = String(text);

    // 4. Replace placeholders if the text is a string and placeholders are provided
    if (placeholders && typeof placeholders === 'object') {
        for (const [placeholder, value] of Object.entries(placeholders)) {
            // Ensure value is stringifiable (handles numbers, null, undefined gracefully)
            const replacement = (value !== null && value !== undefined) ? String(value) : '';
            // Use a regex to replace all occurrences of {placeholder} globally
            // Escape placeholder name for regex safety? Usually not needed for typical keys.
            resultString = resultString.replace(new RegExp(`\\{${placeholder}\\}`, 'g'), replacement);
        }
    }

    return resultString;
}

// Expose the translation function and the loader
module.exports = {
    loadTranslations, // Call this once at startup
    t,                // Use this for getting translated strings
    getActiveLocale: () => activeLocale // Expose the active locale if needed elsewhere
};