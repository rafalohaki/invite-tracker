import { env } from '@/config/env.ts';

const LOG_LEVELS = { DEBUG: 1, INFO: 2, WARN: 3, ERROR: 4 } as const;
type LogLevelName = keyof typeof LOG_LEVELS;

const activeLevel: number = LOG_LEVELS[env.LOG_LEVEL];

function shouldLog(level: LogLevelName): boolean {
    return activeLevel <= LOG_LEVELS[level];
}

// biome-ignore lint/suspicious/noExplicitAny: logger accepts any printable argument
export const logDebug = (...args: any[]): void => {
    if (shouldLog('DEBUG')) console.debug('[DEBUG]', ...args);
};
// biome-ignore lint/suspicious/noExplicitAny: logger accepts any printable argument
export const logInfo = (...args: any[]): void => {
    if (shouldLog('INFO')) console.info('[INFO]', ...args);
};
// biome-ignore lint/suspicious/noExplicitAny: logger accepts any printable argument
export const logWarn = (...args: any[]): void => {
    if (shouldLog('WARN')) console.warn('[WARN]', ...args);
};
// biome-ignore lint/suspicious/noExplicitAny: logger accepts any printable argument
export const logError = (...args: any[]): void => {
    if (shouldLog('ERROR')) console.error('[ERROR]', ...args);
};

export const configuredLogLevel: LogLevelName = env.LOG_LEVEL;
