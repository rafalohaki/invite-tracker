import type { Guild, GuildMember, Role } from 'discord.js';
import type { AppContext } from '@/types/discord.ts';
import { logError, logInfo, logWarn } from '@/utils/logger.ts';
import { canAssignRole } from '@/utils/permissions.ts';

/** Soft throttle between members to stay friendly with Discord's role-update rate limit. */
export const ROLE_ASSIGN_THROTTLE_MS = 1500;

export interface AssignmentReport {
    added: string[];
    skipped: { roleId: string; reason: string }[];
}

/**
 * Grant every RoleReward whose threshold is now satisfied, that the inviter
 * doesn't already have, and that passes the hierarchy/perm check.
 *
 * Single `member.roles.add(rolesArray, reason)` API call per member — far
 * friendlier to Discord's rate limits than one call per role.
 */
export async function assignEligibleRoles(
    ctx: AppContext,
    guild: Guild,
    inviter: GuildMember,
    validatedCount: number,
): Promise<AssignmentReport> {
    const prefix = `[RoleRewards][Guild:${guild.id}][Inviter:${inviter.id}]`;
    const eligible = ctx.repos.roleRewards.findEligibleForCount(guild.id, validatedCount);
    const added: string[] = [];
    const skipped: { roleId: string; reason: string }[] = [];

    const rolesToAdd: Role[] = [];
    for (const reward of eligible) {
        const role = guild.roles.cache.get(reward.roleId) ?? (await guild.roles.fetch(reward.roleId).catch(() => null));
        if (!role) {
            skipped.push({ roleId: reward.roleId, reason: 'role-not-found' });
            logWarn(`${prefix} Reward roleId ${reward.roleId} not found in guild — skipping.`);
            continue;
        }
        if (inviter.roles.cache.has(role.id)) continue;
        const check = canAssignRole(guild, role);
        if (!check.ok) {
            skipped.push({ roleId: reward.roleId, reason: check.reason });
            logWarn(`${prefix} Cannot assign ${role.name} (${reward.roleId}): ${check.reason}.`);
            continue;
        }
        rolesToAdd.push(role);
    }

    if (rolesToAdd.length === 0) return { added, skipped };

    try {
        await inviter.roles.add(rolesToAdd, `Role reward: ${validatedCount} validated invites`);
        for (const role of rolesToAdd) added.push(role.id);
        logInfo(`${prefix} Added ${rolesToAdd.length} role(s): ${rolesToAdd.map((r) => r.name).join(', ')}.`);
    } catch (err) {
        logError(`${prefix} Failed to add roles in bulk:`, err);
        for (const role of rolesToAdd) skipped.push({ roleId: role.id, reason: 'add-failed' });
    }
    return { added, skipped };
}
