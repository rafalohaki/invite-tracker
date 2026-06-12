/** Returns the current time as an ISO 8601 string (matches strftime('%Y-%m-%dT%H:%M:%fZ', 'now') in SQL). */
export function isoNow(): string {
    return new Date().toISOString();
}

/** Returns a timestamp `windowMs` in the past, ISO 8601. */
export function isoCutoff(windowMs: number): string {
    return new Date(Date.now() - windowMs).toISOString();
}

/**
 * Renders an ISO 8601 string as a Discord timestamp tag (`<t:unix:R>` → "3 days ago",
 * locale-aware on the client). Falls back to the raw string when unparsable.
 */
export function toDiscordTimestamp(iso: string, style: 'R' | 'f' | 'D' = 'R'): string {
    const ms = Date.parse(iso);
    if (Number.isNaN(ms)) return iso;
    return `<t:${Math.floor(ms / 1000)}:${style}>`;
}
