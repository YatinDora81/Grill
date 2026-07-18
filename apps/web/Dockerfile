# Grill web — Next.js App Router + API. Build context = monorepo root.
FROM oven/bun:1.3.7-debian AS base
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# ── deps ──────────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json bun.lock turbo.json ./
COPY apps/web/package.json ./apps/web/
COPY apps/audio/package.json ./apps/audio/
COPY packages/db/package.json ./packages/db/
COPY packages/types/package.json ./packages/types/
COPY packages/eslint-config/package.json ./packages/eslint-config/
COPY packages/typescript-config/package.json ./packages/typescript-config/
# canvas (optional peer of unpdf) has no Linux prebuild and exits 1 even though
# the rest of the tree installed. Accept that, but fail hard if Next never landed.
RUN set -eu; \
  bun install --frozen-lockfile || bun install || true; \
  if [ -d node_modules/next ] || ls -d node_modules/.bun/next@* >/dev/null 2>&1; then \
    echo "bun install ok (optional canvas may be missing)"; \
  else \
    echo "bun install failed — next is missing"; \
    exit 1; \
  fi

# ── build ─────────────────────────────────────────────────────────────
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# prisma.config.ts requires DATABASE_URL even for `generate`
ENV DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build?schema=ai_interview"
ENV NEXT_TELEMETRY_DISABLED=1

# Re-link workspaces against full sources, then generate (leave NODE_ENV unset
# so the prisma CLI from dependencies resolves).
RUN bun install --frozen-lockfile || bun install || true
RUN bun run --filter @repo/db db:generate

ENV NODE_ENV=production
# lib/env.ts validates keys at import time, and `next build` evaluates route
# modules while collecting page data. Real secrets are injected at runtime — these
# build-only placeholders just satisfy that eager check and are never used.
ENV GEMINI_API_KEYS="build-placeholder"
ENV GROQ_API_KEYS="build-placeholder"
ENV JWT_SECRET="build-placeholder-build-placeholder-build-placeholder"
RUN bun run --filter web build

# ── run ───────────────────────────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=4000

COPY --from=builder /app /app
COPY docker/web-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 4000
ENTRYPOINT ["/entrypoint.sh"]
