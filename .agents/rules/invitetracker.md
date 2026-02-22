---
trigger: always_on
---

# Project: invite-tracker

## Stack
- Node.js 24 LTS (via nvm, .nvmrc pinned to 24)
- discord.js ^14.25.1 (zainstalowana przez bun — latest stable v14)
- SQLite (natywny sterownik bun:sqlite — brak zewnętrznych zależności DB)
- dotenv ^16.5.0
- js-yaml ^4.1.0 (custom-lang.yaml translations)
- Package manager: bun (bun install, bun run)
- Deploy target: self-hosted / VPS

## MCP dla tego projektu
- discord.js API → web_search_exa "discord.js v14 [topic] site:discord.js.org" then crawling_exa
- SQLite / bun:sqlite → web_search_exa then crawling_exa https://bun.sh/docs/api/sqlite
- Node.js core → no MCP needed
- Docs: https://discord.js.org/docs/packages/discord.js/14.25.1
- Bun SQLite docs: https://bun.sh/docs/api/sqlite

## Commands
# Install dependencies
bun install

# Run bot (production)
bun run start         # → bun index.js

# Run bot (dev, auto-restart on change)
bun run dev           # → bun --watch index.js

# Deploy slash commands to Discord
bun run deploy        # → bun deploy-commands.js

## Struktura projektu
index.js                     # główny plik bota — klient, eventy, caching zaproszeń
config.js                    # non-sensitive runtime config (kolory, limity)
deploy-commands.js           # jednorazowy skrypt rejestracji slash commands
commands/
  invite.js                  # /invite — generuje/pokazuje link i statystyki
  leaderboard.js             # /leaderboard — ranking inviters
  check.js                   # /check [admin only] — sprawdza statystyki usera
database/
  db.js                      # SQLite interface (bun:sqlite) — tabele UserInvites + TrackedJoins
utils/
  logger.js                  # wspólny logger (logDebug/Info/Warn/Error)
  translator.js              # t() — odczytuje klucze z custom-lang.yaml
custom-lang.yaml             # tłumaczenia (sekcje: en:, custom:)
invites.db                   # plik bazy SQLite (auto-tworzony przy starcie bota)

## Zasady kodu
- CommonJS only (require/module.exports) — NO ESM import/export
- "type": "commonjs" ustawione w package.json
- Database: używaj WYŁĄCZNIE database/db.js (dbInterface). Nie importuj bun:sqlite bezpośrednio
  poza tym plikiem. bun:sqlite jest synchroniczne — nie dodawaj zbędnych await przy operacjach DB.
- Mongoose zostało USUNIĘTE — nigdy nie importuj go ponownie
- All secrets via .env (DISCORD_TOKEN, CLIENT_ID, ADMIN_IDS) — NEVER w config.js
- SQLite nie wymaga MONGODB_URI w .env
- config.js = non-sensitive runtime config only (embedColor, limits, intervals)
- Use discord.js v14 API only: GatewayIntentBits, Events, PermissionsBitField, Collection
- NEVER use deprecated v13 patterns: no MessageEmbed (use EmbedBuilder), no Intents.FLAGS
- NEVER use deprecated user.tag — używaj user.username lub member.displayName
- Slash command files MUST export { data: SlashCommandBuilder, execute: async fn }
- Locale/translations: zawsze przez utils/translator.js t() — nigdy hardcode strings
- Logging: ZAWSZE importuj { logDebug, logInfo, logWarn, logError } from utils/logger.js
  — ZERO bezpośrednich console.log/warn/error/debug w żadnym pliku projektu
- Async error handling: wrap all event handlers w try/catch, reply ephemeral on error
- Intents: GuildMembers jest PRIVILEGED — musi być włączony w Discord Dev Portal
- Channel type check: przy tworzeniu invite akceptuj GuildText, GuildAnnouncement,
  GuildVoice, GuildStageVoice — dla threadów/forów używaj kanału nadrzędnego (isThread())
- setInterval timery: zawsze zapisuj referencję (let x = setInterval(...))
  i czyść clearInterval(x) w shutdown handler

## Env variables (.env)
DISCORD_TOKEN=           # token bota (wymagany)
CLIENT_ID=               # application ID (wymagany)
ADMIN_IDS=               # ID adminów po przecinku, bez spacji (wymagany dla /check)
LOCALE_LANG=             # 'en' lub 'custom' (opcjonalny, domyślnie 'en')
TEST_GUILD_ID=           # ID serwera testowego dla deploy-commands (opcjonalny)
VALIDATION_PERIOD_DAYS=  # override domyślnych 7 dni (opcjonalny)
VALIDATION_CHECK_INTERVAL_MINUTES=  # override domyślnych 60 min (opcjonalny)
LOG_LEVEL=               # DEBUG | INFO | WARN | ERROR (domyślnie INFO)
PERFORM_GUILD_DELETE_CLEANUP=  # true/false (domyślnie false)

## WAŻNE – agent behavior
- NEVER modify files based on analysis alone
- Analysis = read-only, wait for user confirmation before making changes
- Before changing discord.js version: verify exact version via crawling_exa on npmjs.com FIRST
- Before adding new intents: check if PRIVILEGED (GuildMembers, GuildPresences, MessageContent)
- bun run start/dev BĘDZIE crashować bez .env — to oczekiwane zachowanie
- Nie używaj npm/npx — projekt używa wyłącznie bun/bunx
