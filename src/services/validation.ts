import type { Guild } from 'discord.js';
import { INITIAL_VALIDATION_DELAY_MS, MEMBER_FETCH_CHUNK_SIZE, ROLE_ASSIGN_THROTTLE_MS } from '@/config/constants.ts';
import { env } from '@/config/env.ts';
import type { BulkValidationUpdate } from '@/db/repositories/tracked-joins.ts';
import { assignEligibleRoles } from '@/services/role-rewards.ts';
import type { AppClient, AppContext } from '@/types/discord.ts';
import { isUnknownMemberOrUser } from '@/utils/discord-errors.ts';
import { logError, logInfo, logWarn } from '@/utils/logger.ts';
import { isoNow } from '@/utils/time.ts';

type PresenceStatus = 'present' | 'left' | 'error_skip';

/**
 * Resolve {userId → presence} for many users in one (or few) batched fetch(es).
 * Cheaper than N individual fetches; falls back to per-user only when the batch fails.
 */
async function fetchPresenceForGuild(
    guild: Guild,
    userIds: readonly string[],
    logPrefix: string,
): Promise<Map<string, PresenceStatus>> {
    const result = new Map<string, PresenceStatus>();
    if (userIds.length === 0) return result;

    for (let i = 0; i < userIds.length; i += MEMBER_FETCH_CHUNK_SIZE) {
        const chunk = userIds.slice(i, i + MEMBER_FETCH_CHUNK_SIZE);
        try {
            const members = await guild.members.fetch({ user: [...chunk] });
            for (const id of chunk) {
                result.set(id, members.has(id) ? 'present' : 'left');
            }
        } catch (err) {
            logWarn(`${logPrefix} Batch fetch failed for ${chunk.length} member(s); falling back per-user:`, err);
            for (const id of chunk) {
                try {
                    await guild.members.fetch({ user: id, force: true });
                    result.set(id, 'present');
                } catch (perUserErr) {
                    if (isUnknownMemberOrUser(perUserErr)) {
                        result.set(id, 'left');
                    } else {
                        logWarn(`${logPrefix} Per-user fetch failed for ${id}:`, perUserErr);
                        result.set(id, 'error_skip');
                    }
                }
            }
        }
    }
    return result;
}

/**
 * Single validation pass across every guild the bot is in:
 *   1. For each guild: read its per-guild validation_period_days (env fallback).
 *   2. Pull pending TrackedJoins older than the cutoff.
 *   3. Batch-fetch member presence.
 *   4. Build a bulk update payload, run it in one transaction.
 *   5. Return the inviters whose validated count just changed (for PR #10 to assign role rewards).
 */
export async function runValidation(client: AppClient, ctx: AppContext): Promise<Map<string, Set<string>>> {
    const logPrefix = '[ValidationTask]';
    logInfo(`${logPrefix} Running validation pass across ${client.guilds.cache.size} guild(s)…`);
    const promotedByInviter = new Map<string, Set<string>>();

    for (const guild of client.guilds.cache.values()) {
        const guildPrefix = `${logPrefix}[Guild:${guild.id}]`;
        try {
            const cfg = ctx.repos.guildConfig.getOrDefault(guild.id);
            const cutoffMs = Date.now() - cfg.validation_period_days * 24 * 60 * 60 * 1000;
            const cutoff = new Date(cutoffMs).toISOString();
            const candidates = ctx.repos.trackedJoins.findCandidatesForGuild(guild.id, cutoff);
            if (candidates.length === 0) continue;

            logInfo(`${guildPrefix} ${candidates.length} pending join(s) eligible.`);
            const userIds = candidates.map((c) => c.inviteeId);
            const presence = await fetchPresenceForGuild(guild, userIds, guildPrefix);

            const validationTime = isoNow();
            const bulkOps: BulkValidationUpdate[] = [];
            for (const candidate of candidates) {
                const status = presence.get(candidate.inviteeId);
                if (status === 'present') {
                    bulkOps.push({
                        id: candidate.id,
                        status: 'validated',
                        validationTime,
                        leaveTime: null,
                    });
                    const set = promotedByInviter.get(guild.id) ?? new Set<string>();
                    set.add(candidate.inviterId);
                    promotedByInviter.set(guild.id, set);
                } else if (status === 'left') {
                    bulkOps.push({
                        id: candidate.id,
                        status: 'left_early',
                        validationTime: null,
                        leaveTime: validationTime,
                    });
                }
                // error_skip → leave the row untouched, try again next run.
            }

            if (bulkOps.length === 0) {
                logInfo(`${guildPrefix} No actionable updates after presence check.`);
                continue;
            }
            const validatedCount = bulkOps.filter((o) => o.status === 'validated').length;
            logInfo(
                `${guildPrefix} Applying ${bulkOps.length} update(s): ${validatedCount} validated, ${bulkOps.length - validatedCount} left_early.`,
            );
            ctx.repos.trackedJoins.bulkUpdateStatus(bulkOps);
        } catch (err) {
            logError(`${guildPrefix} Failed validation pass:`, err);
        }
    }

    // Role-reward sweep: for every inviter whose validated count just changed,
    // grant any reward whose threshold is now satisfied. One bulk role.add per
    // inviter, with a soft throttle between inviters so we don't hit the
    // per-guild "10 role updates / 10s" rate limit on a busy run.
    for (const [guildId, inviterIds] of promotedByInviter.entries()) {
        const guild = client.guilds.cache.get(guildId);
        if (!guild) continue;
        for (const inviterId of inviterIds) {
            try {
                const inviter = await guild.members.fetch(inviterId).catch(() => null);
                if (!inviter) continue;
                const count = ctx.repos.trackedJoins.countByStatus(guildId, inviterId, 'validated');
                await assignEligibleRoles(ctx, guild, inviter, count);
            } catch (err) {
                logError(`[ValidationTask][Guild:${guildId}][Inviter:${inviterId}] Role assignment failed:`, err);
            }
            await new Promise((resolve) => setTimeout(resolve, ROLE_ASSIGN_THROTTLE_MS));
        }
    }

    return promotedByInviter;
}

/**
 * Install the periodic scheduler. Returns the timer handle so callers (graceful shutdown)
 * can clear it. Runs an initial pass 2 minutes after startup, then on the configured cadence.
 */
export function startValidationScheduler(client: AppClient, ctx: AppContext): NodeJS.Timeout {
    const intervalMs = env.VALIDATION_CHECK_INTERVAL_MINUTES * 60 * 1000;
    logInfo(`[ValidationTask] Scheduler armed: every ${env.VALIDATION_CHECK_INTERVAL_MINUTES} min.`);

    setTimeout(() => {
        runValidation(client, ctx).catch((err) => logError('[ValidationTask] Initial pass failed:', err));
    }, INITIAL_VALIDATION_DELAY_MS);

    return setInterval(() => {
        runValidation(client, ctx).catch((err) => logError('[ValidationTask] Periodic pass failed:', err));
    }, intervalMs);
}
