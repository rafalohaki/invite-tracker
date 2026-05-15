import { DiscordAPIError } from 'discord.js';

/** Discord API error codes used by this bot. Reference: https://discord.com/developers/docs/topics/opcodes-and-status-codes */
export const DISCORD_ERROR_CODES = {
    UNKNOWN_INVITE: 10006,
    UNKNOWN_MEMBER: 10007,
    UNKNOWN_USER: 10013,
    UNKNOWN_CHANNEL: 10003,
    UNKNOWN_ROLE: 10011,
    MISSING_ACCESS: 50001,
    MISSING_PERMISSIONS: 50013,
    INVALID_FORM_BODY: 50035,
} as const;

export type DiscordErrorCode = (typeof DISCORD_ERROR_CODES)[keyof typeof DISCORD_ERROR_CODES];

export function isDiscordAPIError(error: unknown): error is DiscordAPIError {
    return error instanceof DiscordAPIError;
}

export function hasErrorCode(error: unknown, code: DiscordErrorCode): boolean {
    return isDiscordAPIError(error) && error.code === code;
}

export function isUnknownMemberOrUser(error: unknown): boolean {
    return (
        hasErrorCode(error, DISCORD_ERROR_CODES.UNKNOWN_MEMBER) || hasErrorCode(error, DISCORD_ERROR_CODES.UNKNOWN_USER)
    );
}

export function isMissingPermissions(error: unknown): boolean {
    return hasErrorCode(error, DISCORD_ERROR_CODES.MISSING_PERMISSIONS);
}

export function isUnknownInvite(error: unknown): boolean {
    return hasErrorCode(error, DISCORD_ERROR_CODES.UNKNOWN_INVITE);
}
