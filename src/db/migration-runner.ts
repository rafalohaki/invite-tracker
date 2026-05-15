import type { Database } from 'bun:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logError, logInfo } from '@/utils/logger.ts';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(moduleDir, 'migrations');

interface MigrationRow {
    name: string;
}

/**
 * Applies every `migrations/NNN_*.sql` file not yet recorded in `_migrations`.
 * Idempotent: a second call on the same DB is a no-op.
 */
export function runMigrations(db: Database): void {
    db.exec(`
        CREATE TABLE IF NOT EXISTS _migrations (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT NOT NULL UNIQUE,
            applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        )
    `);

    const files = readdirSync(MIGRATIONS_DIR)
        .filter((f) => f.endsWith('.sql'))
        .sort();

    const appliedRows = db.query('SELECT name FROM _migrations').all() as MigrationRow[];
    const applied = new Set(appliedRows.map((r) => r.name));

    const insertApplied = db.prepare('INSERT INTO _migrations (name) VALUES (?)');

    for (const file of files) {
        if (applied.has(file)) continue;
        const sql = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
        const apply = db.transaction(() => {
            db.exec(sql);
            insertApplied.run(file);
        });
        try {
            apply();
            logInfo(`[migrate] Applied ${file}`);
        } catch (err) {
            logError(`[migrate] Failed to apply ${file}:`, err);
            throw err;
        }
    }
}
