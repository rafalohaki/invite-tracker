import { Database } from 'bun:sqlite';
import { runMigrations } from './migration-runner.ts';

/**
 * Creates a SQLite database connection and runs pending migrations.
 *
 * Factory (not singleton) so tests can spin up `createDb(':memory:')` per `describe`
 * without polluting global state.
 *
 * @param dbPath Filesystem path or `:memory:` for ephemeral test databases.
 */
export function createDb(dbPath: string): Database {
    const db = new Database(dbPath);
    // WAL = better read/write concurrency + crash resilience. NORMAL sync is the SQLite-recommended
    // pairing with WAL — fsync once per checkpoint, not every commit.
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = NORMAL');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA busy_timeout = 5000');
    runMigrations(db);
    return db;
}
