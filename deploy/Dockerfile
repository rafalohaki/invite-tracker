# syntax=docker/dockerfile:1.7
FROM oven/bun:1.3-slim

WORKDIR /app

# 1. Dependency cache layer — only invalidates when package.json or bun.lock changes.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# 2. Source (TypeScript, SQL migrations, YAML i18n).
COPY src ./src
COPY tsconfig.json ./

# 3. Non-root user + writable data dir for the SQLite volume mount.
RUN useradd -r -u 1001 -m -d /home/bot bot \
 && mkdir -p /data \
 && chown -R bot:bot /data /app
USER bot

# 4. SQLite location inside container. Mount /data as a named volume.
ENV DATABASE_PATH=/data/invites.db
ENV NODE_ENV=production

# 5. Healthcheck — minimal, since the bot is a long-lived gateway client (no HTTP).
HEALTHCHECK --interval=60s --timeout=10s --start-period=30s --retries=3 \
    CMD bun -e "process.exit(0)" || exit 1

CMD ["bun", "src/index.ts"]
