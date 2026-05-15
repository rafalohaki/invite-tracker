/** Returns the current time as an ISO 8601 string (matches strftime('%Y-%m-%dT%H:%M:%fZ', 'now') in SQL). */
export function isoNow(): string {
    return new Date().toISOString();
}

/** Returns a timestamp `windowMs` in the past, ISO 8601. */
export function isoCutoff(windowMs: number): string {
    return new Date(Date.now() - windowMs).toISOString();
}
