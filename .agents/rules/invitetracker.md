---
trigger: always_on
---

# Project: invite-tracker (v2 — TypeScript rewrite)

## Stack
- Bun ≥ 1.3 — runs `.ts` natively, no build step (runtime AND package manager; never npm/npx/node)
- TypeScript strict (tsc --noEmit only, TS 6.x), path alias `@/*` → `src/*`
- discord.js v14 (latest stable, Components v2 UI: ContainerBuilder + MessageFlags.IsComponentsV2)
- bun:sqlite (native driver, WAL mode) — no external DB dependencies
- zod v4 (env + config validation), js-yaml (i18n), Biome v2 (lint + format)
- Deploy target: self-hosted / VPS via Docker (`deploy/`)

## Commands
- `bun install`
- `bun run start` / `bun run dev`        # bot (dev = --watch)
- `bun run deploy:commands`              # register slash commands with Discord
- `bun run verify`                       # lint + typecheck + test — run before every commit
- `bun run lint:fix`                     # Biome auto-fix

## Architektura (src/)
- `index.ts` — bootstrap: env → DB migrate → client → events → login; graceful shutdown
- `config/{env,constants}.ts` — zod-validated env (fail-fast), bot-wide constants
- `db/client.ts` — createDb(path) factory (nie singleton; testy używają `:memory:`)
- `db/migrations/*.sql` — forward-only, idempotentne (tabela `_migrations`)
- `db/repositories/` — jedno repo na tabelę + `createRepositories(db)` factory;
  WSZYSTKIE zapytania SQL wyłącznie w repozytoriach (prepared statements)
- `services/` — logika biznesowa, czyste funkcje gdzie się da (testowalne bez Discorda)
- `commands/` — fabryki `build*Command(ctx)` zwracające `{ data, execute, autocomplete? }`
- `events/` — `register*(client, ctx)` per zdarzenie
- `i18n/custom-lang.yaml` — sekcje `en:` (wymagana) i `custom:` (PL); dostęp przez `t()`
- `types/` — typy wierszy DB + `AppContext` (DI: `{ db, repos }`)

## Zasady kodu
- ESM only (`"type": "module"`), importy z rozszerzeniem `.ts` i aliasem `@/`
- Dependency injection przez `AppContext` — zero stanu modułowego poza invite-cache
- bun:sqlite jest synchroniczne — nie dodawaj zbędnych `await` przy operacjach DB
- Wszystkie sekrety przez `.env` (walidacja w `config/env.ts`); nigdy w kodzie
- UI: Components v2 (ContainerBuilder); NIE używaj EmbedBuilder w nowym kodzie
- NIGDY wzorce v13 (MessageEmbed, Intents.FLAGS) ani deprecated `user.tag`
- Teksty użytkownika ZAWSZE przez `t()` z `custom-lang.yaml` (en + custom/PL)
- Logging ZAWSZE przez `@/utils/logger.ts` — zero gołych console.*
- Event handlery owinięte w try/catch; błędy komend → ephemeral reply
- Timery: trzymaj uchwyt i czyść w shutdown (wzorzec: ValidationScheduler.cancel())
- Timestampy: ISO 8601 zgodne z `strftime('%Y-%m-%dT%H:%M:%fZ','now')` (porównania leksykograficzne)
- Nowe tabele: migracja `NNN_*.sql` + typ wiersza w `types/db.ts` + repo + wpis
  w `createRepositories` + interfejs `Repositories` + testy na `:memory:`
- Intenty: GuildMembers jest PRIVILEGED (włącz w Dev Portal); GuildInvites wymagany dla cache

## Testy
- `bun test` — bez I/O Discorda; repozytoria i czyste serwisy na `createTestDb()` (`:memory:`)
- Test migracji utrzymuje pełną listę plików `NNN_*.sql` — zaktualizuj przy nowej migracji

## Agent behavior
- Przed zmianą wersji discord.js sprawdź najnowszą stabilną (npm view discord.js version)
- Nowe intenty: sprawdź czy PRIVILEGED (GuildMembers, GuildPresences, MessageContent)
- `bun run start/dev` crashuje bez `.env` — to oczekiwane (fail-fast)
- Przed commitem: `bun run verify` musi przejść w całości
