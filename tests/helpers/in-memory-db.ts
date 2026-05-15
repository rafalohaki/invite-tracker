import { createDb } from '@/db/client.ts';

/**
 * Creates an isolated in-memory SQLite database with every migration applied.
 * Each test should call this in `beforeEach` to avoid cross-contamination.
 */
export function createTestDb() {
    return createDb(':memory:');
}
