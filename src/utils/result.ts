/**
 * Minimal Result type for operations that can fail with a known set of reasons.
 * Use instead of throwing when the caller is expected to handle every failure case
 * (e.g. role-assignment failure modes that map to log-and-skip).
 */
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
    return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
    return { ok: false, error };
}
