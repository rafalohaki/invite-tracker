/**
 * Minimal CSV serializer (RFC 4180-ish): quotes fields containing commas,
 * quotes, or newlines; doubles embedded quotes. No external dependency.
 */
export function csvEscape(value: string | number | null | undefined): string {
    const s = value === null || value === undefined ? '' : String(value);
    if (/[",\r\n]/.test(s)) {
        return `"${s.replaceAll('"', '""')}"`;
    }
    return s;
}

export function toCsv(headers: readonly string[], rows: readonly (string | number | null | undefined)[][]): string {
    const lines = [headers.map(csvEscape).join(',')];
    for (const row of rows) {
        lines.push(row.map(csvEscape).join(','));
    }
    return `${lines.join('\r\n')}\r\n`;
}
