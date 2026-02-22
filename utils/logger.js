/**
 * @file utils/logger.js
 * @description Centralized logger with configurable log levels (DEBUG, INFO, WARN, ERROR).
 * Controlled by LOG_LEVEL environment variable. Defaults to INFO.
 * Import this in any file instead of using console.* directly.
 */

'use strict';

const LOG_LEVELS = { DEBUG: 1, INFO: 2, WARN: 3, ERROR: 4 };
const configuredLogLevelName = process.env.LOG_LEVEL?.toUpperCase() || 'INFO';
const LOG_LEVEL = LOG_LEVELS[configuredLogLevelName] ?? LOG_LEVELS.INFO;

const logDebug = (...args) => { if (LOG_LEVEL <= LOG_LEVELS.DEBUG) console.debug('[DEBUG]', ...args); };
const logInfo = (...args) => { if (LOG_LEVEL <= LOG_LEVELS.INFO) console.info('[INFO]', ...args); };
const logWarn = (...args) => { if (LOG_LEVEL <= LOG_LEVELS.WARN) console.warn('[WARN]', ...args); };
const logError = (...args) => { if (LOG_LEVEL <= LOG_LEVELS.ERROR) console.error('[ERROR]', ...args); };

module.exports = { logDebug, logInfo, logWarn, logError, LOG_LEVEL, configuredLogLevelName };
