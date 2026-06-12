import type { Guild, GuildMember } from 'discord.js';
import type { InviteLabelRow } from '@/types/db.ts';
import type { AppContext } from '@/types/discord.ts';
import { logError, logInfo, logWarn } from '@/utils/logger.ts';
import { canAssignRole } from '@/utils/permissions.ts';

/**
 * Grants the label's auto-role to a freshly joined member (e.g. everyone joining
 * via the "YouTube" invite gets @YouTube Fan). No-op when the label has no role.
 * Hierarchy/permission pre-check mirrors role-rewards.
 */
export async function applyLabelAutoRole(
    _ctx: AppContext,
    guild: Guild,
    member: GuildMember,
    labelRow: InviteLabelRow,
): Promise<boolean> {
    if (!labelRow.autoRoleId) return false;
    const prefix = `[InviteLabels][Guild:${guild.id}][User:${member.id}]`;

    const role =
        guild.roles.cache.get(labelRow.autoRoleId) ?? (await guild.roles.fetch(labelRow.autoRoleId).catch(() => null));
    if (!role) {
        logWarn(`${prefix} Auto-role ${labelRow.autoRoleId} for label '${labelRow.label}' not found — skipping.`);
        return false;
    }
    const check = canAssignRole(guild, role);
    if (!check.ok) {
        logWarn(`${prefix} Cannot assign auto-role ${role.name} for label '${labelRow.label}': ${check.reason}.`);
        return false;
    }
    try {
        await member.roles.add(role, `Invite label '${labelRow.label}' auto-role`);
        logInfo(`${prefix} Granted auto-role ${role.name} (label '${labelRow.label}').`);
        return true;
    } catch (err) {
        logError(`${prefix} Failed to grant auto-role for label '${labelRow.label}':`, err);
        return false;
    }
}
