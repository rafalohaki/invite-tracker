export interface UserInviteRow {
    userId: string;
    guildId: string;
    inviteCode: string;
    createdAt: string;
    updatedAt: string;
}

export type JoinStatus = 'pending' | 'validated' | 'left_early' | 'flagged';

export interface TrackedJoinRow {
    id: number;
    guildId: string;
    inviteeId: string;
    inviterId: string;
    inviteCodeUsed: string;
    joinTimestamp: string;
    status: JoinStatus;
    validationTimestamp: string | null;
    leaveTimestamp: string | null;
    createdAt: string;
    updatedAt: string;
}

export type Locale = 'en' | 'custom';

export interface GuildConfigRow {
    guildId: string;
    validation_period_days: number | null;
    welcome_channel_id: string | null;
    welcome_template: string | null;
    locale: Locale | null;
    anti_cheat_window_days: number | null;
    createdAt: string;
    updatedAt: string;
}

export interface RoleRewardRow {
    id: number;
    guildId: string;
    threshold: number;
    roleId: string;
    createdAt: string;
}

export interface JoinHistoryRow {
    id: number;
    guildId: string;
    userId: string;
    inviterId: string | null;
    inviteCodeUsed: string | null;
    joinTimestamp: string;
    leftTimestamp: string | null;
    flaggedAsRejoin: 0 | 1;
}

export type LeaderboardPeriod = 'all' | 'week' | 'month';

export interface LeaderboardEntryRow {
    inviterId: string;
    count: number;
}
