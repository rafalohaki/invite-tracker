import { Events } from 'discord.js';
import { findUsedInviteAndStale } from '@/services/invite-attribution.ts';
import { cacheGuildInvites, ensureCachedUses, fetchInvitesSafe } from '@/services/invite-cache.ts';
import { sendWelcomeMessage } from '@/services/welcome.ts';
import type { AppClient, AppContext } from '@/types/discord.ts';
import { ensureFullMemberData } from '@/utils/discord-members.ts';
import { logError, logInfo, logWarn } from '@/utils/logger.ts';
import { hasManageGuild } from '@/utils/permissions.ts';

const INVITE_FETCH_DELAY_MS = 2500;

export function registerGuildMemberAdd(client: AppClient, ctx: AppContext): void {
    client.on(Events.GuildMemberAdd, async (rawMember) => {
        const base = `[GuildMemberAdd][Guild:${rawMember.guild?.id ?? 'N/A'}][User:${rawMember.id}]`;
        try {
            const member = await ensureFullMemberData(rawMember);
            if (!member) {
                logWarn(`${base} Unusable member data — skipping.`);
                return;
            }
            const { guild, user } = member;
            const prefix = `[GuildMemberAdd][Guild:${guild.id}][User:${user.id}]`;
            logInfo(`${prefix} User ${user.username} joined.`);

            if (!hasManageGuild(guild)) {
                logWarn(`${prefix} Bot lacks Manage Guild — recording join without attribution.`);
                ctx.repos.joinHistory.record(guild.id, user.id, null, null);
                return;
            }

            // 1. Heuristic delay so Discord's invite-uses counter has time to propagate.
            await new Promise((resolve) => setTimeout(resolve, INVITE_FETCH_DELAY_MS));

            const currentInvites = await fetchInvitesSafe(guild);
            const cachedUses = await ensureCachedUses(guild);

            // 2. Build the {code → uses} map from the live invites collection.
            const currentUses = new Map<string, number>();
            if (currentInvites) {
                for (const inv of currentInvites.values()) {
                    currentUses.set(inv.code, inv.uses ?? 0);
                }
            }

            // 3. Compare against tracked bot-generated invites.
            const trackedInvites = ctx.repos.userInvites.getAllInGuild(guild.id);
            if (trackedInvites.length === 0) {
                logInfo(`${prefix} No bot-tracked invites — recording without attribution.`);
                ctx.repos.joinHistory.record(guild.id, user.id, null, null);
                await cacheGuildInvites(guild);
                return;
            }

            const { attribution, staleInviteCodes } = findUsedInviteAndStale(
                currentInvites ? currentUses : null,
                cachedUses,
                trackedInvites,
                prefix,
            );

            // 4. Purge stale invites (deleted on Discord but still in our DB).
            if (staleInviteCodes.length > 0) {
                logInfo(`${prefix} Cleaning up ${staleInviteCodes.length} stale invite(s).`);
                try {
                    ctx.repos.userInvites.deleteManyByCode(staleInviteCodes, guild.id);
                } catch (err) {
                    logError(`${prefix} Stale cleanup failed:`, err);
                }
            }

            // 5. Always record JoinHistory (with or without attribution).
            ctx.repos.joinHistory.record(
                guild.id,
                user.id,
                attribution?.inviterId ?? null,
                attribution?.inviteCode ?? null,
            );

            // 6. If we attributed, create the pending TrackedJoin and send the welcome message.
            //    Anti-cheat lands in PR #9; for now every attributed join is treated as legitimate.
            if (attribution) {
                ctx.repos.trackedJoins.upsertPending(guild.id, user.id, attribution.inviterId, attribution.inviteCode);
                logInfo(
                    `${prefix} Recorded pending TrackedJoin (inviter ${attribution.inviterId}, code ${attribution.inviteCode}).`,
                );

                // Send welcome message (best effort — fetch inviter as a User, not a member of THIS guild,
                // so we still mention them even if they since left).
                try {
                    const inviterUser = await client.users.fetch(attribution.inviterId).catch(() => null);
                    if (inviterUser) {
                        const validatedCount = ctx.repos.trackedJoins.countByStatus(
                            guild.id,
                            attribution.inviterId,
                            'validated',
                        );
                        await sendWelcomeMessage(ctx, guild, member, inviterUser, validatedCount);
                    }
                } catch (err) {
                    logError(`${prefix} Welcome message dispatch failed:`, err);
                }
            }

            // 7. Refresh cache so the next join sees the new counts.
            await cacheGuildInvites(guild);
        } catch (err) {
            logError(`${base} Uncaught error in handler:`, err);
        }
    });
}
