import type { Collection, Guild, Invite } from 'discord.js';
import { isMissingPermissions } from '@/utils/discord-errors.ts';
import { logDebug, logError, logWarn } from '@/utils/logger.ts';
import { hasManageGuild } from '@/utils/permissions.ts';

/**
 * Per-process in-memory snapshot: guildId → (inviteCode → uses count).
 * Rebuilt on bot startup and refreshed after every GuildMemberAdd / cache-miss event.
 *
 * Module-level state is intentional: the cache is global per-bot, and re-initializing it
 * mid-run is undesirable. Tests don't touch this module directly — attribution logic
 * accepts the map as a parameter, keeping it testable in isolation.
 */
const inviteUsesCache: Map<string, Map<string, number>> = new Map();

export async function cacheGuildInvites(guild: Guild): Promise<boolean> {
    const prefix = `[InviteCache][Guild:${guild.id}]`;
    if (!hasManageGuild(guild)) {
        logWarn(`${prefix} Missing 'Manage Guild' permission. Cannot cache invites.`);
        inviteUsesCache.delete(guild.id);
        return false;
    }
    try {
        const invites = await guild.invites.fetch();
        const usesMap = new Map<string, number>();
        for (const inv of invites.values()) {
            usesMap.set(inv.code, inv.uses ?? 0);
        }
        inviteUsesCache.set(guild.id, usesMap);
        logDebug(`${prefix} Cached ${usesMap.size} invite uses.`);
        return true;
    } catch (err) {
        if (isMissingPermissions(err)) {
            logWarn(`${prefix} Lost Manage Guild permission mid-fetch.`);
        } else {
            logError(`${prefix} Failed to fetch invites:`, err);
        }
        inviteUsesCache.delete(guild.id);
        return false;
    }
}

export function getCachedUses(guildId: string): Map<string, number> | undefined {
    return inviteUsesCache.get(guildId);
}

/**
 * Records a single invite's use count without a full refetch — fed by the
 * InviteCreate gateway event. No-op when the guild has no cache yet (the next
 * full rebuild will pick the invite up anyway).
 */
export function setCachedUse(guildId: string, inviteCode: string, uses: number): void {
    inviteUsesCache.get(guildId)?.set(inviteCode, uses);
}

/** Drops a single invite from the cache — fed by the InviteDelete gateway event. */
export function removeCachedUse(guildId: string, inviteCode: string): void {
    inviteUsesCache.get(guildId)?.delete(inviteCode);
}

/** Returns the cached map, building it on demand. Null on permanent failure. */
export async function ensureCachedUses(guild: Guild): Promise<Map<string, number> | null> {
    const prefix = `[InviteCache][Guild:${guild.id}]`;
    let cached = inviteUsesCache.get(guild.id);
    if (cached) return cached;
    logWarn(`${prefix} Cache missing; rebuilding now…`);
    const ok = await cacheGuildInvites(guild);
    cached = inviteUsesCache.get(guild.id);
    if (!ok || !cached) {
        logError(`${prefix} Failed to establish invite cache; cannot attribute reliably.`);
        return null;
    }
    return cached;
}

export function clearGuildCache(guildId: string): boolean {
    return inviteUsesCache.delete(guildId);
}

/** Fetches current invites without modifying the cache. Returns null on perm/API failure. */
export async function fetchInvitesSafe(guild: Guild): Promise<Collection<string, Invite> | null> {
    const prefix = `[InviteFetch][Guild:${guild.id}]`;
    if (!hasManageGuild(guild)) {
        logWarn(`${prefix} Missing 'Manage Guild' permission.`);
        return null;
    }
    try {
        return await guild.invites.fetch();
    } catch (err) {
        if (isMissingPermissions(err)) {
            logWarn(`${prefix} Lost Manage Guild permission mid-fetch (unexpected).`);
        } else {
            logError(`${prefix} Failed to fetch invites:`, err);
        }
        return null;
    }
}
