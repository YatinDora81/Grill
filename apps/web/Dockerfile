FROM oven/bun:1.3.7-debian AS base
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json bun.lock turbo.json ./
COPY apps/web/package.json ./apps/web/
COPY apps/audio/package.json ./apps/audio/
COPY packages/db/package.json ./packages/db/
COPY packages/types/package.json ./packages/types/
COPY packages/eslint-config/package.json ./packages/eslint-config/
COPY packages/typescript-config/package.json ./packages/typescript-config/
RUN set -eu; \
  bun install --frozen-lockfile || bun install || true; \
  if [ -d node_modules/next ] || ls -d node_modules/.bun/next@* >/dev/null 2>&1; then \
    echo "bun install ok (optional canvas may be missing)"; \
  else \
    echo "bun install failed — next is missing"; \
    exit 1; \
  fi

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build?schema=ai_interview"
ENV NEXT_TELEMETRY_DISABLED=1

RUN bun install --frozen-lockfile || bun install || true
RUN bun run --filter @repo/db db:generate

ENV NODE_ENV=production
ENV GEMINI_API_KEYS="build-placeholder"
ENV GROQ_API_KEYS="build-placeholder"
ENV JWT_SECRET="build-placeholder-build-placeholder-build-placeholder"
RUN bun run --filter web build

FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=4000

COPY --from=builder /app /app
COPY docker/web-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 4000
ENTRYPOINT ["/entrypoint.sh"]
