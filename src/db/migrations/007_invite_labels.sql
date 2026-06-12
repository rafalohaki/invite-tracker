-- InviteLabels: human-readable source labels for invite codes ("YouTube", "Twitter", ...).
-- Premium feature in hosted invite bots: track where members come from and optionally
-- auto-assign a role to members who join via a labeled invite.
-- One label per code; the same label may span multiple codes (stats group by label).
CREATE TABLE IF NOT EXISTS InviteLabels (
    guildId    TEXT NOT NULL,
    inviteCode TEXT NOT NULL,
    label      TEXT NOT NULL,
    autoRoleId TEXT,
    createdAt  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updatedAt  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (guildId, inviteCode)
);
