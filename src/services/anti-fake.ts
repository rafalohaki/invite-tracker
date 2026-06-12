/**
 * Fake-join detection: a join is "fake" when the joining Discord account is
 * younger than the guild's `min_account_age_days`. Classic counter to invite
 * farming with freshly created throwaway accounts.
 *
 * Pure function — callers pass `user.createdTimestamp`; tests pass arbitrary clocks.
 */
export function isAccountTooYoung(accountCreatedMs: number, minAgeDays: number, nowMs: number = Date.now()): boolean {
    if (minAgeDays <= 0) return false;
    return nowMs - accountCreatedMs < minAgeDays * 24 * 60 * 60 * 1000;
}
