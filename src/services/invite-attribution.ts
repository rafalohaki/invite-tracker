import type { UserInviteRow } from '@/types/db.ts';
import { logDebug, logInfo, logWarn } from '@/utils/logger.ts';

export interface Attribution {
    inviterId: string;
    inviteCode: string;
    delta: number;
}

export interface AttributionResult {
    attribution: Attribution | null;
    staleInviteCodes: string[];
    ambiguous: boolean;
}

interface SingleInviteCheck {
    isStale: boolean;
    usageIncreased: boolean;
    delta: number;
    inviterId: string;
    inviteCode: string;
}

export interface UsedCodeResult {
    code: string;
    ambiguous: boolean;
}

/**
 * Detect which invite code (ANY guild invite, not just bot-tracked ones) was used,
 * by diffing current vs cached use counts. Powers invite-label source tracking and
 * auto-roles, which apply to arbitrary codes.
 *
 * A code is a candidate when its count increased, or when it's new since the last
 * cache refresh and already has uses. With multiple candidates the first is returned
 * with `ambiguous: true` (same trade-off as inviter attribution). Pure function.
 */
export function findUsedCodeAcrossAll(
    currentUses: Map<string, number> | null,
    cachedUses: Map<string, number> | null,
): UsedCodeResult | null {
    if (!currentUses || !cachedUses) return null;
    const candidates: string[] = [];
    for (const [code, uses] of currentUses) {
        const cached = cachedUses.get(code);
        if (cached !== undefined ? uses > cached : uses > 0) {
            candidates.push(code);
        }
    }
    // biome-ignore lint/style/noNonNullAssertion: length checked above
    if (candidates.length >= 1) return { code: candidates[0]!, ambiguous: candidates.length > 1 };
    return null;
}

/** Inspect one tracked invite against current vs cached use counts. Pure function. */
export function checkSingleInvite(
    userInvite: UserInviteRow,
    currentUses: Map<string, number> | null,
    cachedUses: Map<string, number> | null,
    logPrefix: string,
): SingleInviteCheck {
    const current = currentUses?.get(userInvite.inviteCode);
    const cached = cachedUses?.get(userInvite.inviteCode);

    if (current === undefined) {
        logWarn(
            `${logPrefix} Tracked invite ${userInvite.inviteCode} (inviter ${userInvite.userId}) not on Discord — marking stale.`,
        );
        cachedUses?.delete(userInvite.inviteCode);
        return {
            isStale: true,
            usageIncreased: false,
            delta: 0,
            inviterId: userInvite.userId,
            inviteCode: userInvite.inviteCode,
        };
    }

    let delta = 0;
    let usageIncreased = false;
    if (cachedUses && cached !== undefined) {
        if (current > cached) {
            delta = current - cached;
            usageIncreased = true;
            logDebug(`${logPrefix} ${userInvite.inviteCode} uses: ${cached} → ${current} (Δ${delta}).`);
        }
    } else if (current > 0) {
        // Cache miss but invite was used — best-effort attribution from a single observation.
        logInfo(`${logPrefix} Cache miss for ${userInvite.inviteCode}; attributing on uses=${current}.`);
        delta = current;
        usageIncreased = true;
    }

    return {
        isStale: false,
        usageIncreased,
        delta,
        inviterId: userInvite.userId,
        inviteCode: userInvite.inviteCode,
    };
}

/**
 * Compare every tracked user-invite against current Discord state and decide attribution.
 *
 * Returns:
 * - `attribution`: the inviter + invite-code we believe was used, or null if undecidable.
 * - `staleInviteCodes`: codes that no longer exist on Discord — caller should purge from DB.
 * - `ambiguous`: true when multiple tracked invites incremented in the same window. In that
 *   case `attribution` is set to the FIRST match — accuracy is not guaranteed (see plan §14.4).
 */
export function findUsedInviteAndStale(
    currentUses: Map<string, number> | null,
    cachedUses: Map<string, number> | null,
    trackedUserInvites: readonly UserInviteRow[],
    logPrefix: string,
): AttributionResult {
    if (!currentUses) {
        logWarn(`${logPrefix} Cannot attribute: currentUses is null (perms or API error).`);
        return { attribution: null, staleInviteCodes: [], ambiguous: false };
    }
    if (!cachedUses) {
        logWarn(`${logPrefix} Cannot attribute: cachedUses is null (cache failed).`);
        return { attribution: null, staleInviteCodes: [], ambiguous: false };
    }

    const stale: string[] = [];
    const candidates: Attribution[] = [];

    for (const ui of trackedUserInvites) {
        const r = checkSingleInvite(ui, currentUses, cachedUses, logPrefix);
        if (r.isStale) {
            stale.push(r.inviteCode);
        } else if (r.usageIncreased) {
            candidates.push({ inviterId: r.inviterId, inviteCode: r.inviteCode, delta: r.delta });
        }
    }

    if (candidates.length === 1) {
        // biome-ignore lint/style/noNonNullAssertion: length === 1 guarantees [0] exists
        const a = candidates[0]!;
        logInfo(`${logPrefix} Attributed to ${a.inviterId} via ${a.inviteCode} (Δ${a.delta}).`);
        return { attribution: a, staleInviteCodes: stale, ambiguous: false };
    }
    if (candidates.length > 1) {
        // biome-ignore lint/style/noNonNullAssertion: length > 1 guarantees [0] exists
        const a = candidates[0]!;
        const detail = candidates.map((c) => `${c.inviteCode}(+${c.delta})`).join(', ');
        logWarn(`${logPrefix} Ambiguous attribution [${detail}] — using first match (${a.inviteCode}).`);
        return { attribution: a, staleInviteCodes: stale, ambiguous: true };
    }
    logInfo(`${logPrefix} No tracked invite usage increased.`);
    return { attribution: null, staleInviteCodes: stale, ambiguous: false };
}
