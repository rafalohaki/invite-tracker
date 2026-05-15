import { type Guild, PermissionFlagsBits, type Role } from 'discord.js';

export function hasManageGuild(guild: Guild): boolean {
    return guild.members.me?.permissions.has(PermissionFlagsBits.ManageGuild) ?? false;
}

export function hasManageRoles(guild: Guild): boolean {
    return guild.members.me?.permissions.has(PermissionFlagsBits.ManageRoles) ?? false;
}

export type AssignRoleResult =
    | { ok: true }
    | { ok: false; reason: 'bot-not-cached' | 'no-manage-roles' | 'role-managed' | 'role-everyone' | 'role-above-bot' };

/**
 * Pre-flight check before `member.roles.add(role)`. Discord will reject the API call otherwise,
 * but this lets us log a meaningful reason and skip the call entirely (saves a 403).
 *
 * Rules (every one must pass):
 *   - bot's GuildMember must be cached (`guild.members.me`)
 *   - bot must hold ManageRoles in this guild
 *   - target role must not be a "managed" role (integration-owned, e.g. Booster)
 *   - target role must not be @everyone
 *   - target role's position must be strictly below the bot's highest role
 */
export function canAssignRole(guild: Guild, role: Role): AssignRoleResult {
    const me = guild.members.me;
    if (!me) return { ok: false, reason: 'bot-not-cached' };
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) return { ok: false, reason: 'no-manage-roles' };
    if (role.managed) return { ok: false, reason: 'role-managed' };
    if (role.id === guild.roles.everyone.id) return { ok: false, reason: 'role-everyone' };
    if (role.position >= me.roles.highest.position) return { ok: false, reason: 'role-above-bot' };
    return { ok: true };
}
