# Invite Tracker — Discord Bot (v2)

A Discord bot that tracks user-generated invites, validates joins after a configurable retention period, and rewards top inviters with roles. Built on **Bun + TypeScript + discord.js v14 + bun:sqlite**.

[![CI](https://github.com/rafalohaki/invite-tracker/actions/workflows/ci.yml/badge.svg)](https://github.com/rafalohaki/invite-tracker/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/Bun-1.3+-000000.svg?logo=bun&logoColor=white)](https://bun.sh)
[![discord.js](https://img.shields.io/badge/discord.js-v14.26-blue.svg?logo=discord&logoColor=white)](https://discord.js.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org)

## Features

| Command | What it does |
|---|---|
| `/invite` | Generates (or returns) your personal permanent invite link, plus your validated / pending / bonus / total counts. |
| `/leaderboard period:[all\|week\|month]` | Top inviters in this server, paginated 10 per page with Prev / Next buttons. `all` includes bonus invites. |
| `/who-invited <user>` | Shows who invited a member (inviter, invite code, relative join time, status). |
| `/invited [user]` | Lists the latest 20 members someone invited, with per-join status icons (defaults to you). |
| `/server-stats` | Public server-wide stats: joins per status, lifetime joins/leaves, flagged rejoins, top inviter. |
| `/check <user>` | _(admin)_ Inspect another user's invite stats, including flagged rejoins. |
| `/bonus add\|remove <user> <amount> \| show <user>` | _(Manage Guild)_ Grant or revoke bonus invites; counts toward totals and role rewards. |
| `/invite-labels add <code> <label> [role] \| remove <code> \| list` | _(Manage Guild)_ Label any invite ("YouTube", "Twitter"…) to track join sources; optional auto-role for members joining via that invite. |
| `/invite-sources` | Public bar chart of joins per labeled invite — see where members come from. |
| `/export leaderboard\|joins` | _(Manage Guild)_ CSV export: full leaderboard (validated/bonus/total + display names) or raw tracked joins. |
| `/config get \| set <key> <value> \| reset <key>` | _(Manage Guild)_ Per-guild configuration with autocomplete on `key`. |
| `/role-rewards add <threshold> <role> \| remove <threshold> \| list` | _(Manage Guild)_ Grant a role automatically when an inviter reaches N invites (validated + bonus). |

Behind the scenes:

- **Validated vs pending joins** — a join enters `pending` immediately; if the user is still in the guild after `validation_period_days` (default 7), it flips to `validated`. If they leave first, it flips to `left_early`.
- **Anti-cheat rejoin detection** — if the same user leaves and rejoins via a *different* inviter inside the `anti_cheat_window_days` window (default 30), the new join is recorded as `flagged` and earns no validated credit. Visible in `/check`.
- **Anti-fake account-age filter** — when `min_account_age_days` is set, joins from Discord accounts younger than the threshold are `flagged` and earn no credit.
- **Bonus invites** — admins can add/remove credit per user. The `all` leaderboard, `/invite`, `/check`, role rewards and the welcome `{count}` all use validated + bonus.
- **Join/leave log** — set `log_channel_id` and the bot posts a line for every join (with inviter attribution, fake/rejoin flags and source label) and every leave. Mentions never ping.
- **Invite labels (source tracking)** — label any invite code and the bot detects which code each join used (diffing use counts across *all* guild invites, not just bot-generated ones), records it in `JoinHistory`, and can auto-assign a role per label. Fake-flagged accounts never receive auto-roles.
- **Live invite cache** — `InviteCreate`/`InviteDelete` gateway events keep the uses cache fresh and purge deleted bot invites from the DB immediately.
- **Role rewards** — checked on every promotion to `validated` and on every `/bonus add`. Bulk `member.roles.add(array)` for rate-limit friendliness; hierarchy + permission check before every grant.
- **i18n** — every user-facing string lives in `src/i18n/custom-lang.yaml` (English + Polish `custom` section). Global default via `LOCALE_LANG`; per-guild override via `/config set locale custom|en`.

## Requirements

- **[Bun](https://bun.sh) ≥ 1.3.0** — runs `.ts` natively, no build step on prod.
- A Discord bot application ([Developer Portal](https://discord.com/developers/applications)) with:
  - **Privileged Intent: `GUILD_MEMBERS`** enabled in the Bot tab.
  - Bot scopes: `bot`, `applications.commands`.
  - Permissions in invite URL: `Manage Guild`, `Create Instant Invite`, and `Manage Roles` (only if you plan to use `/role-rewards`).

## Setup (local)

```bash
git clone https://github.com/rafalohaki/invite-tracker.git
cd invite-tracker
bun install
cp .env.example .env
# fill in DISCORD_TOKEN, CLIENT_ID, ADMIN_IDS
bun run deploy:commands   # register slash commands with Discord
bun run start             # or `bun run dev` for hot-reload
```

## Configuration

### Environment variables (global defaults)

| Variable | Default | Description |
|---|---|---|
| `DISCORD_TOKEN` | — | Bot token. **Required.** |
| `CLIENT_ID` | — | Application ID. **Required.** |
| `TEST_GUILD_ID` | _(unset)_ | If set, `deploy:commands` registers slash commands to this guild only (near-instant updates for dev). |
| `ADMIN_IDS` | _(empty)_ | Comma-separated user IDs allowed to use `/check`. |
| `LOG_LEVEL` | `INFO` | `DEBUG` \| `INFO` \| `WARN` \| `ERROR`. |
| `DATABASE_PATH` | `./invites.db` | SQLite file path. In Docker: `/data/invites.db`. |
| `LOCALE_LANG` | `en` | Default locale (`en` \| `custom`). |
| `VALIDATION_PERIOD_DAYS` | `7` | How long a user must stay to count as a validated invite. |
| `VALIDATION_CHECK_INTERVAL_MINUTES` | `60` | Validation task cadence. |
| `ANTI_CHEAT_WINDOW_DAYS` | `30` | Rejoin window for anti-cheat. Set to `0` to disable. |
| `MIN_ACCOUNT_AGE_DAYS` | `0` | Joins from accounts younger than this are flagged as fake. `0` disables. |
| `PERFORM_GUILD_DELETE_CLEANUP` | `false` | If `true`, wipes guild-scoped DB rows when the bot leaves a guild. |

### Per-guild configuration (`/config`)

Every guild can override the environment defaults without a redeploy:

| Key | Type | Example |
|---|---|---|
| `validation_period_days` | integer 1–365 | `14` |
| `welcome_channel_id` | snowflake | `123456789012345678` |
| `welcome_template` | string ≤ 1000 chars | `Welcome {user}! Invited by {inviter} (#{count}).` |
| `locale` | `en` \| `custom` | `custom` |
| `anti_cheat_window_days` | integer 1–365 | `60` |
| `min_account_age_days` | integer 0–365 (`0` = off) | `7` |
| `log_channel_id` | snowflake | `123456789012345678` |

```text
/config set welcome_channel_id 123456789012345678
/config set welcome_template Welcome {user}, invited by {inviter}!
/config get
```

Template placeholders: `{user}`, `{inviter}`, `{count}`. `@everyone`, `@here`, and role mentions in the template text are stripped by `allowedMentions` at send time — only the invitee and inviter are pinged.

## Deployment with Docker

```bash
cp .env.example .env   # then fill in real values
docker compose -f deploy/docker-compose.yml up -d --build
```

- Single-stage `oven/bun:1.3-slim` image, non-root user `bot:1001`.
- SQLite file lives in a named volume `invite-tracker-data` mounted at `/data`. Survives `docker compose down`.
- Log rotation: 10 MB × 3 files per container.

To redeploy slash commands after changing them:

```bash
docker compose -f deploy/docker-compose.yml run --rm bot bun src/deploy-commands.ts
```

## Development

```bash
bun run dev        # bun --watch src/index.ts
bun run test       # bun test (133 tests, in-memory SQLite, zero Discord I/O)
bun run lint       # Biome v2 (lint + format)
bun run lint:fix   # auto-fix lint + format
bun run typecheck  # tsc --noEmit
bun run audit      # bun audit (currently 0 vulnerabilities)
bun run verify     # lint + typecheck + test
```

CI runs `lint`, `typecheck`, `test`, and `audit` on every push and PR to `MAIN`.

## Architecture

```
src/
├── index.ts                # bootstrap: env → DB migrate → client → events → login
├── client.ts               # createClient() with intents + Collection<Command>
├── deploy-commands.ts      # REST.put for slash-command registration
├── config/{env, constants}
├── db/
│   ├── client.ts           # createDb(path) factory; not a singleton (testable)
│   ├── migration-runner.ts # idempotent SQL migration runner
│   ├── migrations/*.sql    # 7 forward migrations (no down migrations)
│   └── repositories/*.ts   # 7 typed repositories + createRepositories(db) factory
├── services/               # business logic, zero discord.js coupling where possible
│   ├── invite-cache.ts
│   ├── invite-attribution.ts
│   ├── validation.ts       # periodic scheduler + batched member fetch
│   ├── welcome.ts          # template render + allowedMentions whitelist
│   ├── event-log.ts        # join/leave log channel (pure renderers + sender)
│   ├── role-rewards.ts     # hierarchy check + bulk roles.add
│   ├── anti-cheat.ts       # rejoin detection
│   └── anti-fake.ts        # account-age fake detection
├── commands/               # 12 slash-command builders, factory pattern (ctx-injected)
├── events/                 # 7 event handlers (ready / interaction / guild × 2 / member × 2 / invites)
├── interactions/           # button + autocomplete handlers
├── i18n/{translator, custom-lang.yaml}
├── utils/                  # logger, permissions, discord-errors, time, safe-reply, result, discord-members
└── types/                  # DB row types, AppContext, Command
```

### Dependency injection

Every command and event handler is a closure over `AppContext`:

```ts
interface AppContext {
    db: Database;
    repos: {
        userInvites: UserInvitesRepository;
        trackedJoins: TrackedJoinsRepository;
        guildConfig: GuildConfigRepository;
        roleRewards: RoleRewardsRepository;
        joinHistory: JoinHistoryRepository;
        bonusInvites: BonusInvitesRepository;
    };
}
```

Tests instantiate `:memory:` databases and pass them straight into repositories — no module-level state to reset.

## Database

SQLite via `bun:sqlite`. Schema is versioned through plain `.sql` files in `src/db/migrations/`, applied at startup. Re-running is a no-op (tracked in the `_migrations` table).

Tables:

- **`UserInvites`** — bot-generated invite code per user per guild.
- **`TrackedJoins`** — one row per attributed join; status transitions `pending → validated | left_early | flagged`.
- **`GuildConfig`** — per-guild overrides; NULL columns fall back to env.
- **`RoleRewards`** — `(guildId, threshold, roleId)` with UNIQUE constraint.
- **`JoinHistory`** — full audit trail with `flaggedAsRejoin` boolean.
- **`BonusInvites`** — admin-granted net bonus per `(guildId, userId)`; may go negative.
- **`InviteLabels`** — source label + optional auto-role per `(guildId, inviteCode)`.

All `DEFAULT` clauses and write paths use `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')` so timestamps match `Date.toISOString()` byte-for-byte — lexicographic comparison is guaranteed correct.

## License

MIT — see [LICENSE](LICENSE).
