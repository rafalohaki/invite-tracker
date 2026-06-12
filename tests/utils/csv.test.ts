import { describe, expect, it } from 'bun:test';
import { csvEscape, toCsv } from '@/utils/csv.ts';

describe('csvEscape', () => {
    it('passes plain values through', () => {
        expect(csvEscape('hello')).toBe('hello');
        expect(csvEscape(42)).toBe('42');
    });

    it('renders null/undefined as empty', () => {
        expect(csvEscape(null)).toBe('');
        expect(csvEscape(undefined)).toBe('');
    });

    it('quotes commas, quotes and newlines', () => {
        expect(csvEscape('a,b')).toBe('"a,b"');
        expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
        expect(csvEscape('line1\nline2')).toBe('"line1\nline2"');
    });
});

describe('toCsv', () => {
    it('builds a CRLF-terminated document with a header row', () => {
        const csv = toCsv(
            ['id', 'name'],
            [
                [1, 'Alice'],
                [2, 'Bob, Jr.'],
            ],
        );
        expect(csv).toBe('id,name\r\n1,Alice\r\n2,"Bob, Jr."\r\n');
    });

    it('handles zero data rows', () => {
        expect(toCsv(['a'], [])).toBe('a\r\n');
    });
});
