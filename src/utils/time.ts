const UNIT_MS: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
};

/**
 * Parse a duration like `7d`, `30m`, `12h`, `90s` into milliseconds.
 * Returns null on invalid input.
 */
export function parseDuration(input: string): number | null {
    const match = /^(\d+)\s*([smhd])$/i.exec(input.trim());
    if (!match) return null;
    const value = Number(match[1]);
    const unit = match[2]?.toLowerCase();
    if (!unit || !(unit in UNIT_MS)) return null;
    const multiplier = UNIT_MS[unit];
    if (multiplier === undefined) return null;
    return value * multiplier;
}

/** Returns the current time as an ISO 8601 string (matches strftime('%Y-%m-%dT%H:%M:%fZ', 'now') in SQL). */
export function isoNow(): string {
    return new Date().toISOString();
}

/** Returns a timestamp `windowMs` in the past, ISO 8601. */
export function isoCutoff(windowMs: number): string {
    return new Date(Date.now() - windowMs).toISOString();
}

/** Compact human readout for log messages: "2d 3h 45m". */
export function msToHumanReadable(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    let remaining = Math.floor(ms / 1000);
    const days = Math.floor(remaining / 86400);
    remaining %= 86400;
    const hours = Math.floor(remaining / 3600);
    remaining %= 3600;
    const minutes = Math.floor(remaining / 60);
    const seconds = remaining % 60;
    const parts: string[] = [];
    if (days) parts.push(`${days}d`);
    if (hours) parts.push(`${hours}h`);
    if (minutes) parts.push(`${minutes}m`);
    if (seconds && parts.length < 2) parts.push(`${seconds}s`);
    return parts.join(' ') || '0s';
}
