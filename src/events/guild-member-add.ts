import { Events } from 'discord.js';
import { INVITE_FETCH_DELAY_MS } from '@/config/constants.ts';
import { detectRejoin } from '@/services/anti-cheat.ts';
import { isAccountTooYoung } from '@/services/anti-fake.ts';
import { findUsedInviteAndStale } from '@/services/invite-attribution.ts';
import { cacheGuildInvites, ensureCachedUses, fetchInvitesSafe } from '@/services/invite-cache.ts';
import { sendWelcomeMessage } from '@/services/welcome.ts';
import type { AppClient, AppContext } from '@/types/discord.ts';
import { ensureFullMemberData } from '@/utils/discord-members.ts';
import { logError, logInfo, logWarn } from '@/utils/logger.ts';
import { hasManageGuild } from '@/utils/permissions.ts';

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
            await Bun.sleep(INVITE_FETCH_DELAY_MS);

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

            // 5. Always record JoinHistory (with or without attribution). Capture id for potential flagging.
            const joinHistoryId = ctx.repos.joinHistory.record(
                guild.id,
                user.id,
                attribution?.inviterId ?? null,
                attribution?.inviteCode ?? null,
            );

            // 6. If we attributed, run anti-fake + anti-cheat; flagged joins skip TrackedJoin/welcome.
            if (attribution) {
                const cfg = ctx.repos.guildConfig.getOrDefault(guild.id);
                const tooYoung = isAccountTooYoung(user.createdTimestamp, cfg.min_account_age_days);
                const verdict = detectRejoin(ctx, guild.id, user.id, attribution.inviterId, cfg.anti_cheat_window_days);

                if (tooYoung) {
                    logWarn(
                        `${prefix} Anti-fake flag: account created ${user.createdAt?.toISOString() ?? '?'} is younger than ${cfg.min_account_age_days}d — no invite credit.`,
                    );
                    ctx.repos.trackedJoins.upsertWithStatus(
                        guild.id,
                        user.id,
                        attribution.inviterId,
                        attribution.inviteCode,
                        'flagged',
                    );
                } else if (verdict.isSuspicious) {
                    logWarn(
                        `${prefix} Anti-cheat flag: ${user.id} previously invited by ${verdict.previousInviterId}, now by ${attribution.inviterId} within ${cfg.anti_cheat_window_days}d.`,
                    );
                    ctx.repos.trackedJoins.upsertWithStatus(
                        guild.id,
                        user.id,
                        attribution.inviterId,
                        attribution.inviteCode,
                        'flagged',
                    );
                    ctx.repos.joinHistory.flagAsRejoin(joinHistoryId);
                } else {
                    ctx.repos.trackedJoins.upsertPending(
                        guild.id,
                        user.id,
                        attribution.inviterId,
                        attribution.inviteCode,
                    );
                    logInfo(
                        `${prefix} Recorded pending TrackedJoin (inviter ${attribution.inviterId}, code ${attribution.inviteCode}).`,
                    );

                    // Send welcome message (best effort — fetch inviter as a User, not a member of THIS guild,
                    // so we still mention them even if they since left).
                    try {
                        const inviterUser = await client.users.fetch(attribution.inviterId).catch(() => null);
                        if (inviterUser) {
                            // {count} in the template = inviter's total credit (validated + bonus).
                            const validatedCount = ctx.repos.trackedJoins.countByStatus(
                                guild.id,
                                attribution.inviterId,
                                'validated',
                            );
                            const bonusCount = ctx.repos.bonusInvites.get(guild.id, attribution.inviterId);
                            await sendWelcomeMessage(ctx, guild, member, inviterUser, validatedCount + bonusCount);
                        }
                    } catch (err) {
                        logError(`${prefix} Welcome message dispatch failed:`, err);
                    }
                }
            }

            // 7. Refresh cache so the next join sees the new counts.
            await cacheGuildInvites(guild);
        } catch (err) {
            logError(`${base} Uncaught error in handler:`, err);
        }
    });
}
